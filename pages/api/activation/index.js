// GET /api/activation
// Returns full activation state: adapters (with cost info), all requests, summary.

import { loadActivationRequests, loadActivationState, getActivationSummary } from '../../../lib/activation/activationGate.js';
import { listAdapters }   from '../../../lib/adapters/loadAdapter.js';
import { ADAPTER_COST_MODEL } from '../../../lib/cost/costEngine.js';

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const store   = loadActivationRequests();
  const state   = loadActivationState();
  const summary = getActivationSummary();
  const raw     = listAdapters();

  const adapters = raw.map(a => ({
    ...a,
    costTier:       ADAPTER_COST_MODEL[a.adapterId]?.tier           || null,
    perDispatch:    ADAPTER_COST_MODEL[a.adapterId]?.perDispatch     || 0,
    activationRisk: ADAPTER_COST_MODEL[a.adapterId]?.activationRisk || 'unknown',
  }));

  return res.status(200).json({
    summary,
    activationState: state.overrides || {},
    adapters,
    requests: store.requests,
  });
}
