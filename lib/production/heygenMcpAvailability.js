// lib/production/heygenMcpAvailability.js
// SERVER-SIDE ONLY. Never import from client components.
//
// Resolves the live status of the "heygen-mcp" provider catalog entry for
// Production Router's own (coarse) recommendation vocabulary — mirrors
// lib/production/openartVideoAvailability.js exactly. Never executes
// generation. Maps the Provider Execution Engine's finer six-value
// execution-readiness status (see checkHeyGenMcpHealth() in
// lib/heygen/heygenMcpClient.js) down to Router's binary
// active/staged/unavailable vocabulary, so PROVIDER_CATALOG scoring/
// recommendation logic (lib/production/productionRules.js) never needs to
// know about execution-engine-specific states.

import { checkHeyGenMcpHealth } from '../heygen/heygenMcpClient.js';

/**
 * @returns {Promise<{ status: 'active'|'staged'|'unavailable', reason: string, executionStatus: string }>}
 */
export async function resolveHeyGenMcpStatus() {
  const health = await checkHeyGenMcpHealth();

  if (health.status === 'active') {
    return { status: 'active', reason: `HeyGen MCP is connected and ${health.toolCount} tools were discovered, including the required generation/status tools.`, executionStatus: health.status };
  }

  if (health.status === 'disabled' || health.status === 'authentication_required') {
    return { status: 'staged', reason: health.error || 'HeyGen MCP is not yet connected — see the HeyGen Setup panel.', executionStatus: health.status };
  }

  // tooling_incomplete / auth_failed / unavailable — something is actually wrong,
  // not just "not yet configured."
  return { status: 'unavailable', reason: health.error || 'HeyGen MCP is not currently usable.', executionStatus: health.status };
}
