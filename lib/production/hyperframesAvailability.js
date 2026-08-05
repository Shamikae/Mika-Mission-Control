// lib/production/hyperframesAvailability.js
// SERVER-SIDE ONLY. Never import from client components.
//
// Resolves the live status of the "hyperframes" provider catalog entry for
// Production Router's own (coarse) recommendation vocabulary — mirrors
// lib/production/heygenMcpAvailability.js / higgsfieldMcpAvailability.js /
// openartVideoMcpAvailability.js in SHAPE only. Deliberately NOT named
// MCP-related — HyperFrames is a local CLI tool, not a remote MCP/OAuth
// provider, and "health" here means "is the CLI runnable and is at least
// one valid composition available," never an auth/connection state.
//
// Maps the Provider Execution Engine's finer execution-readiness status
// (see hyperframes.adapter.js's healthCheck()) down to Router's binary
// active/staged/unavailable vocabulary, so PROVIDER_CATALOG scoring/
// recommendation logic (lib/production/productionRules.js) never needs to
// know about execution-engine-specific states.

import hyperframesAdapter from './execution/adapters/hyperframes.adapter.js';

/**
 * @returns {Promise<{ status: 'active'|'staged'|'unavailable', reason: string, executionStatus: string }>}
 */
export async function resolveHyperFramesStatus() {
  const health = await hyperframesAdapter.healthCheck();

  if (health.status === 'active') {
    return {
      status: 'active',
      reason: `HyperFrames CLI is runnable (${health.cliVersion}) and ${health.compositionCount} valid composition(s) were found under tools/hyperframes/.`,
      executionStatus: health.status,
    };
  }

  if (health.status === 'disabled' || health.status === 'staged') {
    return { status: 'staged', reason: health.error || 'HyperFrames is not yet ready — see HyperFrames Setup.', executionStatus: health.status };
  }

  // unavailable / error — something is actually wrong, not just "not yet configured."
  return { status: 'unavailable', reason: health.error || 'HyperFrames is not currently usable.', executionStatus: health.status };
}
