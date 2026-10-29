#!/usr/bin/env node
// Checks that everything Reel Studio needs is installed and prints the exact fix for anything missing.
//   node scripts/setup.mjs                       check only
//   node scripts/setup.mjs --install-transcriber warm up the speech-to-text engine (downloads ~1 GB once)
import { spawnSync } from 'node:child_process';
import { ffmpegBin, ffprobeBin, hasFilter } from '../lib/ff.mjs';

const win = process.platform === 'win32';
const mac = process.platform === 'darwin';
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m, fix) => {
  console.log(`  MISSING  ${m}`);
  if (fix) console.log(`           fix: ${fix}`);
  problems++;
};
let problems = 0;
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return r.error || r.status !== 0 ? null : (r.stdout || r.stderr).trim();
};

console.log('\nReel Studio setup check\n');

const major = Number(process.versions.node.split('.')[0]);
major >= 18 ? ok(`Node ${process.versions.node}`) : bad(`Node 18 or newer (found ${process.versions.node})`, 'install from https://nodejs.org');

const ffInstall = win ? 'winget install Gyan.FFmpeg   (then open a new terminal)' : mac ? 'brew install ffmpeg' : 'sudo apt install ffmpeg';
if (ffmpegBin() && ffprobeBin()) {
  ok(`ffmpeg and ffprobe (${run(ffmpegBin(), ['-version'])?.match(/^ffmpeg version \S+/)?.[0] ?? 'found'})`);
  hasFilter('subtitles') ? ok('ffmpeg has the subtitles filter (libass)') : bad('ffmpeg without libass, captions cannot be drawn', ffInstall + '  (use a "full" build)');
} else {
  bad('ffmpeg / ffprobe', ffInstall);
}

const uv = run('uv', ['--version']);
const py = ['python3', 'python', 'py'].map((c) => [c, run(c, ['--version'])]).find(([, v]) => v);
if (uv) ok(`uv ${uv.split(' ')[1]} (runs the transcriber with no manual Python setup)`);
else if (py) ok(`${py[1]} (you will need: pip install faster-whisper "av<17")`);
else bad('uv or Python 3.9+ for transcription', win ? 'winget install astral-sh.uv' : mac ? 'brew install uv' : 'curl -LsSf https://astral.sh/uv/install.sh | sh');

if (process.argv.includes('--install-transcriber')) {
  console.log('\nInstalling the transcriber (first run downloads packages)...');
  const cmd = uv
    ? ['uv', ['run', '--quiet', '--python', '3.12', '--with', 'faster-whisper', '--with', 'av<17', 'python', '-c', 'import faster_whisper; print("faster-whisper", faster_whisper.__version__)']]
    : py
      ? [py[0], ['-m', 'pip', 'install', '--user', 'faster-whisper', 'av<17']]
      : null;
  if (!cmd) bad('no way to install the transcriber yet');
  else if (spawnSync(cmd[0], cmd[1], { stdio: 'inherit' }).status === 0) ok('transcriber ready (speech models download on first use)');
  else bad('transcriber install failed');
}

console.log(problems ? `\n${problems} thing(s) to fix, then run this again.\n` : '\nAll good. Start the app with: npm start\n');
process.exit(problems ? 1 : 0);
