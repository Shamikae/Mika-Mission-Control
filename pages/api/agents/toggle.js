// POST /api/agents/toggle
// Body: { agentId, action: 'enable'|'disable'|'maintenance-on'|'maintenance-off' }
//
// Governance enforcement:
//   - Cannot activate a staged agent (requires adapter activation + provider setup)
//   - Cannot bypass governance or dispatch
//   - Only disable/enable active agents, or set maintenance on any agent

import fs   from 'fs';
import path from 'path';
import { getAgentById } from '../../../lib/agents/loadAgentRegistry';

const ROOT  = process.cwd();
const FILE  = path.join(ROOT, 'data', 'agent-control-state.json');

function readJson(fp, fb) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return fb; }
}

const VALID_ACTIONS = ['enable', 'disable', 'maintenance-on', 'maintenance-off'];

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { agentId, action, reason } = req.body;
  if (!agentId) return res.status(400).json({ error: 'agentId required' });
  if (!VALID_ACTIONS.includes(action)) {
    return res.status(400).json({ error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}` });
  }

  const agent = getAgentById(agentId);
  if (!agent) return res.status(404).json({ error: `Agent "${agentId}" not found in registry` });

  // ── Governance gate ─────────────────────────────────────────────────
  if (action === 'enable' && agent.status === 'staged') {
    return res.status(403).json({
      error:           `Cannot activate staged agent "${agent.displayName}" via the control center.`,
      governanceBlock: true,
      detail:          'Staged agents require: (1) adapter activation approval, (2) env vars configured, (3) execute() implemented, and (4) a successful runtime health check.',
      agent:           { id: agent.id, displayName: agent.displayName, adapterId: agent.adapterId, status: agent.status },
    });
  }

  if (action === 'enable' && agent.status === 'inactive') {
    return res.status(403).json({
      error:           `Cannot activate inactive agent "${agent.displayName}" via the control center.`,
      governanceBlock: true,
      detail:          'Inactive agents must be configured and re-registered manually.',
    });
  }

  const state    = readJson(FILE, { overrides: {} });
  const now      = new Date().toISOString();
  const override = state.overrides[agentId] || {};

  switch (action) {
    case 'disable':
      state.overrides[agentId] = { ...override, disabled: true, disabledAt: now, disabledReason: reason || null };
      break;
    case 'enable':
      state.overrides[agentId] = { ...override, disabled: false, enabledAt: now };
      break;
    case 'maintenance-on':
      state.overrides[agentId] = { ...override, maintenance: true, maintenanceStartedAt: now, maintenanceReason: reason || 'Manual maintenance' };
      break;
    case 'maintenance-off':
      state.overrides[agentId] = { ...override, maintenance: false, maintenanceEndedAt: now };
      break;
  }

  state.updatedAt = now;
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2));

  return res.status(200).json({
    ok:       true,
    agentId,
    action,
    agent:    { id: agent.id, displayName: agent.displayName, status: agent.status },
    override: state.overrides[agentId],
  });
}
