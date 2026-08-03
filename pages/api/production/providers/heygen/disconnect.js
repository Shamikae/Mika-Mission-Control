// POST /api/production/providers/heygen/disconnect
// Clears the local HeyGen OAuth session (tokens + in-flight PKCE/state).
// The dynamic client registration is kept so reconnecting doesn't require
// re-registering a new OAuth client with HeyGen. Never touches OpenArt's
// separate, isolated auth store. Admin-protected by middleware.js.

import { disconnectHeyGen } from '../../../../../lib/heygen/heygenMcpClient';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const result = disconnectHeyGen();
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
