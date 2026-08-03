// GET /api/production/providers/heygen/generation-schema
// Sanitized, relevant-only fields from the live "create_video_from_avatar"
// MCP tool schema, plus honest capability flags (cancellation support,
// provisional cost estimate) the HeyGen Setup UI needs before building a
// submission. Read-only — never calls a generation tool.

import { getHeyGenGenerationSchema } from '../../../../../lib/heygen/heygenMcpClient';
import heygenMcpAdapter from '../../../../../lib/production/execution/adapters/heygenMcp.adapter';

const STATUS_BY_CODE = { disabled: 503, authorization_required: 401 };

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const redirectUrl = String(process.env.HEYGEN_MCP_OAUTH_REDIRECT_URL || '').trim() || undefined;

  try {
    const schema = await getHeyGenGenerationSchema(redirectUrl);
    if (!schema) {
      return res.status(503).json({ ok: false, error: 'HeyGen\'s "create_video_from_avatar" tool is not currently discoverable.', code: 'tooling_incomplete' });
    }
    return res.status(200).json({
      ok: true,
      schema,
      cancellationSupported: false,
      cancellationNote: 'HeyGen has no cancellation tool for a create_video_from_avatar render — only a destructive delete_video (removes the video record) and a create_video_agent-only session-stop tool, neither of which applies here.',
      estimate: heygenMcpAdapter.estimate(),
    });
  } catch (e) {
    const status = STATUS_BY_CODE[e.code] || 502;
    return res.status(status).json({ ok: false, error: e.message, code: e.code || 'unknown_error' });
  }
}
