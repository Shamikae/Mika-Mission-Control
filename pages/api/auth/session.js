// pages/api/auth/session.js
// The missing half of the EXISTING auth model — not a second one.
//
// middleware.js already accepts three credential carriers: the
// `x-mika-admin-token` header, an `Authorization: Bearer` header, and the
// `mika_admin_token` cookie. The header paths work (that is why terminal curl
// succeeds), but nothing ever set the cookie, so every mutation issued by the
// browser UI was rejected with 401 before reaching its route.
//
// This route establishes that cookie and nothing else. It introduces no new
// token, no new secret, and no parallel session store — the same
// MIKA_ADMIN_TOKEN remains the single source of truth.
//
// ── Why a cookie rather than sending the header from the client ──────────
// MIKA_ADMIN_TOKEN is a server secret. Exposing it to client JavaScript (via
// NEXT_PUBLIC_*, localStorage, or an inlined constant) so that fetch could
// attach a header would put the admin credential in the bundle and in reach of
// any XSS. An HttpOnly cookie is never readable by JavaScript, so the browser
// can authenticate without the page ever holding the secret.
//
//   GET    -> { authenticated }        never returns the token
//   POST   -> { token } establishes the session cookie
//   DELETE -> clears it (sign out)

import crypto from 'crypto';

export const SESSION_COOKIE = 'mika_admin_token';

// Brute-force damping. This route is deliberately exempt from the middleware
// token check (it is how a session is obtained), so it is the one endpoint an
// unauthenticated caller can reach — it must not become an oracle.
const ATTEMPT_WINDOW_MS = 60_000;
const MAX_ATTEMPTS_PER_WINDOW = 10;
const attempts = new Map(); // ip -> { count, windowStart }

function tooManyAttempts(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now - entry.windowStart > ATTEMPT_WINDOW_MS) {
    attempts.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS_PER_WINDOW;
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  // timingSafeEqual requires equal lengths, so compare a fixed-size digest of
  // each value instead — length itself then leaks nothing.
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function cookieAttributes() {
  const isProd = process.env.NODE_ENV === 'production';
  return [
    'Path=/',
    'HttpOnly',            // unreadable from JavaScript
    'SameSite=Strict',     // CSRF defence, alongside middleware's origin check
    ...(isProd ? ['Secure'] : []), // localhost dev is plain HTTP
    'Max-Age=604800',      // 7 days
  ].join('; ');
}

export const config = { api: { bodyParser: { sizeLimit: '2kb' } } };

export default function handler(req, res) {
  const configuredToken = String(process.env.MIKA_ADMIN_TOKEN || '').trim();

  if (req.method === 'GET') {
    // Reports only whether this browser is authenticated. Never the token.
    const cookie = req.cookies?.[SESSION_COOKIE] || '';
    const authenticated = !!configuredToken && !!cookie && constantTimeEqual(cookie, configuredToken);
    return res.status(200).json({
      ok: true,
      authenticated,
      tokenConfigured: !!configuredToken,
      // Lets the UI explain the "no token configured" case honestly rather
      // than showing a sign-in prompt that cannot succeed.
      reason: !configuredToken
        ? 'MIKA_ADMIN_TOKEN is not configured — mutation APIs are locked.'
        : authenticated ? null : 'No valid admin session in this browser.',
    });
  }

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    return res.status(200).json({ ok: true, authenticated: false });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  if (!configuredToken) {
    return res.status(503).json({
      ok: false,
      code: 'admin_token_not_configured',
      error: 'MIKA_ADMIN_TOKEN is not configured on the server.',
    });
  }

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'local').split(',')[0].trim();
  if (tooManyAttempts(ip)) {
    return res.status(429).json({ ok: false, code: 'too_many_attempts', error: 'Too many sign-in attempts. Wait a minute and try again.' });
  }

  const submitted = String(req.body?.token || '').trim();
  if (!submitted || !constantTimeEqual(submitted, configuredToken)) {
    // Deliberately identical response for "empty" and "wrong" — no oracle.
    return res.status(401).json({ ok: false, code: 'invalid_token', error: 'That admin token is not valid.' });
  }

  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(configuredToken)}; ${cookieAttributes()}`);
  // The token is never echoed back.
  return res.status(200).json({ ok: true, authenticated: true });
}
