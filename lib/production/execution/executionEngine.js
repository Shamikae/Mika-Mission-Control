// lib/production/execution/executionEngine.js
// SERVER-SIDE ONLY.
//
// The Provider Execution Engine orchestrator. Owns everything the milestone
// spec assigns to "the engine": eligibility-to-execute-now, adapter
// selection, queue/lifecycle state, retries, polling, cancellation, output
// normalization, artifact ingestion, and terminal status.
//
// It deliberately does NOT re-decide anything Production Router already
// decided (eligibility-to-plan, mode, provider recommendation, readiness,
// budget, approval) — those live exclusively in lib/production/productionRules.js
// and lib/production/buildProductionPlan.js, imported and read here, never
// recomputed differently.
//
// LOCKING: the authoritative lock is the atomic file in
// lib/production/execution/executionLock.js (data/production-execution-locks/).
// job.execution.lock, persisted here, is sanitized OBSERVABILITY metadata
// mirrored from an acquired lock — it is never consulted to decide whether
// a new acquisition may succeed. The lock TOKEN is stored server-side in
// job.execution.lock (never returned by any API — sanitizeExecutionForResponse
// strips it) purely so a later, separate request (e.g. a poll call) can
// look up which token this job's lock was issued with, since each Next.js
// API request is otherwise stateless.

import { getProductionJob, updateProductionJob } from '../productionJobStore.js';
import { loadPackage } from '../../content/contentPackageStore.js';
import { applyProductionRefToPackage } from '../buildProductionPlan.js';
import { makeActivityEvent } from '../productionRules.js';
import {
  ACTIVE_EXECUTION_STATES, DEFAULT_MAX_ATTEMPTS, MAX_ATTEMPTS_CEILING,
  EXECUTION_LOCK_OWNER, EXECUTION_LOCK_TTL_MS,
  checkExecutionEligibility, isRetryableErrorReason, computeBackoffSeconds,
  sanitizeProviderMetadata, sanitizeExecutionForResponse,
  isAllowedArtifactMime, maxBytesForMime,
} from './executionRules.js';
import { acquireExecutionLock, releaseExecutionLock, renewExecutionLock } from './executionLock.js';
import { pushToQueue, listQueue, queuePosition, removeFromQueue, isQueued } from './executionQueue.js';
import { getExecutionAdapter, isProviderKnown, isProviderExecutable } from './providerAdapterRegistry.js';
import { saveProductionArtifact } from './productionArtifactStore.js';
import { downloadRemoteArtifact } from './downloadRemoteArtifact.js';

const MAX_QUEUE_SCAN = 10; // bounded — never an unbounded scan

// ── Shared helpers ────────────────────────────────────────────────────────────

async function resolveProviderInfo(providerId) {
  const providerKnown = isProviderKnown(providerId);
  const providerExecutable = providerKnown ? await isProviderExecutable(providerId) : false;
  return { providerKnown, providerExecutable };
}

function lockObservability(lockResult) {
  if (!lockResult?.ok) return null;
  return { owner: lockResult.owner, token: lockResult.token, acquiredAt: lockResult.acquiredAt, expiresAt: lockResult.expiresAt };
}

/**
 * Marks a job failed and — if a lock token is held — releases the
 * authoritative lock first. `token` is null for failures that occur before
 * any lock was ever acquired (e.g. an ineligibility check at enqueue/scan
 * time), in which case there is nothing to release.
 */
function markExecutionFailed(job, { reason, message, actor = 'system', token = null, rawMetadata } = {}) {
  if (token) releaseExecutionLock(job.id, token);

  const retryable = isRetryableErrorReason(reason);
  const failed = updateProductionJob(job.id, {
    status: 'failed',
    execution: {
      ...job.execution,
      status: 'failed',
      error: String(message || 'Execution failed').slice(0, 500),
      errorReason: reason || 'unknown_error',
      updatedAt: new Date().toISOString(),
      lock: null,
      // Only overwritten when the caller has real diagnostics to persist
      // (e.g. a submit response that failed to parse) — otherwise the
      // execution's prior providerMetadata is left untouched.
      ...(rawMetadata !== undefined ? { providerMetadata: sanitizeProviderMetadata(rawMetadata) } : {}),
    },
    activityHistory: [...job.activityHistory, makeActivityEvent('execution_failed', {
      actor, note: message, metadata: { reason, retryable, attemptCount: job.execution?.attemptCount ?? null },
    })],
  });
  applyProductionRefToPackage(failed);
  return failed;
}

async function ingestOutput(output, { pkg, jobId }) {
  if (!isAllowedArtifactMime(output.mimeType)) {
    throw new Error(`MIME type "${output.mimeType}" is not in the artifact allowlist.`);
  }

  let buffer;
  if (output.localBuffer) {
    if (!Buffer.isBuffer(output.localBuffer)) throw new Error('localBuffer must be a Buffer.');
    buffer = output.localBuffer;
  } else if (output.url) {
    const downloaded = await downloadRemoteArtifact(output.url, output.mimeType);
    buffer = downloaded.buffer;
  } else {
    throw new Error('Output has neither localBuffer nor url.');
  }

  const maxBytes = maxBytesForMime(output.mimeType);
  if (buffer.length > maxBytes) {
    throw new Error(`Artifact exceeds max size (${buffer.length} > ${maxBytes} bytes).`);
  }

  const saved = saveProductionArtifact({ brand: pkg.brand, productionJobId: jobId, buffer, mimeType: output.mimeType, filename: output.filename });
  return {
    id: saved.id,
    type: output.type || 'document',
    mimeType: output.mimeType,
    filename: saved.filename,
    sizeBytes: saved.sizeBytes,
    artifactUrl: saved.artifactUrl, // local secure route only — never a provider URL
    metadata: output.metadata || null,
  };
}

async function finalizeCompletion(job, pkg, rawResult, { actor, token }) {
  const adapter = getExecutionAdapter(job.selectedProvider);
  const normalized = adapter.normalizeResult(rawResult);

  let current = updateProductionJob(job.id, {
    execution: { ...job.execution, status: 'downloading', updatedAt: new Date().toISOString() },
    activityHistory: [...job.activityHistory, makeActivityEvent('execution_progress', { actor: 'system', note: 'Downloading/collecting provider outputs.' })],
  });

  const savedOutputs = [];
  for (const output of normalized.outputs || []) {
    try {
      savedOutputs.push(await ingestOutput(output, { pkg, jobId: job.id }));
    } catch (e) {
      const failed = markExecutionFailed(current, { reason: 'provider_error', message: `Artifact ingestion failed: ${e.message}`, actor, token });
      return { ok: true, job: failed };
    }
  }

  current = updateProductionJob(job.id, {
    execution: { ...current.execution, status: 'processing_artifacts', updatedAt: new Date().toISOString() },
  });

  // Release the authoritative lock now that no further provider interaction
  // will happen for this job — completed/failed/cancelled are all terminal.
  if (token) releaseExecutionLock(job.id, token);

  const now = new Date().toISOString();
  current = updateProductionJob(job.id, {
    status: 'completed',
    execution: {
      ...current.execution,
      status: 'completed',
      progress: 100,
      completedAt: now,
      updatedAt: now,
      outputs: savedOutputs,
      providerMetadata: sanitizeProviderMetadata(normalized.providerMetadata),
      lock: null,
      error: null,
      errorReason: null,
    },
    activityHistory: [...current.activityHistory, makeActivityEvent('execution_completed', {
      actor: 'system', note: `${savedOutputs.length} artifact(s) saved.`, metadata: { outputCount: savedOutputs.length },
    })],
  });
  applyProductionRefToPackage(current);

  return { ok: true, job: current };
}

function freshExecutionRecord(job, maxAttempts) {
  return {
    status: 'queued',
    provider: job.selectedProvider,
    providerJobId: null,
    attemptCount: job.execution?.attemptCount || 0,
    maxAttempts,
    startedAt: null,
    updatedAt: new Date().toISOString(),
    completedAt: null,
    cancelledAt: null,
    lastPollAt: null,
    nextPollAt: null,
    progress: null,
    error: null,
    errorReason: null,
    outputs: job.execution?.outputs || [],
    providerMetadata: null,
    lock: null,
    mock: job.selectedProvider === 'mock-video',
  };
}

/**
 * Runs the actual submit step once the authoritative lock is already held.
 * `token` must be threaded through to every terminal/async persistence
 * point so the lock can be correctly released (or kept, for the async
 * waiting_provider case) by whoever legitimately holds it.
 */
async function executeSubmission(job, pkg, lockResult, { actor }) {
  const token = lockResult.token;
  const lockMeta = lockObservability(lockResult);

  let current = updateProductionJob(job.id, {
    execution: { ...job.execution, lock: lockMeta },
  });

  const attemptNumber = (current.execution.attemptCount || 0) + 1;
  current = updateProductionJob(job.id, {
    status: 'executing',
    execution: {
      ...current.execution,
      status: 'executing',
      attemptCount: attemptNumber,
      startedAt: current.execution.startedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      error: null,
      errorReason: null,
    },
    activityHistory: [...current.activityHistory, makeActivityEvent('execution_started', { actor, note: `Attempt ${attemptNumber}/${current.execution.maxAttempts}` })],
  });
  applyProductionRefToPackage(current);

  const adapter = getExecutionAdapter(job.selectedProvider);
  if (!adapter) {
    const failed = markExecutionFailed(current, { reason: 'validation_error', message: `No execution adapter registered for provider "${job.selectedProvider}".`, actor: 'system', token });
    return { ok: true, job: failed };
  }

  let submitResult;
  try {
    submitResult = await adapter.submit({ job: current, pkg, attemptNumber });
  } catch (e) {
    const failed = markExecutionFailed(current, { reason: 'unknown_error', message: e.message, actor: 'system', token });
    return { ok: true, job: failed };
  }

  if (!submitResult.ok) {
    const failed = markExecutionFailed(current, { reason: submitResult.errorReason || 'provider_error', message: submitResult.error || 'Provider submit failed.', actor: 'system', token, rawMetadata: submitResult.rawMetadata });
    return { ok: true, job: failed };
  }

  // manual-export completes synchronously right here — this is also the
  // only place a providerJobId is ever submitted for a given attempt, and
  // the lock guarantees no second submit can happen for the same attempt.
  if (submitResult.status === 'completed') {
    return finalizeCompletion(current, pkg, submitResult, { actor: 'system', token });
  }

  // Async adapter (mock-video) — persist waiting_provider; the lock stays
  // held (its token remains recorded in job.execution.lock, server-side
  // only) until a later poll/cancel call resolves it to a terminal state.
  const nextPollAt = submitResult.nextPollSeconds ? new Date(Date.now() + submitResult.nextPollSeconds * 1000).toISOString() : null;
  current = updateProductionJob(job.id, {
    execution: {
      ...current.execution,
      status: 'waiting_provider',
      providerJobId: submitResult.providerJobId,
      providerMetadata: sanitizeProviderMetadata(submitResult.rawMetadata),
      nextPollAt,
      updatedAt: new Date().toISOString(),
      lock: lockMeta,
    },
    activityHistory: [...current.activityHistory, makeActivityEvent('execution_submitted', {
      actor: 'system', note: `Provider job ${submitResult.providerJobId}`, metadata: { nextPollSeconds: submitResult.nextPollSeconds },
    })],
  });
  applyProductionRefToPackage(current);

  return { ok: true, job: current };
}

// ── Public: enqueue ──────────────────────────────────────────────────────────

export async function enqueueExecutionForJob(jobId, { maxAttempts, userNote, actor = 'user' } = {}) {
  const job = getProductionJob(jobId);
  if (!job) return { ok: false, status: 404, error: `Job "${jobId}" not found.` };

  const pkg = loadPackage(job.packageId);
  const providerInfo = await resolveProviderInfo(job.selectedProvider);

  const eligibility = checkExecutionEligibility(job, pkg, providerInfo);
  if (!eligibility.eligible) {
    return { ok: false, status: 409, error: eligibility.reasons.join(' '), reasons: eligibility.reasons };
  }
  if (isQueued(jobId)) {
    return { ok: false, status: 409, error: 'This job is already queued.' };
  }

  const clampedMaxAttempts = Number.isFinite(Number(maxAttempts))
    ? Math.max(1, Math.min(MAX_ATTEMPTS_CEILING, Math.round(Number(maxAttempts))))
    : DEFAULT_MAX_ATTEMPTS;

  const execution = job.execution && ACTIVE_EXECUTION_STATES.includes(job.execution.status)
    ? job.execution // defensive — should be unreachable given the eligibility check above
    : freshExecutionRecord(job, clampedMaxAttempts);

  const updatedJob = updateProductionJob(jobId, {
    status: 'queued',
    execution,
    activityHistory: [...job.activityHistory, makeActivityEvent('execution_queued', { actor, note: typeof userNote === 'string' ? userNote.slice(0, 500) : null })],
  });
  applyProductionRefToPackage(updatedJob);

  const queueResult = pushToQueue(jobId, { maxAttempts: clampedMaxAttempts, userNote });
  if (!queueResult.ok) {
    return { ok: false, status: 409, error: queueResult.error };
  }

  return { ok: true, job: updatedJob, queuePosition: queueResult.position };
}

// ── Public: run next queued item ─────────────────────────────────────────────

/**
 * 1. Peek the next queue entry.
 * 2. Attempt authoritative lock acquisition.
 * 3. Dequeue ONLY after lock acquisition succeeds.
 * 4. Revalidate eligibility after acquiring the lock (state may have
 *    changed between the peek and winning the lock).
 * 5. If revalidation fails: release the lock, mark the job failed, and
 *    never submit provider work.
 * 6. If the lock is contended (held by another request/process), leave the
 *    item in the queue and continue scanning for the next eligible,
 *    uncontended item — bounded, never an unbounded scan.
 */
export async function runNextExecution({ actor = 'user' } = {}) {
  const items = listQueue();
  if (!items.length) return { ok: true, message: 'Queue is empty.', job: null };

  const scanBound = Math.min(items.length, MAX_QUEUE_SCAN);

  for (let i = 0; i < scanBound; i++) {
    const head = items[i];
    const jobId = head.productionJobId;
    const job = getProductionJob(jobId);
    if (!job) {
      removeFromQueue(jobId);
      continue; // vanished job — skip and keep scanning
    }

    const pkg = loadPackage(job.packageId);
    const providerInfo = await resolveProviderInfo(job.selectedProvider);
    const eligibility = checkExecutionEligibility(job, pkg, providerInfo);

    if (!eligibility.eligible) {
      removeFromQueue(jobId);
      // A legitimate, honest outcome of processing the queue (not a
      // transport error) — mirrors Router v1's "blocked job is still
      // ok:true" convention. No lock was ever acquired for this job.
      const failed = markExecutionFailed(job, { reason: 'validation_error', message: eligibility.reasons.join(' '), actor: 'system', token: null });
      return { ok: true, job: failed };
    }

    const lockResult = acquireExecutionLock(jobId, { owner: EXECUTION_LOCK_OWNER });
    if (!lockResult.ok) {
      // Contended by another process/request right now — leave it in the
      // queue (never dequeue permanently for this reason) and try the next
      // eligible item instead.
      continue;
    }

    // Won the lock — dequeue only now.
    removeFromQueue(jobId);

    let jobForHistory = job;
    if (lockResult.reclaimed) {
      const note = lockResult.reclaimedFrom === 'malformed'
        ? 'Reclaimed a malformed execution lock file before processing.'
        : `Reclaimed a stale execution lock (previously "${lockResult.reclaimedFrom?.owner}", expired ${lockResult.reclaimedFrom?.expiresAt}).`;
      jobForHistory = updateProductionJob(jobId, {
        activityHistory: [...job.activityHistory, makeActivityEvent('execution_lock_reclaimed', { actor: 'system', note })],
      });
    }

    // Revalidate eligibility AFTER acquiring the lock.
    const freshJob = getProductionJob(jobId) || jobForHistory;
    const freshPkg = loadPackage(freshJob.packageId);
    const freshEligibility = checkExecutionEligibility(freshJob, freshPkg, providerInfo);
    if (!freshEligibility.eligible) {
      releaseExecutionLock(jobId, lockResult.token);
      const failed = markExecutionFailed(freshJob, { reason: 'validation_error', message: freshEligibility.reasons.join(' '), actor: 'system', token: null });
      return { ok: true, job: failed };
    }

    return executeSubmission(freshJob, freshPkg, lockResult, { actor });
  }

  return { ok: true, message: 'No eligible, uncontended queued job was available within the scan bound.', job: null };
}

// ── Public: poll ──────────────────────────────────────────────────────────────

export async function pollExecutionForJob(jobId, { force = false, actor = 'user' } = {}) {
  const job = getProductionJob(jobId);
  if (!job) return { ok: false, status: 404, error: `Job "${jobId}" not found.` };
  if (!job.execution) return { ok: false, status: 409, error: 'This job has no execution record yet.' };

  const execStatus = job.execution.status;
  if (execStatus !== 'waiting_provider') {
    return { ok: false, status: 409, error: `Job is in execution status "${execStatus}" — polling only applies while waiting on the provider.` };
  }
  if (!force && job.execution.nextPollAt && new Date(job.execution.nextPollAt).getTime() > Date.now()) {
    return { ok: false, status: 429, error: `Too early to poll — next allowed at ${job.execution.nextPollAt}. Pass force:true to override.` };
  }

  // Retrieve (server-side only) whichever token this job's lock was last
  // recorded with, and ensure we still — or again — hold the authoritative
  // lock before touching provider state. The renew/reacquire distinction
  // matters: renew only succeeds against the SAME still-valid lock file
  // entry; if it doesn't (expired and reclaimed by someone else, or the
  // file is simply gone), we must win a fresh acquisition rather than
  // assume ownership.
  const storedToken = job.execution.lock?.token || null;
  let token = storedToken;
  let reclaimNote = null;

  if (storedToken) {
    const renewed = renewExecutionLock(jobId, storedToken);
    if (!renewed.ok) {
      const reacquired = acquireExecutionLock(jobId, { owner: EXECUTION_LOCK_OWNER });
      if (!reacquired.ok) return { ok: false, status: 409, error: reacquired.error };
      token = reacquired.token;
      reclaimNote = 'Execution lock token no longer matched the authoritative lock (expired/reclaimed) — reacquired before polling.';
    }
  } else {
    const reacquired = acquireExecutionLock(jobId, { owner: EXECUTION_LOCK_OWNER });
    if (!reacquired.ok) return { ok: false, status: 409, error: reacquired.error };
    token = reacquired.token;
    reclaimNote = 'No execution lock token was on record for this job — acquired one before polling.';
  }

  const freshExpiresAt = new Date(Date.now() + EXECUTION_LOCK_TTL_MS).toISOString();
  let current = updateProductionJob(jobId, {
    execution: { ...job.execution, lock: { owner: EXECUTION_LOCK_OWNER, token, acquiredAt: job.execution.lock?.acquiredAt || new Date().toISOString(), expiresAt: freshExpiresAt } },
  });
  if (reclaimNote) {
    current = updateProductionJob(jobId, {
      activityHistory: [...current.activityHistory, makeActivityEvent('execution_lock_reclaimed', { actor: 'system', note: reclaimNote })],
    });
  }

  const pkg = loadPackage(job.packageId);
  const adapter = getExecutionAdapter(job.selectedProvider);
  if (!adapter) {
    const failed = markExecutionFailed(current, { reason: 'validation_error', message: `No execution adapter registered for provider "${job.selectedProvider}".`, actor: 'system', token });
    return { ok: true, job: failed };
  }

  let pollResult;
  try {
    pollResult = await adapter.poll({ job: current, pkg, providerJobId: current.execution.providerJobId });
  } catch (e) {
    const failed = markExecutionFailed(current, { reason: 'unknown_error', message: e.message, actor: 'system', token });
    return { ok: true, job: failed };
  }

  if (!pollResult.ok) {
    const failed = markExecutionFailed(current, { reason: pollResult.errorReason || 'provider_error', message: pollResult.error || 'Provider poll failed.', actor: 'system', token });
    return { ok: true, job: failed };
  }

  if (pollResult.status === 'completed') {
    return finalizeCompletion(current, pkg, pollResult, { actor, token });
  }

  const nextPollAt = pollResult.nextPollSeconds ? new Date(Date.now() + pollResult.nextPollSeconds * 1000).toISOString() : null;
  const polled = updateProductionJob(jobId, {
    execution: {
      ...current.execution,
      status: pollResult.status || 'waiting_provider',
      progress: pollResult.progress ?? current.execution.progress,
      lastPollAt: new Date().toISOString(),
      nextPollAt,
      providerMetadata: sanitizeProviderMetadata(pollResult.rawMetadata || current.execution.providerMetadata),
      updatedAt: new Date().toISOString(),
      lock: { owner: EXECUTION_LOCK_OWNER, token, acquiredAt: current.execution.lock.acquiredAt, expiresAt: freshExpiresAt },
    },
    activityHistory: [...current.activityHistory, makeActivityEvent('execution_polled', {
      actor, note: `Progress ${pollResult.progress ?? '?'}%`, metadata: { nextPollSeconds: pollResult.nextPollSeconds },
    })],
  });
  applyProductionRefToPackage(polled);

  return { ok: true, job: polled };
}

// ── Public: cancel ────────────────────────────────────────────────────────────

export async function cancelExecutionForJob(jobId, { actor = 'user', note } = {}) {
  const job = getProductionJob(jobId);
  if (!job) return { ok: false, status: 404, error: `Job "${jobId}" not found.` };

  // Cancel a merely-queued job (never submitted to a provider — no lock
  // was ever acquired for it, since run-next is the only thing that
  // acquires the lock, and it always dequeues before doing so).
  if (isQueued(jobId) && (!job.execution || job.execution.status === 'queued')) {
    removeFromQueue(jobId);
    const cancelled = updateProductionJob(jobId, {
      status: 'cancelled',
      execution: { ...(job.execution || {}), status: 'cancelled', cancelledAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lock: null },
      activityHistory: [...job.activityHistory, makeActivityEvent('execution_cancelled', { actor, note: note || 'Cancelled while queued.' })],
    });
    applyProductionRefToPackage(cancelled);
    return { ok: true, job: cancelled };
  }

  const execStatus = job.execution?.status;
  if (!execStatus || !['queued', 'executing', 'waiting_provider'].includes(execStatus)) {
    return { ok: false, status: 409, error: `Cannot cancel a job in execution status "${execStatus || 'none'}".` };
  }

  const adapter = getExecutionAdapter(job.selectedProvider);
  if (execStatus === 'waiting_provider' && job.execution.providerJobId && adapter) {
    try { await adapter.cancel({ job, providerJobId: job.execution.providerJobId }); }
    catch { /* best-effort — the job is still marked cancelled locally regardless */ }
  }

  const token = job.execution.lock?.token || null;
  if (token) releaseExecutionLock(jobId, token);

  const cancelled = updateProductionJob(jobId, {
    status: 'cancelled',
    execution: { ...job.execution, status: 'cancelled', cancelledAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lock: null },
    activityHistory: [...job.activityHistory, makeActivityEvent('execution_cancelled', { actor, note: note || null })],
  });
  applyProductionRefToPackage(cancelled);
  return { ok: true, job: cancelled };
}

// ── Public: retry ─────────────────────────────────────────────────────────────

export async function retryExecutionForJob(jobId, { actor = 'user' } = {}) {
  const job = getProductionJob(jobId);
  if (!job) return { ok: false, status: 404, error: `Job "${jobId}" not found.` };

  if (job.execution?.status !== 'failed') {
    return { ok: false, status: 409, error: `Only a "failed" execution can be retried (current: "${job.execution?.status || 'none'}").` };
  }
  if (!isRetryableErrorReason(job.execution.errorReason)) {
    return { ok: false, status: 409, error: `Failure reason "${job.execution.errorReason}" is not retryable.` };
  }
  if ((job.execution.attemptCount || 0) >= (job.execution.maxAttempts || DEFAULT_MAX_ATTEMPTS)) {
    return { ok: false, status: 409, error: `Maximum attempts (${job.execution.maxAttempts}) reached.` };
  }
  if (isQueued(jobId)) {
    return { ok: false, status: 409, error: 'This job is already queued.' };
  }

  // A 'failed' execution always already had its lock released by
  // markExecutionFailed — nothing to release here, only requeue.
  const backoffSeconds = computeBackoffSeconds((job.execution.attemptCount || 0) + 1);

  const requeued = updateProductionJob(jobId, {
    status: 'queued',
    execution: { ...job.execution, status: 'queued', error: null, errorReason: null, updatedAt: new Date().toISOString(), lock: null },
    activityHistory: [...job.activityHistory, makeActivityEvent('execution_retry', {
      actor, note: `Retry ${(job.execution.attemptCount || 0) + 1}/${job.execution.maxAttempts}, backoff ~${backoffSeconds}s`, metadata: { backoffSeconds },
    })],
  });
  applyProductionRefToPackage(requeued);

  const queueResult = pushToQueue(jobId, { maxAttempts: job.execution.maxAttempts });
  if (!queueResult.ok) return { ok: false, status: 409, error: queueResult.error };

  return { ok: true, job: requeued };
}

// ── Public: sanitized status view (GET) ──────────────────────────────────────

export async function getExecutionView(jobId) {
  const job = getProductionJob(jobId);
  if (!job) return { ok: false, status: 404, error: `Job "${jobId}" not found.` };

  if (job.execution) {
    return {
      ok: true,
      status: job.execution.status,
      execution: sanitizeExecutionForResponse(job.execution),
      queuePosition: isQueued(jobId) ? queuePosition(jobId) : null,
    };
  }

  const pkg = loadPackage(job.packageId);
  const providerInfo = await resolveProviderInfo(job.selectedProvider);
  const eligibility = checkExecutionEligibility(job, pkg, providerInfo);

  return {
    ok: true,
    status: eligibility.eligible ? 'ready' : 'not_eligible',
    execution: null,
    eligibility,
    queuePosition: null,
  };
}
