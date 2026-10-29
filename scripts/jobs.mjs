#!/usr/bin/env node
// Job queue helper used by Claude (and handy for humans).
//   node scripts/jobs.mjs list
//   node scripts/jobs.mjs next                       -> prints the oldest submitted job as JSON (exit 1 if none)
//   node scripts/jobs.mjs show <id>
//   node scripts/jobs.mjs status <id> <state> "message" [progress]
//   node scripts/jobs.mjs wait                       -> blocks until a job is submitted, prints its id
import { listJobs, readJob, setStatus } from '../lib/jobs.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const submitted = () => listJobs().filter((j) => j.status === 'submitted').reverse();

switch (cmd) {
  case 'list':
    for (const j of listJobs()) console.log(`${j.id}  ${j.status.padEnd(9)}  ${j.filename}  ${j.message || ''}`);
    break;
  case 'next': {
    const job = submitted()[0];
    if (!job) {
      console.error('No submitted jobs.');
      process.exit(1);
    }
    console.log(JSON.stringify(job, null, 2));
    break;
  }
  case 'show':
    console.log(JSON.stringify(readJob(rest[0]), null, 2));
    break;
  case 'status': {
    const [id, state, message = '', progress] = rest;
    if (!['uploaded', 'submitted', 'working', 'done', 'error'].includes(state)) {
      console.error('State must be uploaded | submitted | working | done | error');
      process.exit(1);
    }
    setStatus(id, state, message, progress === undefined ? undefined : Number(progress));
    console.log(`${id} -> ${state} ${message}`);
    break;
  }
  case 'wait':
    for (;;) {
      const job = submitted()[0];
      if (job) {
        console.log(job.id);
        break;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    break;
  default:
    console.error('Commands: list | next | show <id> | status <id> <state> "msg" [progress] | wait');
    process.exit(1);
}
