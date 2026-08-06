// lib/production/assets/assetResolver.js
// SERVER-SIDE ONLY.
//
// ── The Asset Generation seam (M1) ───────────────────────────────────────
//
//   URS scene  →  AssetRequest  →  [Diamond Control]  →  opaque binding
//              →  Production Job (existing Execution Engine)
//              →  ingested artifact  →  immutable Asset  →  URS assetRef
//
// INVARIANTS enforced here and validated by
// scripts/validate-asset-generation-m1.mjs:
//   • No provider module is imported anywhere under lib/production/assets/.
//   • No provider name appears in a conditional here.
//   • The binding from Diamond Control is forwarded as OPAQUE data.
//   • All execution goes through the existing Provider Execution Engine.
//     The legacy dispatch path is closed to new work (F1).
//   • Nothing here renders, and the translator never calls into this module.
//
// M1 scope: one scene, one asset, one output. No planner, no fan-out, no
// cache, no automatic retry.
//
// This module is the PLANNING half. Job creation and artifact ingestion live
// in ./assetJobs.js.

import { recommendBinding } from '../../diamond/recommendBinding.js';
import { buildAssetRequest, validateBindingShape } from './assetRules.js';
import { capabilityForSceneAssetKind } from './assetCapabilities.js';

/**
 * Plans one scene's asset and asks policy who should make it.
 * Pure apart from reading policy — creates nothing.
 *
 * @returns {{ ok, request?, binding?, warnings, error? }}
 */
export function planSceneAsset(spec, sceneIndex, { capability, brandId, modelOverride } = {}) {
  const warnings = [];

  let resolvedCapability = capability;
  if (!resolvedCapability) {
    const scene = (spec?.scenes || [])[sceneIndex];
    const mapped = capabilityForSceneAssetKind(scene?.visual?.assetKind);
    resolvedCapability = mapped.capability;
    if (mapped.reason) warnings.push(mapped.reason);
    if (!resolvedCapability) return { ok: false, error: mapped.reason || 'No capability could be resolved for this scene.', warnings };
  }

  const planned = buildAssetRequest(spec, sceneIndex, { capability: resolvedCapability, brandId });
  if (!planned.ok) return { ok: false, error: planned.error, warnings: [...warnings, ...planned.warnings] };
  warnings.push(...planned.warnings);

  // Ask policy. The answer is data — this module never inspects which
  // provider or model came back, only that the shape is valid.
  const decision = recommendBinding(planned.request, { modelOverride });
  if (!decision.ok) return { ok: false, error: decision.error, warnings };

  const shape = validateBindingShape(decision.binding);
  if (!shape.valid) return { ok: false, error: `Policy returned an unusable binding: ${shape.errors.join('; ')}`, warnings };

  return { ok: true, request: planned.request, binding: decision.binding, warnings };
}

/**
 * Attaches a resolved asset to a Content Package additively.
 *
 * The package gains an `assets[]` entry; buildRenderSpec reads it to populate
 * URS `assets[]` and `scenes[].assetRef`. Provider and model are deliberately
 * NOT copied here — provenance stays on the asset record so URS remains
 * provider-neutral.
 */
export function buildPackageAssetEntry(record) {
  return {
    assetId: record.assetId,
    capability: record.capability,
    sceneIndex: record.sourceSceneId,
    storagePath: record.storagePath,
    mimeType: record.mimeType,
    width: record.width,
    height: record.height,
    contentHash: record.contentHash,
  };
}
