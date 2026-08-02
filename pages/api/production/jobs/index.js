// GET /api/production/jobs
// Lists production jobs, newest first. Optional filters: packageId, status, provider, mode.

import { listProductionJobs } from '../../../../lib/production/productionJobStore';
import { sanitizeExecutionForResponse } from '../../../../lib/production/execution/executionRules';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { packageId, status, provider, mode } = req.query;
  let jobs = listProductionJobs();

  if (packageId) jobs = jobs.filter(j => j.packageId === packageId);
  if (status)    jobs = jobs.filter(j => j.status === status);
  if (provider)  jobs = jobs.filter(j => j.selectedProvider === provider);
  if (mode)      jobs = jobs.filter(j => j.selectedMode === mode);

  // Never return a raw lock token (job.execution.lock.token) — sanitize
  // every job's execution field the same way the execution-specific routes do.
  const sanitized = jobs.map(j => ({ ...j, execution: sanitizeExecutionForResponse(j.execution) }));

  return res.status(200).json({ ok: true, jobs: sanitized, total: sanitized.length });
}
