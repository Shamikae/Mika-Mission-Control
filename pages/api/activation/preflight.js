// GET /api/activation/preflight?adapterId=heygen
// Runs preflight checklist for a single adapter without creating a request.

import { runPreflightChecklist } from '../../../lib/activation/activationGate.js';

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { adapterId } = req.query;
  if (!adapterId) return res.status(400).json({ error: 'adapterId query param required' });

  const result = runPreflightChecklist(adapterId);
  return res.status(200).json(result);
}
