import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { JOBS_DIR } from './paths.mjs';

export const ID_RE = /^[a-z0-9]{6,20}$/;

export const newId = () => Date.now().toString(36) + crypto.randomBytes(2).toString('hex');

export function jobDir(id) {
  if (!ID_RE.test(id)) throw new Error(`Bad job id: ${id}`);
  return path.join(JOBS_DIR, id);
}

export function readJob(id) {
  return JSON.parse(fs.readFileSync(path.join(jobDir(id), 'job.json'), 'utf8').replace(/^﻿/, ''));
}

export function writeJob(job) {
  const file = path.join(jobDir(job.id), 'job.json');
  job.updatedAt = new Date().toISOString();
  fs.writeFileSync(file + '.tmp', JSON.stringify(job, null, 2));
  fs.renameSync(file + '.tmp', file);
  return job;
}

export function updateJob(id, patch) {
  return writeJob({ ...readJob(id), ...patch });
}

export function setStatus(id, status, message = '', progress) {
  const patch = { status, message };
  if (progress !== undefined) patch.progress = progress;
  return updateJob(id, patch);
}

export function listJobs() {
  if (!fs.existsSync(JOBS_DIR)) return [];
  return fs
    .readdirSync(JOBS_DIR)
    .filter((id) => ID_RE.test(id) && fs.existsSync(path.join(JOBS_DIR, id, 'job.json')))
    .map((id) => readJob(id))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
