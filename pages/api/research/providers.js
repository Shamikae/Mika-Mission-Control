// GET /api/research/providers — lists governed research providers (exa,
// tavily, brave-search, model-synthesis) with status/executable/configured/
// executionType/capabilities/health. Never exposes a credential.

import { listResearchProviders } from '../../../lib/research/providerRegistry.js';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  return res.status(200).json({ ok: true, providers: listResearchProviders() });
}
