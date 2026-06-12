// POST /api/activation/rollback
// Rolls back an active (gate-activated) adapter to staged.

import { rollbackActivation } from '../../../lib/activation/activationGate.js';

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { adapterId, reason } = req.body || {};
  if (!adapterId) return res.status(400).json({ error: 'adapterId required' });

  const result = rollbackActivation(adapterId, reason);
  return res.status(result.ok ? 200 : 400).json(result);
}
