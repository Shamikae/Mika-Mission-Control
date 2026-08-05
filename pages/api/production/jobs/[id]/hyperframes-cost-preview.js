// POST /api/production/jobs/[id]/hyperframes-cost-preview
// Returns the adapter's confirmed local estimate — always a real,
// non-provisional $0 (local CPU/GPU time only, no provider credits). No
// provider call is needed — estimate() never touches the filesystem or
// spawns a process. Admin protected by middleware.js.

import { getProductionJob } from '../../../../../lib/production/productionJobStore';
import { isValidId } from '../../../../../lib/production/productionRules';
import hyperframesAdapter from '../../../../../lib/production/execution/adapters/hyperframes.adapter';

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

  if (job.selectedProvider !== 'hyperframes') {
    return res.status(409).json({ ok: false, error: `This job's selected provider is "${job.selectedProvider}" — cost preview only applies to jobs with selectedProvider "hyperframes".` });
  }

  try {
    const estimate = await hyperframesAdapter.estimate({ job });
    return res.status(200).json({ ok: true, estimate });
  } catch (e) {
    return res.status(502).json({ ok: false, error: e.message || 'Could not preview cost.' });
  }
}
