// POST /api/activation/request
// Creates a new activation request for a staged adapter (runs preflight internally).

import { createActivationRequest } from '../../../lib/activation/activationGate.js';

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { adapterId, adapterName, notes } = req.body || {};
  if (!adapterId) return res.status(400).json({ error: 'adapterId required' });

  const request = createActivationRequest(adapterId, adapterName, notes);
  return res.status(200).json({ ok: true, request });
}
