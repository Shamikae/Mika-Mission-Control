// GET /api/openart/tools
// Authenticates against OpenArt's MCP server and calls listTools(), returning
// only sanitized tool metadata (name, description, input schema). Fails with
// a clear, typed error instead of silently falling back when OpenArt is
// disabled or not yet authenticated.

import { listOpenArtTools, buildOpenArtCallbackUrl } from '../../../lib/openart/openartMcpClient.js';

const STATUS_BY_CODE = {
  disabled:                503,
  authentication_required: 401,
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const redirectUrl = buildOpenArtCallbackUrl(req);

  try {
    const tools = await listOpenArtTools(redirectUrl);
    return res.status(200).json({ ok: true, tools, count: tools.length });
  } catch (e) {
    const status = STATUS_BY_CODE[e.code] || 502;
    return res.status(status).json({ ok: false, code: e.code || 'tools_failed', error: e.message });
  }
}
