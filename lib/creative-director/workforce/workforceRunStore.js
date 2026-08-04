// lib/creative-director/workforce/workforceRunStore.js
// SERVER-SIDE ONLY — uses fs.
// One JSON file per workforce run under data/content-workforce-runs/<id>.json
// — same file-backed, atomic-write convention as
// lib/creative-director/contentRequestStore.js, lib/production/productionJobStore.js,
// and lib/publishing/publishJobStore.js.

import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { isValidId } from './workforceRules';

const STORE_DIR = path.join(process.cwd(), 'data', 'content-workforce-runs');

function ensureDir() {
  if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
}

function fileFor(id) {
  return path.join(STORE_DIR, `${id}.json`);
}

export function generateWorkforceRunId() {
  return `wfr-${Date.now()}-${randomBytes(3).toString('hex')}`;
}

function writeRunFile(run) {
  ensureDir();
  const target = fileFor(run.id);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(run, null, 2));
  fs.renameSync(tmp, target);
  return run;
}

export function createWorkforceRun(run) {
  if (!isValidId(run.id)) throw new Error(`Invalid workforce run id "${run.id}".`);
  return writeRunFile(run);
}

export function getWorkforceRun(id) {
  if (!isValidId(id)) return null;
  try {
    const file = fileFor(id);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

/** Lists all workforce runs, newest first (by updatedAt). Optional requestId filter. */
export function listWorkforceRuns({ requestId } = {}) {
  ensureDir();
  try {
    let runs = fs.readdirSync(STORE_DIR)
      .filter(f => f.endsWith('.json') && !f.includes('.tmp'))
      .map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(STORE_DIR, f), 'utf-8')); }
        catch { return null; }
      })
      .filter(Boolean);
    if (requestId) runs = runs.filter(r => r.requestId === requestId);
    return runs.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  } catch {
    return [];
  }
}

export function updateWorkforceRun(id, patch) {
  const run = getWorkforceRun(id);
  if (!run) return null;
  const updated = { ...run, ...patch, updatedAt: new Date().toISOString() };
  return writeRunFile(updated);
}

/**
 * Finds the single active (non-terminal-rejected/cancelled) run for a
 * request, if any — the "only one active run per request" invariant. A
 * request whose run reached rejected/cancelled can get a fresh new run.
 */
export function findActiveRunForRequest(requestId) {
  const runs = listWorkforceRuns({ requestId });
  return runs.find(r => r.status !== 'rejected' && r.status !== 'cancelled') || null;
}
