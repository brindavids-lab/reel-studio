#!/usr/bin/env node
// Usage: node scripts/frame.mjs <jobId> <seconds> [source|output]
// Saves a JPG still so Claude can look at it (for example to keep captions off the speaker's face).
import fs from 'node:fs';
import path from 'node:path';
import { readJob, jobDir } from '../lib/jobs.mjs';
import { runFfmpeg } from '../lib/ff.mjs';

const [id, sec = '1', which = 'source'] = process.argv.slice(2);
if (!id) {
  console.error('Usage: node scripts/frame.mjs <jobId> <seconds> [source|output]');
  process.exit(1);
}
const dir = jobDir(id);
const job = readJob(id);
const input = which === 'output' ? job.output : job.source;
if (!input) {
  console.error('That job has no output yet.');
  process.exit(1);
}
fs.mkdirSync(path.join(dir, 'frames'), { recursive: true });
const name = `frames/${which}-${String(sec).replace('.', '_')}.jpg`;
await runFfmpeg(['-ss', String(sec), '-i', input, '-frames:v', '1', '-vf', 'scale=720:-2', '-q:v', '3', name], { cwd: dir });
console.log(path.join(dir, name));
