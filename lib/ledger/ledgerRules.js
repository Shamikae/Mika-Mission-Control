// lib/ledger/ledgerRules.js
// Pure functions — no I/O, no fs, no network. Safe on both server and client
// (same convention as productionRules.js, publishingRules.js, renderSpecSchema.js).
//
// ── The Ledger (F2) ───────────────────────────────────────────────────────
//
// ONE append-only record of every governed execution across every division:
// who caused it, what capability it served, which provider/model was bound,
// what it was estimated to cost, what it actually cost, who approved it, and
// how it ended.
//
// This exists because governance was split three ways and blind to most of it:
// costEngine reads only the legacy dispatch log, the Activation Gate is not
// consulted by the Execution Engine, and production jobs carry isolated
// budget/approval blocks. Every video Mika has rendered is invisible to Cost
// Intelligence. Asset Generation would have been a fourth spend source.
//
// ── Invariants ───────────────────────────────────────────────────────────
//   • APPEND-ONLY. A record is written once and never edited. A mistake is
//     corrected by appending a linked correction record, never by mutation.
//   • ATTRIBUTED. Every record names an actor — human, agent, schedule, or
//     system. This field is what makes future autonomous agents auditable,
//     which is why it exists before any agent does.
//   • HONEST COST. `estimate` and `actual` are separate, and both carry an
//     explicit `confirmed` flag. An unknown actual cost is recorded as
//     unknown — never back-filled from the estimate.
//   • SAFE TO PERSIST. No prompts, no secrets, no OAuth tokens, no raw
//     provider payloads, no absolute paths. Prompts are referenced by hash;
//     the text lives in the Content Package / asset record.
//   • PROVIDER FIELDS ARE ATTRIBUTION, NOT LOGIC. `binding.providerId` is
//     recorded so spend can be attributed. No division may branch on it.
//   • UNITS ARE PRESERVED EXACTLY. 0.12 higgsfield-credits is recorded as
//     0.12 higgsfield-credits — never rewritten as $0.12, never converted into
//     another provider's credits. Audit history records what happened; turning
//     incomparable units into one comparable number is an analytics concern and
//     belongs downstream, where the assumption behind the conversion can be
//     stated and changed. A converted figure written here would be
//     indistinguishable from a real one forever after.

import { COST_ESTIMATE_TYPES, COST_UNITS } from '../cost/costShape.js';

export const LEDGER_SCHEMA_VERSION = 1;

export const ACTOR_TYPES = ['human', 'agent', 'schedule', 'system'];

export const LEDGER_EVENTS = [
  'approval_granted',
  'execution_started',
  'execution_completed',
  'execution_failed',
  'execution_cancelled',
  // Cache decisions are governed events too: a hit is a deliberate choice NOT
  // to spend, and is exactly as auditable as a purchase.
  'cache_hit',
  'cache_miss',
  // Batch asset planning. One plan, one approval — later child executions
  // reference the same approvalRef rather than approving per scene.
  'asset_plan_created',
  'asset_plan_estimated',
  'asset_plan_approval_requested',
  'asset_plan_approved',
  'asset_plan_rejected',
  'asset_plan_invalidated',
  'correction',
];

export const OUTCOME_STATUSES = ['pending', 'approved', 'started', 'completed', 'failed', 'cancelled', 'corrected', 'cache_hit', 'cache_miss', 'planned', 'estimated', 'invalidated'];

// `confirmed_*` means the number is real. `provisional_*` means it is a guess
// and must never be presented as spend.
//
// Re-exported from the shared money shape rather than duplicated: a second copy
// would let the Ledger silently reject a vocabulary the planner had already
// accepted, which is exactly how an estimate loses its provenance on the way to
// storage.
export const ESTIMATE_TYPES = COST_ESTIMATE_TYPES;

const ID_RE = /^[a-zA-Z0-9_-]{1,120}$/;
const MAX = { short: 200, id: 120, reason: 500 };

export function isValidLedgerId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

function str(v, max = MAX.short) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function num(v) {
  return Number.isFinite(v) ? v : null;
}

// ── Content safety ────────────────────────────────────────────────────────

// Patterns that must never reach a persisted ledger record. Checked over the
// serialized record, so a value nested anywhere is still caught.
const FORBIDDEN_PATTERNS = [
  { name: 'absolute_path', re: /(^|["'\s])\/(Users|home|var|etc|root)\// },
  { name: 'windows_path', re: /[A-Za-z]:\\\\/ },
  { name: 'bearer_token', re: /Bearer\s+[A-Za-z0-9._-]{20,}/i },
  { name: 'api_key', re: /\b(sk|pk|rk)[-_](live|test)?[-_]?[A-Za-z0-9]{20,}/ },
  { name: 'aws_key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'private_key', re: /BEGIN (?:RSA |EC )?PRIVATE KEY/ },
  // Tolerates JSON-escaped keys (\"access_token\") — a raw provider payload
  // nested as a string is exactly the case that must be caught.
  { name: 'oauth_token', re: /\\?"(access_token|refresh_token|id_token|client_secret)\\?"\s*:/i },
  { name: 'data_uri', re: /data:[a-z]+\/[a-z0-9.+-]+;base64,/i },
];

/**
 * Scans a candidate record for content that must never be persisted.
 * @returns {string[]} names of violated rules (empty when safe)
 */
export function findForbiddenContent(record) {
  let serialized;
  try { serialized = JSON.stringify(record); } catch { return ['unserializable']; }
  return FORBIDDEN_PATTERNS.filter(p => p.re.test(serialized)).map(p => p.name);
}

// ── Normalization ─────────────────────────────────────────────────────────

function normalizeActor(actor) {
  // A bare string actor (the Execution Engine's existing convention —
  // `actor: 'user'` / `'system'`) is accepted and widened, so the engine's
  // current call sites keep working without change.
  if (typeof actor === 'string') {
    const id = str(actor, MAX.id) || 'unknown';
    return { type: id === 'system' ? 'system' : 'human', id, displayName: null };
  }
  // An explicit actor object is NOT coerced. Widening a malformed actor to
  // "system" would record a false attribution — worse than a rejected record,
  // because it would look authoritative. Invalid values are passed through so
  // validateLedgerRecord() rejects them.
  return {
    type: actor?.type ?? null,
    id: str(actor?.id, MAX.id),
    displayName: str(actor?.displayName, MAX.short),
  };
}

// The unit a cost is denominated in is part of the fact being recorded, so it
// is stored whole.
//
// This previously clamped `currency` to 8 characters, which silently truncated
// every provider credit unit in the system — "higgsfield-credits" was persisted
// as "higgsfie" and "openart-credits" as "openart-". The figures survived; what
// they were denominated in did not, which made two different providers' spend
// indistinguishable in the audit trail.
const MAX_UNIT_CHARS = 40;

function normalizeMoney(m, { requireConfirmedFlag = true } = {}) {
  const empty = { amount: null, unit: null, currency: null, providerCreditUnit: null, confirmed: false, isLowerBound: false };
  if (!m || typeof m !== 'object') {
    return requireConfirmedFlag ? empty : null;
  }
  const unit = COST_UNITS.includes(m.unit) ? m.unit : null;
  return {
    amount: num(m.amount),
    unit,
    // `currency` stays populated for every shape — including provider credits —
    // because existing readers depend on it. `unit`/`providerCreditUnit` say
    // precisely WHICH kind of unit it is; nothing is converted either way.
    currency: str(m.currency, MAX_UNIT_CHARS) || str(m.providerCreditUnit, MAX_UNIT_CHARS),
    providerCreditUnit: unit === 'provider_credits' ? str(m.providerCreditUnit, MAX_UNIT_CHARS) : null,
    confirmed: m.confirmed === true,
    isLowerBound: m.isLowerBound === true,
  };
}

/**
 * Builds a normalized, safe-to-persist ledger record. Pure — the caller
 * persists it. Never throws on bad input; returns a record plus the errors
 * that would make it invalid, so a caller can decide policy.
 */
export function buildLedgerRecord({
  id, event, actor, division, capability, source, binding,
  estimate, actual, approval, outcome, metadata,
} = {}) {
  const est = estimate && typeof estimate === 'object' ? estimate : {};
  return {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    id: str(id, MAX.id),
    timestamp: new Date().toISOString(),
    event: LEDGER_EVENTS.includes(event) ? event : null,

    actor: normalizeActor(actor),
    division: str(division, MAX.short),
    capability: str(capability, MAX.short),

    source: {
      packageId: str(source?.packageId, MAX.id),
      renderSpecId: str(source?.renderSpecId, MAX.id),
      sceneId: source?.sceneId === null || source?.sceneId === undefined ? null : String(source.sceneId).slice(0, 40),
      productionJobId: str(source?.productionJobId, MAX.id),
      assetRequestId: str(source?.assetRequestId, MAX.id),
      planId: str(source?.planId, MAX.id),
    },

    // Attribution only. No division may branch on these.
    binding: {
      providerId: str(binding?.providerId, MAX.id),
      model: str(binding?.model, MAX.short),
      executionType: str(binding?.executionType, MAX.short),
    },

    estimate: {
      ...normalizeMoney(est),
      estimateType: ESTIMATE_TYPES.includes(est.estimateType) ? est.estimateType : 'unknown',
    },

    // An unknown actual stays unknown. Never copied from the estimate.
    actual: normalizeMoney(actual),

    approval: {
      required: approval?.required === true,
      approvalRef: str(approval?.approvalRef, MAX.id),
      approvedAt: str(approval?.approvedAt, 40),
      approvedBy: str(approval?.approvedBy, MAX.id),
    },

    outcome: {
      status: OUTCOME_STATUSES.includes(outcome?.status) ? outcome.status : 'pending',
      errorReason: str(outcome?.errorReason, MAX.reason),
      artifactIds: Array.isArray(outcome?.artifactIds)
        ? outcome.artifactIds.filter(a => typeof a === 'string').map(a => a.slice(0, MAX.id)).slice(0, 20)
        : [],
      startedAt: str(outcome?.startedAt, 40),
      completedAt: str(outcome?.completedAt, 40),
    },

    metadata: {
      policyVersion: str(metadata?.policyVersion, 40),
      capabilityRegistryVersion: str(metadata?.capabilityRegistryVersion, 40),
      correctsEntryId: str(metadata?.correctsEntryId, MAX.id),
      note: str(metadata?.note, MAX.short),
    },
  };
}

/**
 * Structural + safety validation. A record failing this must never be
 * persisted.
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateLedgerRecord(record) {
  const errors = [];
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { valid: false, errors: ['Ledger record must be an object.'] };
  }
  if (record.schemaVersion !== LEDGER_SCHEMA_VERSION) errors.push(`schemaVersion must be ${LEDGER_SCHEMA_VERSION}.`);
  if (!isValidLedgerId(record.id)) errors.push('id is required and must be a safe identifier.');
  if (!record.timestamp || Number.isNaN(Date.parse(record.timestamp))) errors.push('timestamp must be a valid ISO date.');
  if (!LEDGER_EVENTS.includes(record.event)) errors.push(`event must be one of: ${LEDGER_EVENTS.join(', ')}.`);

  if (!record.actor || !ACTOR_TYPES.includes(record.actor.type)) errors.push('actor.type is required.');
  if (!record.actor?.id) errors.push('actor.id is required — every action must be attributed.');

  if (!record.division) errors.push('division is required.');
  if (!record.capability) errors.push('capability is required.');

  if (!record.estimate || !ESTIMATE_TYPES.includes(record.estimate.estimateType)) {
    errors.push(`estimate.estimateType must be one of: ${ESTIMATE_TYPES.join(', ')}.`);
  }
  if (record.estimate?.confirmed === true && !Number.isFinite(record.estimate.amount)) {
    errors.push('A confirmed estimate must carry a numeric amount.');
  }
  if (record.actual?.confirmed === true && !Number.isFinite(record.actual.amount)) {
    errors.push('A confirmed actual cost must carry a numeric amount.');
  }
  if (!record.outcome || !OUTCOME_STATUSES.includes(record.outcome.status)) errors.push('outcome.status is required.');
  if (record.event === 'correction' && !record.metadata?.correctsEntryId) {
    errors.push('A correction record must reference the entry it corrects.');
  }

  const forbidden = findForbiddenContent(record);
  if (forbidden.length) errors.push(`Record contains forbidden content: ${forbidden.join(', ')}.`);

  return { valid: errors.length === 0, errors };
}

/**
 * Builds a correction record. The original is never touched — corrections are
 * appended and linked, so the history of what was believed and when stays
 * intact.
 */
export function buildCorrectionRecord({ id, correctsEntryId, actor, division, capability, actual, note }) {
  return buildLedgerRecord({
    id,
    event: 'correction',
    actor,
    division,
    capability,
    actual,
    outcome: { status: 'corrected' },
    metadata: { correctsEntryId, note },
  });
}

// ── Spend policy ──────────────────────────────────────────────────────────

/**
 * Is this execution a real purchase?
 *
 * Drives the Ledger failure policy in the Execution Engine: unledgered PAID
 * spend is never allowed, but a bookkeeping failure must not break the
 * genuinely free local render path.
 */
export function isPaidExecution({ costTier, estimateType, amount } = {}) {
  if (costTier === 'free') return false;
  if (estimateType === 'confirmed_local') return false;
  if (Number.isFinite(amount) && amount === 0 && estimateType === 'confirmed_provider') return false;
  return true;
}
