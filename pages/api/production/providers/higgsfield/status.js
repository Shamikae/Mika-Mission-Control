// GET /api/production/providers/higgsfield/status
// Returns non-secret Higgsfield MCP connection status. Never includes
// tokens, client secrets, registration secrets, or the raw account tool
// response — see lib/higgsfield/higgsfieldMcpClient.js.

import { getHiggsfieldConnectionStatus, getHiggsfieldAccountSummary, buildHiggsfieldCallbackUrl } from '../../../../../lib/higgsfield/higgsfieldMcpClient';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const status = getHiggsfieldConnectionStatus();

    let accountSummary = null;
    if (status.status === 'connected') {
      const redirectUrl = buildHiggsfieldCallbackUrl(req);
      const result = await getHiggsfieldAccountSummary(redirectUrl).catch(() => null);
      accountSummary = result?.ok ? result.accountSummary : null;
    }

    return res.status(200).json({ ok: true, ...status, accountSummary });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
