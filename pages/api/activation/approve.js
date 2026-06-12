// POST /api/activation/approve
// Approves a pending activation request and flips adapter to active in activation-state.

import { approveActivationRequest } from '../../../lib/activation/activationGate.js';

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { requestId } = req.body || {};
  if (!requestId) return res.status(400).json({ error: 'requestId required' });

  const result = approveActivationRequest(requestId);
  return res.status(result.ok ? 200 : 400).json(result);
}
