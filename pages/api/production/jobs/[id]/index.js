// GET   /api/production/jobs/[id] — return one sanitized job
// PATCH /api/production/jobs/[id] — allow selectedMode, selectedProvider,
//   budget, user notes, cancel. Changing selectedMode/selectedProvider/budget
//   triggers a full readiness/provider/budget/status recompute (never a
//   stale patch) and resets any prior approval — a materially changed plan
//   must be re-approved, never silently carried forward as still-approved.
//
// Input (PATCH): { selectedMode? } | { selectedProvider? } |
//   { budget: { maxEstimatedCost?, currency?, approvalRequiredAbove? } } |
//   { userNotes } | { cancel: true, note? }
// Output: { ok: true, job } | { ok: false, error }

import { getProductionJob, updateProductionJob, cancelProductionJob } from '../../../../../lib/production/productionJobStore';
import { buildProductionJob, applyProductionRefToPackage } from '../../../../../lib/production/buildProductionPlan';
import { isValidId, isValidMode, PROVIDER_CATALOG, PRODUCTION_MODE_IDS } from '../../../../../lib/production/productionRules';

const PROVIDER_IDS = PROVIDER_CATALOG.map(p => p.id);

export const config = {
  api: { bodyParser: { sizeLimit: '64kb' } },
};

export default async function handler(req, res) {
  const { id } = req.query;
  if (!id || typeof id !== 'string' || !isValidId(id)) {
    return res.status(400).json({ ok: false, error: 'Invalid job id.' });
  }

  if (req.method === 'GET') {
    const job = getProductionJob(id);
    if (!job) return res.status(404).json({ ok: false, error: `Job "${id}" not found.` });
    return res.status(200).json({ ok: true, job });
  }

  if (req.method === 'PATCH') {
    const job = getProductionJob(id);
    if (!job) return res.status(404).json({ ok: false, error: `Job "${id}" not found.` });

    const { selectedMode, selectedProvider, budget, cancel, note, userNotes } = req.body || {};

    if (cancel === true) {
      const cancelled = cancelProductionJob(id, { actor: 'user', note: typeof note === 'string' ? note.slice(0, 300) : null });
      if (cancelled) applyProductionRefToPackage(cancelled); // guarded — only syncs if still the package's latest job
      return res.status(200).json({ ok: true, job: cancelled });
    }

    if (userNotes !== undefined) {
      if (typeof userNotes !== 'string' || userNotes.length > 2000) {
        return res.status(400).json({ ok: false, error: 'userNotes must be a string of 2000 characters or fewer.' });
      }
      const updated = updateProductionJob(id, { metadata: { userNotes } });
      return res.status(200).json({ ok: true, job: updated });
    }

    const needsRebuild = selectedMode !== undefined || selectedProvider !== undefined || budget !== undefined;
    if (!needsRebuild) {
      return res.status(400).json({ ok: false, error: 'No recognized fields to update.' });
    }
    if (selectedMode !== undefined && !isValidMode(selectedMode)) {
      return res.status(400).json({ ok: false, error: `Invalid selectedMode. Valid: ${PRODUCTION_MODE_IDS.join(', ')}.` });
    }
    if (selectedProvider !== undefined && !PROVIDER_IDS.includes(selectedProvider)) {
      return res.status(400).json({ ok: false, error: `Invalid selectedProvider. Valid: ${PROVIDER_IDS.join(', ')}.` });
    }

    let maxEstimatedCost = job.budget?.maxEstimatedCost ?? undefined;
    let currency = job.budget?.currency;
    let approvalRequiredAbove = job.budget?.approvalRequiredAbove ?? undefined;
    if (budget && typeof budget === 'object') {
      if (budget.maxEstimatedCost !== undefined) {
        const n = Number(budget.maxEstimatedCost);
        if (budget.maxEstimatedCost !== null && (!Number.isFinite(n) || n < 0)) {
          return res.status(400).json({ ok: false, error: 'budget.maxEstimatedCost must be a non-negative number.' });
        }
        maxEstimatedCost = budget.maxEstimatedCost === null ? undefined : n;
      }
      if (budget.currency !== undefined) {
        currency = typeof budget.currency === 'string' ? (budget.currency.trim().slice(0, 10) || 'USD') : currency;
      }
      if (budget.approvalRequiredAbove !== undefined) {
        approvalRequiredAbove = typeof budget.approvalRequiredAbove === 'string' ? budget.approvalRequiredAbove.trim().slice(0, 40) : undefined;
      }
    }

    const result = await buildProductionJob({
      packageId: job.packageId,
      selectedMode: selectedMode !== undefined ? selectedMode : job.selectedMode,
      selectedProvider: selectedProvider !== undefined ? selectedProvider : job.selectedProvider,
      maxEstimatedCost, currency, approvalRequiredAbove,
      actor: 'user',
      existingJob: { ...job, approval: null }, // a materially changed plan must be re-approved
    });

    if (!result.ok) return res.status(404).json({ ok: false, error: result.error });

    const updated = updateProductionJob(id, result.job);
    applyProductionRefToPackage(updated);
    return res.status(200).json({ ok: true, job: updated });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
