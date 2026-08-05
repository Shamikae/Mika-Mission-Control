// POST /api/production/jobs/[id]/higgsfield-cost-preview
// Calls the adapter's estimate() — a REAL, non-generating cost preflight
// via Higgsfield's get_cost mechanism when the saved providerInput is
// complete, or an honest provisional shape otherwise. Never submits a job,
// never spends credits. Admin protected by middleware.js.

import { getProductionJob } from '../../../../../lib/production/productionJobStore';
import { loadPackage } from '../../../../../lib/content/contentPackageStore';
import { isValidId } from '../../../../../lib/production/productionRules';
import higgsfieldMcpAdapter from '../../../../../lib/production/execution/adapters/higgsfieldMcp.adapter';

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

  if (job.selectedProvider !== 'higgsfield-mcp') {
    return res.status(409).json({ ok: false, error: `This job's selected provider is "${job.selectedProvider}" — cost preview only applies to jobs with selectedProvider "higgsfield-mcp".` });
  }

  const pkg = loadPackage(job.packageId);
  if (!pkg) return res.status(404).json({ ok: false, error: 'Content Package no longer exists.' });

  try {
    const estimate = await higgsfieldMcpAdapter.estimate({ job, pkg });
    return res.status(200).json({ ok: true, estimate });
  } catch (e) {
    return res.status(502).json({ ok: false, error: e.message || 'Could not preview cost.' });
  }
}
