// lib/creative-director/workforce/workforceRules.js
// Pure functions — no I/O, no fs, no network. Safe to import from both server
// routes and the browser bundle (same convention as
// lib/creative-director/creativeDirectorRules.js). This is the ONLY place
// workforce run/stage state machine rules, invalidation dependencies, and
// budget math are defined — server and client always agree.

// Imported directly from productionRules.js (the original source both
// lib/creative-director/creativeDirectorRules.js and this file re-export
// from) rather than through creativeDirectorRules.js, so this file's own
// dependency chain stays entirely within the new workforce/production
// modules — avoids adding any import-path requirement onto a pre-existing,
// unmodified file (Node's native ESM loader, unlike webpack, requires
// explicit .js extensions on relative imports, which this file's own
// dependencies now consistently use).
import { isValidId, makeActivityEvent } from '../../production/productionRules.js';

export { isValidId, makeActivityEvent };

// ── Stage order + the ONE shared sequence every run follows ─────────────────

export const WORKFORCE_STAGE_IDS = [
  'research', 'script', 'storyboard', 'prompts', 'thumbnail', 'caption', 'review',
];

export const WORKFORCE_STAGE_META = {
  research:   { label: 'Research Agent',    description: 'Audience/topic/competitive research (model-assisted synthesis).' },
  script:     { label: 'Script Writer',     description: 'Hooks and full script.' },
  storyboard: { label: 'Storyboard Agent',  description: 'Scene-by-scene shot plan.' },
  prompts:    { label: 'Prompt Engineer',   description: 'Provider-specific generation prompts (planning only — no execution).' },
  thumbnail:  { label: 'Thumbnail Designer', description: 'Thumbnail concept and visual brief (planning only — no image generated here).' },
  caption:    { label: 'Caption Writer',    description: 'Platform captions, hashtags, CTA copy.' },
  review:     { label: 'Creative Review',   description: 'Structured AI review of the complete creative package.' },
};

// What each stage's prompt is built from (upstream stage ids whose EFFECTIVE
// — i.e. edited — output is included as context). Not the same as the
// invalidation map below.
export const STAGE_CONTEXT_DEPENDENCIES = {
  research:   [],
  script:     ['research'],
  storyboard: ['research', 'script'],
  prompts:    ['script', 'storyboard'],
  thumbnail:  ['research', 'script', 'prompts'],
  caption:    ['research', 'script', 'storyboard', 'prompts', 'thumbnail'],
  review:     ['research', 'script', 'storyboard', 'prompts', 'thumbnail', 'caption'],
};

// Explicit, literal invalidation map — rerunning a stage invalidates exactly
// these downstream stages (not simply "everything after it" — caption is
// deliberately NOT invalidated by a Storyboard rerun, per spec).
export const DOWNSTREAM_INVALIDATION = {
  research:   ['script', 'storyboard', 'prompts', 'thumbnail', 'caption', 'review'],
  script:     ['storyboard', 'prompts', 'thumbnail', 'caption', 'review'],
  storyboard: ['prompts', 'thumbnail', 'review'],
  prompts:    ['thumbnail', 'review'],
  thumbnail:  ['review'],
  caption:    ['review'],
  review:     [],
};

export function isValidStageId(id) {
  return WORKFORCE_STAGE_IDS.includes(id);
}

// ── Run statuses ──────────────────────────────────────────────────────────

export const WORKFORCE_RUN_STATUSES = [
  'draft', 'queued', 'running', 'waiting_review', 'approved',
  'rejected', 'failed', 'cancelled', 'package_created',
];

export const TERMINAL_RUN_STATUSES = ['rejected', 'cancelled', 'package_created'];

export const RUN_STATUS_META = {
  draft:            { label: 'Draft',            color: '#a78bfa' },
  queued:           { label: 'Queued',           color: '#5d6c86' },
  running:          { label: 'Running',          color: '#60a5fa' },
  waiting_review:   { label: 'Waiting Review',   color: '#f59e0b' },
  approved:         { label: 'Approved',         color: '#4ade80' },
  rejected:         { label: 'Rejected',         color: '#f87171' },
  failed:           { label: 'Failed',           color: '#f87171' },
  cancelled:        { label: 'Cancelled',        color: '#5d6c86' },
  package_created:  { label: 'Package Created',  color: 'var(--gold, #c9a84c)' },
};

export const STAGE_STATUS_META = {
  not_started:    { label: 'Not Started',    color: '#5d6c86' },
  queued:         { label: 'Queued',         color: '#5d6c86' },
  running:        { label: 'Running',        color: '#60a5fa' },
  completed:      { label: 'Completed',      color: '#4ade80' },
  failed:         { label: 'Failed',         color: '#f87171' },
  invalidated:    { label: 'Invalidated',    color: '#f59e0b' },
  waiting_review: { label: 'Waiting Review', color: '#f59e0b' },
  approved:       { label: 'Approved',       color: '#4ade80' },
  rejected:       { label: 'Rejected',       color: '#f87171' },
};

export function isRunTerminal(status) {
  return TERMINAL_RUN_STATUSES.includes(status);
}

// ── Fresh run scaffold ────────────────────────────────────────────────────

export function emptyStageSlot() {
  return { status: 'not_started', result: null };
}

export function defaultStages() {
  return Object.fromEntries(WORKFORCE_STAGE_IDS.map(id => [id, emptyStageSlot()]));
}

// ── Editable-override whitelist (human edits before final approval) ────────
// Persisted separately from raw stage output — never mutates the historical
// model result. Review evaluates the EFFECTIVE (merged) output.

const OVERRIDE_FIELDS = {
  // research.claims is editable because Creative Review's factualSafety score
  // is computed from it, and Research legitimately emits claims it has flagged
  // sourceNeeded:true with no sourceIds. Without a curation path those claims
  // block approval permanently: Review is not itself editable, approveRun()
  // hard-requires approvedForPackageCreation, and re-running Research is not a
  // remedy (it re-derives equally unsourced claims). The operator curates —
  // dropping or sourcing a claim — and Review re-scores the EFFECTIVE output.
  research:   ['claims'],
  script:     ['selectedHook', 'fullText', 'cta'],
  storyboard: ['scenes'], // scenes: array of { index, narration, visual } partial overrides by index
  thumbnail:  ['headline', 'visualBrief'],
  caption:    ['primaryCaption', 'hashtags'],
};

export function isEditableStage(stageId) {
  return Object.prototype.hasOwnProperty.call(OVERRIDE_FIELDS, stageId);
}

function clampOverrideString(v, max = 4000) {
  return typeof v === 'string' ? v.trim().slice(0, max) : undefined;
}

/**
 * Sanitizes a human edit patch for one stage into only the whitelisted,
 * editable fields for that stage. Unknown keys are silently dropped (the
 * API route itself rejects unknown top-level keys before this is reached).
 */
export function sanitizeStageOverride(stageId, patch) {
  if (!isEditableStage(stageId) || !patch || typeof patch !== 'object') return {};
  const allowed = OVERRIDE_FIELDS[stageId];
  const out = {};

  for (const key of allowed) {
    if (patch[key] === undefined) continue;
    if (stageId === 'storyboard' && key === 'scenes') {
      if (!Array.isArray(patch.scenes)) continue;
      out.scenes = patch.scenes
        .filter(s => s && typeof s === 'object' && Number.isFinite(s.index))
        .map(s => ({
          index: Math.max(0, Math.round(s.index)),
          narration: clampOverrideString(s.narration, 1000),
          visual: clampOverrideString(s.visual, 1000),
        }))
        .slice(0, 40);
      continue;
    }
    if (stageId === 'research' && key === 'claims') {
      if (!Array.isArray(patch.claims)) continue;
      out.claims = patch.claims
        .filter(c => c && typeof c === 'object' && typeof c.text === 'string' && c.text.trim())
        .map(c => {
          const sourceIds = Array.isArray(c.sourceIds)
            ? c.sourceIds.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim().slice(0, 500)).slice(0, 10)
            : [];
          return {
            text: clampOverrideString(c.text, 1000),
            sourceIds,
            // A curated claim is asserted by the operator, so it no longer
            // reports an outstanding source requirement.
            sourceNeeded: false,
            verificationStatus: sourceIds.length ? 'supported' : 'operator_asserted',
          };
        })
        .slice(0, 20);
      continue;
    }
    if (stageId === 'caption' && key === 'hashtags') {
      if (!Array.isArray(patch.hashtags)) continue;
      out.hashtags = patch.hashtags
        .filter(t => typeof t === 'string' && t.trim())
        .map(t => t.trim().replace(/^#/, '').slice(0, 40).toLowerCase())
        .filter((t, i, arr) => arr.indexOf(t) === i)
        .slice(0, 30);
      continue;
    }
    const clamped = clampOverrideString(patch[key], key === 'fullText' ? 6000 : 500);
    if (clamped !== undefined) out[key] = clamped;
  }
  return out;
}

/**
 * Merges a stage's raw model output with any human override for that stage,
 * WITHOUT mutating either. Returns the effective output every downstream
 * consumer (later stages' prompts, Creative Review, package mapping) must
 * use. Never touches run.stages[stageId].result — the historical output.
 */
export function getEffectiveStageOutput(run, stageId) {
  const slot = run?.stages?.[stageId];
  const base = slot?.result?.output || null;
  if (!base) return null;
  const override = run?.overrides?.[stageId];
  if (!override || typeof override !== 'object') return base;

  if (stageId === 'research') {
    // A curated claims array REPLACES the model's claims wholesale — the
    // operator's list is the whole truth downstream. Raw output is untouched.
    if (!Array.isArray(override.claims)) return base;
    return { ...base, claims: override.claims, unresolvedClaims: [] };
  }
  if (stageId === 'script') {
    const out = { ...base };
    if (override.selectedHook !== undefined) out.selectedHook = override.selectedHook;
    if (override.fullText !== undefined) out.fullText = override.fullText;
    if (override.cta !== undefined) out.cta = override.cta;
    return out;
  }
  if (stageId === 'storyboard') {
    if (!Array.isArray(override.scenes) || !override.scenes.length) return base;
    const byIndex = new Map(override.scenes.map(s => [s.index, s]));
    return {
      ...base,
      scenes: (base.scenes || []).map(scene => {
        const o = byIndex.get(scene.index);
        if (!o) return scene;
        return {
          ...scene,
          narration: o.narration !== undefined ? o.narration : scene.narration,
          visual: o.visual !== undefined ? o.visual : scene.visual,
        };
      }),
    };
  }
  if (stageId === 'thumbnail') {
    return {
      ...base,
      headline: override.headline !== undefined ? override.headline : base.headline,
      visualBrief: override.visualBrief !== undefined ? override.visualBrief : base.visualBrief,
    };
  }
  if (stageId === 'caption') {
    return {
      ...base,
      primaryCaption: override.primaryCaption !== undefined ? override.primaryCaption : base.primaryCaption,
      hashtags: override.hashtags !== undefined ? override.hashtags : base.hashtags,
    };
  }
  return base;
}

// ── Budget governance ────────────────────────────────────────────────────
// No real per-model pricing is integrated (mirrors
// lib/production/productionRules.js's estimateProviderBudget — provisional
// tier/flat-rate figures only, never a fabricated precise price). This flat
// rate is a deliberately conservative, clearly-labeled placeholder used only
// to keep the cumulative estimate in the same order of magnitude as typical
// small JSON-mode completions, so the cap is meaningful without pretending
// to know real OpenRouter billing.

const PROVISIONAL_USD_PER_1K_TOKENS = 0.003;

export function estimateCostFromTokens(totalTokens) {
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) return null;
  return {
    amountUsd: Math.round((totalTokens / 1000) * PROVISIONAL_USD_PER_1K_TOKENS * 1e6) / 1e6,
    provisional: true,
    basis: `${PROVISIONAL_USD_PER_1K_TOKENS} USD / 1K tokens (provisional flat rate — no real per-model pricing integrated)`,
  };
}

/** Rough pre-call estimate from prompt length alone (no usage yet). */
export function estimateCostFromPromptLength(promptChars, maxTokens) {
  const estimatedPromptTokens = Math.ceil((promptChars || 0) / 4);
  const estimatedTotalTokens = estimatedPromptTokens + (maxTokens || 0);
  return {
    estimatedTokens: estimatedTotalTokens,
    ...estimateCostFromTokens(estimatedTotalTokens),
  };
}

export function sumCumulativeCost(run) {
  return WORKFORCE_STAGE_IDS.reduce((sum, id) => {
    const cost = run?.stages?.[id]?.result?.estimatedCost;
    return sum + (cost?.amountUsd || 0);
  }, 0);
}

/**
 * @returns {{ blocked: boolean, reason?: string, projectedUsd: number, capUsd: number|null }}
 */
export function checkBudgetGate(run, preCallEstimateUsd, { overrideBudget = false } = {}) {
  const capUsd = run?.budget?.capUsd;
  if (capUsd == null) return { blocked: false, projectedUsd: null, capUsd: null };

  const cumulative = sumCumulativeCost(run);
  const projectedUsd = Math.round((cumulative + (preCallEstimateUsd || 0)) * 1e6) / 1e6;

  if (projectedUsd > capUsd && !overrideBudget) {
    return {
      blocked: true,
      reason: `Projected cumulative estimated cost ($${projectedUsd}) would exceed the configured budget cap ($${capUsd}). Pass overrideBudget: true to proceed anyway.`,
      projectedUsd,
      capUsd,
    };
  }
  return { blocked: false, projectedUsd, capUsd };
}

// ── Activity ─────────────────────────────────────────────────────────────

// ── Request body hygiene ──────────────────────────────────────────────────

/** Returns unknown keys present in body that are not in allowedKeys — empty array means clean. */
export function unknownKeys(body, allowedKeys) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
  const allowed = new Set(allowedKeys);
  return Object.keys(body).filter(k => !allowed.has(k));
}

// ── Errors ───────────────────────────────────────────────────────────────
// Defined here (not in workforceEngine.js) so both the engine and the
// package-mapping module can import it without a circular dependency.

export class WorkforceError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const WORKFORCE_ACTIVITY_EVENT_TYPES = [
  'run_created', 'stage_started', 'stage_completed', 'stage_failed', 'stage_schema_repair_attempted',
  'stage_invalidated', 'stage_rerun_requested', 'stage_edited', 'budget_override_approved',
  'review_completed', 'human_approved', 'human_rejected', 'run_cancelled', 'package_created',
];
