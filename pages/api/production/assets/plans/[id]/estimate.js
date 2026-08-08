// POST /api/production/assets/plans/[id]/estimate
//
// Runs a live, NON-GENERATING cost preflight for every paid request. Submits
// nothing. The preflight adapter is injected from lib/diamond so the planner
// stays provider-blind.

import { estimatePlan } from '../../../../../../lib/production/assets/assetPlanService';
import { preflightCost } from '../../../../../../lib/diamond/costPreflight';

export const config = { api: { bodyParser: { sizeLimit: '4kb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const result = await estimatePlan(
    req.query.id,
    request => preflightCost(request.assetRequest, request.binding),
    { actor: 'user' },
  );
  if (!result.ok) return res.status(result.status).json({ ok: false, error: result.error });
  return res.status(200).json({ ok: true, plan: result.plan, ledgerEntryId: result.ledgerEntryId });
}
