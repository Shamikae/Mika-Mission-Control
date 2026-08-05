// GET /api/production/providers/higgsfield/tools
// Authenticates against Higgsfield's MCP server and calls listTools(),
// returning only sanitized tool metadata (name, description, input
// schema). Fails with a clear, typed error instead of silently falling
// back when Higgsfield is disabled or not yet authenticated. This list is
// the source of truth for what Checkpoint 2 may implement — nothing here
// is hard-coded.

import { listHiggsfieldTools, buildHiggsfieldCallbackUrl } from '../../../../../lib/higgsfield/higgsfieldMcpClient';

const STATUS_BY_CODE = {
  disabled:              503,
  authorization_required: 401,
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const redirectUrl = buildHiggsfieldCallbackUrl(req);

  try {
    const tools = await listHiggsfieldTools(redirectUrl);
    return res.status(200).json({ ok: true, tools, count: tools.length });
  } catch (e) {
    const status = STATUS_BY_CODE[e.code] || 502;
    return res.status(status).json({ ok: false, code: e.code || 'tools_failed', error: e.message });
  }
}
