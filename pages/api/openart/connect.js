// POST /api/openart/connect
// Begins the OpenArt MCP OAuth flow: performs (or reuses) dynamic client
// registration and PKCE setup, then returns the provider authorization URL
// for the caller to send the user's browser to. Never returns tokens or
// client secrets.

import { beginOpenArtAuthorization, buildOpenArtCallbackUrl } from '../../../lib/openart/openartMcpClient.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const redirectUrl = buildOpenArtCallbackUrl(req);

  try {
    const result = await beginOpenArtAuthorization(redirectUrl);
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    const status = e.code === 'disabled' ? 503 : 502;
    return res.status(status).json({ ok: false, code: e.code || 'connect_failed', error: e.message });
  }
}
