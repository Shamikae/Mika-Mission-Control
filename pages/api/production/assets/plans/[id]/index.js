// GET /api/production/assets/plans/[id] — read one AssetPlan.

import { getPlan } from '../../../../../../lib/production/assets/assetPlanStore';

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const plan = getPlan(req.query.id);
  if (!plan) return res.status(404).json({ ok: false, error: 'Asset plan not found.' });
  return res.status(200).json({ ok: true, plan });
}
