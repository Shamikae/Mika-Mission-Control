// POST /api/production/jobs/[id]/approve
// Explicit human approval. Moves needs_approval -> ready ONLY if the job's
// readiness check passes. Never auto-approves — this is the only path that
// sets approval.approvedAt.

import { getProductionJob, updateProductionJob } from '../../../../../lib/production/productionJobStore';
import { applyProductionRefToPackage } from '../../../../../lib/production/buildProductionPlan';
import { isValidId, makeActivityEvent } from '../../../../../lib/production/productionRules';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string' || !isValidId(id)) {
    return res.status(400).json({ ok: false, error: 'Invalid job id.' });
  }

  const job = getProductionJob(id);
  if (!job) return res.status(404).json({ ok: false, error: `Job "${id}" not found.` });

  if (job.status !== 'needs_approval') {
    return res.status(409).json({ ok: false, error: `Job is "${job.status}" — approval only applies to jobs in "needs_approval".` });
  }
  if (!job.readiness?.ready) {
    return res.status(409).json({ ok: false, error: 'Readiness check does not pass — cannot approve until required assets are available.' });
  }

  const now = new Date().toISOString();
  const updated = updateProductionJob(id, {
    status: 'ready',
    approval: { ...job.approval, approvedAt: now, approvedBy: 'user' },
    activityHistory: [...job.activityHistory, makeActivityEvent('approved', { actor: 'user', note: 'Explicit human approval granted.' })],
  });
  applyProductionRefToPackage(updated);

  return res.status(200).json({ ok: true, job: updated });
}
