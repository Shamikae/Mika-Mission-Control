// GET /api/agents/control-center
// Aggregates registry, adapter info, dispatch log, and control-state overrides
// into a single payload for the Agent Control Center dashboard.
// Does NOT run live healthChecks — use /api/adapters/status for that.

import fs   from 'fs';
import path from 'path';
import { loadAgentRegistry }    from '../../../lib/agents/loadAgentRegistry';
import { listAdapters }         from '../../../lib/adapters/loadAdapter';
import { loadAdapterHealth }    from '../../../lib/adapters/adapterHealth';
import { resolveAgentRuntimeHealth } from '../../../lib/agents/resolveRuntimeHealth';

const ROOT = process.cwd();

function readJson(fp, fb) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return fb; }
}

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const agents        = loadAgentRegistry();
  const adapters      = listAdapters();
  const tasks         = readJson(path.join(ROOT, 'data', 'tasks.json'), []);
  const dispatchLog   = readJson(path.join(ROOT, 'logs', 'dispatch-log.json'), []);
  const controlState  = readJson(path.join(ROOT, 'data', 'agent-control-state.json'), { overrides: {} });
  const adapterMaint  = readJson(path.join(ROOT, 'data', 'adapter-maintenance.json'), { maintenance: {} });
  const healthStore   = loadAdapterHealth();

  const adapterMap = Object.fromEntries(adapters.map(a => [a.adapterId, a]));

  // Dispatch counts and last dispatch per agent
  const dispatchByAgent = {};
  for (const d of dispatchLog) {
    const id = d.selectedAgentId;
    if (!id) continue;
    if (!dispatchByAgent[id]) dispatchByAgent[id] = [];
    dispatchByAgent[id].push(d);
  }

  // Tasks today
  const today = new Date().toISOString().split('T')[0];
  const dispatchedToday = dispatchLog.filter(d => d.timestamp?.startsWith(today)).length;

  // Enrich agents
  const enrichedAgents = agents.map(agent => {
    const override    = controlState.overrides?.[agent.id] || null;
    const agentDisps  = dispatchByAgent[agent.id] || [];
    const adapterInfo = adapterMap[agent.adapterId] || null;
    const runtime = resolveAgentRuntimeHealth({
      agent,
      adapter: adapterInfo,
      evidence: healthStore.adapters?.[agent.adapterId] || null,
      override,
      maintenance: adapterMaint.maintenance?.[agent.adapterId] || null,
    });
    const last        = agentDisps.length > 0 ? agentDisps[agentDisps.length - 1] : null;
    const failed      = agentDisps.filter(d => d.executionStatus === 'failed').length;
    const failureRate = agentDisps.length > 0 ? +(failed / agentDisps.length * 100).toFixed(1) : 0;

    const warnings = [];
    if (runtime.runtimeStatus === 'unknown') warnings.push('Runtime health is unknown until a fresh adapter check succeeds');
    if (runtime.runtimeEvidence.reason === 'stale_evidence') warnings.push('Last runtime health evidence is stale');
    if (failureRate > 30) warnings.push(`High failure rate: ${failureRate}%`);
    if (!agent.adapterId) warnings.push('No adapterId set in registry');
    if (agent.adapterId && !adapterMap[agent.adapterId]) warnings.push(`Adapter "${agent.adapterId}" not registered in loadAdapter`);

    return {
      ...agent,
      ...runtime,
      override,
      adapterInfo,
      dispatchCount:  agentDisps.length,
      failureRate,
      failedCount:    failed,
      lastDispatch:   last,
      warnings,
    };
  });

  // Enrich adapters with maintenance state
  const enrichedAdapters = adapters.map(a => ({
    ...a,
    maintenanceState: adapterMaint.maintenance?.[a.adapterId] || null,
    inMaintenance:    adapterMaint.maintenance?.[a.adapterId]?.active === true,
  }));

  // Workforce summary
  const summary = {
    total:        agents.length,
    active:       agents.filter(a => a.status === 'active').length,
    staged:       agents.filter(a => a.status === 'staged').length,
    inactive:     agents.filter(a => a.status === 'inactive').length,
    reviewOnly:   agents.filter(a => a.status === 'review-only').length,
    executable:   enrichedAgents.filter(a => a.liveConnected).length,
    healthy:      enrichedAgents.filter(a => a.runtimeStatus === 'available').length,
    reachable:    enrichedAgents.filter(a => a.runtimeStatus === 'reachable').length,
    warning:      enrichedAgents.filter(a => a.runtimeStatus === 'degraded').length,
    offline:      enrichedAgents.filter(a => a.health === 'Offline').length,
    unknown:      enrichedAgents.filter(a => a.runtimeStatus === 'unknown').length,
    maintenance:  enrichedAgents.filter(a => a.runtimeEvidence?.reason === 'maintenance').length,
    stagedCount:  enrichedAgents.filter(a => a.health === 'Staged').length,
    reviewActive: enrichedAgents.filter(a => a.status === 'review-only' && a.runtimeStatus === 'available').length,
  };

  // Adapter summary
  const maintCount = Object.values(adapterMaint.maintenance || {}).filter(m => m.active).length;
  const adapterSummary = {
    total:       adapters.length,
    active:      adapters.filter(a => a.status === 'active').length,
    staged:      adapters.filter(a => a.status === 'staged').length,
    maintenance: maintCount,
    failed:      0, // requires live healthCheck via /api/adapters/status
  };

  // Cost estimate (static, no live billing API)
  const costEstimate = {
    dispatchedToday,
    estimatedDailyCost: dispatchedToday * 0.013, // ~$0.013 per OpenClaw task
    estimatedMonthlyCost: dispatchedToday * 0.013 * 30,
    note: 'Estimate only — based on active adapter cost models. No live billing API.',
  };

  return res.status(200).json({
    generatedAt:    new Date().toISOString(),
    agents:         enrichedAgents,
    adapters:       enrichedAdapters,
    summary,
    adapterSummary,
    costEstimate,
  });
}
