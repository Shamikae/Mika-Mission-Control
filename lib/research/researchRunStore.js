// lib/research/researchRunStore.js
// SERVER-SIDE ONLY — uses fs.
// One JSON file per research run under data/research-runs/<id>.json — same
// file-backed, atomic-write convention as
// lib/creative-director/workforce/workforceRunStore.js. Deliberately does
// NOT duplicate the full workforce run output — it only ever references
// workforceRunId/requestId.

import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { isValidId, isResearchRunTerminal } from './researchRules.js';

const STORE_DIR = path.join(process.cwd(), 'data', 'research-runs');

function ensureDir() {
  if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
}
function fileFor(id) {
  return path.join(STORE_DIR, `${id}.json`);
}

export function generateResearchRunId() {
  return `rsr-${Date.now()}-${randomBytes(3).toString('hex')}`;
}

function writeRunFile(run) {
  ensureDir();
  const target = fileFor(run.id);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(run, null, 2));
  fs.renameSync(tmp, target);
  return run;
}

export function createResearchRun(run) {
  if (!isValidId(run.id)) throw new Error(`Invalid research run id "${run.id}".`);
  return writeRunFile(run);
}

export function getResearchRun(id) {
  if (!isValidId(id)) return null;
  try {
    const file = fileFor(id);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

export function listResearchRuns({ workforceRunId } = {}) {
  ensureDir();
  try {
    let runs = fs.readdirSync(STORE_DIR)
      .filter(f => f.endsWith('.json') && !f.includes('.tmp'))
      .map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(STORE_DIR, f), 'utf-8')); }
        catch { return null; }
      })
      .filter(Boolean);
    if (workforceRunId) runs = runs.filter(r => r.workforceRunId === workforceRunId);
    return runs.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  } catch {
    return [];
  }
}

export function updateResearchRun(id, patch) {
  const run = getResearchRun(id);
  if (!run) return null;
  const updated = { ...run, ...patch, updatedAt: new Date().toISOString() };
  return writeRunFile(updated);
}

/**
 * One ACTIVE (genuinely in-progress: draft/planning/searching/fetching)
 * live research run per workforce run — prevents two concurrent runs for
 * the same workforce run from ever existing at once. Once a run reaches a
 * terminal status (ready/failed/cancelled) it no longer blocks a fresh run
 * from being created, so an explicit "Rerun with Live Search" always gets
 * a clean new research-run record rather than being stuck reusing stale
 * (possibly failed) results.
 */
export function findActiveResearchRunForWorkforceRun(workforceRunId) {
  const runs = listResearchRuns({ workforceRunId });
  return runs.find(r => !isResearchRunTerminal(r.status)) || null;
}

/** Most recent research run for a workforce run, terminal or not (for read/display purposes). */
export function findLatestResearchRunForWorkforceRun(workforceRunId) {
  return listResearchRuns({ workforceRunId })[0] || null;
}
