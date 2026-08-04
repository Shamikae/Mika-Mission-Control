// GET /api/creative-director/workforce — list workforce runs (filter: requestId, status)

import { listWorkforceRuns } from '../../../../lib/creative-director/workforce/workforceRunStore';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const { requestId, status } = req.query;
  let runs = listWorkforceRuns({ requestId: requestId || undefined });
  if (status) runs = runs.filter(r => r.status === status);
  return res.status(200).json({ ok: true, runs, total: runs.length });
}
