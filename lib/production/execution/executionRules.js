// lib/production/execution/executionRules.js
// Pure functions — no I/O, no fs, no network. Safe to import from both server
// routes and the browser bundle (same convention as
// lib/production/productionRules.js and lib/content/contentPipelineRules.js).
//
// This is the ONLY place execution-state transition legality, retry
// eligibility, MIME allowlists, and execution eligibility rules are defined.
//
// The Provider Execution Engine decides HOW/WHEN a ready job executes. It
// never re-decides eligibility/mode/provider/readiness/budget/approval —
// those remain exclusively Production Router's job (lib/production/productionRules.js).

// ── Execution states ─────────────────────────────────────────────────────────
// Fine-grained states live only on job.execution.status. The job's own
// top-level `status` (lib/production/productionRules.js JOB_STATES) already
// reserves 'queued' | 'executing' | 'completed' | 'failed' | 'cancelled' for
// this milestone — those five are kept in sync as a coarse mirror via
// mapExecutionStatusToJobStatus() below. 'ready' is never persisted; it is a
// synthesized view for a job that is eligible but has no execution record yet.

export const EXECUTION_STATES = [
  'ready', 'queued', 'executing', 'waiting_provider', 'downloading',
  'processing_artifacts', 'completed', 'failed', 'cancelled',
];

export const ACTIVE_EXECUTION_STATES = ['queued', 'executing', 'waiting_provider', 'downloading', 'processing_artifacts'];
export const TERMINAL_EXECUTION_STATES = ['completed', 'failed', 'cancelled'];

export function isValidExecutionState(state) {
  return EXECUTION_STATES.includes(state);
}

// Coarse mirror written to the job's own top-level `status` field.
export function mapExecutionStatusToJobStatus(executionStatus) {
  if (executionStatus === 'queued') return 'queued';
  if (['executing', 'waiting_provider', 'downloading', 'processing_artifacts'].includes(executionStatus)) return 'executing';
  if (executionStatus === 'completed') return 'completed';
  if (executionStatus === 'failed') return 'failed';
  if (executionStatus === 'cancelled') return 'cancelled';
  return null;
}

// ── Transition legality ──────────────────────────────────────────────────────

const TRANSITIONS = {
  queued:               ['executing', 'cancelled', 'failed'],
  executing:             ['waiting_provider', 'downloading', 'cancelled', 'failed'],
  waiting_provider:      ['waiting_provider', 'downloading', 'cancelled', 'failed'],
  downloading:           ['processing_artifacts', 'failed'],
  processing_artifacts:  ['completed', 'failed'],
  completed:             [],
  failed:                ['queued'], // retry only, and only through the dedicated retry endpoint
  cancelled:             [],
};

export function isValidExecutionTransition(from, to) {
  if (!isValidExecutionState(from) || !isValidExecutionState(to)) return false;
  if (from === to) return ['waiting_provider'].includes(from); // waiting_provider may "transition to itself" on an unchanged poll
  return (TRANSITIONS[from] || []).includes(to);
}

// ── Retry rules ───────────────────────────────────────────────────────────────

export const DEFAULT_MAX_ATTEMPTS = 3;
export const MAX_ATTEMPTS_CEILING = 5;

export const RETRYABLE_ERROR_REASONS = new Set([
  'network_error', 'timeout', 'provider_error', 'rate_limited', 'unknown_error',
]);
export const NON_RETRYABLE_ERROR_REASONS = new Set([
  'validation_error', 'authentication_error', 'budget_exceeded', 'cancelled', 'malformed_output',
  // The provider submission genuinely succeeded (and may have spent real
  // credits) but no job id could be parsed from the response — retrying
  // would resubmit and risk duplicate paid work. Recoverable ONLY via the
  // read-only reconciliation path (lib/production/execution/
  // higgsfieldReconciliation.js), never the normal retry endpoint.
  'provider_submission_unresolved',
]);

export function isRetryableErrorReason(reason) {
  return RETRYABLE_ERROR_REASONS.has(reason);
}

/**
 * Simple exponential backoff, informational only (v1 has no scheduler — every
 * retry is human-triggered via the explicit retry endpoint, so this value is
 * surfaced to the UI/activity log rather than enforced as a hard wait).
 */
export function computeBackoffSeconds(attemptNumber) {
  const base = 5;
  const capped = Math.min(attemptNumber, 6);
  return Math.min(base * 2 ** (capped - 1), 300);
}

// ── Locking ───────────────────────────────────────────────────────────────────

export const EXECUTION_LOCK_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const EXECUTION_LOCK_OWNER = 'production-execution-engine';

export function isLockStale(lock) {
  if (!lock) return true;
  const expires = new Date(lock.expiresAt).getTime();
  return !Number.isFinite(expires) || expires < Date.now();
}

export function isLockActive(lock) {
  return !!lock && !isLockStale(lock);
}

// ── Artifact MIME / size rules ────────────────────────────────────────────────

export const ARTIFACT_MIME_ALLOWLIST = {
  'video/mp4':  { category: 'video', ext: 'mp4' },
  'video/webm': { category: 'video', ext: 'webm' },
  'image/png':  { category: 'image', ext: 'png' },
  'image/jpeg': { category: 'image', ext: 'jpg' },
  'image/webp': { category: 'image', ext: 'webp' },
  'application/json': { category: 'document', ext: 'json' },
  'text/markdown':    { category: 'document', ext: 'md' },
};

export const ARTIFACT_MAX_BYTES = {
  video: 75 * 1024 * 1024,
  image: 15 * 1024 * 1024,
  document: 2 * 1024 * 1024,
};

export const ARTIFACT_DOWNLOAD_TIMEOUT_MS = 30_000;

export function isAllowedArtifactMime(mimeType) {
  return !!ARTIFACT_MIME_ALLOWLIST[mimeType];
}

export function maxBytesForMime(mimeType) {
  const entry = ARTIFACT_MIME_ALLOWLIST[mimeType];
  return entry ? ARTIFACT_MAX_BYTES[entry.category] : 0;
}

export function extForMime(mimeType) {
  return ARTIFACT_MIME_ALLOWLIST[mimeType]?.ext || null;
}

// ── Execution eligibility ─────────────────────────────────────────────────────
// Never re-decides Router-owned concerns (mode/provider recommendation,
// budget tiering) — only checks whether execution may start/continue RIGHT NOW.

/**
 * @param {object} job — the Production Job record
 * @param {object|null} pkg — the current, freshly-loaded Content Package (or null if missing)
 * @param {{ providerExecutable: boolean, providerKnown: boolean }} providerInfo
 * @returns {{ eligible: boolean, reasons: string[] }}
 */
export function checkExecutionEligibility(job, pkg, { providerExecutable, providerKnown } = {}) {
  const reasons = [];
  if (!job) return { eligible: false, reasons: ['Production job not found.'] };

  const execStatus = job.execution?.status || null;

  if (execStatus === 'completed') reasons.push('Job has already completed execution.');
  if (execStatus === 'cancelled') reasons.push('Job execution was cancelled — create a new plan or retry instead.');
  if (execStatus && ACTIVE_EXECUTION_STATES.includes(execStatus) && isLockActive(job.execution?.lock)) {
    reasons.push('An execution is already active for this job.');
  }

  const alreadyQueuedOrReady = job.status === 'ready' || job.status === 'queued' || execStatus === 'queued';
  if (!alreadyQueuedOrReady && !reasons.length) {
    reasons.push(`Job status must be "ready" or "queued" to execute (current: "${job.status}").`);
  }

  if (job.budget?.approvalRequired && !job.approval?.approvedAt) {
    reasons.push('Job requires approval before execution, and has not been approved.');
  }
  if (!job.readiness?.ready) {
    reasons.push('Job readiness check does not pass — required assets are missing.');
  }
  if (!job.selectedProvider) {
    reasons.push('No provider is selected.');
  } else if (providerKnown === false) {
    reasons.push(`Provider "${job.selectedProvider}" is not registered in the execution engine.`);
  } else if (providerExecutable === false) {
    reasons.push(`Provider "${job.selectedProvider}" is not currently executable.`);
  }

  if (!pkg) {
    reasons.push('Content Package no longer exists.');
  } else {
    if (job.packageUpdatedAt !== pkg.metadata?.updatedAt) {
      reasons.push('Package has changed since this plan was built — refresh the plan before executing.');
    }
    if (pkg.production?.latestJobId && pkg.production.latestJobId !== job.id) {
      reasons.push('This job is no longer the package\'s latest production job.');
    }
    if (pkg.status === 'rejected') {
      reasons.push('Package has been rejected.');
    }
  }

  return { eligible: reasons.length === 0, reasons };
}

// ── Sanitization ──────────────────────────────────────────────────────────────

const SECRET_KEY_PATTERN = /token|secret|key|password|authorization|credential|cookie/i;
const MAX_METADATA_JSON_BYTES = 4000;

/**
 * Strips anything resembling a secret key/value, drops the lock token, and
 * clamps overall size. Used both when persisting providerMetadata and when
 * building API responses.
 */
export function sanitizeProviderMetadata(raw) {
  if (!raw || typeof raw !== 'object') return null;

  function strip(node, depth = 0) {
    if (depth > 4 || node === null) return node;
    if (Array.isArray(node)) return node.slice(0, 20).map(v => strip(v, depth + 1));
    if (typeof node === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(node)) {
        if (SECRET_KEY_PATTERN.test(k)) continue;
        if (typeof v === 'string' && /^https?:\/\//i.test(v)) continue; // never carry provider URLs
        out[k] = strip(v, depth + 1);
      }
      return out;
    }
    return node;
  }

  const stripped = strip(raw);
  const json = JSON.stringify(stripped);
  if (json.length <= MAX_METADATA_JSON_BYTES) return stripped;
  return { truncated: true, note: 'providerMetadata exceeded size limit and was dropped.' };
}

/**
 * Sanitizes a job.execution object for API responses — never returns the
 * lock token, and re-runs providerMetadata sanitization defensively.
 */
export function sanitizeExecutionForResponse(execution) {
  if (!execution) return null;
  const { lock, ...rest } = execution;
  return {
    ...rest,
    providerMetadata: sanitizeProviderMetadata(execution.providerMetadata),
    lock: lock ? { active: isLockActive(lock), acquiredAt: lock.acquiredAt, expiresAt: lock.expiresAt } : null,
  };
}
