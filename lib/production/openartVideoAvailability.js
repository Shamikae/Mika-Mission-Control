// lib/production/openartVideoAvailability.js
// SERVER-SIDE ONLY. Never import from client components.
//
// Resolves the live status of the "openart-video" provider catalog entry.
// Never executes generation — only checks whether the existing, unmodified
// OpenArt MCP OAuth session is healthy AND whether a video-capable tool is
// currently discoverable via listTools(). As of the current OpenArt MCP
// integration (Checkpoint 2 — text2image only), no such tool exists, so this
// honestly resolves to 'unavailable' rather than fabricating availability.

import { checkOpenArtHealth, listOpenArtTools } from '../openart/openartMcpClient.js';

const VIDEO_TOOL_PATTERN = /video/i;

/**
 * @returns {Promise<{ status: 'active'|'unavailable', reason: string }>}
 */
export async function resolveOpenArtVideoStatus() {
  const health = await checkOpenArtHealth();
  if (health.status !== 'active') {
    return {
      status: 'unavailable',
      reason: `OpenArt MCP is not active (status: ${health.status}) — ${health.error || 'connect and authenticate first.'}`,
    };
  }

  try {
    const tools = await listOpenArtTools();
    const videoTool = tools.find(t => VIDEO_TOOL_PATTERN.test(t.name) || VIDEO_TOOL_PATTERN.test(t.description || ''));
    if (videoTool) {
      return { status: 'active', reason: `Video-capable MCP tool discovered: "${videoTool.name}".` };
    }
    return {
      status: 'unavailable',
      reason: `OpenArt MCP is authenticated, but no video-capable tool was found among ${tools.length} discovered tools.`,
    };
  } catch (e) {
    return { status: 'unavailable', reason: `Tool discovery failed: ${e.message}` };
  }
}
