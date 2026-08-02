// lib/production/execution/executionQueue.js
// SERVER-SIDE ONLY — uses fs.
// Simple file-backed FIFO queue at data/production-execution-queue.json.
// No background daemon — items are only ever processed by an explicit
// POST /api/production/execution/run-next call (see executionEngine.js).
// Atomic writes via the same temp+rename pattern as
// lib/production/productionJobStore.js.

import fs from 'fs';
import path from 'path';

const QUEUE_FILE = path.join(process.cwd(), 'data', 'production-execution-queue.json');

function readQueue() {
  try { return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf-8')).items || []; }
  catch { return []; }
}

function writeQueue(items) {
  fs.mkdirSync(path.dirname(QUEUE_FILE), { recursive: true });
  const tmp = `${QUEUE_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ items }, null, 2));
  fs.renameSync(tmp, QUEUE_FILE);
}

export function pushToQueue(productionJobId, { maxAttempts, userNote } = {}) {
  const items = readQueue();
  if (items.some(i => i.productionJobId === productionJobId)) {
    return { ok: false, error: 'This job is already queued.' };
  }
  const entry = {
    productionJobId,
    enqueuedAt: new Date().toISOString(),
    maxAttempts: maxAttempts || null,
    userNote: typeof userNote === 'string' ? userNote.slice(0, 500) : null,
  };
  items.push(entry);
  writeQueue(items);
  return { ok: true, entry, position: items.length };
}

export function listQueue() {
  return readQueue();
}

export function queuePosition(productionJobId) {
  const items = readQueue();
  const idx = items.findIndex(i => i.productionJobId === productionJobId);
  return idx === -1 ? null : idx + 1;
}

export function removeFromQueue(productionJobId) {
  const items = readQueue();
  const next = items.filter(i => i.productionJobId !== productionJobId);
  const removed = next.length !== items.length;
  if (removed) writeQueue(next);
  return removed;
}

export function isQueued(productionJobId) {
  return readQueue().some(i => i.productionJobId === productionJobId);
}
