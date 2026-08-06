// POST /api/production/assets/[jobId]/ingest
//
// Asset Generation M1 — turn a COMPLETED asset job's artifact into an
// immutable Asset, then attach it to its Content Package so URS can resolve it.
//
// Generates nothing and spends nothing: it only reads an artifact the
// Execution Engine already ingested.
//
// Input:  { packageId, sceneIndex, capability?, modelOverride? }
// Output: { ok, asset, package }

import { loadPackage, savePackage } from '../../../../../lib/content/contentPackageStore';
import { buildRenderSpec } from '../../../../../lib/production/renderSpec/buildRenderSpec';
import { planSceneAsset, buildPackageAssetEntry } from '../../../../../lib/production/assets/assetResolver';
import { ingestAssetFromJob } from '../../../../../lib/production/assets/assetJobs';
import { isValidId } from '../../../../../lib/production/productionRules';

export const config = { api: { bodyParser: { sizeLimit: '8kb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { jobId } = req.query;
  if (!jobId || !isValidId(jobId)) {
    return res.status(400).json({ ok: false, error: 'Invalid job id.' });
  }

  const { packageId, sceneIndex, capability, modelOverride } = req.body || {};
  if (!packageId || !Number.isInteger(sceneIndex)) {
    return res.status(400).json({ ok: false, error: 'packageId and sceneIndex are required.' });
  }

  const pkg = loadPackage(packageId);
  if (!pkg) return res.status(404).json({ ok: false, error: `Content Package "${packageId}" not found.` });

  const built = buildRenderSpec(pkg, { mode: 'faceless_social' });
  if (!built.ok) return res.status(422).json({ ok: false, error: 'Could not rebuild the Render Specification.' });

  // Re-derive the same request so the asset record carries the identical
  // prompt hash and scene attribution the job was created from.
  const planned = planSceneAsset(built.spec, sceneIndex, { capability, modelOverride });
  if (!planned.ok) return res.status(422).json({ ok: false, error: planned.error });

  const ingested = ingestAssetFromJob(jobId, planned.request, { actor: 'user' });
  if (!ingested.ok) {
    return res.status(422).json({ ok: false, error: ingested.error, errors: ingested.errors });
  }

  // Additive: the package gains an assets[] entry. Existing fields are
  // untouched, and a package without one behaves exactly as before.
  const entry = buildPackageAssetEntry(ingested.record);
  const existing = Array.isArray(pkg.assets) ? pkg.assets.filter(a => a.sceneIndex !== entry.sceneIndex) : [];
  const updated = {
    ...pkg,
    assets: [...existing, entry].sort((a, b) => a.sceneIndex - b.sceneIndex),
    metadata: { ...pkg.metadata, updatedAt: new Date().toISOString() },
  };
  savePackage(updated);

  return res.status(201).json({
    ok: true,
    asset: {
      assetId: ingested.record.assetId,
      capability: ingested.record.capability,
      sceneIndex: ingested.record.sourceSceneId,
      mimeType: ingested.record.mimeType,
      sizeBytes: ingested.record.sizeBytes,
      contentHash: ingested.record.contentHash,
      provenance: ingested.record.provenance,
      cost: ingested.record.cost,
    },
    package: { id: updated.id, assets: updated.assets },
  });
}
