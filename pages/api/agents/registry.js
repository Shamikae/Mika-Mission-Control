// pages/api/agents/registry.js
// Serves the complete workforce list: live agents from config + staged agents from registry.
// Department / role / execution metadata lives here; runtime connection config stays in openclaw.config.js.

import { loadAgentRegistry } from '../../../lib/agents/loadAgentRegistry';
import { resolveAgentRuntimeHealth } from '../../../lib/agents/resolveRuntimeHealth';
import { loadAdapterHealth } from '../../../lib/adapters/adapterHealth';
import { listAdapters } from '../../../lib/adapters/loadAdapter';
import config from '../../../lib/config';

const DEPARTMENT = {
  openclaw:  'OPERATIONS',
  sentinel:  'OPERATIONS',
  hermes:    'OPERATIONS',
  diamond:   'SALES',
  recovery:  'SALES',
  mika:      'CLIENT OPS',
  medbot:    'CLIENT OPS',
  cannabot:  'CLIENT OPS',
  hookr:     'CONTENT',
  twin:      'CONTENT',
};

const ROLE = {
  openclaw:  'Master Orchestrator',
  sentinel:  'System Watchdog',
  hermes:    'Research + Kanban Worker',
  diamond:   'AI Consulting Agent',
  recovery:  'Lead Recovery Specialist',
  mika:      'Property Management AI',
  medbot:    'Medical Reception AI',
  cannabot:  'Cannabis Operations AI',
  hookr:     'Content Creator AI',
  twin:      'Personal Brand AI',
};

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const registry = loadAgentRegistry();
  const healthStore = loadAdapterHealth();
  const adapters = listAdapters();
  const adapterMap = Object.fromEntries(adapters.map(adapter => [adapter.adapterId, adapter]));
  const registryMap = Object.fromEntries(registry.map(agent => [agent.id, agent]));
  const configIds = new Set(config.agents.map(a => a.id));

  // Configured agents retain declared registry metadata. Runtime state is
  // derived only from fresh adapter health evidence.
  const configuredAgents = config.agents.map(a => {
    const declared = registryMap[a.id] || {
      id: a.id,
      displayName: a.label,
      department: DEPARTMENT[a.id] || 'OPERATIONS',
      role: ROLE[a.id] || (a.description ? a.description.split('—')[0].trim() : 'AI Agent'),
      avatarType: a.id,
      executionMode: a.systemType,
      allowedTaskTypes: a.capabilities || [],
      requiresApproval: false,
      status: 'configured',
      adapterId: a.id,
      description: a.description || '',
    };
    const adapter = adapterMap[declared.adapterId];
    const runtime = resolveAgentRuntimeHealth({
      agent: declared,
      adapter,
      evidence: healthStore.adapters?.[declared.adapterId] || null,
    });

    return {
      ...declared,
      displayName: declared.displayName || a.label,
      department: declared.department || DEPARTMENT[a.id] || 'OPERATIONS',
      role: declared.role || ROLE[a.id] || 'AI Agent',
      executionMode: declared.executionMode || a.systemType,
      allowedTaskTypes: declared.allowedTaskTypes || a.capabilities || [],
      model: a.model || null,
      project: a.project || null,
      description: declared.description || a.description || '',
      schedule: a.schedule || null,
      ...runtime,
    };
  });

  const registryOnlyAgents = registry
    .filter(r => !configIds.has(r.id))
    .map(agent => ({
      ...agent,
      model: null,
      project: null,
      schedule: null,
      ...resolveAgentRuntimeHealth({
        agent,
        adapter: adapterMap[agent.adapterId] || null,
        evidence: healthStore.adapters?.[agent.adapterId] || null,
      }),
    }));

  res.status(200).json([...configuredAgents, ...registryOnlyAgents]);
}
