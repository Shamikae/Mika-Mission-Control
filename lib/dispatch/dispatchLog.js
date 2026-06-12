// lib/dispatch/dispatchLog.js
// Append-only dispatch log writer.
// Writes compact JSONL entries to /logs/dispatch-log.json.

import path from 'path';
import fs from 'fs';

const LOG_PATH = path.join(process.cwd(), 'logs', 'dispatch-log.json');
const LOG_DIR  = path.join(process.cwd(), 'logs');

function readLog() {
  try {
    if (!fs.existsSync(LOG_PATH)) return [];
    return JSON.parse(fs.readFileSync(LOG_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

/**
 * Append a dispatch entry to the log.
 * Keeps the most recent 500 entries to prevent unbounded growth.
 *
 * Core fields (route-task.js):
 * @param {object} entry
 * @param {string} entry.timestamp
 * @param {string} entry.taskId
 * @param {string} entry.taskType
 * @param {string|null} entry.laneId
 * @param {string|null} entry.selectedAgentId
 * @param {string|null} entry.fallbackAgentId
 * @param {boolean} entry.executableNow
 * @param {boolean} entry.approvalRequired
 * @param {string} entry.decisionReason
 *
 * Execution fields (execute.js — present when a task was actually run):
 * @param {string} [entry.executionStatus]   'success' | 'failed' | 'staged' | 'manual_required'
 * @param {string} [entry.executionMode]     'gateway' | 'ssh-http:ssh' | 'ssh-http:cli' | null
 * @param {string} [entry.executionTarget]   'openclaw' | 'hermes' | null
 * @param {string} [entry.outputSummary]     first 150 chars of agent output
 * @param {string} [entry.errorSummary]      first 120 chars of error message
 */
export function appendDispatchLog(entry) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const existing = readLog();
    const next = [entry, ...existing].slice(0, 500);
    fs.writeFileSync(LOG_PATH, JSON.stringify(next, null, 2));
  } catch (err) {
    console.error('[dispatchLog] write failed:', err.message);
  }
}

export function readDispatchLog(limit = 50) {
  return readLog().slice(0, limit);
}
