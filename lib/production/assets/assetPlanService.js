// lib/production/assets/assetPlanService.js
// SERVER-SIDE ONLY.
//
// The one place plan lifecycle transitions happen, so the five API routes stay
// thin and cannot drift from each other. Every transition appends an activity
// event and one Ledger record.
//
// Contains no provider knowledge. The live cost preflight is performed through
// the provider-neutral estimate hook below, which asks the ALREADY-BOUND
// provider what its own request costs — the planner never selects it.

import { loadPackage } from '../../content/contentPackageStore.js';
import { buildRenderSpec } from '../renderSpec/buildRenderSpec.js';
import { appendLedgerEntry } from '../../ledger/ledgerStore.js';
import { buildPlan, refreshPlan, planContentHash } from './assetPlanner.js';
import { savePlan, getPlan, findLivePlanForSpec } from './assetPlanStore.js';
import { canTransition, checkApprovalEligibility, makePlanEvent, summarizePlan, planCeilings } from './assetPlanRules.js';
import { recordAssetUsage } from './assetLibraryStore.js';

/** Short, unit-preserving rendering of a plan's grouped totals. */
function describeTotals(totals) {
  if (!totals?.length) return 'no paid spend';
  return totals
    .map(t => `${t.isLowerBound ? '≥' : ''}${t.amount} ${t.unit === 'currency' ? t.currency : t.providerCreditUnit}`)
    .join(' + ');
}

/**
 * The plan's estimate in Ledger form, with the unit preserved exactly.
 *
 * A single-unit plan records its real amount and denomination. A multi-unit plan
 * records NO amount: there is no honest single figure, and picking one unit's
 * subtotal would understate the plan permanently in the audit trail.
 */
function planLedgerEstimate(plan) {
  const s = plan.summary || {};
  const totals = s.totals || [];
  const confirmed = s.estimateCompleteness === 'complete' && s.comparable === true;

  if (s.comparable === true && totals.length === 1) {
    const t = totals[0];
    return {
      amount: t.amount,
      unit: t.unit,
      currency: t.unit === 'currency' ? t.currency : t.providerCreditUnit,
      providerCreditUnit: t.providerCreditUnit,
      estimateType: confirmed ? 'confirmed_provider' : 'provisional_tier',
      confirmed,
      isLowerBound: t.isLowerBound === true,
    };
  }
  if (totals.length === 0) {
    return { amount: 0, unit: 'currency', currency: 'USD', estimateType: 'confirmed_local', confirmed: true, isLowerBound: false };
  }
  return { amount: null, unit: null, currency: null, estimateType: 'provisional_tier', confirmed: false, isLowerBound: true };
}

/** Ledger fields shared by every plan event. No prompts, ever. */
function planLedgerBase(plan, event, outcomeStatus) {
  return {
    event,
    actor: plan.actor,
    division: 'asset-generation',
    capability: 'asset_batch',
    source: {
      planId: plan.planId,
      packageId: plan.packageId,
      renderSpecId: plan.renderSpecId,
    },
    // ONE ledger record carries ONE estimate, but a plan may spend in several
    // units. When it does there is genuinely no single number to record, so the
    // amount is left null and the grouped totals go in the note — rather than
    // recording one unit's subtotal as though it were the whole plan.
    estimate: planLedgerEstimate(plan),
    approval: {
      required: true,
      approvalRef: plan.approval?.approvalRef || null,
      approvedAt: plan.approval?.approvedAt || null,
      approvedBy: plan.approval?.approvedBy || null,
    },
    outcome: { status: outcomeStatus },
    metadata: {
      note: `requests=${plan.summary?.sceneCount} hits=${plan.summary?.cacheHits} paid=${plan.summary?.paidRequests} placeholders=${plan.summary?.placeholders} totals=[${describeTotals(plan.summary?.totals)}] completeness=${plan.summary?.estimateCompleteness}`,
    },
  };
}

export function createPlanForPackage({ packageId, actor = 'user', modelOverride, ceilingAmount, currency, ceilings }) {
  const pkg = loadPackage(packageId);
  if (!pkg) return { ok: false, status: 404, error: `Content Package "${packageId}" not found.` };

  const built = buildRenderSpec(pkg, { mode: 'faceless_social' });
  if (!built.ok || !built.spec) return { ok: false, status: 422, error: 'Could not build a valid Render Specification.' };

  // One live plan per URS — a second would mean two competing approvals.
  const existing = findLivePlanForSpec(built.spec.specId);
  if (existing) {
    return { ok: true, status: 200, plan: existing, reused: true };
  }

  const plan = buildPlan(built.spec, {
    packageId, brandId: built.spec.source?.brand, actor,
    modelOverride, ceilingAmount, currency, ceilings,
  });

  const saved = savePlan(plan);
  if (!saved.ok) return { ok: false, status: 500, error: saved.error };

  const led = appendLedgerEntry(planLedgerBase(plan, 'asset_plan_created', 'planned'));
  return { ok: true, status: 201, plan: saved.plan, reused: false, ledgerEntryId: led.ok ? led.id : null };
}

/**
 * Runs the live, NON-GENERATING cost preflight for every paid request.
 *
 * @param {(request: object) => Promise<{ok, amount, currency, estimateType, confirmed, note}>} preflight
 *   Injected by the caller so this module stays provider-neutral.
 */
export async function estimatePlan(planId, preflight, { actor = 'user' } = {}) {
  const plan = getPlan(planId);
  if (!plan) return { ok: false, status: 404, error: `Asset plan "${planId}" not found.` };
  if (!canTransition(plan.status, 'estimated') && plan.status !== 'estimated') {
    return { ok: false, status: 409, error: `Cannot estimate a plan in status "${plan.status}".` };
  }

  const requests = [];
  for (const r of plan.requests) {
    if (r.status !== 'awaiting_generation') { requests.push(r); continue; }
    let result;
    try { result = await preflight(r); } catch (e) {
      requests.push({ ...r, estimate: { amount: null, unit: null, currency: null, estimateType: 'unknown', confirmed: false, isLowerBound: false }, warnings: [...r.warnings, `Cost preflight failed: ${e.message}`] });
      continue;
    }
    requests.push({
      ...r,
      // The canonical money shape is stored WHOLE. Keeping only amount+currency
      // would drop `unit` (making a credits figure indistinguishable from
      // dollars) and `isLowerBound` (turning a published "from" price into a
      // guaranteed one) — the two facts that make a total safe to approve.
      estimate: result?.cost
        ? { ...result.cost }
        : {
            amount: Number.isFinite(result?.amount) ? result.amount : null,
            unit: null,
            currency: result?.currency || null,
            estimateType: result?.estimateType || 'unknown',
            // Never inferred — a provider that cannot price its own request stays provisional.
            confirmed: result?.confirmed === true,
            isLowerBound: result?.isLowerBound === true,
          },
      warnings: result?.note ? [...r.warnings, result.note] : r.warnings,
    });
  }

  let next = refreshPlan({ ...plan, requests });
  next.summary = summarizePlan(requests);
  next.budget = { ...next.budget, estimatedTotal: next.summary.estimatedTotal, totals: next.summary.totals };
  next.status = next.status === 'invalidated' ? 'invalidated' : 'estimated';
  next.contentHash = planContentHash(next);
  next.activityHistory = [...plan.activityHistory, makePlanEvent('asset_plan_estimated', { actor, note: `totals=[${describeTotals(next.summary.totals)}] comparable=${next.summary.comparable} completeness=${next.summary.estimateCompleteness}` })];

  const saved = savePlan(next);
  if (!saved.ok) return { ok: false, status: 500, error: saved.error };

  const led = appendLedgerEntry(planLedgerBase(next, 'asset_plan_estimated', 'estimated'));
  return { ok: true, status: 200, plan: saved.plan, ledgerEntryId: led.ok ? led.id : null };
}

export function approvePlan(planId, { actor = 'user', ceilingAmount, currency, ceilings, acknowledgeProvisional = false, expectedContentHash } = {}) {
  const plan = getPlan(planId);
  if (!plan) return { ok: false, status: 404, error: `Asset plan "${planId}" not found.` };

  // Applying a ceiling changes the plan's content hash, so it must be folded
  // in BEFORE the hash is bound to the approval.
  let working = plan;
  const hasCeilings = ceilings && typeof ceilings === 'object' && Object.keys(ceilings).length > 0;
  if (hasCeilings || Number.isFinite(ceilingAmount) || currency) {
    working = refreshPlan({
      ...plan,
      budget: {
        ...plan.budget,
        ceilings: hasCeilings ? { ...ceilings } : (plan.budget.ceilings || {}),
        ceilingAmount: Number.isFinite(ceilingAmount) ? ceilingAmount : plan.budget.ceilingAmount,
        currency: currency || plan.budget.currency,
      },
    });
    working.contentHash = planContentHash(working);
  }

  // The operator approved a specific plan. If it moved underneath them, refuse.
  if (expectedContentHash && expectedContentHash !== working.contentHash) {
    return { ok: false, status: 409, error: 'Plan content has changed since it was reviewed — re-estimate and approve again.', contentHash: working.contentHash };
  }

  const eligibility = checkApprovalEligibility(working, { acknowledgeProvisional });
  if (!eligibility.eligible) {
    return { ok: false, status: 422, error: 'Plan is not eligible for approval.', reasons: eligibility.reasons, plan: working };
  }

  const now = new Date().toISOString();
  const approvalRef = `apr-${working.planId}`;
  const approved = {
    ...working,
    status: 'approved',
    approval: {
      required: true,
      approvalRef,
      approvedAt: now,
      approvedBy: typeof actor === 'string' ? actor : actor?.id || 'user',
      contentHashAtApproval: working.contentHash,
      acknowledgedProvisional: acknowledgeProvisional === true,
    },
    activityHistory: [...working.activityHistory, makePlanEvent('asset_plan_approved', { actor, note: `ceilings=${JSON.stringify(planCeilings(working))} totals=[${describeTotals(working.summary.totals)}]`.slice(0, 200) })],
  };

  const saved = savePlan(approved);
  if (!saved.ok) return { ok: false, status: 500, error: saved.error };

  // Cache hits are usages the moment the batch is approved — the asset is
  // committed to this render even though nothing was generated.
  for (const r of approved.requests.filter(x => x.status === 'resolved_from_cache' && x.assetId)) {
    recordAssetUsage({
      assetId: r.assetId, packageId: approved.packageId, renderSpecId: approved.renderSpecId,
      sceneId: r.sceneIndex, productionJobId: null, actor: approved.actor, source: 'asset_plan_approved',
    });
  }

  // Exactly ONE approval record for the whole batch.
  const led = appendLedgerEntry(planLedgerBase(approved, 'asset_plan_approved', 'approved'));
  return { ok: true, status: 200, plan: saved.plan, approvalRef, ledgerEntryId: led.ok ? led.id : null };
}

export function rejectPlan(planId, { actor = 'user', reason } = {}) {
  const plan = getPlan(planId);
  if (!plan) return { ok: false, status: 404, error: `Asset plan "${planId}" not found.` };
  if (!canTransition(plan.status, 'rejected')) {
    return { ok: false, status: 409, error: `Cannot reject a plan in status "${plan.status}".` };
  }
  const rejected = {
    ...plan,
    status: 'rejected',
    approval: { ...plan.approval, approvalRef: null, approvedAt: null, approvedBy: null, contentHashAtApproval: null },
    activityHistory: [...plan.activityHistory, makePlanEvent('asset_plan_rejected', { actor, note: reason || null })],
  };
  const saved = savePlan(rejected);
  if (!saved.ok) return { ok: false, status: 500, error: saved.error };
  const led = appendLedgerEntry(planLedgerBase(rejected, 'asset_plan_rejected', 'cancelled'));
  return { ok: true, status: 200, plan: saved.plan, ledgerEntryId: led.ok ? led.id : null };
}
