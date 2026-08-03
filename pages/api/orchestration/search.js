// GET /api/orchestration/search?q=...
// Global search across content packages, production jobs, artifacts,
// providers, publishing platforms, and publish jobs. Read-only — reuses
// every existing store directly, no new persistence.

import { listPipelinePackages } from '../../../lib/content/contentPipelineStore';
import { listProductionJobs } from '../../../lib/production/productionJobStore';
import { listPublishJobs } from '../../../lib/publishing/publishJobStore';
import { searchAll } from '../../../lib/orchestration/globalSearch';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const { q } = req.query;
  if (typeof q !== 'string' || !q.trim()) {
    return res.status(200).json({ ok: true, results: [] });
  }

  const packages = listPipelinePackages();
  const productionJobs = listProductionJobs();
  const publishJobs = listPublishJobs();

  const results = searchAll({ packages, productionJobs, publishJobs }, q.slice(0, 200));
  return res.status(200).json({ ok: true, results, total: results.length });
}
