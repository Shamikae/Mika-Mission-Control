// lib/creative-director/contentRequestStore.js
// SERVER-SIDE ONLY — uses fs.
// One JSON file per content request under data/content-requests/<id>.json —
// same file-backed, atomic-write convention as
// lib/production/productionJobStore.js and lib/publishing/publishJobStore.js.
// This store owns ONLY Content Requests. It never writes a Content Package
// — package creation always goes through lib/content/contentPackageStore.js's
// own savePackage() (see packageFromRequest.js), the same interface Content
// Pack Generator uses. No new package storage, no schema drift.

import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { isValidId, makeActivityEvent } from './creativeDirectorRules';

const STORE_DIR = path.join(process.cwd(), 'data', 'content-requests');

function ensureDir() {
  if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
}

function fileFor(id) {
  return path.join(STORE_DIR, `${id}.json`);
}

export function generateContentRequestId() {
  return `creq-${Date.now()}-${randomBytes(3).toString('hex')}`;
}

function writeRequestFile(request) {
  ensureDir();
  const target = fileFor(request.id);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(request, null, 2));
  fs.renameSync(tmp, target);
  return request;
}

export function createContentRequest(request) {
  if (!isValidId(request.id)) throw new Error(`Invalid content request id "${request.id}".`);
  return writeRequestFile(request);
}

export function getContentRequest(id) {
  if (!isValidId(id)) return null;
  try {
    const file = fileFor(id);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

/** Lists all content requests, newest first (by updatedAt). */
export function listContentRequests() {
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

export function updateContentRequest(id, patch) {
  const request = getContentRequest(id);
  if (!request) return null;
  const updated = { ...request, ...patch, updatedAt: new Date().toISOString() };
  return writeRequestFile(updated);
}

export function appendRequestHistory(id, type, opts) {
  const request = getContentRequest(id);
  if (!request) return null;
  const event = makeActivityEvent(type, opts);
  const updated = {
    ...request,
    activityHistory: [...(request.activityHistory || []), event],
    updatedAt: new Date().toISOString(),
  };
  return writeRequestFile(updated);
}
