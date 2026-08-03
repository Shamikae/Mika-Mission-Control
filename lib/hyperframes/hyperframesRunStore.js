// lib/hyperframes/hyperframesRunStore.js
// SERVER-SIDE ONLY — uses fs.
//
// Lightweight local run records for HyperFrames lint/check/preview/render
// invocations. One JSON file per run under data/hyperframes-runs/ (gitignored,
// runtime-only — same file-backed convention as
// lib/production/execution/executionQueue.js). Never persists secrets or
// absolute filesystem paths — see sanitizeLogText().

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const STORE_DIR = path.join(process.cwd(), 'data', 'hyperframes-runs');
const MAX_LOG_CHARS = 8000; // clamp — never an unbounded stdout dump
const MAX_LOG_LINES = 400;

function ensureDir() {
  fs.mkdirSync(STORE_DIR, { recursive: true });
}

function fileFor(id) {
  return path.join(STORE_DIR, `${id}.json`);
}

export function generateRunId() {
  return `hfr-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

function writeRunFile(run) {
  ensureDir();
  const target = fileFor(run.id);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(run, null, 2));
  fs.renameSync(tmp, target);
  return run;
}

export function getHyperFramesRun(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id)) return null;
  try {
    const file = fileFor(id);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch { return null; }
}

export function listHyperFramesRuns({ compositionId } = {}) {
  ensureDir();
  try {
    return fs.readdirSync(STORE_DIR)
      .filter(f => f.endsWith('.json') && !f.includes('.tmp'))
      .map(f => { try { return JSON.parse(fs.readFileSync(path.join(STORE_DIR, f), 'utf-8')); } catch { return null; } })
      .filter(Boolean)
      .filter(r => !compositionId || r.compositionId === compositionId)
      .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  } catch { return []; }
}

/** Is there already an active (queued/running) render for this composition? */
export function hasActiveRender(compositionId) {
  return listHyperFramesRuns({ compositionId }).some(r => r.command === 'render' && ['queued', 'running'].includes(r.status));
}

export function createHyperFramesRun({ compositionId, command }) {
  const now = new Date().toISOString();
  const run = {
    id: generateRunId(),
    compositionId,
    command, // 'lint' | 'check' | 'preview' | 'render'
    status: 'queued',
    startedAt: null,
    updatedAt: now,
    completedAt: null,
    exitCode: null,
    progress: null,
    logTail: [],
    outputFilename: null,
    importedJobId: null,
    error: null,
    // preview-only fields (never an absolute path):
    previewPort: null,
    previewPid: null,
  };
  return writeRunFile(run);
}

export function updateHyperFramesRun(id, patch) {
  const run = getHyperFramesRun(id);
  if (!run) return null;
  const updated = { ...run, ...patch, updatedAt: new Date().toISOString() };
  return writeRunFile(updated);
}

// ── Log sanitization ─────────────────────────────────────────────────────
// Same principle as lib/hermes/health.js's sanitizeHermesError(): strip
// ANSI control sequences, redact absolute/home-directory paths and anything
// that looks like a secret, clamp overall length. Never a raw stdout dump.

const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07/g;
// eslint-disable-next-line no-control-regex
const OTHER_CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g;
const HOME_PATH_RE = /(?:\/Users|\/home|\/root|[A-Za-z]:\\)[^\s"'<>]*/g;
const PROJECT_ROOT = process.cwd();
const SECRET_KV_RE = /\b([A-Z][A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z0-9_]*)\s*[:=]\s*\S+/gi;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._-]+/gi;

export function sanitizeLogText(text) {
  if (typeof text !== 'string' || !text) return '';
  let cleaned = text
    .replace(ANSI_RE, '')
    .replace(OTHER_CONTROL_RE, '')
    .split(PROJECT_ROOT).join('<project>')
    .replace(HOME_PATH_RE, '[redacted-path]')
    .replace(SECRET_KV_RE, '$1=[redacted]')
    .replace(BEARER_RE, 'Bearer [redacted]');
  return cleaned;
}

/**
 * Appends sanitized lines to a run's logTail, clamping total stored size —
 * never an unbounded accumulation of raw stdout.
 */
export function appendHyperFramesRunLog(id, rawChunk) {
  const run = getHyperFramesRun(id);
  if (!run) return null;
  const sanitized = sanitizeLogText(rawChunk);
  const newLines = sanitized.split('\n').filter(l => l.trim().length > 0);
  const combined = [...(run.logTail || []), ...newLines].slice(-MAX_LOG_LINES);
  // Also clamp total character budget, trimming oldest lines first.
  let totalChars = combined.reduce((sum, l) => sum + l.length, 0);
  while (totalChars > MAX_LOG_CHARS && combined.length > 1) {
    totalChars -= combined.shift().length;
  }
  return updateHyperFramesRun(id, { logTail: combined });
}

/** Sanitizes a whole run record before it is ever returned from an API route. */
export function sanitizeRunForResponse(run) {
  if (!run) return null;
  const { previewPid, ...rest } = run; // pid is server-internal only
  return rest;
}
