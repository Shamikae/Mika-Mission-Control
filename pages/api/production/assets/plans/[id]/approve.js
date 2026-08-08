// POST /api/production/assets/plans/[id]/approve
//
// The ONE approval gate for the whole batch. Requires a budget ceiling, and
// binds the approval to the plan's exact content hash so a later change
// invalidates it. Dispatches nothing — there is no dispatch route yet.
//
// Input: { ceilings?, ceilingAmount?, currency?, acknowledgeProvisional?, expectedContentHash? }
//
// `ceilings` is the real form — one limit per spend unit, e.g.
//   { "USD": 1.00, "higgsfield-credits": 5.00 }
// because a plan can spend in units that have no conversion between them and a
// lone number cannot say which one it governs. The legacy ceilingAmount+currency
// pair is still accepted and becomes a ceiling for that one unit only.

import { approvePlan } from '../../../../../../lib/production/assets/assetPlanService';

export const config = { api: { bodyParser: { sizeLimit: '4kb' } } };

const MAX_CEILING_UNITS = 12;

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const { ceilings, ceilingAmount, currency, acknowledgeProvisional, expectedContentHash } = req.body || {};
  if (ceilingAmount !== undefined && ceilingAmount !== null && !(Number.isFinite(ceilingAmount) && ceilingAmount >= 0)) {
    return res.status(400).json({ ok: false, error: 'ceilingAmount must be a non-negative number.' });
  }
  if (ceilings !== undefined && ceilings !== null) {
    if (typeof ceilings !== 'object' || Array.isArray(ceilings)) {
      return res.status(400).json({ ok: false, error: 'ceilings must be an object mapping each spend unit to its own limit.' });
    }
    const entries = Object.entries(ceilings);
    if (entries.length > MAX_CEILING_UNITS) {
      return res.status(400).json({ ok: false, error: `ceilings may name at most ${MAX_CEILING_UNITS} units.` });
    }
    for (const [unit, value] of entries) {
      if (!(Number.isFinite(value) && value >= 0)) {
        return res.status(400).json({ ok: false, error: `Ceiling for "${unit}" must be a non-negative number.` });
      }
    }
  }

  const result = approvePlan(req.query.id, {
    actor: 'user', ceilings, ceilingAmount, currency,
    acknowledgeProvisional: acknowledgeProvisional === true,
    expectedContentHash,
  });
  if (!result.ok) {
    return res.status(result.status).json({ ok: false, error: result.error, reasons: result.reasons || null, contentHash: result.contentHash || null });
  }
  return res.status(200).json({ ok: true, plan: result.plan, approvalRef: result.approvalRef, ledgerEntryId: result.ledgerEntryId });
}
