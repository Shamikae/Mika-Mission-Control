// POST /api/production/router/plan
// Builds and persists a governed production plan/job for an approved Content
// Package. Never generates a video and never calls a provider — planning
// only. Admin-token protected (see middleware.js — applies to every
// non-GET/HEAD/OPTIONS /api/* route automatically).
//
// Input:  { packageId, selectedMode?, selectedProvider?, maxEstimatedCost?, currency?, approvalRequiredAbove? }
// Output: { ok: true, job } | { ok: false, error }

import { buildProductionJob, applyProductionRefToPackage } from '../../../../lib/production/buildProductionPlan';
import { createProductionJob } from '../../../../lib/production/productionJobStore';
import { isValidId, isValidMode, PROVIDER_CATALOG, PRODUCTION_MODE_IDS, makeActivityEvent } from '../../../../lib/production/productionRules';
import { sanitizeExecutionForResponse } from '../../../../lib/production/execution/executionRules';

const PROVIDER_IDS = PROVIDER_CATALOG.map(p => p.id);

export const config = {
  api: { bodyParser: { sizeLimit: '64kb' } },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { packageId, selectedMode, selectedProvider, maxEstimatedCost, currency, approvalRequiredAbove } = req.body || {};

  if (!packageId || typeof packageId !== 'string' || !isValidId(packageId)) {
    return res.status(400).json({ ok: false, error: 'A valid packageId is required.' });
  }
  if (selectedMode !== undefined && selectedMode !== null && !isValidMode(selectedMode)) {
    return res.status(400).json({ ok: false, error: `Invalid selectedMode. Valid: ${PRODUCTION_MODE_IDS.join(', ')}.` });
  }
  if (selectedProvider !== undefined && selectedProvider !== null && !PROVIDER_IDS.includes(selectedProvider)) {
    return res.status(400).json({ ok: false, error: `Invalid selectedProvider. Valid: ${PROVIDER_IDS.join(', ')}.` });
  }

  let maxCost;
  if (maxEstimatedCost !== undefined && maxEstimatedCost !== null) {
    const n = Number(maxEstimatedCost);
    if (!Number.isFinite(n) || n < 0) {
      return res.status(400).json({ ok: false, error: 'maxEstimatedCost must be a non-negative number.' });
    }
    maxCost = n;
  }

  const result = await buildProductionJob({
    packageId,
    selectedMode: selectedMode || undefined,
    selectedProvider: selectedProvider || undefined,
    maxEstimatedCost: maxCost,
    currency: typeof currency === 'string' ? (currency.trim().slice(0, 10) || 'USD') : 'USD',
    approvalRequiredAbove: typeof approvalRequiredAbove === 'string' ? approvalRequiredAbove.trim().slice(0, 40) : undefined,
  });

  if (!result.ok) {
    return res.status(404).json({ ok: false, error: result.error });
  }

  const job = {
    ...result.job,
    activityHistory: [makeActivityEvent('job_created', { actor: 'user' }), ...result.job.activityHistory],
  };

  // Persist the job FIRST. The package backlink is only ever added once the
  // job itself is durably on disk — a failed job write must never leave a
  // dangling production reference on the package.
  let persistedJob;
  try {
    persistedJob = createProductionJob(job);
  } catch (err) {
    return res.status(500).json({ ok: false, error: `Failed to persist production job: ${err.message}` });
  }

  // A freshly created job is unconditionally the newest one for this
  // package — force the reference rather than applying the "still latest"
  // guard used everywhere else.
  applyProductionRefToPackage(persistedJob, { force: true });

  return res.status(201).json({ ok: true, job: { ...persistedJob, execution: sanitizeExecutionForResponse(persistedJob.execution) } });
}
