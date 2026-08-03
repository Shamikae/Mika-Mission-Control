// GET /api/production/providers/heygen/avatars?search=
// Sanitized, briefly-cached avatar list for the HeyGen Setup UI. Read-only —
// never calls a generation tool. previewUrl values are for temporary UI
// display only; callers must never persist them into a Production Job.

import { listHeyGenAvatars } from '../../../../../lib/heygen/heygenMcpClient';

const STATUS_BY_CODE = { disabled: 503, authorization_required: 401 };

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const search = typeof req.query.search === 'string' ? req.query.search.slice(0, 100) : undefined;
  const redirectUrl = String(process.env.HEYGEN_MCP_OAUTH_REDIRECT_URL || '').trim() || undefined;

  try {
    const avatars = await listHeyGenAvatars({ redirectUrl, search });
    return res.status(200).json({ ok: true, avatars, count: avatars.length });
  } catch (e) {
    const status = STATUS_BY_CODE[e.code] || 502;
    return res.status(status).json({ ok: false, error: e.message, code: e.code || 'unknown_error' });
  }
}
