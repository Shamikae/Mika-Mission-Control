// POST /api/adapters/health/check
// Body: { adapterId?: string }  — omit adapterId to check all adapters
//
// Runs live healthCheck() on one or all adapters.
// Saves results to data/adapter-health.json.
// Appends to logs/adapter-health-log.json (max 500 entries).
//
// Slow for active adapters — pings real services.
// Staged adapters are resolved without network calls.

import {
  runAdapterHealthCheck,
  runAllAdapterHealthChecks,
  persistHealthResults,
  getAdapterHealthSummary,
  loadAdapterHealth,
} from '../../../../lib/adapters/adapterHealth';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { adapterId } = req.body || {};

  let results;
  if (adapterId) {
    const single = await runAdapterHealthCheck(adapterId);
    results = [single];
  } else {
    results = await runAllAdapterHealthChecks();
  }

  const store   = persistHealthResults(results);
  const summary = getAdapterHealthSummary(store);

  return res.status(200).json({
    ok:        true,
    checkedAt: store.checkedAt,
    checked:   results.length,
    results,
    summary,
  });
}
