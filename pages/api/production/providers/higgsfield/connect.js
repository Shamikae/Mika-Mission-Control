// POST /api/production/providers/higgsfield/connect
// Begins the Higgsfield MCP OAuth flow: performs (or reuses) dynamic client
// registration and PKCE setup, then returns the provider authorization URL
// for the caller to send the user's browser to. Never returns tokens or
// client secrets. Admin-protected automatically by middleware.js (applies
// to every non-GET/HEAD/OPTIONS /api/* route).

import { beginHiggsfieldAuthorization, buildHiggsfieldCallbackUrl } from '../../../../../lib/higgsfield/higgsfieldMcpClient';

const STATUS_BY_CODE = {
  disabled:         503,
  invalid_redirect: 400,
  registration_failed: 502,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const redirectUrl = buildHiggsfieldCallbackUrl(req);

  try {
    const result = await beginHiggsfieldAuthorization(redirectUrl);
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    const status = STATUS_BY_CODE[e.code] || 502;
    return res.status(status).json({ ok: false, code: e.code || 'connect_failed', error: e.message });
  }
}
