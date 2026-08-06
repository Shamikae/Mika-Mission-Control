// lib/ledger/ledgerStore.js
// SERVER-SIDE ONLY (filesystem).
//
// Append-only persistence for the Ledger. One immutable JSON file per entry
// under data/ledger/, matching the one-record-per-file convention already used
// by productionJobStore / publishJobStore / hyperframesRunStore.
//
// ── Why one file per entry rather than a JSONL log ───────────────────────
// Immutability becomes a filesystem property rather than a discipline: an
// entry is created with an exclusive write and is never opened for writing
// again. A single appended log file would have to be re-opened for every
// write, which is exactly the operation that makes silent mutation possible.
//
// Writes are staged to a dot-prefixed temp file and published with an atomic
// rename, so a concurrent reader never observes a partial record.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { buildLedgerRecord, validateLedgerRecord, isValidLedgerId } from './ledgerRules.js';

export const LEDGER_DIR = path.join(process.cwd(), 'data', 'ledger');

// Monotonic within a process. Two entries written in the same millisecond
// would otherwise sort unstably, making an audit trail's ORDER
// non-deterministic — which defeats the point of an append-only log. The
// counter is zero-padded so lexical id order matches insertion order.
let sequenceCounter = 0;

export function generateLedgerId() {
  const seq = String(sequenceCounter++ % 1_000_000).padStart(6, '0');
  return `led-${Date.now()}-${seq}-${crypto.randomBytes(3).toString('hex')}`;
}

function ensureDir() {
  fs.mkdirSync(LEDGER_DIR, { recursive: true });
}

/** Resolves an entry id to its validated absolute path. Throws on anything unsafe. */
function entryPath(id) {
  if (!isValidLedgerId(id)) {
    const err = new Error('Invalid ledger entry id.');
    err.code = 'invalid_id';
    throw err;
  }
  const resolved = path.resolve(LEDGER_DIR, `${id}.json`);
  if (path.dirname(resolved) !== path.resolve(LEDGER_DIR)) {
    const err = new Error('Refusing a ledger path that escapes the ledger directory.');
    err.code = 'traversal_rejected';
    throw err;
  }
  return resolved;
}

/**
 * Validates and appends one immutable ledger entry.
 *
 * NEVER throws — a ledger write is called from inside execution paths, and the
 * CALLER must decide policy (block paid spend vs. degrade on free work). It
 * returns an explicit result instead so that decision is always visible at the
 * call site rather than buried in a catch.
 *
 * @returns {{ ok: boolean, id?: string, record?: object, error?: string, errors?: string[] }}
 */
export function appendLedgerEntry(input) {
  let record;
  try {
    record = buildLedgerRecord({ id: input?.id || generateLedgerId(), ...input });
  } catch (err) {
    return { ok: false, error: `Could not build ledger record: ${err.message}` };
  }

  const validation = validateLedgerRecord(record);
  if (!validation.valid) {
    return { ok: false, error: 'Ledger record failed validation.', errors: validation.errors };
  }

  let target;
  try { target = entryPath(record.id); } catch (err) {
    return { ok: false, error: err.message };
  }

  // Append-only: an existing entry is never overwritten.
  if (fs.existsSync(target)) {
    return { ok: false, error: `Ledger entry "${record.id}" already exists — the ledger is append-only.` };
  }

  const staging = path.join(LEDGER_DIR, `.tmp-${record.id}-${crypto.randomBytes(4).toString('hex')}`);
  try {
    ensureDir();
    // 'wx' — exclusive create; two concurrent writers cannot both win.
    fs.writeFileSync(staging, JSON.stringify(record, null, 2), { encoding: 'utf-8', flag: 'wx' });
    fs.renameSync(staging, target); // atomic publish
  } catch (err) {
    try { fs.rmSync(staging, { force: true }); } catch { /* ignore */ }
    return { ok: false, error: `Could not persist ledger entry: ${err.message}` };
  }

  return { ok: true, id: record.id, record };
}

export function getLedgerEntry(id) {
  try {
    return JSON.parse(fs.readFileSync(entryPath(id), 'utf-8'));
  } catch { return null; }
}

/**
 * Reads entries, newest first. Filters are applied in memory — the ledger is
 * an inspectable log, not a query engine.
 */
export function listLedgerEntries({ division, capability, productionJobId, event, limit = 200 } = {}) {
  if (!fs.existsSync(LEDGER_DIR)) return [];
  const entries = fs.readdirSync(LEDGER_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('.'))
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(LEDGER_DIR, f), 'utf-8')); } catch { return null; }
    })
    .filter(Boolean)
    .filter(e => !division || e.division === division)
    .filter(e => !capability || e.capability === capability)
    .filter(e => !event || e.event === event)
    .filter(e => !productionJobId || e.source?.productionJobId === productionJobId);

  // Timestamp first, then id — the id embeds a monotonic counter, so entries
  // sharing a millisecond still order deterministically.
  return entries
    .sort((a, b) => (new Date(b.timestamp) - new Date(a.timestamp)) || String(b.id).localeCompare(String(a.id)))
    .slice(0, Math.max(1, Math.min(2000, limit)));
}

/** All entries for one production job, oldest first — the audit trail for a single execution. */
export function getLedgerTrailForJob(productionJobId) {
  return listLedgerEntries({ productionJobId, limit: 2000 })
    .sort((a, b) => (new Date(a.timestamp) - new Date(b.timestamp)) || String(a.id).localeCompare(String(b.id)));
}
