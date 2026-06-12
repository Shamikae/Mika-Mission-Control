// GET /api/cost/summary
// Returns full cost intelligence summary: overview, alerts, opportunities,
// activation projections, workflow averages. Computes fresh from dispatch log.

import { getCostSummary } from '../../../lib/cost/costEngine';

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const data = getCostSummary(true);
  return res.status(200).json(data);
}
