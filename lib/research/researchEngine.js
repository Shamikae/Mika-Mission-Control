// lib/research/researchEngine.js
// SERVER-SIDE ONLY. The ONE orchestration module for the live research
// pipeline: query planning -> governed search -> normalize/dedupe/score ->
// bounded content fetch -> persisted research-run record. This module never
// calls an LLM — it only gathers and normalizes real source evidence. The
// Research Agent's own synthesis call (researchStage.js) consumes this
// run's sources afterward as grounding context.

import {
  getResearchConfig, checkResearchBudgetGate, estimateResearchCost,
  makeActivityEvent, ResearchError, isResearchRunTerminal,
} from './researchRules.js';
import { buildQueryPlan } from './queryPlanning.js';
import { dedupeAndScoreSources } from './sourceQuality.js';
import { canonicalDedupeKey } from './researchAdapterContract.js';
import { createExaAdapter } from './adapters/exaAdapter.js';
import { createTavilyAdapter } from './adapters/tavilyAdapter.js';
import { createMockResearchAdapter } from './adapters/mockAdapter.js';
import {
  generateResearchRunId, createResearchRun, getResearchRun, updateResearchRun,
  findActiveResearchRunForWorkforceRun,
} from './researchRunStore.js';

function mockModeActive() {
  return process.env.CONTENT_RESEARCH_MOCK_MODE === 'true' && process.env.NODE_ENV !== 'production';
}

function selectAdapter(cfg) {
  if (mockModeActive()) return createMockResearchAdapter();
  if (cfg.provider === 'exa') return createExaAdapter();
  if (cfg.provider === 'tavily') return createTavilyAdapter();
  return null; // brave-search: staged, no adapter implemented this milestone
}

function finalizeAsFailed(run, errorReason, error) {
  return updateResearchRun(run.id, {
    status: 'failed',
    errorReason,
    error,
    activityHistory: [...run.activityHistory, makeActivityEvent('research_failed', { actor: 'system', note: errorReason })],
  });
}

export function getOrCreateResearchRun(workforceRunId, requestId) {
  const existing = findActiveResearchRunForWorkforceRun(workforceRunId);
  if (existing) return { run: existing, created: false };

  const now = new Date().toISOString();
  const run = {
    id: generateResearchRunId(),
    workforceRunId,
    requestId,
    mode: 'live-search',
    provider: null,
    status: 'draft',
    queries: [],
    sources: [],
    evidence: [],
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    usage: { queries: 0, fetches: 0 },
    estimatedCost: null,
    warnings: [],
    errorReason: null,
    error: null,
    activityHistory: [makeActivityEvent('research_run_created', { actor: 'system', note: `For workforce run ${workforceRunId}` })],
    version: 1,
  };
  createResearchRun(run);
  return { run, created: true };
}

/**
 * Runs the full live-research pipeline for an existing research-run record.
 * Never throws for expected failure modes — records status:"failed" with an
 * honest errorReason instead, exactly like workforceModelClient.js's
 * philosophy for the model-call boundary.
 */
export async function runLiveResearch(runId, request, { overrideBudget = false } = {}) {
  const cfg = getResearchConfig();
  let run = getResearchRun(runId);
  if (!run) throw new ResearchError(404, 'run_not_found', `Research run "${runId}" not found.`);
  if (isResearchRunTerminal(run.status) && run.status !== 'failed') {
    throw new ResearchError(409, 'run_terminal', `Cannot run — research run status is already terminal ("${run.status}").`);
  }

  if (!cfg.enabled) return finalizeAsFailed(run, 'configuration_pending', 'CONTENT_RESEARCH_ENABLED is not set to true.');

  const adapter = selectAdapter(cfg);
  if (!adapter) return finalizeAsFailed(run, 'configuration_pending', `No adapter is implemented for provider "${cfg.provider}" in this milestone.`);

  const health = await adapter.healthCheck();
  if (!health.healthy) return finalizeAsFailed(run, 'configuration_pending', health.message);

  const plan = buildQueryPlan(request);
  if (!plan.queries.length) return finalizeAsFailed(run, 'invalid_request', 'Query planning produced zero queries for this request.');

  const preEstimate = estimateResearchCost({ queryCount: plan.queries.length, fetchCount: cfg.maxFetches });
  const gate = checkResearchBudgetGate(cfg.maxEstimatedCostUsd, preEstimate.amountUsd, { overrideBudget });
  if (gate.blocked) return finalizeAsFailed(run, 'budget_cap_exceeded', gate.reason);

  run = updateResearchRun(runId, {
    status: 'planning',
    provider: adapter.id,
    queries: plan.queries,
    activityHistory: [...run.activityHistory, makeActivityEvent('queries_planned', { actor: 'system', note: `${plan.queries.length} queries` })],
  });

  // ── searching (bounded to one retry per query on a transient failure) ──
  run = updateResearchRun(runId, { status: 'searching' });
  const rawResults = [];
  let queryCount = 0;
  for (const q of plan.queries) {
    queryCount += 1;
    let attempt = await adapter.search(q.query, { numResults: q.resultLimit, timeoutMs: cfg.timeoutMs });
    let retried = false;
    if (!attempt.ok) {
      attempt = await adapter.search(q.query, { numResults: q.resultLimit, timeoutMs: cfg.timeoutMs });
      retried = true;
    }
    if (!attempt.ok) {
      return finalizeAsFailed(getResearchRun(runId), attempt.status, `Query "${q.id}" failed${retried ? ' (after one retry)' : ''}: ${attempt.message}`);
    }
    rawResults.push(...adapter.normalizeResults(attempt.results, { query: q.query }));
  }

  // ── dedupe + score + cap ─────────────────────────────────────────────
  const sources = dedupeAndScoreSources(rawResults, { dedupeKeyFn: canonicalDedupeKey })
    .sort((a, b) => b.qualityScore - a.qualityScore)
    .slice(0, cfg.maxSources);

  run = updateResearchRun(runId, {
    status: 'fetching',
    sources,
    usage: { queries: queryCount, fetches: 0 },
    activityHistory: [...getResearchRun(runId).activityHistory, makeActivityEvent('sources_gathered', { actor: 'system', note: `${sources.length} unique sources from ${queryCount} queries` })],
  });

  // ── bounded full-content fetch for the top-scored sources only ────────
  const toFetch = sources.slice(0, cfg.maxFetches);
  let fetchCount = 0;
  const fetchWarnings = [];
  for (const s of toFetch) {
    const fetched = await adapter.fetch(s, { maxCharacters: 4000, timeoutMs: cfg.timeoutMs });
    if (fetched.ok) {
      fetchCount += 1;
      s.content = String(fetched.content || '').slice(0, 4000);
    } else {
      fetchWarnings.push(`Full-content fetch failed for "${s.title}" — keeping its search-result snippet instead.`);
    }
  }

  const finalCost = estimateResearchCost({ queryCount, fetchCount });
  const now = new Date().toISOString();
  return updateResearchRun(runId, {
    status: 'ready',
    sources,
    completedAt: now,
    usage: { queries: queryCount, fetches: fetchCount },
    estimatedCost: finalCost,
    warnings: fetchWarnings,
    activityHistory: [...getResearchRun(runId).activityHistory, makeActivityEvent('research_ready', { actor: 'system', note: `${sources.length} sources, ${fetchCount} fetched in full` })],
  });
}

export function retryResearchRun(runId) {
  const run = getResearchRun(runId);
  if (!run) throw new ResearchError(404, 'run_not_found', `Research run "${runId}" not found.`);
  if (run.status !== 'failed') throw new ResearchError(409, 'invalid_state', `Cannot retry — research run status is "${run.status}", expected "failed".`);
  return updateResearchRun(runId, {
    status: 'draft',
    errorReason: null,
    error: null,
    activityHistory: [...run.activityHistory, makeActivityEvent('research_retry_requested', { actor: 'user' })],
  });
}

export function cancelResearchRun(runId) {
  const run = getResearchRun(runId);
  if (!run) throw new ResearchError(404, 'run_not_found', `Research run "${runId}" not found.`);
  if (isResearchRunTerminal(run.status)) throw new ResearchError(409, 'run_terminal', `Cannot cancel — research run status is already terminal ("${run.status}").`);
  return updateResearchRun(runId, {
    status: 'cancelled',
    activityHistory: [...run.activityHistory, makeActivityEvent('research_cancelled', { actor: 'user' })],
  });
}

export function getKnownSourceIds(researchRun) {
  return new Set((researchRun?.sources || []).map(s => s.id));
}
