#!/usr/bin/env node
// Usage: node scripts/transcribe.mjs <jobId> [model]   (model: tiny | base | small | medium, default small)
// Runs faster-whisper through `uv` if available, otherwise through a Python that already has faster-whisper.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../lib/paths.mjs';
import { readJob, jobDir, setStatus } from '../lib/jobs.mjs';

const [id, model = process.env.REEL_WHISPER_MODEL || 'small'] = process.argv.slice(2);
if (!id) {
  console.error('Usage: node scripts/transcribe.mjs <jobId> [model]');
  process.exit(1);
}

const dir = jobDir(id);
const job = readJob(id);
const script = path.join(ROOT, 'scripts', 'transcribe.py');
const args = [path.join(dir, job.source), path.join(dir, 'words.json'), model];

const works = (cmd, a) => {
  const r = spawnSync(cmd, a, { stdio: 'ignore' });
  return !r.error && r.status === 0;
};
const attempts = [];
// Python 3.12 and av<17 are pinned because faster-whisper's dependencies have no wheels for the newest
// Pythons yet and the newest PyAV dropped an argument faster-whisper still passes.
if (works('uv', ['--version'])) {
  attempts.push(['uv', ['run', '--quiet', '--python', '3.12', '--with', 'faster-whisper', '--with', 'av<17', 'python', script, ...args]]);
}
for (const py of ['python3', 'python', 'py']) {
  if (works(py, ['--version'])) attempts.push([py, [script, ...args]]);
}
if (!attempts.length) {
  console.error('No Python found. Install "uv" (https://docs.astral.sh/uv/) or Python 3.9+ with: pip install faster-whisper');
  process.exit(1);
}

setStatus(id, 'working', 'Listening to your video', 15);
for (const [cmd, a] of attempts) {
  const r = spawnSync(cmd, a, { stdio: 'inherit' });
  if (r.status === 0) {
    console.log(`Wrote jobs/${id}/words.json`);
    process.exit(0);
  }
}
setStatus(id, 'error', 'Transcription failed. Run: node scripts/setup.mjs --install-transcriber');
process.exit(1);
