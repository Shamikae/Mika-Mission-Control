// GET /api/production/jobs
// Lists production jobs, newest first. Optional filters: packageId, status, provider, mode.

import { listProductionJobs } from '../../../../lib/production/productionJobStore';

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

  return res.status(200).json({ ok: true, jobs, total: jobs.length });
}
