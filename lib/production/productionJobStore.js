// lib/production/productionJobStore.js
// SERVER-SIDE ONLY — uses fs.
// One JSON file per job under data/production-jobs/<id>.json — same
// file-backed convention as lib/content/contentPackageStore.js and
// lib/workflows/loadViralContentWorkflow.js. No database added.
//
// The Content Package remains the single source of truth for creative
// content — a job only ever stores packageId + derived planning metadata,
// never a copy of the package's written content (see productionRules.js's
// buildScenesSummary / buildVoiceoverScriptSummary / etc., which persist
// booleans/counts/references, not text).

import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { isValidId, makeActivityEvent } from './productionRules';

const STORE_DIR = path.join(process.cwd(), 'data', 'production-jobs');

function ensureDir() {
  if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
}

function fileFor(id) {
  return path.join(STORE_DIR, `${id}.json`);
}

export function generateJobId() {
  return `pr-${Date.now()}-${randomBytes(3).toString('hex')}`;
}

function writeJobFile(job) {
  ensureDir();
  // Atomic-ish write: write to a temp file in the same directory, then
  // rename — rename is atomic on the same filesystem, avoiding a reader
  // ever observing a partially-written job file.
  const target = fileFor(job.id);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(job, null, 2));
  fs.renameSync(tmp, target);
  return job;
}

export function createProductionJob(job) {
  if (!isValidId(job.id)) throw new Error(`Invalid job id "${job.id}".`);
  return writeJobFile(job);
}

export function getProductionJob(id) {
  if (!isValidId(id)) return null;
  try {
    const file = fileFor(id);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Lists all jobs, newest first (by metadata.updatedAt).
 */
export function listProductionJobs() {
  ensureDir();
  try {
    return fs.readdirSync(STORE_DIR)
      .filter(f => f.endsWith('.json') && !f.includes('.tmp'))
      .map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(STORE_DIR, f), 'utf-8')); }
        catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.metadata?.updatedAt || 0) - new Date(a.metadata?.updatedAt || 0));
  } catch {
    return [];
  }
}

/**
 * Merges a shallow patch onto an existing job and persists it. Returns null
 * if the job does not exist. Callers own building the correct nested patch
 * (this does not deep-merge nested objects like `budget` or `approval`).
 */
export function updateProductionJob(id, patch) {
  const job = getProductionJob(id);
  if (!job) return null;
  const updated = { ...job, ...patch, metadata: { ...job.metadata, ...(patch.metadata || {}), updatedAt: new Date().toISOString() } };
  return writeJobFile(updated);
}

export function appendProductionHistory(id, type, opts) {
  const job = getProductionJob(id);
  if (!job) return null;
  const event = makeActivityEvent(type, opts);
  const updated = {
    ...job,
    activityHistory: [...(job.activityHistory || []), event],
    metadata: { ...job.metadata, updatedAt: new Date().toISOString() },
  };
  return writeJobFile(updated);
}

export function cancelProductionJob(id, { actor = 'user', note = null } = {}) {
  const job = getProductionJob(id);
  if (!job) return null;
  const event = makeActivityEvent('cancelled', { actor, note });
  const updated = {
    ...job,
    status: 'cancelled',
    activityHistory: [...(job.activityHistory || []), event],
    metadata: { ...job.metadata, updatedAt: new Date().toISOString() },
  };
  return writeJobFile(updated);
}
