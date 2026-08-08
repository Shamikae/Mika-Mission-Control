// POST /api/production/assets/plans — create one AssetPlan for a package's URS
//
// Planning only: computes capabilities, checks the cache, asks policy for a
// binding per miss, and stops. Creates no Production Job and spends nothing.
//
// Input:  { packageId, modelOverride?, ceilingAmount?, currency? }
// Output: { ok, plan, reused, ledgerEntryId }

import { createPlanForPackage } from '../../../../../lib/production/assets/assetPlanService';

export const config = { api: { bodyParser: { sizeLimit: '8kb' } } };

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const { packageId, modelOverride, ceilingAmount, currency } = req.body || {};
  if (!packageId || typeof packageId !== 'string') {
    return res.status(400).json({ ok: false, error: 'packageId is required.' });
  }
  if (ceilingAmount !== undefined && ceilingAmount !== null && !(Number.isFinite(ceilingAmount) && ceilingAmount >= 0)) {
    return res.status(400).json({ ok: false, error: 'ceilingAmount must be a non-negative number when supplied.' });
  }

  const result = createPlanForPackage({ packageId, actor: 'user', modelOverride, ceilingAmount, currency });
  if (!result.ok) return res.status(result.status).json({ ok: false, error: result.error });
  return res.status(result.status).json({ ok: true, plan: result.plan, reused: result.reused, ledgerEntryId: result.ledgerEntryId || null });
}
