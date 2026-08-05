// lib/production/higgsfieldMcpAvailability.js
// SERVER-SIDE ONLY. Never import from client components.
//
// Resolves the live status of the "higgsfield-mcp" provider catalog entry
// for Production Router's own (coarse) recommendation vocabulary — mirrors
// lib/production/heygenMcpAvailability.js exactly. Never executes
// generation. Maps the Provider Execution Engine's finer execution-
// readiness status (see higgsfieldMcp.adapter.js's healthCheck(), which
// includes both the MCP connection status AND the required-tools check)
// down to Router's binary active/staged/unavailable vocabulary, so
// PROVIDER_CATALOG scoring/recommendation logic
// (lib/production/productionRules.js) never needs to know about execution-
// engine-specific states.

import higgsfieldMcpAdapter from './execution/adapters/higgsfieldMcp.adapter.js';

/**
 * @returns {Promise<{ status: 'active'|'staged'|'unavailable', reason: string, executionStatus: string }>}
 */
export async function resolveHiggsfieldMcpStatus() {
  const health = await higgsfieldMcpAdapter.healthCheck();

  if (health.status === 'active') {
    return { status: 'active', reason: `Higgsfield MCP is connected and ${health.toolCount} tools were discovered, including the required generation/status tools.`, executionStatus: health.status };
  }

  if (health.status === 'disabled' || health.status === 'authentication_required') {
    return { status: 'staged', reason: health.error || 'Higgsfield MCP is not yet connected — see the Higgsfield Setup panel.', executionStatus: health.status };
  }

  // tooling_incomplete / auth_failed / unavailable — something is actually
  // wrong, not just "not yet configured."
  return { status: 'unavailable', reason: health.error || 'Higgsfield MCP is not currently usable.', executionStatus: health.status };
}
