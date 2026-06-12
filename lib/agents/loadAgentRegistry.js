// lib/agents/loadAgentRegistry.js
// Loads the modular agent registry from /agents/agent-registry.json.
// This is the single source of truth for agent metadata outside of openclaw.config.js.
// openclaw.config.js owns runtime connection settings; this file owns workforce identity/display data.

import path from 'path';
import fs from 'fs';

const REGISTRY_PATH = path.join(process.cwd(), 'agents', 'agent-registry.json');

let _cache = null;

export function loadAgentRegistry() {
  if (_cache) return _cache;
  try {
    const raw = fs.readFileSync(REGISTRY_PATH, 'utf-8');
    _cache = JSON.parse(raw);
    return _cache;
  } catch {
    return [];
  }
}

export function getAgentById(id) {
  return loadAgentRegistry().find((a) => a.id === id) || null;
}

export function getAgentsByDepartment(department) {
  return loadAgentRegistry().filter((a) => a.department === department);
}

export function getActiveAgents() {
  return loadAgentRegistry().filter((a) => a.status === 'active');
}

export function getLiveAgents() {
  return loadAgentRegistry().filter((a) => a.liveConnected === true);
}

// Merge registry metadata with a runtime agent config entry from openclaw.config.js.
// Registry fields (displayName, department, role, etc.) take precedence for UI.
// Config fields (systemType, systemConfig, capabilities) take precedence for runtime.
export function mergeWithConfig(configAgent) {
  const reg = getAgentById(configAgent.id);
  if (!reg) return configAgent;
  return {
    ...configAgent,
    ...reg,
    // Runtime fields always win
    systemType:   configAgent.systemType,
    systemId:     configAgent.systemId,
    systemConfig: configAgent.systemConfig,
    capabilities: configAgent.capabilities,
  };
}
