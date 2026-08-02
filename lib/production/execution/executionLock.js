// lib/production/execution/executionLock.js
// SERVER-SIDE ONLY (but deliberately import-free of anything outside this
// directory — see lib/production/execution/package.json's {"type":"module"}
// — so it can be loaded directly by plain `node`, including from separate
// child processes, for real cross-process concurrency testing. That scoping
// has no effect on the Next.js build, which transpiles everything through
// its own bundler regardless of Node's native module-type resolution.)
//
// AUTHORITATIVE LOCK: an exclusive-create ('wx') file at
// data/production-execution-locks/<jobId>.lock. This — NOT any read-check-
// write sequence, and NOT job.execution.lock — is the sole thing that
// decides whether an acquisition succeeds. job.execution.lock (maintained
// by executionEngine.js) is sanitized OBSERVABILITY metadata mirrored from
// here; it is never consulted to grant or deny a lock.
//
// 'wx' (O_CREAT | O_EXCL) atomically fails with EEXIST if the target
// already exists — this is a real OS-level guarantee, safe across
// overlapping requests within one process, across separate Node processes,
// and (given a shared filesystem) across future VPS replicas. A plain
// "read the file, check its contents, then write" sequence is NOT atomic
// and is exactly what this module replaces.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { EXECUTION_LOCK_TTL_MS, EXECUTION_LOCK_OWNER } from './executionRules.js';

const LOCK_DIR = path.join(process.cwd(), 'data', 'production-execution-locks');

// Intentionally duplicated from lib/production/productionRules.js's
// isValidId — this module must stay free of imports outside this directory
// (see header comment), so a tiny, stable regex is kept local rather than
// crossing that boundary.
const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]{3,100}$/;
function isValidJobId(id) {
  return typeof id === 'string' && SAFE_ID_PATTERN.test(id);
}

function ensureLockDir() {
  fs.mkdirSync(LOCK_DIR, { recursive: true });
}

function lockFilePath(jobId) {
  return path.join(LOCK_DIR, `${jobId}.lock`);
}

function readLockFileSafely(lockPath) {
  let raw;
  try {
    raw = fs.readFileSync(lockPath, 'utf-8');
  } catch (e) {
    if (e.code === 'ENOENT') return { missing: true };
    return { malformed: true, error: e.message };
  }
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !data.token || !data.expiresAt) {
      return { malformed: true };
    }
    return { data };
  } catch {
    return { malformed: true };
  }
}

function isStale(data) {
  const expires = new Date(data.expiresAt).getTime();
  return !Number.isFinite(expires) || expires <= Date.now();
}

// Write the COMPLETE payload to a private, uniquely-named temp file first
// (invisible to any other process — nobody else knows this name), then
// publish it via a hard link. link(2), like open(O_EXCL), atomically fails
// with EEXIST if the destination already exists — but unlike a plain
// open('wx') + write() + close() sequence, the destination's content is
// fully formed the INSTANT its name becomes visible to anyone else.
//
// This closes a real race that this module's own cross-process stress
// testing caught directly: open('wx') creates a 0-byte file immediately,
// and the subsequent write() is a SEPARATE syscall — a concurrent reader
// landing in that gap sees an empty/truncated file, readLockFileSafely()
// classifies it as "malformed," and the reclaim path (correctly designed
// to treat a malformed file as safe to reclaim) would then steal a
// perfectly healthy, in-progress lock out from under its rightful owner.
// Reproduced at roughly 1-in-8 to 1-in-25 under real concurrent load.
function writeLockExclusive(lockPath, payload) {
  const content = JSON.stringify(payload);
  const tmpPath = `${lockPath}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  fs.writeFileSync(tmpPath, content, { mode: 0o600 });
  try {
    fs.linkSync(tmpPath, lockPath);
  } catch (e) {
    try { fs.unlinkSync(tmpPath); } catch { /* best-effort */ }
    if (e.code === 'EEXIST') return { ok: false };
    throw e;
  }
  try { fs.unlinkSync(tmpPath); } catch { /* the lock now lives at lockPath via its own link — dropping the temp name is best-effort */ }
  return { ok: true };
}

const MAX_ACQUIRE_ATTEMPTS = 4; // bounded — never an unbounded retry loop

/**
 * Atomically acquires the execution lock for a job.
 *
 * @returns {{ ok: boolean, token?: string, owner?: string, acquiredAt?: string,
 *   expiresAt?: string, reclaimed?: boolean,
 *   reclaimedFrom?: { owner: string, acquiredAt: string, expiresAt: string } | 'malformed' | null,
 *   reason?: 'invalid_id' | 'lock_unavailable', error?: string }}
 */
export function acquireExecutionLock(jobId, { owner = EXECUTION_LOCK_OWNER, ttlMs = EXECUTION_LOCK_TTL_MS } = {}) {
  if (!isValidJobId(jobId)) {
    return { ok: false, reason: 'invalid_id', error: 'Invalid job id.' };
  }
  ensureLockDir();
  const lockPath = lockFilePath(jobId);

  for (let attempt = 1; attempt <= MAX_ACQUIRE_ATTEMPTS; attempt++) {
    const token = crypto.randomBytes(16).toString('hex');
    const now = Date.now();
    const payload = { owner, token, acquiredAt: new Date(now).toISOString(), expiresAt: new Date(now + ttlMs).toISOString() };

    if (writeLockExclusive(lockPath, payload).ok) {
      return { ok: true, token, owner, acquiredAt: payload.acquiredAt, expiresAt: payload.expiresAt, reclaimed: attempt > 1 };
    }

    // EEXIST — someone holds (or held) this lock. Inspect it.
    const existing = readLockFileSafely(lockPath);
    if (existing.missing) continue; // vanished between our attempt and this read — retry immediately (bounded)

    if (existing.data && !isStale(existing.data)) {
      return { ok: false, reason: 'lock_unavailable', error: 'An execution is already active for this job.' };
    }

    // Stale (or malformed) — reclaim via atomic rename-to-quarantine.
    //
    // A plain rename here is NOT by itself enough to guarantee only one
    // winner: rename() only guarantees exclusivity over the SOURCE INODE at
    // the instant it runs — it says nothing about what's occupying that
    // path. A straggler contender's rename can land in the gap between a
    // winner's rename-away and its immediate recreate, and successfully
    // "capture" the WINNER'S BRAND-NEW valid lock instead of getting ENOENT
    // (proven by this module's cross-process test suite catching exactly
    // this: two contenders both returning ok:true). So every reclaim MUST
    // verify — by comparing tokens — that what it actually quarantined is
    // the SAME stale lock it inspected a moment ago, not someone else's
    // fresh one, before ever proceeding to recreate. A mismatch means we
    // accidentally grabbed a live lock; restore it immediately and retry.
    const reclaimedFrom = existing.data
      ? { owner: existing.data.owner, acquiredAt: existing.data.acquiredAt, expiresAt: existing.data.expiresAt }
      : 'malformed';
    const expectedToken = existing.data?.token ?? null; // null for a malformed lock — see the malformed-branch check below
    const quarantinePath = `${lockPath}.stale-${crypto.randomBytes(4).toString('hex')}`;
    try {
      fs.renameSync(lockPath, quarantinePath);
    } catch (e) {
      if (e.code === 'ENOENT') continue; // lost the reclaim race — loop and retry (bounded)
      throw e;
    }

    const quarantined = readLockFileSafely(quarantinePath);
    const capturedTheIntendedStaleLock = expectedToken !== null
      ? quarantined.data?.token === expectedToken
      : quarantined.malformed === true; // original was malformed — only "safe" if we captured another malformed file, not someone's valid one

    if (!capturedTheIntendedStaleLock) {
      // We captured a DIFFERENT (likely fresh, valid) lock than the one we
      // inspected — put it back untouched and retry from scratch rather
      // than risk a false, duplicate "win".
      try { fs.renameSync(quarantinePath, lockPath); } catch { /* best-effort restore — bounded loop will re-evaluate regardless */ }
      continue;
    }

    try { fs.unlinkSync(quarantinePath); } catch { /* best-effort cleanup, not critical — we've already verified ownership */ }

    // We genuinely won the reclaim of the exact stale lock we inspected —
    // the path is now vacated. Attempt the exclusive create again
    // immediately (still within the bounded loop — if someone else's
    // legitimate fresh acquisition slips in first, our writeLockExclusive
    // simply fails with EEXIST and we fall through to retry).
    if (writeLockExclusive(lockPath, payload).ok) {
      return { ok: true, token, owner, acquiredAt: payload.acquiredAt, expiresAt: payload.expiresAt, reclaimed: true, reclaimedFrom };
    }
  }

  return { ok: false, reason: 'lock_unavailable', error: 'Could not acquire the execution lock — contended after bounded retries.' };
}

/**
 * Only the matching token may release. Idempotent: releasing an
 * already-absent lock is treated as success, so terminal cleanup paths
 * (completed/failed/cancelled) can always call this safely.
 */
export function releaseExecutionLock(jobId, token) {
  if (!isValidJobId(jobId)) return { ok: false, error: 'Invalid job id.' };
  const lockPath = lockFilePath(jobId);
  const existing = readLockFileSafely(lockPath);

  if (existing.missing) return { ok: true, alreadyReleased: true };
  if (existing.malformed) {
    // A malformed lock can never be verified as owned by this token, but it
    // is also never a legitimate authority — remove it defensively rather
    // than wedging the job forever.
    try { fs.unlinkSync(lockPath); } catch { /* already gone */ }
    return { ok: true, malformedRemoved: true };
  }
  if (!token || existing.data.token !== token) {
    return { ok: false, error: 'Token mismatch — refusing release by a non-owner.' };
  }

  try {
    fs.unlinkSync(lockPath);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e; // released concurrently — fine, idempotent
  }
  return { ok: true };
}

/**
 * Only the matching token may renew. Never creates a lock — renewal is not
 * an acquisition path, so an absent or malformed lock fails rather than
 * being treated as available.
 */
export function renewExecutionLock(jobId, token, ttlMs = EXECUTION_LOCK_TTL_MS) {
  if (!isValidJobId(jobId)) return { ok: false, error: 'Invalid job id.' };
  const lockPath = lockFilePath(jobId);
  const existing = readLockFileSafely(lockPath);

  if (existing.missing) return { ok: false, error: 'Lock not found — cannot renew.' };
  if (existing.malformed) return { ok: false, error: 'Lock file is malformed — cannot renew.' };
  if (!token || existing.data.token !== token) {
    return { ok: false, error: 'Token mismatch — refusing renewal by a non-owner.' };
  }

  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const updated = { ...existing.data, expiresAt };

  // Atomic replace via temp-write + rename within the same directory — same
  // convention as lib/production/productionJobStore.js — so a concurrent
  // reader never observes a partially-written lock file.
  const tmpPath = `${lockPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(updated), { mode: 0o600 });
  fs.renameSync(tmpPath, lockPath);

  return { ok: true, token, owner: existing.data.owner, acquiredAt: existing.data.acquiredAt, expiresAt };
}

/** Read-only inspection for observability — never used to grant/deny a lock. */
export function inspectExecutionLock(jobId) {
  if (!isValidJobId(jobId)) return null;
  const existing = readLockFileSafely(lockFilePath(jobId));
  if (existing.missing || existing.malformed) return null;
  return { owner: existing.data.owner, acquiredAt: existing.data.acquiredAt, expiresAt: existing.data.expiresAt, active: !isStale(existing.data) };
}
