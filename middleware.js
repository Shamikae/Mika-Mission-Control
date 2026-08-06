import { NextResponse } from 'next/server';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const TOKEN_COOKIE = 'mika_admin_token';
const GUARDED_READ_PATHS = new Set([
  '/api/activation/preflight',
  '/api/adapters/status',
]);

// The session route is how a browser OBTAINS the credential this middleware
// checks, so it cannot itself require that credential — that is the only
// reason it is exempt. Everything else still applies to it: origin validation
// below runs first, and the route performs its own constant-time token
// comparison plus per-IP attempt throttling.
const AUTH_SESSION_PATH = '/api/auth/session';

function isAuthSessionRoute(request) {
  return request.nextUrl.pathname === AUTH_SESSION_PATH;
}

function isGuardedRead(request) {
  return GUARDED_READ_PATHS.has(request.nextUrl.pathname)
    || request.nextUrl.pathname.startsWith('/api/paperclip/');
}

function parseAllowedOrigins(request) {
  const configured = String(process.env.MIKA_ALLOWED_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);

  return new Set([request.nextUrl.origin, ...configured]);
}

function constantTimeEqual(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  const length = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;

  for (let index = 0; index < length; index += 1) {
    mismatch |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }

  return mismatch === 0;
}

function requestToken(request) {
  const authorization = request.headers.get('authorization') || '';
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  return request.headers.get('x-mika-admin-token')
    || bearer
    || request.cookies.get(TOKEN_COOKIE)?.value
    || '';
}

function jsonError(status, code, message) {
  return NextResponse.json({ ok: false, code, error: message }, { status });
}

export function middleware(request) {
  const guardedRead = SAFE_METHODS.has(request.method) && isGuardedRead(request);
  if (SAFE_METHODS.has(request.method) && !guardedRead) {
    return NextResponse.next();
  }

  const allowedOrigins = parseAllowedOrigins(request);
  const origin = request.headers.get('origin');

  if (origin && !allowedOrigins.has(origin)) {
    return jsonError(403, 'origin_rejected', 'Request origin is not allowed.');
  }

  // Origin validation above has already run. Sign-in/sign-out is allowed
  // through the token gate — and only the token gate — because it is the
  // endpoint that issues the token cookie.
  if (isAuthSessionRoute(request)) {
    return NextResponse.next();
  }

  const configuredToken = String(process.env.MIKA_ADMIN_TOKEN || '').trim();
  if (configuredToken) {
    if (!constantTimeEqual(requestToken(request), configuredToken)) {
      return jsonError(401, 'authentication_required', 'A valid Mika admin token is required.');
    }
    return NextResponse.next();
  }

  const hostname = request.nextUrl.hostname;
  const localHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  const sameOrigin = origin && allowedOrigins.has(origin);

  if (process.env.NODE_ENV !== 'production' && localHost && (sameOrigin || guardedRead)) {
    return NextResponse.next();
  }

  return jsonError(
    503,
    'admin_token_not_configured',
    'Mutation APIs are locked until MIKA_ADMIN_TOKEN is configured.',
  );
}

export const config = {
  matcher: '/api/:path*',
};
