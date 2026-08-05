// lib/research/researchRules.js
// Pure functions — no I/O, no fs, no network. Safe to import from both server
// routes and the browser bundle (same convention as
// lib/creative-director/workforce/workforceRules.js). This is the ONLY place
// research-run state, governance limits, source classification enums, and
// budget math are defined — server and client always agree.

import { isValidId, makeActivityEvent } from '../production/productionRules.js';

export { isValidId, makeActivityEvent };

export class ResearchError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ── Config (env) ─────────────────────────────────────────────────────────
// Mirrors workforceModelClient.js's getWorkforceConfig() shape/conventions.

function bool(v, fallback = false) {
  if (v === undefined || v === '') return fallback;
  return String(v).trim().toLowerCase() === 'true';
}
function num(v, fallback) {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : fallback;
}

export function getResearchConfig() {
  return {
    enabled: bool(process.env.CONTENT_RESEARCH_ENABLED, false),
    provider: (process.env.CONTENT_RESEARCH_PROVIDER || 'exa').trim(),
    allowModelFallback: bool(process.env.CONTENT_RESEARCH_ALLOW_MODEL_FALLBACK, true),
    maxQueries: Math.min(5, num(process.env.CONTENT_RESEARCH_MAX_QUERIES, 5)),
    maxResultsPerQuery: Math.min(5, num(process.env.CONTENT_RESEARCH_MAX_RESULTS_PER_QUERY, 5)),
    maxSources: Math.min(15, num(process.env.CONTENT_RESEARCH_MAX_SOURCES, 15)),
    maxFetches: Math.min(3, num(process.env.CONTENT_RESEARCH_MAX_FETCHES, 3)),
    timeoutMs: num(process.env.CONTENT_RESEARCH_TIMEOUT_MS, 30000),
    maxEstimatedCostUsd: (() => {
      const raw = process.env.CONTENT_RESEARCH_MAX_ESTIMATED_COST;
      const n = Number(raw);
      return raw !== undefined && raw !== '' && Number.isFinite(n) && n >= 0 ? n : null;
    })(),
    requirePrimaryForStats: bool(process.env.CONTENT_RESEARCH_REQUIRE_PRIMARY_FOR_STATS, true),
  };
}

// ── Research run statuses ────────────────────────────────────────────────

export const RESEARCH_RUN_STATUSES = [
  'draft', 'planning', 'searching', 'fetching', 'ready', 'failed', 'cancelled',
];
export const TERMINAL_RESEARCH_STATUSES = ['ready', 'failed', 'cancelled'];
export function isResearchRunTerminal(status) {
  return TERMINAL_RESEARCH_STATUSES.includes(status);
}

export const RESEARCH_RUN_STATUS_META = {
  draft:     { label: 'Draft',     color: '#a78bfa' },
  planning:  { label: 'Planning',  color: '#60a5fa' },
  searching: { label: 'Searching', color: '#60a5fa' },
  fetching:  { label: 'Fetching',  color: '#60a5fa' },
  ready:     { label: 'Ready',     color: '#4ade80' },
  failed:    { label: 'Failed',    color: '#f87171' },
  cancelled: { label: 'Cancelled', color: '#5d6c86' },
};

// ── Source classification ────────────────────────────────────────────────

export const SOURCE_CLASSIFICATIONS = [
  'primary', 'authoritative-secondary', 'industry-source', 'community-source', 'commercial', 'unknown',
];

// ── Evidence model enums ─────────────────────────────────────────────────

export const VERIFICATION_STATUSES = ['supported', 'partially_supported', 'conflicting', 'unsupported', 'needs_verification'];
export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'];

// ── Budget governance ────────────────────────────────────────────────────
// Same provisional, honestly-labeled-estimate philosophy as
// lib/creative-director/workforce/workforceRules.js's estimateCostFromTokens
// — no real per-provider pricing is integrated for v1 beyond a conservative
// flat per-query/per-fetch placeholder.

const PROVISIONAL_USD_PER_QUERY = 0.005;
const PROVISIONAL_USD_PER_FETCH = 0.003;

export function estimateResearchCost({ queryCount = 0, fetchCount = 0 }) {
  const amountUsd = Math.round(((queryCount * PROVISIONAL_USD_PER_QUERY) + (fetchCount * PROVISIONAL_USD_PER_FETCH)) * 1e6) / 1e6;
  return {
    amountUsd,
    provisional: true,
    basis: `$${PROVISIONAL_USD_PER_QUERY}/query + $${PROVISIONAL_USD_PER_FETCH}/fetched page (provisional flat rate — no real per-provider pricing integrated)`,
  };
}

/**
 * @returns {{ blocked: boolean, reason?: string, projectedUsd: number|null, capUsd: number|null }}
 */
export function checkResearchBudgetGate(capUsd, estimateUsd, { overrideBudget = false } = {}) {
  if (capUsd == null) return { blocked: false, projectedUsd: null, capUsd: null };
  const projectedUsd = Math.round(estimateUsd * 1e6) / 1e6;
  if (projectedUsd > capUsd && !overrideBudget) {
    return {
      blocked: true,
      reason: `Estimated research cost ($${projectedUsd}) would exceed the configured budget cap ($${capUsd}). Pass overrideBudget: true to proceed anyway.`,
      projectedUsd,
      capUsd,
    };
  }
  return { blocked: false, projectedUsd, capUsd };
}

// ── Request body hygiene (shared with workforceRules.js's convention) ──────

export function unknownKeys(body, allowedKeys) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
  const allowed = new Set(allowedKeys);
  return Object.keys(body).filter(k => !allowed.has(k));
}
