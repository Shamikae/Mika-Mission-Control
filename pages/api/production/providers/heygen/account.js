// GET /api/production/providers/heygen/account
// Dynamically finds an account/profile/plan tool from the LIVE discovered
// HeyGen MCP tool list (never an assumed exact name) and calls it if
// present. Returns only sanitized plan/credit information — never the raw
// tool response, and never persists it. If no such tool exists, returns
// ok:true with accountSummary:null — the connection can still be healthy.

import { getHeyGenAccountSummary, buildHeyGenCallbackUrl } from '../../../../../lib/heygen/heygenMcpClient';

const STATUS_BY_CODE = {
  disabled:              503,
  authorization_required: 401,
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const redirectUrl = buildHeyGenCallbackUrl(req);
  const result = await getHeyGenAccountSummary(redirectUrl);

  if (!result.ok) {
    if (result.reason === 'no_account_tool') {
      return res.status(200).json({ ok: true, accountSummary: null, note: 'No account/profile tool was found in the discovered tool list.' });
    }
    const status = STATUS_BY_CODE[result.reason] || 502;
    return res.status(status).json({ ok: false, code: result.reason || 'account_failed', error: result.error || 'Could not retrieve account information.' });
  }

  return res.status(200).json({ ok: true, accountSummary: result.accountSummary });
}
