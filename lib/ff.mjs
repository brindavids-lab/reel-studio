import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const cache = {};

// Looks for FFMPEG_PATH / FFPROBE_PATH, then FFMPEG_DIR, then the system PATH.
function findBin(name) {
  if (name in cache) return cache[name];
  const envVar = name.toUpperCase() + '_PATH';
  const candidates = [process.env[envVar], process.env.FFMPEG_DIR && path.join(process.env.FFMPEG_DIR, name), name].filter(Boolean);
  for (const c of candidates) {
    const r = spawnSync(c, ['-version'], { encoding: 'utf8' });
    if (!r.error && r.status === 0) return (cache[name] = c);
  }
  return (cache[name] = null);
}

export const ffmpegBin = () => findBin('ffmpeg');
export const ffprobeBin = () => findBin('ffprobe');

export function requireFfmpeg() {
  const bin = ffmpegBin();
  if (!bin) throw new Error('ffmpeg was not found. Install it (see README) or set FFMPEG_PATH.');
  return bin;
}

export function hasFilter(name) {
  const r = spawnSync(requireFfmpeg(), ['-hide_banner', '-filters'], { encoding: 'utf8' });
  return new RegExp(`\\s${name}\\s`).test(r.stdout || '');
}

export function probe(file) {
  const bin = ffprobeBin();
  if (!bin) return null;
  const r = spawnSync(bin, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], {
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  });
  if (r.status !== 0) return null;
  const info = JSON.parse(r.stdout);
  const v = info.streams.find((s) => s.codec_type === 'video');
  if (!v) return null;
  const rotation = Number(v.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ?? v.tags?.rotate ?? 0);
  const swap = Math.abs(rotation) % 180 === 90;
  const [n, d] = (v.r_frame_rate || '30/1').split('/').map(Number);
  return {
    duration: Number(info.format.duration),
    width: swap ? v.height : v.width,
    height: swap ? v.width : v.height,
    fps: d ? n / d : 30,
    hasAudio: info.streams.some((s) => s.codec_type === 'audio'),
  };
}

// Runs ffmpeg and reports progress (0..1) when `duration` is known.
export function runFfmpeg(args, { cwd, duration, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(requireFfmpeg(), ['-hide_banner', '-y', '-nostats', '-progress', 'pipe:1', ...args], { cwd });
    let errTail = '';
    p.stderr.on('data', (d) => (errTail = (errTail + d).slice(-4000)));
    p.stdout.on('data', (d) => {
      const m = String(d).match(/out_time_(?:us|ms)=(\d+)/g);
      if (m && duration && onProgress) {
        const us = Number(m[m.length - 1].split('=')[1]);
        onProgress(Math.min(1, us / 1e6 / duration));
      }
    });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}\n${errTail}`))));
  });
}

// Returns [[start, end], ...] of silent stretches.
export function detectSilences(file, { noiseDb = -32, minDuration = 0.45 } = {}) {
  const r = spawnSync(
    requireFfmpeg(),
    ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', `silencedetect=noise=${noiseDb}dB:d=${minDuration}`, '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 1 << 26 },
  );
  const out = [];
  let start = null;
  for (const line of (r.stderr || '').split('\n')) {
    const s = line.match(/silence_start: ([\d.]+)/);
    const e = line.match(/silence_end: ([\d.]+)/);
    if (s) start = Number(s[1]);
    if (e && start !== null) out.push([start, Number(e[1])]), (start = null);
  }
  return out;
}
