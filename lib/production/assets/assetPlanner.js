// lib/production/assets/assetPlanner.js
// SERVER-SIDE ONLY.
//
// URS → seven bounded AssetRequests → cache check → opaque binding per miss →
// estimate → one batch approval. Stops before dispatch: this module never
// submits a generation and never touches the Execution Engine.
//
// INVARIANTS (validator-enforced):
//   • no provider module imported, no provider named in a conditional
//   • the binding from Diamond Control is forwarded as opaque data
//   • the legacy dispatch path is never used
//   • one request maximum per scene
//   • no hidden retries, no silent generation

import crypto from 'crypto';
import {
  ASSET_PLAN_SCHEMA_VERSION, ASSET_PLANNER_VERSION, resolveSceneCapability,
  requestIdFor, computePlanContentHash, summarizePlan, makePlanEvent,
} from './assetPlanRules.js';
import { buildAssetRequest, validateBindingShape, unsupportedRequestFields } from './assetRules.js';
import { lookupAsset } from './assetCache.js';
import { recommendBinding } from '../../diamond/recommendBinding.js';
import { generatePlanId } from './assetPlanStore.js';

function hash(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

export function planContentHash(plan) {
  return computePlanContentHash(plan, hash);
}

/**
 * Builds the seven requests for a URS. Pure apart from reading the asset
 * library cache — creates nothing and spends nothing.
 */
export function buildPlanRequests(spec, { brandId } = {}) {
  const requests = [];
  const warnings = [];

  (spec.scenes || []).forEach((scene, index) => {
    const resolved = resolveSceneCapability(scene);
    const capability = resolved.capability;
    const requestId = requestIdFor(spec.specId, index, capability);

    const base = {
      requestId,
      sceneId: index,
      sceneIndex: index,
      capability,
      required: resolved.required,
      placeholderAllowed: resolved.placeholderAllowed,
      // Creative intent is preserved verbatim — the planner never rewrites it.
      creativeIntent: {
        generationPrompt: scene.visual?.generationPrompt || null,
        negativePrompt: scene.visual?.negativePrompt || null,
        description: scene.visual?.description || null,
        onScreenText: scene.onScreenText || null,
        assetKind: scene.visual?.assetKind || null,
      },
      semanticFingerprint: null,
      cacheResult: null,
      binding: null,
      estimate: null,
      status: 'pending',
      assetId: null,
      productionJobId: null,
      warnings: [...resolved.warnings],
      droppedFields: [],
      capabilityReasons: resolved.reasons,
    };

    // A placeholder scene is terminal: nothing is generated, nothing costs.
    if (capability === 'placeholder') {
      requests.push({
        ...base,
        status: 'placeholder',
        // A confirmed zero, denominated honestly. Zero costs nothing in every
        // unit, so aggregation treats it as unit-neutral and it joins no total.
        estimate: { amount: 0, unit: 'currency', currency: 'USD', estimateType: 'confirmed_local', confirmed: true, isLowerBound: false },
      });
      warnings.push(`Scene ${index}: ${resolved.warnings[0] || 'left as a placeholder.'}`);
      return;
    }

    // Real capability — build the concrete request the cache is keyed on.
    const built = buildAssetRequest(spec, index, { capability, brandId });
    if (!built.ok) {
      requests.push({ ...base, status: 'blocked', warnings: [...base.warnings, built.error] });
      warnings.push(`Scene ${index}: ${built.error}`);
      return;
    }
    requests.push({ ...base, ...{ assetRequest: built.request }, warnings: [...base.warnings, ...built.warnings] });
  });

  return { requests, warnings };
}

/**
 * Resolves each request against the Asset Library, then asks policy for a
 * binding and a price for every miss. Never generates.
 */
export function resolvePlanRequests(requests, { modelOverride } = {}) {
  return requests.map(r => {
    if (r.status === 'placeholder' || r.status === 'blocked') return r;

    const req = r.assetRequest;
    const cache = lookupAsset(req);

    // ── Hit: no binding, no job, no spend ────────────────────────────────
    if (cache.status === 'hit' && cache.selectedAssetId) {
      return {
        ...r,
        semanticFingerprint: cache.semanticFingerprint,
        cacheResult: { status: cache.status, selectedAssetId: cache.selectedAssetId, candidateAssetIds: cache.candidateAssetIds, reason: cache.reason },
        status: 'resolved_from_cache',
        assetId: cache.selectedAssetId,
        estimate: { amount: 0, unit: 'currency', currency: 'USD', estimateType: 'confirmed_local', confirmed: true, isLowerBound: false },
      };
    }

    // ── Ambiguous: multiple eligible variants and no explicit selection.
    // Never silently generate and never silently pick — the operator decides.
    if (cache.status === 'ambiguous') {
      return {
        ...r,
        semanticFingerprint: cache.semanticFingerprint,
        cacheResult: { status: cache.status, selectedAssetId: cache.selectedAssetId, candidateAssetIds: cache.candidateAssetIds, reason: cache.reason },
        status: 'blocked',
        warnings: [...r.warnings, `Multiple eligible cached variants matched and none is marked selected. Choose one before this scene can resolve — generating would duplicate work already paid for.`],
        estimate: null,
      };
    }

    // ── Miss or stale: ask policy who should make it ─────────────────────
    const decision = recommendBinding(req, { modelOverride });
    if (!decision.ok) {
      return {
        ...r,
        semanticFingerprint: cache.semanticFingerprint,
        cacheResult: { status: cache.status, selectedAssetId: null, candidateAssetIds: cache.candidateAssetIds, reason: cache.reason },
        status: 'blocked',
        warnings: [...r.warnings, `No provider binding available: ${decision.error}`],
      };
    }

    const shape = validateBindingShape(decision.binding);
    if (!shape.valid) {
      return {
        ...r,
        semanticFingerprint: cache.semanticFingerprint,
        cacheResult: { status: cache.status, selectedAssetId: null, candidateAssetIds: cache.candidateAssetIds, reason: cache.reason },
        status: 'blocked',
        warnings: [...r.warnings, `Policy returned an unusable binding: ${shape.errors.join('; ')}`],
      };
    }

    return {
      ...r,
      semanticFingerprint: cache.semanticFingerprint,
      cacheResult: { status: cache.status, selectedAssetId: null, candidateAssetIds: cache.candidateAssetIds, reason: cache.reason },
      // Stored WHOLE, never a hand-picked subset. The binding is opaque: the
      // planner does not know which of its fields matter, so cherry-picking
      // silently drops the ones it happens not to recognise. An earlier
      // version kept only providerId/model/mode and lost `params.mediaType`
      // (breaking the cost preflight) and `supports` (which would have
      // re-added a field the provider rejects).
      binding: { ...decision.binding },
      // Fields the request carries that this binding cannot accept — dropped
      // from the provider call and reported, never silently discarded.
      droppedFields: unsupportedRequestFields(req, decision.binding),
      status: 'awaiting_generation',
      // Price is filled in by the estimate step, which performs a live
      // non-generating preflight. Until then it is honestly unknown.
      // Honestly unknown until the estimate step runs: no amount AND no unit.
      // Declaring a unit here would let an unpriced request quietly join a total.
      estimate: { amount: null, unit: null, currency: null, estimateType: 'unknown', confirmed: false, isLowerBound: false },
    };
  });
}

/** Assembles a persistable plan. */
export function buildPlan(spec, { packageId, brandId, actor, modelOverride, ceilingAmount, currency, ceilings }) {
  const { requests: built, warnings } = buildPlanRequests(spec, { brandId });
  const resolved = resolvePlanRequests(built, { modelOverride });

  const plan = {
    planId: generatePlanId(),
    schemaVersion: ASSET_PLAN_SCHEMA_VERSION,
    plannerVersion: ASSET_PLANNER_VERSION,
    actor: typeof actor === 'string' ? { type: 'human', id: actor } : (actor || { type: 'system', id: 'system' }),
    division: 'asset-generation',
    packageId: packageId || null,
    renderSpecId: spec.specId || null,
    brandId: brandId || spec.source?.brand || null,
    status: 'draft',
    requests: resolved,
    summary: summarizePlan(resolved),
    budget: {
      // Per-unit ceilings: a plan may spend in several units and each needs its
      // own limit. The legacy single ceiling is still accepted on input and
      // promoted to a one-unit ceiling by planCeilings().
      ceilings: ceilings && typeof ceilings === 'object' ? { ...ceilings } : {},
      ceilingAmount: Number.isFinite(ceilingAmount) ? ceilingAmount : null,
      currency: currency || null,
      estimatedTotal: null,
      totals: [],
    },
    approval: { required: true, approvalRef: null, approvedAt: null, approvedBy: null, contentHashAtApproval: null, acknowledgedProvisional: false },
    resolvedAssetIds: resolved.filter(r => r.assetId).map(r => r.assetId),
    unresolvedSceneIds: resolved.filter(r => !r.assetId && r.status !== 'placeholder').map(r => r.sceneIndex),
    warnings,
    activityHistory: [makePlanEvent('asset_plan_created', { actor: typeof actor === 'string' ? actor : actor?.id, note: `${resolved.length} scene(s)` })],
    contentHash: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  plan.budget.estimatedTotal = plan.summary.estimatedTotal;
  plan.budget.totals = plan.summary.totals;
  plan.contentHash = planContentHash(plan);
  return plan;
}

/**
 * Recomputes summary + content hash after any change, and invalidates an
 * existing approval when the plan no longer matches what was approved.
 */
export function refreshPlan(plan) {
  const summary = summarizePlan(plan.requests);
  const next = { ...plan, summary, budget: { ...plan.budget, estimatedTotal: summary.estimatedTotal, totals: summary.totals } };
  next.contentHash = planContentHash(next);
  next.resolvedAssetIds = plan.requests.filter(r => r.assetId).map(r => r.assetId);
  next.unresolvedSceneIds = plan.requests.filter(r => !r.assetId && r.status !== 'placeholder').map(r => r.sceneIndex);

  const approvedHash = plan.approval?.contentHashAtApproval;
  if (approvedHash && approvedHash !== next.contentHash) {
    next.approval = { ...plan.approval, approvalRef: null, approvedAt: null, approvedBy: null, contentHashAtApproval: null };
    next.status = 'invalidated';
    next.activityHistory = [
      ...plan.activityHistory,
      makePlanEvent('asset_plan_invalidated', { actor: 'system', note: 'Plan content changed after approval — the prior approval no longer applies.' }),
    ];
  }
  return next;
}
