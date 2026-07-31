// POST /api/openart/disconnect
// Clears the local OpenArt OAuth session (tokens + in-flight PKCE/state).
// The dynamic client registration is kept so reconnecting doesn't require
// re-registering a new OAuth client with OpenArt.

import { disconnectOpenArt } from '../../../lib/openart/openartMcpClient.js';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const result = disconnectOpenArt();
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
