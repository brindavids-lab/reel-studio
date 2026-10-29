#!/usr/bin/env node
// Usage: node scripts/render.mjs <jobId>
// Reads jobs/<id>/{job.json, words.json, edit.json} and writes jobs/<id>/output/reel-r<revision>.mp4
import fs from 'node:fs';
import path from 'node:path';
import { FONTS_DIR } from '../lib/paths.mjs';
import { readJob, updateJob, setStatus, jobDir } from '../lib/jobs.mjs';
import { probe, runFfmpeg, detectSilences, hasFilter } from '../lib/ff.mjs';
import { resolveLook } from '../lib/config.mjs';
import { buildAss } from '../lib/ass.mjs';

const id = process.argv[2];
if (!id) {
  console.error('Usage: node scripts/render.mjs <jobId>');
  process.exit(1);
}

const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) : fallback);
const norm = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function mergeRanges(ranges, minLen = 0.15) {
  const sorted = ranges.filter(([a, b]) => b - a > 0).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out.filter(([a, b]) => b - a >= minLen);
}

try {
  const dir = jobDir(id);
  const job = readJob(id);
  const settings = job.settings || {};
  const edit = readJson(path.join(dir, 'edit.json'), {});
  const source = path.join(dir, job.source);
  const info = probe(source);
  if (!info) throw new Error('Could not read the source video (is ffprobe installed?)');
  if (!hasFilter('subtitles')) throw new Error('This ffmpeg build has no "subtitles" filter (libass). Install a full ffmpeg build.');

  setStatus(id, 'working', 'Planning cuts', 40);

  // 1. what to keep
  let cuts = (edit.cuts || []).map(([a, b]) => [Number(a), Number(b)]);
  if (settings.tightenSilences) {
    for (const [s, e] of detectSilences(source)) cuts.push([s + 0.18, e - 0.18]);
  }
  cuts = mergeRanges(cuts.map(([a, b]) => [Math.max(0, a), Math.min(info.duration, b)]));
  const keep = [];
  let cursor = 0;
  for (const [a, b] of cuts) {
    if (a > cursor) keep.push([cursor, a]);
    cursor = b;
  }
  if (cursor < info.duration) keep.push([cursor, info.duration]);
  const outDuration = keep.reduce((n, [a, b]) => n + (b - a), 0);

  const mapTime = (t) => {
    let acc = 0;
    for (const [a, b] of keep) {
      if (t >= a && t <= b) return acc + (t - a);
      acc += b - a;
    }
    return null;
  };

  // 2. transcript -> words on the new timeline
  const transcript = readJson(path.join(dir, 'words.json'), { words: [] });
  const fixes = Object.fromEntries(Object.entries(edit.fixes || {}).map(([k, v]) => [norm(k), v]));
  const words = [];
  for (const w of transcript.words) {
    const start = mapTime(w.start);
    if (start === null) continue;
    const segEnd = keep.find(([a, b]) => w.start >= a && w.start <= b)[1];
    const end = mapTime(Math.min(w.end, segEnd)) ?? start + 0.2;
    let text = w.text.trim();
    const fix = fixes[norm(text)];
    if (fix !== undefined) text = fix + (text.match(/[.,;:!?]+$/)?.[0] ?? '');
    if (text) words.push({ text, start, end: Math.max(end, start + 0.12) });
  }

  // 3. captions file
  const look = resolveLook(settings, edit);
  if (!edit.title && settings.titleText) edit.title = { line1: '', accent: settings.titleText };
  const { w: W, h: H } = look.format;
  fs.writeFileSync(path.join(dir, 'captions.ass'), buildAss({ look, words, edit, duration: outDuration }));

  // 4. filter graph
  const f = [];
  const segs = keep.length;
  const needsTrim = !(segs === 1 && keep[0][0] === 0 && keep[0][1] >= info.duration - 0.01);
  if (needsTrim) {
    keep.forEach(([a, b], i) => {
      f.push(`[0:v]trim=start=${a.toFixed(3)}:end=${b.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`);
      if (info.hasAudio) f.push(`[0:a]atrim=start=${a.toFixed(3)}:end=${b.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
    });
    const ins = keep.map((_, i) => `[v${i}]` + (info.hasAudio ? `[a${i}]` : '')).join('');
    f.push(`${ins}concat=n=${segs}:v=1:a=${info.hasAudio ? 1 : 0}[v0]` + (info.hasAudio ? '[a0]' : ''));
  } else {
    f.push('[0:v]null[v0]');
    if (info.hasAudio) f.push('[0:a]anull[a0]');
  }

  const srcRatio = info.width / info.height;
  const dstRatio = W / H;
  const fit = settings.fit && settings.fit !== 'auto' ? settings.fit : Math.abs(srcRatio / dstRatio - 1) <= 0.12 ? 'fill' : 'blur';
  if (fit === 'fill') {
    f.push(`[v0]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[v1]`);
  } else {
    f.push(
      `[v0]split[bg][fg]`,
      `[bg]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=40:6,eq=brightness=-0.08[bgb]`,
      `[fg]scale=${W}:${H}:force_original_aspect_ratio=decrease[fgs]`,
      `[bgb][fgs]overlay=(W-w)/2:(H-h)/2,setsar=1[v1]`,
    );
  }
  const grade = look.style.grade || {};
  const chain = [];
  if (grade.eq) chain.push(`eq=${grade.eq}`);
  if (grade.extra) chain.push(grade.extra);
  if (grade.vignette) chain.push('vignette=PI/5');
  const fontsRel = path.relative(dir, FONTS_DIR).split(path.sep).join('/');
  chain.push(`subtitles=captions.ass:fontsdir=${fontsRel}`);
  f.push(`[v1]${chain.join(',')}[vout]`);
  if (info.hasAudio) {
    f.push(settings.normalizeAudio === false ? '[a0]anull[aout]' : '[a0]loudnorm=I=-16:TP=-1.5:LRA=11[aout]');
  }

  fs.mkdirSync(path.join(dir, 'output'), { recursive: true });
  const outName = `reel-r${job.revision || 1}.mp4`;
  const args = [
    '-i', job.source,
    '-filter_complex', f.join(';'),
    '-map', '[vout]',
    ...(info.hasAudio ? ['-map', '[aout]'] : []),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    ...(info.hasAudio ? ['-c:a', 'aac', '-b:a', '192k'] : []),
    '-movflags', '+faststart',
    `output/${outName}`,
  ];

  setStatus(id, 'working', 'Rendering your reel', 45);
  let lastWrite = 0;
  await runFfmpeg(args, {
    cwd: dir,
    duration: outDuration,
    onProgress: (p) => {
      if (Date.now() - lastWrite > 1500) {
        lastWrite = Date.now();
        updateJob(id, { progress: Math.round(45 + p * 50), message: 'Rendering your reel' });
      }
    },
  });

  updateJob(id, { status: 'done', message: 'Your reel is ready', progress: 100, output: `output/${outName}` });
  console.log(`Done: jobs/${id}/output/${outName}  (${outDuration.toFixed(1)}s, ${W}x${H}, fit=${fit})`);
} catch (err) {
  console.error(err.message);
  try {
    setStatus(id, 'error', err.message.split('\n')[0].slice(0, 300));
  } catch {}
  process.exit(1);
}
