// lib/production/assets/assetPlanRules.js
// Pure — no I/O, no fs, no network. Safe on server and client.
//
// ── AssetPlan contract (M3) ──────────────────────────────────────────────
//
// One plan per URS, one request per scene, ONE approval for the whole batch.
// Contains no provider knowledge: capability is decided from creative intent,
// and who fulfils it is Diamond Control's answer, forwarded opaquely.
//
// The batch gate is deliberate. Earlier audits found a single video already
// passing six approval surfaces; seven per-scene approvals would have made the
// pipeline unusable. The operator approves a bounded total once.
//
// "A bounded total" is now plural. Providers bill in genuinely different units
// (one vendor's credits, another's dollars), so a plan can have several totals
// that must never be added. Cost grouping and ceiling arithmetic therefore live
// in lib/cost/costShape.js — a provider-neutral module this file leans on, so
// that Asset Generation still learns nothing about who charges what.

import { aggregateCosts, checkCeilings, normalizeCeilings, unitKeyOf } from '../../cost/costShape.js';

export const ASSET_PLAN_SCHEMA_VERSION = 1;
export const ASSET_PLANNER_VERSION = 1;

// v1 supports three real capabilities plus an honest "we cannot serve this".
export const PLAN_CAPABILITIES = ['background_plate', 'cinematic_broll_still', 'product_still', 'placeholder'];

export const PLAN_STATES = ['draft', 'estimated', 'awaiting_approval', 'approved', 'rejected', 'invalidated'];

// Forward transitions only. Approval is never reachable without an estimate.
const PLAN_TRANSITIONS = {
  draft: ['estimated', 'invalidated', 'rejected'],
  estimated: ['awaiting_approval', 'invalidated', 'rejected'],
  awaiting_approval: ['approved', 'rejected', 'invalidated'],
  approved: ['invalidated'],
  rejected: [],
  invalidated: [],
};

export function isValidPlanState(s) { return PLAN_STATES.includes(s); }
export function canTransition(from, to) { return (PLAN_TRANSITIONS[from] || []).includes(to); }

export const REQUEST_STATES = ['pending', 'resolved_from_cache', 'awaiting_generation', 'placeholder', 'blocked'];

const ID_RE = /^[a-zA-Z0-9_-]{1,120}$/;
export function isValidPlanId(id) { return typeof id === 'string' && ID_RE.test(id); }

// ── Capability mapping ────────────────────────────────────────────────────
//
// Deterministic and conservative. Two classes of scene are NOT sent to an
// image generator at all, because a still cannot honestly serve them:
//
//   1. Scenes demanding legible text or a brand mark. Generative models
//      produce misspelled, unsearchable, unfixable text — and the compositor
//      already lays the real caption on top. Generate the world, composite
//      the message.
//   2. Scenes whose CONTENT changes over time ("an animation of…", "popping
//      up", "appearing"). A camera move ("slow pan", "zoom in") is different:
//      the subject is static and a still serves it faithfully.
//
// Both become `placeholder` rather than a silently-degraded still.

const TEXT_DEMAND_RE = /\b(bold |large |legible |readable )?(text|caption|headline|title|word|lettering|typography|logo|wordmark|brand mark|slogan|label)\b/i;
const TEMPORAL_ACTION_RE = /\b(animation|animated|appearing|appears|popping up|pops up|moving through|moving across|scrolling|transition(?:ing)?|countdown|sequence of|being filtered|flying|morph(?:ing)?|time-?lapse|loop(?:ing)?)\b/i;
const PRODUCT_RE = /\b(product shot|packshot|packaging|on a seamless|studio backdrop|product on)\b/i;
const CINEMATIC_RE = /\b(cinematic|lifestyle|b-?roll|golden hour|film still|shallow depth)\b/i;
const VIDEO_KINDS = ['video', 'generated_video', 'motion_graphic', 'animation', 'live_action'];

/**
 * Resolves one URS scene to a capability.
 * @returns {{ capability, required, placeholderAllowed, warnings: string[], reasons: string[] }}
 */
export function resolveSceneCapability(scene) {
  const warnings = [];
  const reasons = [];
  const text = `${scene?.visual?.generationPrompt || ''} ${scene?.visual?.description || ''}`.trim();
  const kind = String(scene?.visual?.assetKind || '').toLowerCase();

  if (!text) {
    return {
      capability: 'placeholder', required: false, placeholderAllowed: true,
      warnings: ['Scene carries no visual prompt or description — nothing to generate.'],
      reasons: ['no_visual_intent'],
    };
  }

  if (TEXT_DEMAND_RE.test(text)) {
    return {
      capability: 'placeholder', required: false, placeholderAllowed: true,
      warnings: ['Scene asks for legible text or a brand mark in the image. Generated text is unreliable and the compositor already lays the real caption on top, so no image is requested for this scene.'],
      reasons: ['text_or_logo_required'],
    };
  }

  if (TEMPORAL_ACTION_RE.test(text)) {
    return {
      capability: 'placeholder', required: false, placeholderAllowed: true,
      warnings: ['Scene describes content that changes over time, which a still cannot serve. No motion capability exists in this checkpoint, so the placeholder is kept rather than substituting a misleading still.'],
      reasons: ['temporal_action_required'],
    };
  }

  let capability = 'background_plate';
  if (PRODUCT_RE.test(text)) { capability = 'product_still'; reasons.push('product_signal'); }
  else if (CINEMATIC_RE.test(text)) { capability = 'cinematic_broll_still'; reasons.push('cinematic_signal'); }
  else reasons.push('composited_backdrop');

  // A video-kind scene resolving to a still is a real downgrade of the
  // storyboard's intent — reported, never silent.
  if (VIDEO_KINDS.includes(kind)) {
    warnings.push(`Scene declares assetKind "${kind}" but its subject is static (camera movement only), so a still is requested instead.`);
    reasons.push('video_kind_degraded_to_still');
  }

  return { capability, required: true, placeholderAllowed: true, warnings, reasons };
}

// ── Deterministic identity ────────────────────────────────────────────────

export function requestIdFor(renderSpecId, sceneIndex, capability) {
  return `areq-${renderSpecId}-s${sceneIndex}-${capability}`;
}

/**
 * The subject of the plan's content hash. Approval binds to this, so anything
 * that would change what gets generated — or what it costs — must appear here.
 * Volatile fields (timestamps, ids, status) are deliberately excluded.
 */
export function planHashSubject(plan) {
  const ceilings = planCeilings(plan);
  return {
    v: ASSET_PLAN_SCHEMA_VERSION,
    plannerVersion: ASSET_PLANNER_VERSION,
    packageId: plan.packageId || null,
    renderSpecId: plan.renderSpecId || null,
    brandId: plan.brandId || null,
    // Every ceiling, in canonical per-unit form and sorted so key order cannot
    // change the hash. Raising ANY unit's ceiling must invalidate an approval.
    ceilings: Object.keys(ceilings).sort().map(k => [k, ceilings[k]]),
    requests: (plan.requests || []).map(r => ({
      sceneIndex: r.sceneIndex,
      capability: r.capability,
      fingerprint: r.semanticFingerprint || null,
      status: r.status,
      assetId: r.assetId || null,
      providerId: r.binding?.providerId || null,
      model: r.binding?.model || null,
      amount: r.estimate?.amount ?? null,
      estimateType: r.estimate?.estimateType || null,
      // The unit is part of what was approved: 0.12 of one thing is not 0.12
      // of another, so a unit change must invalidate the approval too.
      unitKey: unitKeyOf(r.estimate) || null,
      isLowerBound: r.estimate?.isLowerBound === true,
    })),
  };
}

export function serializePlanSubject(subject) {
  return JSON.stringify(subject, Object.keys(subject).sort());
}

export function computePlanContentHash(plan, hasher) {
  const s = planHashSubject(plan);
  // Stable ordering: top-level keys sorted, request array order is meaningful
  // (scene order) and therefore preserved.
  return hasher(JSON.stringify([
    s.v, s.plannerVersion, s.packageId, s.renderSpecId, s.brandId, s.ceilings,
    s.requests.map(r => [r.sceneIndex, r.capability, r.fingerprint, r.status, r.assetId, r.providerId, r.model, r.amount, r.estimateType, r.unitKey, r.isLowerBound]),
  ]));
}

// ── Summary + budget ──────────────────────────────────────────────────────

export function summarizePlan(requests) {
  const cacheHits = requests.filter(r => r.status === 'resolved_from_cache').length;
  const paid = requests.filter(r => r.status === 'awaiting_generation').length;
  const placeholders = requests.filter(r => r.status === 'placeholder').length;
  const blocked = requests.filter(r => r.status === 'blocked').length;
  const provisional = requests.filter(r => r.status === 'awaiting_generation' && r.estimate?.confirmed !== true).length;
  const lowerBound = requests.filter(r => r.status === 'awaiting_generation' && r.estimate?.isLowerBound === true).length;

  // Costs are GROUPED BY UNIT, never summed across units. A plan that spends
  // 0.24 of one vendor's credits and $0.04 has no single total, and inventing
  // one would be the exact fabricated number this system refuses to produce.
  const agg = aggregateCosts(
    requests.filter(r => r.status === 'awaiting_generation').map(r => r.estimate),
  );

  // Preserved for the single-unit case, which is still the common one. It is
  // null — not zero, and not a partial sum — the moment the plan spans two
  // units, so no reader can mistake a fragment of the cost for all of it.
  const singleTotal = agg.comparable && agg.totals.length === 1 ? agg.totals[0].amount : (agg.totals.length === 0 ? 0 : null);

  return {
    sceneCount: requests.length,
    cacheHits,
    paidRequests: paid,
    placeholders,
    blocked,
    provisionalRequests: provisional,
    lowerBoundRequests: lowerBound,

    // ── Grouped, unit-safe cost view ──────────────────────────────────────
    totals: agg.totals,
    comparable: agg.comparable,
    estimateCompleteness: agg.estimateCompleteness,
    costWarnings: agg.warnings,
    unknownUnitRequests: agg.unknownUnitRequests,
    unknownAmountRequests: agg.unknownAmountRequests,

    estimatedTotal: singleTotal,
    // True whenever the figure above is not the whole story: an unknown price,
    // a published "from" price, or two units that cannot be added.
    totalIsIncomplete: agg.estimateCompleteness !== 'complete' || !agg.comparable,

    // Scenes that will show a real image: cache hits + successful generations.
    visualCompleteness: requests.length ? Math.round(((cacheHits + paid) / requests.length) * 100) : 0,
  };
}

/**
 * Approval eligibility.
 *
 * EVERY unit the plan will spend in needs its OWN ceiling. A single number
 * cannot govern two units — "ceiling 1.00" says nothing about whether it means
 * dollars or one vendor's credits — so a unit with no matching ceiling blocks
 * approval rather than falling back to whatever number happens to be present.
 */
export function checkApprovalEligibility(plan, { acknowledgeProvisional = false } = {}) {
  const reasons = [];
  if (plan.status !== 'awaiting_approval' && plan.status !== 'estimated') {
    reasons.push(`Plan is "${plan.status}" — only an estimated plan can be approved.`);
  }

  const totals = plan.summary?.totals || [];
  const ceilings = planCeilings(plan);
  const ceilingCheck = checkCeilings(totals, ceilings);
  reasons.push(...ceilingCheck.reasons);

  // A ceiling that cannot be guaranteed (because the total is a floor) is not
  // a hard block, but it must be seen and accepted, never waved through.
  if (!acknowledgeProvisional) reasons.push(...(ceilingCheck.acknowledgeable || []));

  if (plan.summary?.unknownUnitRequests > 0) {
    reasons.push(`${plan.summary.unknownUnitRequests} request(s) carry a cost with no declared unit — no ceiling can govern them, so approval is blocked.`);
  }
  if (plan.summary?.provisionalRequests > 0 && !acknowledgeProvisional) {
    reasons.push(`${plan.summary.provisionalRequests} request(s) carry a provisional estimate — explicit acknowledgement is required.`);
  }
  if (plan.summary?.lowerBoundRequests > 0 && !acknowledgeProvisional) {
    reasons.push(`${plan.summary.lowerBoundRequests} request(s) are priced from a published minimum ("from" pricing) — the real charge may be higher and must be acknowledged.`);
  }
  if (plan.summary?.unknownAmountRequests > 0 && !acknowledgeProvisional) {
    reasons.push('At least one paid request has no known price — the totals are lower bounds and must be acknowledged.');
  }
  if (plan.summary?.comparable === false && !acknowledgeProvisional) {
    reasons.push('This plan spends in more than one unit. There is no single total, and each unit must be approved on its own terms — explicit acknowledgement is required.');
  }
  if ((plan.summary?.paidRequests || 0) === 0 && (plan.summary?.cacheHits || 0) === 0) {
    reasons.push('Plan has nothing to approve — no cache hits and no paid requests.');
  }
  return { eligible: reasons.length === 0, reasons };
}

/**
 * A plan's ceilings in canonical per-unit form.
 *
 * Accepts the legacy single `ceilingAmount` + `currency` pair and promotes it to
 * a one-unit ceiling, so plans written before multi-unit governance still open
 * and still approve — but only ever governing the one unit they actually named.
 */
export function planCeilings(plan) {
  const explicit = normalizeCeilings(plan?.budget?.ceilings);
  if (Object.keys(explicit).length > 0) return explicit;

  const amount = plan?.budget?.ceilingAmount;
  const denom = plan?.budget?.currency;
  if (Number.isFinite(amount) && denom) return normalizeCeilings({ [denom]: amount });
  return {};
}

export function makePlanEvent(type, { actor = 'system', note = null, metadata = null } = {}) {
  return { type, at: new Date().toISOString(), actor, note, metadata: metadata || null };
}
