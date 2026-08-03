// GET /api/production/providers/heygen/callback
// OAuth redirect target for HeyGen's authorization server. Validates the
// returned `state` against the value persisted at connect-time (one-time-use
// CSRF protection with expiry), exchanges the authorization code for
// tokens, then verifies the session by calling listTools() before ever
// reporting "connected". Never places tokens in the redirect URL.
//
// This route is reached by the user's browser directly from HeyGen, so it
// cannot carry a Mika admin token — the state check is what protects it.

import {
  completeHeyGenAuthorization, buildHeyGenCallbackUrl, listHeyGenTools, classifyHeyGenAuthError,
} from '../../../../../lib/heygen/heygenMcpClient';

function redirectWithStatus(res, status, reason) {
  const params = new URLSearchParams({ heygen_oauth: status });
  if (reason) params.set('reason', String(reason).slice(0, 200));
  res.writeHead(302, { Location: `/?${params.toString()}` });
  res.end();
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).end();
  }

  const { code, state, error, error_description: errorDescription } = req.query;

  if (error) {
    const classified = classifyHeyGenAuthError(String(error), errorDescription ? String(errorDescription) : '');
    return redirectWithStatus(res, classified === 'domain_not_whitelisted' ? 'domain_not_whitelisted' : 'error', String(errorDescription || error));
  }

  const redirectUrl = buildHeyGenCallbackUrl(req);

  try {
    await completeHeyGenAuthorization({
      redirectUrl,
      code:  typeof code  === 'string' ? code  : undefined,
      state: typeof state === 'string' ? state : undefined,
    });
  } catch (e) {
    return redirectWithStatus(res, e.code === 'domain_not_whitelisted' ? 'domain_not_whitelisted' : 'error', e.message);
  }

  // Verify the session actually works before ever reporting "connected".
  try {
    await listHeyGenTools(redirectUrl);
  } catch (e) {
    return redirectWithStatus(res, 'error', `Authorized, but tool discovery failed: ${e.message}`);
  }

  return redirectWithStatus(res, 'connected');
}
