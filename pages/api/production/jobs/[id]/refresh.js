// POST /api/production/jobs/[id]/refresh
// Re-reads the package and recomputes eligibility, provider candidates,
// readiness, and the output plan — preserving activity history and the
// job's current selectedMode/selectedProvider/budget as inputs.

import { getProductionJob, updateProductionJob } from '../../../../../lib/production/productionJobStore';
import { refreshProductionJob, applyProductionRefToPackage } from '../../../../../lib/production/buildProductionPlan';
import { isValidId } from '../../../../../lib/production/productionRules';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string' || !isValidId(id)) {
    return res.status(400).json({ ok: false, error: 'Invalid job id.' });
  }

  const job = getProductionJob(id);
  if (!job) return res.status(404).json({ ok: false, error: `Job "${id}" not found.` });

  const result = await refreshProductionJob(job, { actor: 'user' });
  if (!result.ok) return res.status(404).json({ ok: false, error: result.error });

  const updated = updateProductionJob(id, result.job);
  applyProductionRefToPackage(updated);

  return res.status(200).json({ ok: true, job: updated });
}
