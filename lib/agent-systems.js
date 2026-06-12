// lib/agent-systems.js
// ─────────────────────────────────────────────────────────────────────
// System-type abstraction layer.
// Each exported function accepts an agent definition (from config)
// and resolves the correct HTTP call for that agent's systemType.
// ─────────────────────────────────────────────────────────────────────

import config from './config';

const MOCK_MODE = !config.gateway?.vpsUrl ||
                  (config.gateway?.vpsUrl || '').includes('YOUR_VPS_IP');

// ── System resolver ────────────────────────────────────────────────

function resolveSystem(agentDef) {
  const systemType = agentDef.systemType || 'openclaw';
  const base = config.agentSystems?.[systemType] || {};
  return { systemType, ...base, ...(agentDef.systemConfig || {}) };
}

function buildUrl(agentDef, action) {
  const system = resolveSystem(agentDef);
  const endpoint = system.controlEndpoints?.[action];
  if (!endpoint) throw new Error(`No ${action} endpoint configured for ${system.systemType}`);

  const [, endpointPath = ''] = endpoint.trim().split(/\s+/, 2);
  const systemId = agentDef.systemId || agentDef.id;
  const urlPath = endpointPath.replaceAll(':id', encodeURIComponent(systemId));
  return `${system.baseUrl || ''}${urlPath}`;
}

async function agentFetch(agentDef, action, method = 'GET', body = null) {
  if (MOCK_MODE) return null; // caller handles mock path
  const sys = resolveSystem(agentDef);
  const url = buildUrl(agentDef, action);
  const endpointMethod = sys.controlEndpoints?.[action]?.trim().split(/\s+/, 1)[0];
  const opts = {
    method: endpointMethod || method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (sys.auth?.type === 'bearer')  opts.headers['Authorization'] = `Bearer ${sys.auth.token}`;
  if (sys.auth?.type === 'api-key') opts.headers[sys.auth.header || 'X-API-Key'] = sys.auth.token;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`Agent ${agentDef.id} → ${action}: HTTP ${res.status}`);
  return res.json();
}

// ── Public API ─────────────────────────────────────────────────────

export async function agentGetStatus(agentDef) {
  if (MOCK_MODE) return { id: agentDef.id, status: 'unknown', configured: false, source: 'unavailable' };
  return agentFetch(agentDef, 'status');
}

export async function agentStart(agentDef) {
  if (MOCK_MODE) return { success: false, status: 'unavailable', error: 'Agent control is not connected.' };
  return agentFetch(agentDef, 'start', 'POST');
}

export async function agentStop(agentDef) {
  if (MOCK_MODE) return { success: false, status: 'unavailable', error: 'Agent control is not connected.' };
  return agentFetch(agentDef, 'stop', 'POST');
}

export async function agentRestart(agentDef) {
  if (MOCK_MODE) return { success: false, status: 'unavailable', error: 'Agent control is not connected.' };
  return agentFetch(agentDef, 'restart', 'POST');
}

export async function agentPause(agentDef) {
  if (MOCK_MODE) return { success: false, status: 'unavailable', error: 'Agent control is not connected.' };
  return agentFetch(agentDef, 'pause', 'POST');
}

export async function agentResume(agentDef) {
  if (MOCK_MODE) return { success: false, status: 'unavailable', error: 'Agent control is not connected.' };
  return agentFetch(agentDef, 'resume', 'POST');
}

export async function agentDispatch(agentDef, task) {
  // task: { capability, input, priority, requireApproval }
  if (MOCK_MODE) {
    return {
      success: false,
      status: 'unavailable',
      agentId: agentDef.id,
      error: 'Agent dispatch is not connected.',
    };
  }
  return agentFetch(agentDef, 'dispatch', 'POST', task);
}

export async function agentGetLogs(agentDef, limit = 50) {
  if (MOCK_MODE) return [];
  return agentFetch(agentDef, 'logs');
}

export async function agentGetMemory(agentDef) {
  if (MOCK_MODE) return [];
  return agentFetch(agentDef, 'memory');
}

export async function agentGetConfig(agentDef) {
  if (MOCK_MODE) return {
    model:       agentDef.model,
    schedule:    agentDef.schedule,
    memory:      agentDef.memory,
    systemType:  agentDef.systemType,
    systemId:    agentDef.systemId,
    capabilities:agentDef.capabilities,
  };
  return agentFetch(agentDef, 'config');
}

export async function agentSetConfig(agentDef, patch) {
  if (MOCK_MODE) return { success: false, error: 'Agent configuration is not connected.' };
  return agentFetch(agentDef, 'setConfig', 'PUT', patch);
}

// ── System connection test ─────────────────────────────────────────
export async function testSystemConnection(agentDef) {
  if (MOCK_MODE) {
    return {
      reachable: false,
      latencyMs: null,
      systemType: agentDef.systemType,
      error: 'Agent system connection is not configured.',
    };
  }
  try {
    const start = Date.now();
    await agentFetch(agentDef, 'status');
    return { reachable: true, latencyMs: Date.now() - start, systemType: agentDef.systemType };
  } catch (e) {
    return { reachable: false, latencyMs: null, systemType: agentDef.systemType, error: e.message };
  }
}
