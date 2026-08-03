// GET /api/production/providers/heygen/status
// Returns non-secret HeyGen MCP connection status. Never includes tokens,
// client secrets, registration secrets, or the raw account tool response —
// see lib/heygen/heygenMcpClient.js.

import { getHeyGenConnectionStatus, getHeyGenAccountSummary, buildHeyGenCallbackUrl } from '../../../../../lib/heygen/heygenMcpClient';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const status = getHeyGenConnectionStatus();

    let accountSummary = null;
    if (status.status === 'connected') {
      const redirectUrl = buildHeyGenCallbackUrl(req);
      const result = await getHeyGenAccountSummary(redirectUrl).catch(() => null);
      accountSummary = result?.ok ? result.accountSummary : null;
    }

    return res.status(200).json({ ok: true, ...status, accountSummary });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
