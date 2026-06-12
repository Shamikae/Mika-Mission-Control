import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

const QUEUE_FILE = join(process.cwd(), 'queue', 'tasks-queue.json');
const QUEUE_DIR  = join(process.cwd(), 'queue');

function write(entries) {
  if (!existsSync(QUEUE_DIR)) mkdirSync(QUEUE_DIR, { recursive: true });
  writeFileSync(QUEUE_FILE, JSON.stringify(entries, null, 2));
}

/**
 * Create a queue entry from a task and prepend to existing queue.
 * Returns the new queue item.
 */
export function addToQueue(task, existing = []) {
  const entry = {
    queueId:   `q-${Date.now()}-${randomBytes(3).toString('hex')}`,
    taskId:    task.id,
    laneId:    task.lane,
    title:     task.title?.trim() || String(task.description || '').slice(0, 80).trim(),
    priority:  task.priority,
    createdAt: new Date().toISOString(),
    status:    'queued',
    approved:  false,
    dispatched: false,
    completed: false,
  };
  write([entry, ...existing]);
  return entry;
}

/**
 * Mark a queue item as approved. Returns the updated item or null.
 */
export function approveQueueItem(queueId, existing = []) {
  const idx = existing.findIndex(q => q.queueId === queueId);
  if (idx === -1) return null;
  existing[idx] = { ...existing[idx], status: 'approved', approved: true };
  write(existing);
  return existing[idx];
}

/**
 * Update a queue item's status fields. Returns the updated item or null.
 */
export function updateQueueStatus(queueId, patch, existing = []) {
  const idx = existing.findIndex(q => q.queueId === queueId);
  if (idx === -1) return null;
  existing[idx] = { ...existing[idx], ...patch, updatedAt: new Date().toISOString() };
  write(existing);
  return existing[idx];
}
