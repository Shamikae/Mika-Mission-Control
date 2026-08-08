// GET /api/production/providers/kie/status
//
// Read-only Kie.ai status. Reports configuration/auth state, account balance
// when Kie returns one, the v1 model allowlist, and the two operational facts
// an operator must know before approving a Kie generation: the estimate can
// never be provider-confirmed, and a submitted task cannot be cancelled.
//
// Strictly read-only — GET only, no mutation, no generation, no task creation.
// The API key is never returned in any form.

import kieAdapter, { listKieModels } from '../../../../../lib/production/execution/adapters/kie.adapter';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // healthCheck() calls the free, read-only balance endpoint when configured,
  // and short-circuits without any network call when it is not.
  const health = await kieAdapter.healthCheck();

  return res.status(200).json({
    ok: true,
    providerId: 'kie',
    displayName: kieAdapter.displayName,
    status: health.status,
    executable: health.ok === true,
    error: health.error || null,
    // Kie credits. Null when unconfigured or when Kie returned no figure —
    // never defaulted to zero, which would read as "account empty".
    balance: health.balance ?? null,
    balanceCurrency: health.balanceCurrency ?? null,
    models: listKieModels(),
    capabilities: {
      mediaTypes: ['image'],
      maxOutputCount: 1,
      // Kie documents no cost-preflight endpoint, so an estimate is always a
      // published-catalogue figure and never a confirmed price.
      costPreflight: false,
      estimateType: 'provisional_catalog',
      // No cancellation endpoint exists anywhere in Kie's documented API.
      cancellationSupported: false,
      // Result URLs expire ~10 minutes after completion.
      resultUrlTtlSeconds: 600,
    },
  });
}
