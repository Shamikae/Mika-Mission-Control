// lib/creative-director/workforce/workforceEngine.js
// SERVER-SIDE ONLY. The ONE orchestration module for the Content Workforce —
// every API route calls into this file rather than reimplementing sequencing,
// invalidation, retry, or budget logic itself.

import {
  WORKFORCE_STAGE_IDS, STAGE_CONTEXT_DEPENDENCIES, DOWNSTREAM_INVALIDATION,
  isRunTerminal, emptyStageSlot, defaultStages, getEffectiveStageOutput,
  checkBudgetGate, makeActivityEvent, isValidStageId, WorkforceError,
} from './workforceRules';
import { buildStageWorker } from './stages/index';
import { generateWorkforceRunId, createWorkforceRun, getWorkforceRun, updateWorkforceRun, findActiveRunForRequest } from './workforceRunStore';
import { createPackageFromWorkforceRun } from './packageFromWorkforceRun';
import { getContentRequest, updateContentRequest } from '../contentRequestStore';
import { loadPackage } from '../../content/contentPackageStore';

export { WorkforceError };

function parseBudgetCap() {
  const raw = process.env.CONTENT_WORKFORCE_MAX_ESTIMATED_COST;
  const n = Number(raw);
  return raw !== undefined && raw !== '' && Number.isFinite(n) && n >= 0 ? n : null;
}

export function requestAllowsWorkforce(request) {
  return !!request && !['cancelled', 'rejected', 'completed'].includes(request.status);
}

// ── Run creation / resumption ────────────────────────────────────────────

export function getOrCreateRunForRequest(request) {
  const existing = findActiveRunForRequest(request.id);
  if (existing) return { run: existing, created: false };

  const now = new Date().toISOString();
  const run = {
    id: generateWorkforceRunId(),
    requestId: request.id,
    status: 'draft',
    currentStage: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    stages: defaultStages(),
    overrides: {},
    budget: { capUsd: parseBudgetCap(), currency: 'USD' },
    approval: { approved: false, approvedAt: null, actor: null },
    packageId: null,
    activityHistory: [makeActivityEvent('run_created', { actor: 'user', note: `For content request ${request.id}` })],
    version: 1,
  };
  createWorkforceRun(run);
  return { run, created: true };
}

// ── Context building (effective/edited outputs only) ────────────────────

function buildContext(run, request) {
  const context = {
    request: {
      id: request.id, brand: request.brand, platform: request.platform, goal: request.goal, topic: request.topic,
      targetAudience: request.targetAudience, style: request.style, cta: request.cta,
      desiredRuntime: request.desiredRuntime, avatarPreference: request.avatarPreference, priority: request.priority,
    },
  };
  for (const stageId of WORKFORCE_STAGE_IDS) {
    context[stageId] = getEffectiveStageOutput(run, stageId);
  }
  return context;
}

// ── Stage sequencing ─────────────────────────────────────────────────────

/** First stage that still needs to run (not_started/failed/invalidated), in fixed order. Null if all completed. */
export function nextPendingStageId(run) {
  for (const stageId of WORKFORCE_STAGE_IDS) {
    const status = run.stages[stageId]?.status;
    if (status !== 'completed') return stageId;
  }
  return null;
}

function contextReady(run, stageId) {
  return STAGE_CONTEXT_DEPENDENCIES[stageId].every(dep => run.stages[dep]?.status === 'completed');
}

/**
 * Executes exactly one stage and persists the result. Throws WorkforceError
 * for caller-facing failures (invalid state, budget block); a real STAGE
 * failure (model error, schema failure) is NOT thrown — it is recorded on
 * the run and returned normally, since that is expected, recoverable state.
 */
export async function executeOneStage(runId, stageId, { overrideBudget = false } = {}) {
  if (!isValidStageId(stageId)) throw new WorkforceError(400, 'invalid_stage', `Unknown stage "${stageId}".`);

  const run = getWorkforceRun(runId);
  if (!run) throw new WorkforceError(404, 'run_not_found', `Workforce run "${runId}" not found.`);
  if (isRunTerminal(run.status)) throw new WorkforceError(409, 'run_terminal', `Cannot run a stage — run status is terminal ("${run.status}").`);
  if (run.status === 'waiting_review' || run.status === 'approved') {
    throw new WorkforceError(409, 'run_not_running', `Run is "${run.status}" — rerun a specific stage instead of advancing sequentially.`);
  }

  const request = getContentRequest(run.requestId);
  if (!request) throw new WorkforceError(404, 'request_not_found', `Content request "${run.requestId}" not found.`);

  if (!contextReady(run, stageId)) {
    throw new WorkforceError(409, 'upstream_incomplete', `Stage "${stageId}" cannot run yet — required upstream stage(s) are not completed.`);
  }

  const worker = buildStageWorker(stageId, { requestPlatform: request.platform });
  const context = buildContext(run, request);

  const preEstimate = worker.estimate(context);
  const gate = checkBudgetGate(run, preEstimate.amountUsd, { overrideBudget });
  if (gate.blocked) {
    throw new WorkforceError(402, 'budget_cap_exceeded', gate.reason);
  }

  let workingRun = updateWorkforceRun(runId, {
    status: 'running',
    currentStage: stageId,
    stages: { ...run.stages, [stageId]: { status: 'running', result: run.stages[stageId]?.result || null } },
    activityHistory: [...run.activityHistory, makeActivityEvent('stage_started', { actor: 'system', note: stageId })],
  });

  const result = await worker.execute(context);

  const stageStatus = result.ok ? 'completed' : 'failed';
  const activityEvent = result.ok
    ? makeActivityEvent('stage_completed', { actor: 'system', note: stageId, metadata: { model: result.model, warnings: result.warnings } })
    : makeActivityEvent('stage_failed', { actor: 'system', note: stageId, metadata: { errorReason: result.errorReason } });

  const budgetOverrideEvent = (gate.capUsd != null && overrideBudget)
    ? [makeActivityEvent('budget_override_approved', { actor: 'user', note: stageId })]
    : [];

  let runStatus = 'running';
  let completedAt = null;
  if (!result.ok) {
    runStatus = 'failed';
  } else if (stageId === 'review') {
    runStatus = 'waiting_review';
    completedAt = new Date().toISOString();
  }

  workingRun = updateWorkforceRun(runId, {
    status: runStatus,
    currentStage: stageId,
    completedAt,
    stages: { ...workingRun.stages, [stageId]: { status: stageStatus, result } },
    activityHistory: [...workingRun.activityHistory, ...budgetOverrideEvent, activityEvent,
      ...(runStatus === 'waiting_review' ? [makeActivityEvent('review_completed', { actor: 'system', note: result.output?.verdict || 'unknown' })] : [])],
  });

  return workingRun;
}

/** One-click: executes every remaining stage in order, stopping at failure, budget block, or waiting_review. */
export async function runAllRemaining(runId, { overrideBudget = false } = {}) {
  let run = getWorkforceRun(runId);
  if (!run) throw new WorkforceError(404, 'run_not_found', `Workforce run "${runId}" not found.`);

  // Resuming a previously-failed run: the failed stage is re-attempted.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    run = getWorkforceRun(runId);
    if (isRunTerminal(run.status) || run.status === 'waiting_review' || run.status === 'approved') break;
    const stageId = nextPendingStageId(run);
    if (!stageId) break;
    run = await executeOneStage(runId, stageId, { overrideBudget });
    if (run.status === 'failed') break;
  }
  return run;
}

// ── Rerun / invalidation ─────────────────────────────────────────────────

export async function rerunStage(runId, stageId, { overrideBudget = false, note = null } = {}) {
  if (!isValidStageId(stageId)) throw new WorkforceError(400, 'invalid_stage', `Unknown stage "${stageId}".`);
  const run = getWorkforceRun(runId);
  if (!run) throw new WorkforceError(404, 'run_not_found', `Workforce run "${runId}" not found.`);
  if (run.status === 'package_created' || run.status === 'cancelled' || run.status === 'rejected') {
    throw new WorkforceError(409, 'run_terminal', `Cannot rerun a stage — run status is "${run.status}".`);
  }
  if (!contextReady(run, stageId)) {
    throw new WorkforceError(409, 'upstream_incomplete', `Stage "${stageId}" cannot rerun yet — required upstream stage(s) are not completed.`);
  }

  const invalidated = DOWNSTREAM_INVALIDATION[stageId] || [];
  const newStages = { ...run.stages };
  for (const downstreamId of invalidated) {
    if (newStages[downstreamId]?.status === 'completed' || newStages[downstreamId]?.status === 'failed') {
      newStages[downstreamId] = { status: 'invalidated', result: newStages[downstreamId].result };
    }
  }
  newStages[stageId] = emptyStageSlot();

  await updateWorkforceRun(runId, {
    status: 'running',
    approval: { approved: false, approvedAt: null, actor: null },
    stages: newStages,
    activityHistory: [
      ...run.activityHistory,
      makeActivityEvent('stage_rerun_requested', { actor: 'user', note: note || stageId, metadata: { stageId, invalidated } }),
      ...invalidated.map(id => makeActivityEvent('stage_invalidated', { actor: 'system', note: id })),
    ],
  });

  return executeOneStage(runId, stageId, { overrideBudget });
}

// ── Human review actions ─────────────────────────────────────────────────

export function approveRun(runId, { actor = 'user' } = {}) {
  const run = getWorkforceRun(runId);
  if (!run) throw new WorkforceError(404, 'run_not_found', `Workforce run "${runId}" not found.`);
  if (run.status !== 'waiting_review') {
    throw new WorkforceError(409, 'invalid_state', `Cannot approve — run status is "${run.status}", expected "waiting_review".`);
  }
  const review = run.stages.review?.result;
  if (!review?.ok || !review.output?.approvedForPackageCreation) {
    throw new WorkforceError(409, 'review_not_approved', 'AI Creative Review did not approve this package for creation — address blocking issues and rerun Review before human approval.');
  }
  const now = new Date().toISOString();
  return updateWorkforceRun(runId, {
    status: 'approved',
    approval: { approved: true, approvedAt: now, actor },
    activityHistory: [...run.activityHistory, makeActivityEvent('human_approved', { actor })],
  });
}

export function rejectRun(runId, { actor = 'user', reason = null } = {}) {
  const run = getWorkforceRun(runId);
  if (!run) throw new WorkforceError(404, 'run_not_found', `Workforce run "${runId}" not found.`);
  if (isRunTerminal(run.status)) {
    throw new WorkforceError(409, 'run_terminal', `Cannot reject — run status is already terminal ("${run.status}").`);
  }
  return updateWorkforceRun(runId, {
    status: 'rejected',
    activityHistory: [...run.activityHistory, makeActivityEvent('human_rejected', { actor, note: reason })],
  });
}

export function cancelRun(runId, { actor = 'user' } = {}) {
  const run = getWorkforceRun(runId);
  if (!run) throw new WorkforceError(404, 'run_not_found', `Workforce run "${runId}" not found.`);
  if (isRunTerminal(run.status)) {
    throw new WorkforceError(409, 'run_terminal', `Cannot cancel — run status is already terminal ("${run.status}").`);
  }
  return updateWorkforceRun(runId, {
    status: 'cancelled',
    activityHistory: [...run.activityHistory, makeActivityEvent('run_cancelled', { actor })],
  });
}

// ── Editing (whitelisted overrides, never mutates historical output) ────

export function applyStageOverride(runId, stageId, sanitizedOverride) {
  const run = getWorkforceRun(runId);
  if (!run) throw new WorkforceError(404, 'run_not_found', `Workforce run "${runId}" not found.`);
  if (run.stages[stageId]?.status !== 'completed') {
    throw new WorkforceError(409, 'stage_not_completed', `Cannot edit stage "${stageId}" — it has not completed yet.`);
  }
  if (run.status === 'package_created') {
    throw new WorkforceError(409, 'run_terminal', 'Cannot edit — this run already created a package.');
  }

  const invalidated = DOWNSTREAM_INVALIDATION[stageId] || [];
  const newStages = { ...run.stages };
  for (const downstreamId of invalidated) {
    if (newStages[downstreamId]?.status === 'completed' || newStages[downstreamId]?.status === 'failed') {
      newStages[downstreamId] = { status: 'invalidated', result: newStages[downstreamId].result };
    }
  }

  return updateWorkforceRun(runId, {
    status: run.status === 'waiting_review' || run.status === 'approved' ? 'running' : run.status,
    approval: { approved: false, approvedAt: null, actor: null },
    overrides: { ...run.overrides, [stageId]: { ...run.overrides?.[stageId], ...sanitizedOverride } },
    stages: newStages,
    activityHistory: [
      ...run.activityHistory,
      makeActivityEvent('stage_edited', { actor: 'user', note: stageId }),
      ...invalidated.map(id => makeActivityEvent('stage_invalidated', { actor: 'system', note: id })),
    ],
  });
}

// ── Package creation (idempotent) ────────────────────────────────────────

export async function createPackageForRun(runId) {
  const run = getWorkforceRun(runId);
  if (!run) throw new WorkforceError(404, 'run_not_found', `Workforce run "${runId}" not found.`);

  if (run.packageId) {
    const pkg = loadPackage(run.packageId);
    return { run, package: pkg, alreadyCreated: true };
  }

  if (run.status !== 'approved') {
    throw new WorkforceError(409, 'not_approved', `Cannot create a package — run status is "${run.status}", expected "approved".`);
  }

  const request = getContentRequest(run.requestId);
  if (!request) throw new WorkforceError(404, 'request_not_found', `Content request "${run.requestId}" not found.`);

  const pkg = createPackageFromWorkforceRun(run, request);

  const updatedRun = updateWorkforceRun(runId, {
    status: 'package_created',
    packageId: pkg.id,
    activityHistory: [...run.activityHistory, makeActivityEvent('package_created', { actor: 'user', note: pkg.id })],
  });

  updateContentRequest(request.id, { packageId: pkg.id });

  return { run: updatedRun, package: pkg, alreadyCreated: false };
}
