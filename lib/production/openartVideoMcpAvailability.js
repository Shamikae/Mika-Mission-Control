// lib/production/openartVideoMcpAvailability.js
// SERVER-SIDE ONLY. Never import from client components.
//
// Resolves the live status of the "openart-video" provider catalog entry
// for Production Router's own (coarse) recommendation vocabulary — mirrors
// lib/production/higgsfieldMcpAvailability.js exactly. Never executes
// generation. Maps the Provider Execution Engine's finer execution-
// readiness status (see openartVideoMcp.adapter.js's healthCheck(), which
// includes both the MCP connection status AND the required-tools check)
// down to Router's binary active/staged/unavailable vocabulary, so
// PROVIDER_CATALOG scoring/recommendation logic
// (lib/production/productionRules.js) never needs to know about execution-
// engine-specific states.
//
// Supersedes the old lib/production/openartVideoAvailability.js, which
// used a broad /video/i regex over ALL discovered tool names/descriptions
// to guess whether video generation existed at all. That guess is no
// longer needed — a real adapter with real required-tool names now exists.

import openartVideoMcpAdapter from './execution/adapters/openartVideoMcp.adapter.js';

/**
 * @returns {Promise<{ status: 'active'|'staged'|'unavailable', reason: string, executionStatus: string }>}
 */
export async function resolveOpenArtVideoMcpStatus() {
  const health = await openartVideoMcpAdapter.healthCheck();

  if (health.status === 'active') {
    return { status: 'active', reason: `OpenArt MCP is connected and ${health.toolCount} tools were discovered, including the required video generation/status tools.`, executionStatus: health.status };
  }

  if (health.status === 'staged' || health.status === 'authentication_required') {
    return { status: 'staged', reason: health.error || 'OpenArt is not yet connected — see the OpenArt Connection panel.', executionStatus: health.status };
  }

  // tooling_incomplete / offline / unavailable — something is actually
  // wrong, not just "not yet configured."
  return { status: 'unavailable', reason: health.error || 'OpenArt Video is not currently usable.', executionStatus: health.status };
}
