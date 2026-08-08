// POST /api/production/assets/plans/[id]/reject — terminal rejection.

import { rejectPlan } from '../../../../../../lib/production/assets/assetPlanService';

export const config = { api: { bodyParser: { sizeLimit: '4kb' } } };

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const result = rejectPlan(req.query.id, { actor: 'user', reason: req.body?.reason });
  if (!result.ok) return res.status(result.status).json({ ok: false, error: result.error });
  return res.status(200).json({ ok: true, plan: result.plan, ledgerEntryId: result.ledgerEntryId });
}
