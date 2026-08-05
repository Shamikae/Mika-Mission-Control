// GET   /api/production/jobs/[id]/hyperframes-provider-input
// PATCH /api/production/jobs/[id]/hyperframes-provider-input
//
// Server-managed, sanitized HyperFrames setup for a Production Job:
// composition selection + optional render quality. Admin protected
// automatically (middleware.js gates every non-GET route). Sibling to
// higgsfield-provider-input.js/openart-video-provider-input.js —
// deliberately a separate route rather than a generic one, matching the
// established per-provider pattern exactly.
//
// GET:   returns the job's current sanitized providerInput plus the live
//        list of available local HyperFrames compositions (read-only,
//        reuses listHyperFramesCompositions() — never duplicates that
//        discovery logic).
// PATCH: Input: { compositionId?, quality? } — unknown keys (including
//        outputFilename/forceRerender, both explicitly out of scope this
//        checkpoint — see hyperframes.adapter.js) are silently ignored,
//        never merged into providerInput. compositionId is validated
//        against the live local composition catalog — never against a
//        client-supplied label, and never a raw filesystem path.
//
// Output: { ok: true, job?, validation?, compositions? } | { ok: false, error }

import { getProductionJob, updateProductionJob } from '../../../../../lib/production/productionJobStore';
import { loadPackage } from '../../../../../lib/content/contentPackageStore';
import { buildProductionJob, applyProductionRefToPackage } from '../../../../../lib/production/buildProductionPlan';
import { isValidId } from '../../../../../lib/production/productionRules';
import { ACTIVE_EXECUTION_STATES, sanitizeExecutionForResponse } from '../../../../../lib/production/execution/executionRules';
import { validateHyperFramesProviderInputSync } from '../../../../../lib/production/execution/adapters/hyperframes.adapter';
import { isValidCompositionId } from '../../../../../lib/hyperframes/hyperframesSecurity';
import { getHyperFramesComposition, listHyperFramesCompositions } from '../../../../../lib/hyperframes/hyperframesCompositionStore';

const QUALITY_VALUES = ['standard', 'high'];

export const config = {
  api: { bodyParser: { sizeLimit: '4kb' } },
};

function sanitizeJob(job) {
  return job ? { ...job, execution: sanitizeExecutionForResponse(job.execution) } : job;
}

export default async function handler(req, res) {
  const { id } = req.query;
  if (!id || typeof id !== 'string' || !isValidId(id)) {
    return res.status(400).json({ ok: false, error: 'Invalid job id.' });
  }

  const job = getProductionJob(id);
  if (!job) return res.status(404).json({ ok: false, error: `Job "${id}" not found.` });

  if (job.selectedProvider !== 'hyperframes') {
    return res.status(409).json({ ok: false, error: `This job's selected provider is "${job.selectedProvider}" — HyperFrames setup only applies to jobs with selectedProvider "hyperframes".` });
  }

  if (req.method === 'GET') {
    const compositions = await listHyperFramesCompositions();
    return res.status(200).json({ ok: true, providerInput: job.providerInput || null, compositions });
  }

  if (req.method !== 'PATCH') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const executionBlocked = job.execution && ACTIVE_EXECUTION_STATES.includes(job.execution.status);
  const executionTerminalBlocked = job.execution && ['completed', 'cancelled'].includes(job.execution.status);
  if (executionBlocked || executionTerminalBlocked) {
    return res.status(409).json({ ok: false, error: `Cannot change HyperFrames setup while execution is "${job.execution.status}".` });
  }

  const body = req.body || {};

  // Strict whitelist — only these keys are ever read from the request body.
  // outputFilename/forceRerender are deliberately NOT here (see
  // hyperframes.adapter.js's header comment) — never merged into providerInput.
  const next = { ...(job.providerInput || {}) };
  if (body.compositionId !== undefined) {
    if (typeof body.compositionId !== 'string' || !isValidCompositionId(body.compositionId)) {
      return res.status(400).json({ ok: false, error: 'compositionId must be a valid HyperFrames composition identifier.' });
    }
    next.compositionId = body.compositionId;
  }
  if (body.quality !== undefined) {
    if (body.quality !== null && !QUALITY_VALUES.includes(body.quality)) {
      return res.status(400).json({ ok: false, error: `quality must be one of: ${QUALITY_VALUES.join(', ')}, or null.` });
    }
    next.quality = body.quality;
  }

  const pkg = loadPackage(job.packageId);
  if (!pkg) return res.status(404).json({ ok: false, error: 'Content Package no longer exists.' });

  // Live-verify the composition selection against the real local
  // filesystem — never trust a client-supplied id beyond format validation.
  let compositionExists = null;
  if (next.compositionId) {
    const found = await getHyperFramesComposition(next.compositionId).catch(() => null);
    compositionExists = !!found;
  }

  const validation = validateHyperFramesProviderInputSync({
    job: { ...job, providerInput: next },
    compositionExists,
  });

  const updated = updateProductionJob(id, { providerInput: next });

  // Recompute the full plan (readiness/status/budget/approval) through the
  // SAME governed path every other job edit uses — never a parallel
  // recompute. A materially changed setup resets any prior approval.
  const rebuild = await buildProductionJob({
    packageId: updated.packageId,
    selectedMode: updated.selectedMode,
    selectedProvider: updated.selectedProvider,
    providerInput: next,
    maxEstimatedCost: updated.budget?.maxEstimatedCost ?? undefined,
    currency: updated.budget?.currency,
    approvalRequiredAbove: updated.budget?.approvalRequiredAbove ?? undefined,
    actor: 'user',
    existingJob: { ...updated, approval: null },
  });

  if (!rebuild.ok) return res.status(404).json({ ok: false, error: rebuild.error });

  const final = updateProductionJob(id, rebuild.job);
  applyProductionRefToPackage(final);

  return res.status(200).json({ ok: true, job: sanitizeJob(final), validation });
}
