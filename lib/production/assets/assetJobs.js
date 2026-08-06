// lib/production/assets/assetJobs.js
// SERVER-SIDE ONLY.
//
// The I/O half of the Asset Generation seam: creating the governed Production
// Job, and ingesting a completed job's artifact into the immutable asset
// store. Split from assetResolver.js so the PLANNING seam stays free of heavy
// dependencies and can be exercised directly.
//
// Same invariants as the rest of this directory: no provider module is
// imported, no provider name appears in a conditional, and all execution goes
// through the existing Provider Execution Engine.

import fs from 'fs';
import crypto from 'crypto';
import { buildProductionJob } from '../buildProductionPlan.js';
import { getProductionJob } from '../productionJobStore.js';
import { findProductionArtifactPath } from '../execution/productionArtifactStore.js';
import { buildProviderInputFromBinding, buildAssetJobMetadata, promptHashOf, isAllowedAssetMime } from './assetRules.js';
import { saveAsset, generateAssetId } from './assetStore.js';
import { ensureAssetIndexed } from './assetCache.js';
import { getLedgerTrailForJob } from '../../ledger/ledgerStore.js';

function hash(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

/**
 * Creates the governed Production Job that will generate the asset.
 * Uses the SAME planning path every other job uses — no parallel job type,
 * no second execution engine.
 */
export async function createAssetJob(request, binding, { actor = 'user' } = {}) {
  const built = await buildProductionJob({
    packageId: request.sourcePackageId,
    selectedMode: binding.mode,
    selectedProvider: binding.providerId,
    providerInput: buildProviderInputFromBinding(request, binding),
    actor,
  });
  if (!built.ok) return { ok: false, error: built.error };

  return { ok: true, job: built.job, metadata: buildAssetJobMetadata(request) };
}

/**
 * Ingests a COMPLETED asset job's artifact into the immutable asset store.
 *
 * The artifact stays where the engine put it (job-scoped, terminal); the asset
 * is a separate immutable copy in the library, because the two have different
 * lifecycles. The remote provider URL is deliberately not carried over — after
 * ingestion the local bytes are the only source of truth.
 *
 * @returns {{ ok, record?, error? }}
 */
export function ingestAssetFromJob(jobId, request, { actor = 'user' } = {}) {
  const job = getProductionJob(jobId);
  if (!job) return { ok: false, error: `Production job "${jobId}" not found.` };
  if (job.execution?.status !== 'completed') {
    return { ok: false, error: `Job "${jobId}" is "${job.execution?.status || 'unknown'}" — only a completed job can be ingested.` };
  }

  const outputs = job.execution.outputs || [];
  const image = outputs.find(o => isAllowedAssetMime(o.mimeType));
  if (!image) {
    return { ok: false, error: `Job "${jobId}" produced no output with an allowed image MIME type.` };
  }

  const sourcePath = findProductionArtifactPath(image.id);
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return { ok: false, error: `Artifact "${image.id}" could not be located on disk.` };
  }

  const buffer = fs.readFileSync(sourcePath);
  const assetId = generateAssetId();

  // Every ledger entry for this job, so the asset carries its own audit trail.
  const ledgerEntryIds = getLedgerTrailForJob(jobId).map(e => e.id);

  const costEstimate = job.budget?.estimatedRange?.min ?? null;

  const saved = saveAsset({
    assetId,
    buffer,
    mimeType: image.mimeType,
    record: {
      schemaVersion: 1,
      capability: request.capability,
      brandId: request.brandId,
      sourceUrsId: request.sourceUrsId,
      sourcePackageId: request.sourcePackageId,
      sourceSceneId: request.sourceSceneId,
      width: request.width,
      height: request.height,
      provenance: {
        productionJobId: jobId,
        ledgerEntryIds,
        providerJobId: job.execution.providerJobId || null,
        // The prompt itself is NOT stored in the Ledger; the asset keeps a
        // hash plus the URS reference needed to recover it.
        promptHash: promptHashOf(request.prompt, request.negativePrompt, hash),
        generatedAt: job.execution.completedAt || new Date().toISOString(),
        actor,
      },
      cost: {
        estimated: costEstimate,
        actual: null,
        currency: job.budget?.currency || 'USD',
        confirmed: false,
      },
      lineage: { derivedFromAssetId: null },
      // Reuse policy lives on the record; absence means "not rejected".
      policy: { brandApproved: null, state: null, selected: false, retentionClass: 'standard' },
    },
  });

  // Index immediately so the asset is cache-eligible for the next identical
  // request. Indexing is a sidecar write — the record itself stays immutable.
  if (saved.ok) {
    const indexed = ensureAssetIndexed(saved.record, request);
    if (!indexed.ok) saved.warnings = [`Asset saved but could not be indexed for reuse: ${indexed.error}`];
    else saved.semanticFingerprint = indexed.semanticFingerprint;
  }
  return saved;
}

