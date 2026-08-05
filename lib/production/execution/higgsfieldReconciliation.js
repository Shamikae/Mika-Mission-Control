// lib/production/execution/higgsfieldReconciliation.js
// SERVER-SIDE ONLY.
//
// Narrow, no-spend reconciliation for a Higgsfield MCP job stuck in
// execution.errorReason "provider_submission_unresolved" — the submission
// genuinely succeeded on Higgsfield's side (real credits may already have
// been spent) but Mika could not parse a job id from the response (see
// higgsfieldMcp.adapter.js). This is deliberately scoped to that one, real,
// already-diagnosed gap — not a generic cross-provider reconciliation
// platform.
//
// Uses ONLY the read-only "show_generations" tool — never generate_image,
// generate_video, or any other Higgsfield tool. Never resubmits.
//
// Two-step, explicit-confirmation flow:
//   1. search  — read-only, no mutation. Fetches a small, bounded, recent
//      slice of Higgsfield's own generation history and matches it against
//      THIS job's own recorded providerInput and submission time. Matching
//      requires every signal the job specified to agree (media type, model,
//      an exact prompt hash, a narrow creation-time window, and aspect
//      ratio/duration wherever the job specified them) — a single weak
//      signal is never sufficient, and an ambiguous (2+) result is never
//      auto-resolved.
//   2. confirm — requires the caller to explicitly re-supply the exact
//      provider generation id from a freshly re-run search (never trusts a
//      stale or client-fabricated id). Attaches ONLY that id, transitions
//      the job back to "waiting_provider", appends an immutable activity
//      event, then drives the existing, unmodified poll() path to
//      completion.
//
// A job that is not genuinely in the "failed" + "provider_submission_unresolved"
// state is rejected by both steps — including a job that reconciliation has
// already resolved, making a second confirm call a safe, idempotent no-op
// (it errors instead of re-attaching or duplicating activity history).

import { getProductionJob, updateProductionJob } from '../productionJobStore.js';
import { makeActivityEvent } from '../productionRules.js';
import { pollExecutionForJob } from './executionEngine.js';
import { callHiggsfieldTool } from '../../higgsfield/higgsfieldMcpClient.js';
import { matchHiggsfieldGenerations, classifyHiggsfieldMatches } from './higgsfieldReconciliationMatcher.js';

export { matchHiggsfieldGenerations, classifyHiggsfieldMatches };

export const RECONCILE_ERROR_REASON = 'provider_submission_unresolved';
const SEARCH_LIMIT = 20; // bounded — never an unbounded history scan

/** Never mutates. Rejects any job not genuinely in the reconcilable state. */
function assertReconcilable(job) {
  if (!job) return { ok: false, status: 404, error: 'Job not found.' };
  if (job.selectedProvider !== 'higgsfield-mcp') {
    return { ok: false, status: 409, error: 'Reconciliation only applies to jobs using the "higgsfield-mcp" provider.' };
  }
  if (job.execution?.status !== 'failed' || job.execution?.errorReason !== RECONCILE_ERROR_REASON) {
    return {
      ok: false, status: 409,
      error: `This job is not in a reconcilable state (execution status: "${job.execution?.status || 'none'}", reason: "${job.execution?.errorReason || 'none'}"). Reconciliation only applies to a failed job with errorReason "${RECONCILE_ERROR_REASON}".`,
    };
  }
  return { ok: true };
}

/**
 * Step 1 — read-only search. Never mutates the job, never calls a
 * generation tool. Fetches a small, bounded, recent slice of Higgsfield's
 * own history and matches it against this job's own recorded intent.
 */
export async function searchHiggsfieldReconciliationCandidates(jobId) {
  const job = getProductionJob(jobId);
  const gate = assertReconcilable(job);
  if (!gate.ok) return gate;

  let result;
  try {
    result = await callHiggsfieldTool('show_generations', { limit: SEARCH_LIMIT });
  } catch (e) {
    return { ok: false, status: 502, error: `Could not read Higgsfield generation history: ${e.message}` };
  }

  const generations = Array.isArray(result.json?.items) ? result.json.items : [];
  const candidates = matchHiggsfieldGenerations({
    providerInput: job.providerInput,
    submittedAtIso: job.execution.startedAt,
    generations,
  });

  return { ok: true, result: classifyHiggsfieldMatches(candidates), candidates };
}

/**
 * Step 2 — confirmation. Re-runs the search itself (never trusts a stale or
 * client-fabricated candidate) and only proceeds if the confirmed id is
 * still present among the freshly matched candidates. Attaches ONLY the
 * provider generation id, appends one immutable activity event, then drives
 * the existing, unmodified poll() path — never resubmits.
 */
export async function confirmHiggsfieldReconciliation(jobId, { confirmedProviderGenerationId, actor = 'user' } = {}) {
  if (!confirmedProviderGenerationId || typeof confirmedProviderGenerationId !== 'string') {
    return { ok: false, status: 400, error: 'confirmedProviderGenerationId is required.' };
  }

  const job = getProductionJob(jobId);
  // Also makes a second confirm on an already-reconciled job a safe,
  // idempotent no-op: once reconciled the job is no longer "failed" with
  // this errorReason, so this gate rejects it rather than re-attaching.
  const gate = assertReconcilable(job);
  if (!gate.ok) return gate;

  const search = await searchHiggsfieldReconciliationCandidates(jobId);
  if (!search.ok) return search;

  const match = search.candidates.find(c => c.providerGenerationId === confirmedProviderGenerationId);
  if (!match) {
    return { ok: false, status: 409, error: 'The confirmed provider generation id is no longer among the freshly matched candidates — refusing to attach an unverified id. Run the search again.' };
  }

  updateProductionJob(jobId, {
    status: 'executing',
    execution: {
      ...job.execution,
      status: 'waiting_provider',
      providerJobId: match.providerGenerationId,
      error: null,
      errorReason: null,
      nextPollAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    activityHistory: [...job.activityHistory, makeActivityEvent('execution_reconciled', {
      actor,
      note: 'Provider generation id attached via read-only reconciliation (no new generation submitted, no additional credits spent).',
      metadata: { providerGenerationId: match.providerGenerationId },
    })],
  });

  const polled = await pollExecutionForJob(jobId, { force: true, actor });
  if (!polled.ok) return polled;
  return { ok: true, job: polled.job };
}
