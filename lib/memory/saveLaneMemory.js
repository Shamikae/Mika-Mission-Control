import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const MEMORY_DIR  = join(process.cwd(), 'memory');
const MAX_ENTRIES = 15;
const MAX_SUMMARY = 120; // chars — keeps token growth bounded

/**
 * Build a compact memory entry from a completed task and its reply.
 */
export function buildMemoryEntry(task, reply) {
  return {
    timestamp:       new Date().toISOString(),
    taskType:        task.taskType,
    summary:         String(task.description).slice(0, MAX_SUMMARY).trim(),
    responseSummary: reply ? String(reply).slice(0, MAX_SUMMARY).trim() : null,
    decisions:       [],
  };
}

/**
 * Prepend a new entry and persist, trimming to MAX_ENTRIES.
 */
export function appendLaneMemory(laneId, entry, existing = []) {
  if (!laneId) return;
  try {
    if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
    const updated = [entry, ...existing].slice(0, MAX_ENTRIES);
    writeFileSync(join(MEMORY_DIR, `${laneId}.json`), JSON.stringify(updated, null, 2));
  } catch { /* silently ignore — memory is best-effort */ }
}
