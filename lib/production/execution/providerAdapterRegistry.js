// lib/production/execution/providerAdapterRegistry.js
// SERVER-SIDE ONLY.
//
// A dedicated Provider Execution Engine adapter registry — deliberately
// separate from lib/adapters/loadAdapter.js, which serves the agent
// dispatch engine (a different domain: routing tasks like "Research" or
// "Script Creation" to agents like Hermes/OpenClaw/Claude Code). Provider
// Execution Engine adapters implement a different contract entirely
// (submit/poll/cancel/normalizeResult against a Production Job), so they
// are registered here instead of overloading that registry.
//
// Six adapters are registered: manual-export (always executable),
// mock-video (executable only when explicitly enabled), heygen-mcp,
// higgsfield-mcp, and openart-video (all three MCP adapters executable
// only when OAuth-authenticated with all required live tools discovered —
// see each adapter's healthCheck()), and hyperframes (a LOCAL CLI adapter —
// executable when the CLI is runnable and at least one valid composition
// exists; no OAuth, no account, no billing — see
// hyperframes.adapter.js's healthCheck()). Every other Production Router
// provider catalog entry (higgsfield, heygen-api) has NO execution
// adapter — they remain staged/unavailable and are reported honestly via
// listProviderExecutionStatus(). Note "higgsfield" (the old, Direct-API-
// staged agent-domain entry) and "higgsfield-mcp" (the real adapter)
// coexist deliberately, exactly mirroring "heygen" vs "heygen-mcp". The
// standalone HyperFrames Studio flow (pages/api/hyperframes/**, provider:
// 'hyperframes-local' Production Jobs) is entirely separate and untouched —
// this registry entry is an ADDITIONAL governed entry point into the same
// underlying render engine, not a replacement.

import manualExportAdapter from './adapters/manualExport.adapter.js';
import mockVideoAdapter from './adapters/mockVideo.adapter.js';
import heygenMcpAdapter from './adapters/heygenMcp.adapter.js';
import higgsfieldMcpAdapter from './adapters/higgsfieldMcp.adapter.js';
import openartVideoMcpAdapter from './adapters/openartVideoMcp.adapter.js';
import hyperframesAdapter from './adapters/hyperframes.adapter.js';
import kieAdapter from './adapters/kie.adapter.js';
import { PROVIDER_CATALOG } from '../productionRules.js';

// "kie" is ONE provider, not one provider per model. Kie.ai is an aggregator
// fronting 100+ third-party models behind a single API key and task API; the
// model is selected inside the ProviderBinding (binding.model), exactly as with
// Higgsfield. Registering nano-banana and friends as separate providers would
// put model choice into the registry, where policy could no longer change it.
//
// Kie is deliberately absent from PROVIDER_CATALOG: that catalog drives
// Production Router's VIDEO planning recommendations, and Kie v1 generates
// still images only. It is an Asset Generation provider, so it is registered
// here (executable) and reported below (visible) without ever being offered as
// a video render recommendation.
const REGISTRY = {
  'manual-export': manualExportAdapter,
  'mock-video': mockVideoAdapter,
  'heygen-mcp': heygenMcpAdapter,
  'higgsfield-mcp': higgsfieldMcpAdapter,
  'openart-video': openartVideoMcpAdapter,
  'hyperframes': hyperframesAdapter,
  'kie': kieAdapter,
};

export function getExecutionAdapter(providerId) {
  return REGISTRY[providerId] || null;
}

export function isProviderKnown(providerId) {
  return Object.prototype.hasOwnProperty.call(REGISTRY, providerId);
}

export async function isProviderExecutable(providerId) {
  const adapter = REGISTRY[providerId];
  if (!adapter) return false;
  try {
    const health = await adapter.healthCheck();
    return health.ok === true;
  } catch {
    return false;
  }
}

/**
 * Sanitized, honest status for every provider in the Router's catalog, PLUS
 * mock-video — a real, registered execution adapter that intentionally has
 * no entry in Production Router's PROVIDER_CATALOG (it is execution-engine-
 * only, test/dev scope, never offered as a planning recommendation).
 * Used by GET /api/production/providers. Never exposes credentials.
 */
export async function listProviderExecutionStatus() {
  const entries = [];

  for (const provider of [...PROVIDER_CATALOG.filter(p => p.id !== 'heygen-mcp'), { id: 'mock-video' }, { id: 'kie' }, { id: 'heygen-mcp' }, { id: 'heygen-api' }]) {
    // heygen-api remains a Checkpoint-1-only reporting entry — deliberately
    // NOT registered in REGISTRY (getExecutionAdapter/isProviderKnown/
    // isProviderExecutable all correctly say "unknown"/"not executable"),
    // since Direct API execution is out of scope entirely (task instruction:
    // "Do not use the Direct API"). The OLD agent-domain
    // adapters/heygen.adapter.js (dispatch engine, a different system) never
    // determines this status either. heygen-mcp itself is now a REAL
    // registered adapter (see REGISTRY above) — its status/executable/
    // toolCount all fall through to the generic `adapter` branch below,
    // driven honestly by heygenMcp.adapter.js's healthCheck().
    if (provider.id === 'heygen-api') {
      entries.push({
        id: 'heygen-api',
        displayName: 'HeyGen (Direct API)',
        executable: false,
        status: 'staged',
        executionType: 'direct-api',
        billingPool: 'api-wallet',
        mock: false,
        toolCount: null,
        error: null,
        note: 'Future, separate adapter — not implemented.',
      });
      continue;
    }

    const adapter = REGISTRY[provider.id];

    if (adapter) {
      let health;
      try { health = await adapter.healthCheck(); }
      catch (e) { health = { ok: false, status: 'offline', error: e.message, latencyMs: null }; }
      entries.push({
        id: provider.id,
        displayName: adapter.displayName,
        executable: health.ok === true,
        status: health.ok ? 'active' : (health.status || 'staged'),
        executionType: adapter.executionType,
        billingPool: adapter.billingPool || null,
        mock: adapter.mock === true,
        toolCount: health.toolCount ?? null,
        // Reported only by adapters whose provider exposes a real account
        // balance endpoint; null everywhere else rather than zero.
        balance: health.balance ?? null,
        balanceCurrency: health.balanceCurrency ?? null,
        error: health.error || null,
      });
      continue;
    }

    entries.push({
      id: provider.id,
      displayName: provider.displayName,
      executable: false,
      status: provider.status,
      executionType: provider.executionType,
      mock: false,
      error: null,
      note: 'No execution adapter implemented yet — staged for a future milestone.',
    });
  }

  return entries;
}
