// GET /api/orchestration/overview
// Mission Control-wide Content Division summary: package health breakdown,
// production volume/success rate, review status, publish readiness, export
// activity, and queue widths. Read-only aggregation over the EXISTING
// stores (content packages, production jobs, publish jobs, render queue) —
// never a new data-owning system, never a mutation.

import { listPipelinePackages } from '../../../lib/content/contentPipelineStore';
import { listProductionJobs } from '../../../lib/production/productionJobStore';
import { listPublishJobs } from '../../../lib/publishing/publishJobStore';
import { listQueue } from '../../../lib/production/execution/executionQueue';
import { computeMissionControlMetrics } from '../../../lib/orchestration/missionControlMetrics';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const packages = listPipelinePackages();
  const productionJobs = listProductionJobs();
  const publishJobs = listPublishJobs();
  const renderQueue = listQueue();

  const metrics = computeMissionControlMetrics({ packages, productionJobs, publishJobs, renderQueue });
  return res.status(200).json({ ok: true, metrics });
}
