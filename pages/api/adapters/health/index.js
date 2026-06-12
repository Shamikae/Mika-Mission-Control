// GET /api/adapters/health
// Returns stored adapter health data — no live pings. Fast.
// Use POST /api/adapters/health/check to run fresh checks.

import { loadAdapterHealth, getAdapterHealthSummary } from '../../../../lib/adapters/adapterHealth';
import { listAdapters } from '../../../../lib/adapters/loadAdapter';

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const store   = loadAdapterHealth();
  const summary = getAdapterHealthSummary(store);

  // Merge in adapter displayNames for any adapters not yet in the store
  const registered = listAdapters();
  const adapterList = registered.map(a => ({
    ...a,
    ...(store.adapters[a.adapterId] || {
      health:         null,
      ok:             null,
      latencyMs:      null,
      reason:         null,
      message:        null,
      checkedAt:      null,
      envVarsMissing: [],
      envVarsPresent: [],
      activationNote: null,
    }),
  }));

  return res.status(200).json({
    checkedAt: store.checkedAt || null,
    neverChecked: !store.checkedAt,
    summary,
    adapters: adapterList,
    raw: store.adapters,
  });
}
