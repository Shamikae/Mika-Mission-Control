// GET /api/production/providers
// Sanitized provider registry + honest execution status for every provider
// in the Router's catalog (not just the two executable ones).

import { listProviderExecutionStatus } from '../../../lib/production/execution/providerAdapterRegistry';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const providers = await listProviderExecutionStatus();
  return res.status(200).json({ ok: true, providers });
}
