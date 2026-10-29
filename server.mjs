#!/usr/bin/env node
// Reel Studio local server. Zero dependencies. Listens on 127.0.0.1 only.
//   node server.mjs [--open]
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { ROOT, JOBS_DIR, FONTS_DIR, PUBLIC_DIR } from './lib/paths.mjs';
import { FORMATS, loadStyles, loadFonts } from './lib/config.mjs';
import { ID_RE, newId, jobDir, readJob, writeJob, updateJob, listJobs } from './lib/jobs.mjs';
import { probe, ffmpegBin } from './lib/ff.mjs';

const PORT = Number(process.env.PORT) || 4173;
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv']);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.jpg': 'image/jpeg',
};

const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const fail = (res, code, message) => send(res, code, { error: message });

function readBody(req, limit = 1 << 20) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) reject(new Error('Body too large'));
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Serves a file with Range support so <video> can seek.
function serveFile(req, res, file, { download } = {}) {
  let stat;
  try {
    stat = fs.statSync(file);
    if (!stat.isFile()) throw new Error();
  } catch {
    return fail(res, 404, 'Not found');
  }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  if (download) headers['Content-Disposition'] = `attachment; filename="${download.replace(/[^\w.\- ]/g, '_')}"`;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
    let end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
    end = Math.min(end, stat.size - 1);
    if (start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  fs.createReadStream(file).pipe(res);
}

const safeJoin = (base, rel) => {
  const full = path.normalize(path.join(base, rel));
  return full.startsWith(base + path.sep) || full === base ? full : null;
};

function publicJob(job) {
  const { id, filename, status, message, progress, settings, changes, revision, output, meta, createdAt, updatedAt } = job;
  return { id, filename, status, message, progress, settings, changes, revision, output: Boolean(output), meta, createdAt, updatedAt };
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const route = parts.slice(1);

  if (req.method === 'GET' && route[0] === 'config') {
    return send(res, 200, { styles: loadStyles(), fonts: loadFonts(), formats: FORMATS, ffmpeg: Boolean(ffmpegBin()) });
  }
  if (req.method === 'GET' && route[0] === 'jobs' && !route[1]) {
    return send(res, 200, listJobs().map(publicJob));
  }
  if (req.method === 'GET' && route[0] === 'jobs' && route[1]) {
    if (!ID_RE.test(route[1]) || !fs.existsSync(path.join(JOBS_DIR, route[1], 'job.json'))) return fail(res, 404, 'No such job');
    return send(res, 200, publicJob(readJob(route[1])));
  }

  // Upload: raw video bytes in the body, original file name in ?name=
  if (req.method === 'POST' && route[0] === 'jobs' && !route[1]) {
    const name = path.basename(url.searchParams.get('name') || 'video.mp4');
    const ext = path.extname(name).toLowerCase();
    if (!VIDEO_EXT.has(ext)) return fail(res, 400, `Unsupported file type ${ext || '(none)'}. Use mp4, mov, m4v, webm or mkv.`);
    const id = newId();
    const dir = jobDir(id);
    fs.mkdirSync(dir, { recursive: true });
    const source = `source${ext}`;
    const tmp = path.join(dir, source + '.part');
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tmp);
      req.pipe(out);
      out.on('finish', resolve);
      out.on('error', reject);
      req.on('error', reject);
      req.on('aborted', () => reject(new Error('Upload cancelled')));
    });
    fs.renameSync(tmp, path.join(dir, source));
    const meta = probe(path.join(dir, source));
    const job = writeJob({
      id,
      createdAt: new Date().toISOString(),
      filename: name,
      source,
      meta,
      status: 'uploaded',
      message: '',
      progress: 0,
      revision: 0,
      settings: {},
      changes: [],
      output: null,
    });
    return send(res, 201, publicJob(job));
  }

  // Hand off to Claude
  if (req.method === 'POST' && route[0] === 'jobs' && route[1] && route[2] === 'submit') {
    if (!ID_RE.test(route[1]) || !fs.existsSync(path.join(JOBS_DIR, route[1], 'job.json'))) return fail(res, 404, 'No such job');
    let body;
    try {
      body = JSON.parse((await readBody(req)) || '{}');
    } catch {
      return fail(res, 400, 'Invalid JSON');
    }
    const job = readJob(route[1]);
    const incoming = body.settings && typeof body.settings === 'object' ? body.settings : {};
    const known = loadStyles().some((s) => s.id === incoming.styleId);
    if (!known) return fail(res, 400, 'Pick a style first');
    const changes = Array.isArray(body.changes) ? body.changes.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 50) : [];
    const updated = updateJob(job.id, {
      settings: incoming,
      changes,
      revision: (job.revision || 0) + 1,
      status: 'submitted',
      message: 'Waiting for Claude',
      progress: 0,
      submittedAt: new Date().toISOString(),
    });
    return send(res, 200, publicJob(updated));
  }

  return fail(res, 404, 'Unknown endpoint');
}

const server = http.createServer(async (req, res) => {
  try {
    // Guard against DNS rebinding and other sites poking the local API.
    const host = req.headers.host || '';
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return fail(res, 403, 'Forbidden host');
    if (req.method !== 'GET' && req.headers.origin && req.headers.origin !== `http://${host}`) return fail(res, 403, 'Forbidden origin');

    const url = new URL(req.url, `http://${host}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);

    // Job media: /jobs/<id>/source | output | download
    const m = /^\/jobs\/([a-z0-9]+)\/(source|output|download)$/.exec(url.pathname);
    if (m) {
      if (!ID_RE.test(m[1]) || !fs.existsSync(path.join(JOBS_DIR, m[1], 'job.json'))) return fail(res, 404, 'No such job');
      const job = readJob(m[1]);
      const rel = m[2] === 'source' ? job.source : job.output;
      if (!rel) return fail(res, 404, 'Not ready');
      const file = safeJoin(jobDir(job.id), rel);
      if (!file) return fail(res, 403, 'Forbidden');
      const nice = path.parse(job.filename).name + '-edited.mp4';
      return serveFile(req, res, file, { download: m[2] === 'download' ? nice : undefined });
    }

    if (url.pathname.startsWith('/fonts/')) {
      const file = safeJoin(FONTS_DIR, decodeURIComponent(url.pathname.slice(7)));
      return file && path.extname(file) === '.ttf' ? serveFile(req, res, file) : fail(res, 404, 'Not found');
    }

    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const file = safeJoin(PUBLIC_DIR, rel);
    return file ? serveFile(req, res, file) : fail(res, 404, 'Not found');
  } catch (err) {
    console.error(err);
    if (!res.headersSent) fail(res, 500, err.message);
    else res.end();
  }
});

function listen(port, attemptsLeft = 10) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) listen(port + 1, attemptsLeft - 1);
    else throw err;
  });
  server.listen(port, '127.0.0.1', () => {
    const address = `http://localhost:${port}`;
    console.log(`\nReel Studio is running at ${address}\n`);
    if (!ffmpegBin()) console.log('Heads up: ffmpeg was not found. The page will open, but rendering needs it. Run: node scripts/setup.mjs\n');
    console.log('Waiting for you in the browser. When you press "Send to Claude", ask Claude: "edit my reel".\n');
    if (process.argv.includes('--open')) {
      const [cmd, args] =
        process.platform === 'win32' ? ['cmd', ['/c', 'start', '', address]] : process.platform === 'darwin' ? ['open', [address]] : ['xdg-open', [address]];
      spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
    }
  });
}

fs.mkdirSync(JOBS_DIR, { recursive: true });
listen(PORT);
