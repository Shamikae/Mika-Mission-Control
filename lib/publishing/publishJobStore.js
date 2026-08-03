// lib/publishing/publishJobStore.js
// SERVER-SIDE ONLY — uses fs.
// One JSON file per publish job under data/publish-jobs/<id>.json — same
// file-backed, atomic-write convention as
// lib/production/productionJobStore.js. No database added, no new media
// storage: a Publish Job only ever REFERENCES an existing production
// artifactId — it never copies or duplicates media.

import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { isValidId, makeActivityEvent } from './publishingRules';

const STORE_DIR = path.join(process.cwd(), 'data', 'publish-jobs');

function ensureDir() {
  if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
}

function fileFor(id) {
  return path.join(STORE_DIR, `${id}.json`);
}

export function generatePublishJobId() {
  return `pub-${Date.now()}-${randomBytes(3).toString('hex')}`;
}

function writeJobFile(job) {
  ensureDir();
  const target = fileFor(job.id);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(job, null, 2));
  fs.renameSync(tmp, target);
  return job;
}

export function createPublishJob(job) {
  if (!isValidId(job.id)) throw new Error(`Invalid publish job id "${job.id}".`);
  return writeJobFile(job);
}

export function getPublishJob(id) {
  if (!isValidId(id)) return null;
  try {
    const file = fileFor(id);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

/** Lists all publish jobs, newest first (by metadata updatedAt). */
export function listPublishJobs() {
  ensureDir();
  try {
    return fs.readdirSync(STORE_DIR)
      .filter(f => f.endsWith('.json') && !f.includes('.tmp'))
      .map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(STORE_DIR, f), 'utf-8')); }
        catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  } catch {
    return [];
  }
}

/**
 * Merges a shallow patch and persists it. Returns null if the job does not
 * exist. Callers own building the correct nested patch (no deep-merge of
 * nested objects like `publishResult`).
 */
export function updatePublishJob(id, patch) {
  const job = getPublishJob(id);
  if (!job) return null;
  const updated = { ...job, ...patch, updatedAt: new Date().toISOString() };
  return writeJobFile(updated);
}

export function appendPublishHistory(id, type, opts) {
  const job = getPublishJob(id);
  if (!job) return null;
  const event = makeActivityEvent(type, opts);
  const updated = {
    ...job,
    activityHistory: [...(job.activityHistory || []), event],
    updatedAt: new Date().toISOString(),
  };
  return writeJobFile(updated);
}
