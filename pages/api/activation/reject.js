// POST /api/activation/reject
// Rejects a pending activation request.

import { rejectActivationRequest } from '../../../lib/activation/activationGate.js';

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { requestId, reason } = req.body || {};
  if (!requestId) return res.status(400).json({ error: 'requestId required' });

  const result = rejectActivationRequest(requestId, reason);
  return res.status(result.ok ? 200 : 400).json(result);
}
