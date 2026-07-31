// GET /api/openart/status
// Returns non-secret OpenArt MCP connection status. Never includes tokens,
// client secrets, or registration secrets — see lib/openart/openartMcpClient.js.

import { getOpenArtConnectionStatus } from '../../../lib/openart/openartMcpClient.js';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    return res.status(200).json({ ok: true, ...getOpenArtConnectionStatus() });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
