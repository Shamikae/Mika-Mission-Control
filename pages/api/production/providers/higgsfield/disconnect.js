// POST /api/production/providers/higgsfield/disconnect
// Clears the local Higgsfield OAuth session (tokens + in-flight PKCE/state).
// The dynamic client registration is kept so reconnecting doesn't require
// re-registering a new OAuth client with Higgsfield. Never touches the
// separate, isolated HeyGen/OpenArt auth stores. Admin-protected by
// middleware.js.

import { disconnectHiggsfield } from '../../../../../lib/higgsfield/higgsfieldMcpClient';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const result = disconnectHiggsfield();
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
