// POST /api/production/assets/plan
//
// Asset Generation M1 — plan ONE scene's asset, ask Diamond Control who should
// make it, and create the governed Production Job that will generate it.
//
// This route creates a job and stops. Approval, enqueue, execution, and
// polling all use the EXISTING Production Router / Execution Engine endpoints
// unchanged — there is no second execution path and no automatic spend here.
//
// Input:  { packageId, sceneIndex, capability?, modelOverride?, providerOverride?, dryRun? }
//
// providerOverride is an opaque operator selection forwarded straight to policy.
// This route does not know which providers exist and never validates it —
// Diamond Control rejects a provider that has no binding for the capability.
// Output: { ok, request, binding, job?, dryRun? }

import { loadPackage } from '../../../../lib/content/contentPackageStore';
import { buildRenderSpec } from '../../../../lib/production/renderSpec/buildRenderSpec';
import { planSceneAsset } from '../../../../lib/production/assets/assetResolver';
import { unsupportedRequestFields } from '../../../../lib/production/assets/assetRules';
import { lookupAsset } from '../../../../lib/production/assets/assetCache';
import { recordAssetUsage } from '../../../../lib/production/assets/assetLibraryStore';
import { getAsset } from '../../../../lib/production/assets/assetStore';
import { buildPackageAssetEntry } from '../../../../lib/production/assets/assetResolver';
import { savePackage } from '../../../../lib/content/contentPackageStore';
import { appendLedgerEntry } from '../../../../lib/ledger/ledgerStore';
import { createAssetJob } from '../../../../lib/production/assets/assetJobs';
import { preflightCost } from '../../../../lib/diamond/costPreflight';
import { aggregateCosts, checkCeilings, normalizeCeilings, unitLabel } from '../../../../lib/cost/costShape';
import { createProductionJob, updateProductionJob, listProductionJobs } from '../../../../lib/production/productionJobStore';
import { sanitizeExecutionForResponse } from '../../../../lib/production/execution/executionRules';

export const config = { api: { bodyParser: { sizeLimit: '8kb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { packageId, sceneIndex, capability, modelOverride, providerOverride, ceilings, dryRun } = req.body || {};
  if (!packageId || typeof packageId !== 'string') {
    return res.status(400).json({ ok: false, error: 'packageId is required.' });
  }
  if (!Number.isInteger(sceneIndex) || sceneIndex < 0) {
    return res.status(400).json({ ok: false, error: 'sceneIndex must be a non-negative integer.' });
  }

  const pkg = loadPackage(packageId);
  if (!pkg) return res.status(404).json({ ok: false, error: `Content Package "${packageId}" not found.` });

  const built = buildRenderSpec(pkg, { mode: 'faceless_social' });
  if (!built.ok || !built.spec) {
    return res.status(422).json({ ok: false, error: 'Could not build a valid Render Specification for this package.' });
  }

  const planned = planSceneAsset(built.spec, sceneIndex, { capability, modelOverride, providerOverride });
  if (!planned.ok) {
    return res.status(422).json({ ok: false, error: planned.error, warnings: planned.warnings });
  }

  // The binding is echoed for operator review. Asset Generation itself treats
  // it as opaque — it is surfaced here only so a human can see and approve
  // what policy chose before any money moves.
  const preview = {
    request: {
      requestId: planned.request.requestId,
      capability: planned.request.capability,
      sceneIndex: planned.request.sourceSceneId,
      promptChars: planned.request.prompt.length,
      hasNegativePrompt: !!planned.request.negativePrompt,
      aspectRatio: planned.request.aspectRatio,
      width: planned.request.width,
      height: planned.request.height,
      outputCount: planned.request.outputCount,
    },
    binding: {
      providerId: planned.binding.providerId,
      model: planned.binding.model,
      mode: planned.binding.mode,
      policyVersion: planned.binding.policyVersion,
      rationale: planned.binding.rationale,
      confidence: planned.binding.confidence,
    },
    warnings: planned.warnings,
  };

  // ── Cache first (M2) ────────────────────────────────────────────────────
  // Checked BEFORE any job is created, so a hit can never reach the Execution
  // Engine and therefore can never spend. Provider-blind: reuse is decided on
  // request semantics and byte integrity alone.
  const cache = lookupAsset(planned.request);
  const cacheReusable = ['hit', 'ambiguous'].includes(cache.status) && cache.selectedAssetId;

  if (dryRun === true) {
    return res.status(200).json({ ok: true, dryRun: true, ...preview, cache });
  }

  if (cacheReusable) {
    const record = getAsset(cache.selectedAssetId);

    // Attach the existing asset to the package — identical shape to the M1
    // ingest path, so URS resolution is byte-identical to a fresh generation.
    const entry = buildPackageAssetEntry(record);
    const others = Array.isArray(pkg.assets) ? pkg.assets.filter(a => a.sceneIndex !== entry.sceneIndex) : [];
    const nextPkg = {
      ...pkg,
      assets: [...others, entry].sort((a, b) => a.sceneIndex - b.sceneIndex),
      metadata: { ...pkg.metadata, updatedAt: new Date().toISOString() },
    };
    savePackage(nextPkg);

    recordAssetUsage({
      assetId: record.assetId,
      packageId: pkg.id,
      renderSpecId: built.spec.specId,
      sceneId: sceneIndex,
      productionJobId: null,
      actor: { type: 'human', id: 'user' },
      source: 'cache_hit',
    });

    // A cache hit is a governed decision NOT to spend, and is recorded as
    // such. The original generation's cost is NOT duplicated here — actual is
    // a confirmed zero, and the avoided cost is reported separately.
    const led = appendLedgerEntry({
      event: 'cache_hit',
      actor: { type: 'human', id: 'user' },
      division: 'asset-generation',
      capability: planned.request.capability,
      source: { packageId: pkg.id, renderSpecId: built.spec.specId, sceneId: sceneIndex, assetRequestId: planned.request.requestId },
      estimate: { amount: 0, currency: 'USD', estimateType: 'confirmed_local', confirmed: true },
      actual: { amount: 0, currency: 'USD', confirmed: true },
      approval: { required: false },
      outcome: { status: 'cache_hit', artifactIds: [record.assetId] },
      metadata: { note: `Reused asset ${record.assetId} (fingerprint ${cache.semanticFingerprint.slice(0, 12)}…)` },
    });

    return res.status(200).json({
      ok: true,
      ...preview,
      cache: { ...cache, ledgerEntryId: led.ok ? led.id : null },
      reusedAssetId: record.assetId,
      jobCreated: false,
      package: { id: nextPkg.id, assets: nextPkg.assets },
    });
  }

  const missLed = appendLedgerEntry({
    event: 'cache_miss',
    actor: { type: 'human', id: 'user' },
    division: 'asset-generation',
    capability: planned.request.capability,
    source: { packageId: pkg.id, renderSpecId: built.spec.specId, sceneId: sceneIndex, assetRequestId: planned.request.requestId },
    estimate: { estimateType: 'unknown', confirmed: false },
    outcome: { status: 'cache_miss' },
    metadata: { note: cache.reason.slice(0, 180) },
  });

  // Reuse a FAILED job for the same asset request rather than creating a
  // second one. A failed job is terminal and cannot be corrected through any
  // existing provider-input route, and creating a fresh job per correction
  // would sprawl the job store for a single logical request.
  const existing = (listProductionJobs() || []).find(j =>
    j.metadata?.assetRequestId === planned.request.requestId
    && ['failed', 'needs_approval', 'ready'].includes(j.status));

  const created = await createAssetJob(planned.request, planned.binding, { actor: 'user' });
  if (!created.ok) return res.status(422).json({ ok: false, error: created.error, ...preview });

  // Price the bound request through Diamond Control and stamp the result onto
  // the job's budget. Without this the job carries only a generic cost TIER,
  // and the engine's Ledger hook — which reads job.budget — would record a
  // paid execution with no amount, no unit and no provenance.
  //
  // The preflight is non-generating and creates nothing. A provider that cannot
  // price its own request yields an honestly unknown budget rather than a
  // guessed one.
  const preflight = await preflightCost(planned.request, planned.binding);
  const cost = preflight.cost || null;

  // A per-unit ceiling, enforced BEFORE the job exists. `maxEstimatedCost` on
  // the job budget only colours the approval reason — it never blocks — so an
  // operator-supplied ceiling is checked here against the real grouped total,
  // in the estimate's own unit. A ceiling in a different unit does not govern
  // this spend and is treated as no ceiling at all.
  if (ceilings && typeof ceilings === 'object' && Object.keys(ceilings).length > 0) {
    const agg = aggregateCosts([cost]);
    const verdict = checkCeilings(agg.totals, ceilings);
    if (!verdict.ok) {
      return res.status(422).json({
        ok: false,
        error: 'Estimated cost is not within the supplied budget ceiling.',
        reasons: verdict.reasons,
        ceilings: normalizeCeilings(ceilings),
        totals: agg.totals,
        estimate: cost,
        ...preview,
      });
    }
  }
  const pricedBudget = cost && (cost.amount !== null || cost.unit)
    ? {
        ...(created.job.budget || {}),
        estimateType: cost.estimateType,
        // An open-ended max marks a floor price, exactly as the money shape does.
        estimatedRange: cost.amount === null ? null : { min: cost.amount, max: cost.isLowerBound ? null : cost.amount },
        currency: cost.unit === 'currency' ? cost.currency : cost.providerCreditUnit,
        unit: cost.unit,
        providerCreditUnit: cost.providerCreditUnit,
        isLowerBound: cost.isLowerBound,
        pricingSource: cost.pricingSource,
        pricedAt: cost.pricedAt,
        costTier: cost.amount === 0 ? 'free' : 'variable',
        // Every non-local provider spend keeps requiring explicit approval.
        approvalRequired: cost.estimateType !== 'confirmed_local',
      }
    : (created.job.budget || {});

  // buildProductionJob() BUILDS but does not persist — the caller owns that,
  // exactly as /api/production/router/plan does. Attribution is stamped on
  // before the first write so the Execution Engine's single Ledger hook can
  // read it; the engine stays ignorant of Asset Generation.
  const withAttribution = {
    ...created.job,
    budget: pricedBudget,
    metadata: { ...(created.job.metadata || {}), ...created.metadata },
  };

  let job;
  try {
    if (existing) {
      // Same logical request — refresh the plan in place, clearing the prior
      // failure and any stale approval so it must be re-approved.
      job = updateProductionJob(existing.id, {
        ...withAttribution,
        id: existing.id,
        status: 'needs_approval',
        execution: null,
        approval: { ...(withAttribution.approval || {}), approvedAt: null, approvedBy: null },
        metadata: { ...(existing.metadata || {}), ...created.metadata },
      });
    } else {
      createProductionJob(withAttribution);
      job = updateProductionJob(withAttribution.id, {});
    }
    // Deliberately NOT applyProductionRefToPackage(): the package's production
    // pointer describes its render deliverable. An asset job produces an input
    // for that render and must never displace it.
  } catch (err) {
    return res.status(500).json({ ok: false, error: `Failed to persist the asset job: ${err.message}`, ...preview });
  }

  return res.status(201).json({
    ok: true,
    ...preview,
    cache: { ...cache, ledgerEntryId: missLed.ok ? missLed.id : null },
    jobCreated: true,
    reusedJobId: existing ? existing.id : null,
    droppedFields: unsupportedRequestFields(planned.request, planned.binding),
    estimate: cost,
    job: { ...job, execution: sanitizeExecutionForResponse(job.execution) },
  });
}
