// GET /api/openart/callback
// OAuth redirect target for the OpenArt authorization server. Validates the
// returned `state` against the value persisted at connect-time (CSRF
// protection) before exchanging the authorization code for tokens.
//
// This route is reached by the user's browser directly from OpenArt, so it
// cannot carry a Mika admin token — the state check is what protects it.

import { completeOpenArtAuthorization, buildOpenArtCallbackUrl } from '../../../lib/openart/openartMcpClient.js';

function redirectWithStatus(res, status, reason) {
  const params = new URLSearchParams({ openart_oauth: status });
  if (reason) params.set('reason', reason.slice(0, 200));
  res.writeHead(302, { Location: `/?${params.toString()}` });
  res.end();
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).end();
  }

  const { code, state, error, error_description: errorDescription } = req.query;

  if (error) {
    return redirectWithStatus(res, 'error', String(errorDescription || error));
  }

  const redirectUrl = buildOpenArtCallbackUrl(req);

  try {
    await completeOpenArtAuthorization({
      redirectUrl,
      code:  typeof code  === 'string' ? code  : undefined,
      state: typeof state === 'string' ? state : undefined,
    });
    return redirectWithStatus(res, 'connected');
  } catch (e) {
    return redirectWithStatus(res, 'error', e.message);
  }
}
