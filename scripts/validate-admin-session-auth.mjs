#!/usr/bin/env node
// scripts/validate-admin-session-auth.mjs
//
// Executable validation for browser mutation auth and first-run config docs.
// Runs against the REAL dev server — the failure this fixes was only
// observable over real HTTP, so it is tested over real HTTP.
//
// Run: node scripts/validate-admin-session-auth.mjs

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const BASE = 'http://localhost:3099';
const ORIGIN = { Origin: BASE, Referer: `${BASE}/` };

const results = [];
function check(n, c, d = '') { results.push({ n, ok: !!c, d }); console.log(`${c ? 'PASS' : 'FAIL'} — ${n}${d && !c ? ` (${d})` : ''}`); }
function section(t) { console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 52 - t.length))}`); }

function readToken() {
  try {
    const m = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').match(/^MIKA_ADMIN_TOKEN=(.+)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
  } catch { return ''; }
}
const TOKEN = readToken();

async function req(method, urlPath, { headers = {}, body, cookie } = {}) {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      ...ORIGIN,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json, setCookie: res.headers.get('set-cookie') || '' };
}

// A protected mutation with a harmless outcome: it is already approved, so a
// successful auth yields 409 (business rejection) rather than mutating state.
const PROTECTED_MUTATION = '/api/production/jobs/pr-1785988170831-c9c934/approve';

try {
  const up = await fetch(`${BASE}/api/production/providers`).then(r => r.ok).catch(() => false);
  if (!up) { console.log('SKIP — dev server not reachable on :3099.'); process.exit(0); }

  // ── Rejection paths ──────────────────────────────────────────────────────
  section('Unauthenticated mutations are rejected');

  const noAuth = await req('POST', PROTECTED_MUTATION, { body: {} });
  check('mutation with no credential is rejected 401', noAuth.status === 401, String(noAuth.status));
  check('rejection is a typed JSON code', noAuth.json?.code === 'authentication_required', JSON.stringify(noAuth.json));
  check('rejection body never contains the token', !JSON.stringify(noAuth.json || {}).includes(TOKEN || '__no_token_configured__'));

  const badHeader = await req('POST', PROTECTED_MUTATION, { headers: { 'x-mika-admin-token': 'not-the-token' }, body: {} });
  check('invalid header token is rejected 401', badHeader.status === 401, String(badHeader.status));
  const badCookie = await req('POST', PROTECTED_MUTATION, { cookie: 'mika_admin_token=not-the-token', body: {} });
  check('invalid cookie token is rejected 401', badCookie.status === 401, String(badCookie.status));

  // ── GET routes unaffected ────────────────────────────────────────────────
  section('Read routes unaffected');

  const getNoAuth = await req('GET', '/api/production/providers');
  check('unauthenticated GET still succeeds', getNoAuth.status === 200, String(getNoAuth.status));

  // ── Session route ────────────────────────────────────────────────────────
  section('Session route');

  const sessGet = await req('GET', '/api/auth/session');
  check('GET session is reachable without a credential', sessGet.status === 200, String(sessGet.status));
  check('GET session reports authenticated as a boolean', typeof sessGet.json?.authenticated === 'boolean');
  check('GET session never returns the token', !JSON.stringify(sessGet.json || {}).includes(TOKEN || '__no_token_configured__'));
  check('GET session reports whether a token is configured', typeof sessGet.json?.tokenConfigured === 'boolean');

  const wrong = await req('POST', '/api/auth/session', { body: { token: 'definitely-wrong-value' } });
  check('wrong token is rejected 401', wrong.status === 401, String(wrong.status));
  const empty = await req('POST', '/api/auth/session', { body: {} });
  check('empty token is rejected 401', empty.status === 401, String(empty.status));
  check('wrong and empty are indistinguishable (no oracle)',
    JSON.stringify(wrong.json) === JSON.stringify(empty.json));
  check('rejection never echoes the submitted value', !JSON.stringify(wrong.json || {}).includes('definitely-wrong-value'));

  if (!TOKEN) { console.log('SKIP — MIKA_ADMIN_TOKEN not readable; sign-in path not exercised.'); }
  else {
    const signIn = await req('POST', '/api/auth/session', { body: { token: TOKEN } });
    check('correct token signs in 200', signIn.status === 200 && signIn.json?.ok === true, String(signIn.status));
    check('sign-in response never returns the token', !JSON.stringify(signIn.json || {}).includes(TOKEN));

    // ── Cookie attributes ──────────────────────────────────────────────────
    section('Cookie security attributes');

    const sc = signIn.setCookie;
    check('cookie is named mika_admin_token', /(^|[,;\s])mika_admin_token=/.test(sc), sc.slice(0, 60));
    check('cookie is HttpOnly (unreadable by page JS)', /HttpOnly/i.test(sc));
    check('cookie is SameSite=Strict (CSRF defence)', /SameSite=Strict/i.test(sc));
    check('cookie is scoped to Path=/', /Path=\//.test(sc));
    check('cookie has an expiry', /Max-Age=\d+/.test(sc));
    check('Secure is set only in production', process.env.NODE_ENV === 'production' ? /Secure/i.test(sc) : true);

    const cookie = `mika_admin_token=${encodeURIComponent(TOKEN)}`;

    // ── The actual fix ─────────────────────────────────────────────────────
    section('Browser-shaped mutations now succeed');

    const viaCookie = await req('POST', PROTECTED_MUTATION, { cookie, body: {} });
    check('cookie-only mutation passes auth (not 401)', viaCookie.status !== 401, String(viaCookie.status));
    check('cookie-only mutation reaches route logic (409 = already approved)', viaCookie.status === 409, String(viaCookie.status));

    const planDry = await req('POST', '/api/production/assets/plan', {
      cookie,
      body: { packageId: 'pack-1785960819732-4ed2d0', sceneIndex: 0, capability: 'background_plate', modelOverride: 'soul_cinematic', dryRun: true },
    });
    check('asset-plan mutation succeeds via cookie', planDry.status === 200 && planDry.json?.ok === true, String(planDry.status));
    check('asset-plan dry run creates no job', planDry.json?.dryRun === true);

    const hfStatus = await req('GET', '/api/production/providers/higgsfield/status', { cookie });
    check('provider panel reads still work with a session', hfStatus.status === 200);

    // ── Terminal access preserved ──────────────────────────────────────────
    section('Header auth still works');

    const viaHeader = await req('POST', PROTECTED_MUTATION, { headers: { 'x-mika-admin-token': TOKEN }, body: {} });
    check('header auth still passes (terminal/CI unaffected)', viaHeader.status !== 401, String(viaHeader.status));
    const viaBearer = await req('POST', PROTECTED_MUTATION, { headers: { Authorization: `Bearer ${TOKEN}` }, body: {} });
    check('Authorization: Bearer still passes', viaBearer.status !== 401, String(viaBearer.status));

    // ── Precedence is deterministic ────────────────────────────────────────
    section('Credential precedence');

    const headerWinsOverBadCookie = await req('POST', PROTECTED_MUTATION, {
      headers: { 'x-mika-admin-token': TOKEN }, cookie: 'mika_admin_token=garbage', body: {},
    });
    check('valid header wins over an invalid cookie', headerWinsOverBadCookie.status !== 401, String(headerWinsOverBadCookie.status));
    const badHeaderBeatsGoodCookie = await req('POST', PROTECTED_MUTATION, {
      headers: { 'x-mika-admin-token': 'garbage' }, cookie, body: {},
    });
    check('header takes precedence deterministically (invalid header rejects even with a valid cookie)',
      badHeaderBeatsGoodCookie.status === 401, String(badHeaderBeatsGoodCookie.status));

    // ── Sign out ───────────────────────────────────────────────────────────
    section('Sign out');

    const out = await req('DELETE', '/api/auth/session', { cookie });
    check('sign-out succeeds', out.status === 200 && out.json?.authenticated === false);
    check('sign-out expires the cookie', /Max-Age=0/.test(out.setCookie), out.setCookie.slice(0, 80));
  }

  // ── Origin protection unchanged ──────────────────────────────────────────
  section('Origin protection preserved');

  const foreign = await fetch(`${BASE}${PROTECTED_MUTATION}`, {
    method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}',
  });
  check('foreign origin is rejected 403', foreign.status === 403, String(foreign.status));
  const foreignSession = await fetch(`${BASE}/api/auth/session`, {
    method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ token: TOKEN || 'x' }),
  });
  check('foreign origin cannot reach the session route either', foreignSession.status === 403, String(foreignSession.status));

  // ── Source-level guarantees ──────────────────────────────────────────────
  section('Source guarantees');

  const mw = fs.readFileSync(path.join(ROOT, 'middleware.js'), 'utf8');
  check('middleware still enforces the token for non-session routes', /constantTimeEqual\(requestToken\(request\), configuredToken\)/.test(mw));
  check('only the session route is exempt from the token gate', (mw.match(/isAuthSessionRoute/g) || []).length >= 2);
  check('origin check still runs before the session exemption',
    mw.indexOf('origin_rejected') < mw.indexOf('isAuthSessionRoute(request)') || /allowedOrigins[\s\S]*isAuthSessionRoute/.test(mw));

  const route = fs.readFileSync(path.join(ROOT, 'pages/api/auth/session.js'), 'utf8');
  check('session route uses constant-time comparison', /timingSafeEqual/.test(route));
  check('session route throttles attempts', /tooManyAttempts/.test(route));
  check('session route sets HttpOnly', /HttpOnly/.test(route));

  const gate = fs.readFileSync(path.join(ROOT, 'components/layout/AdminSessionGate.jsx'), 'utf8');
  check('UI gate never stores the token after sign-in', /setToken\(''\)/.test(gate));
  check('UI gate surfaces a visible error (no silent failure)', /setError\(/.test(gate));

  const noHardcoded = !/MIKA_ADMIN_TOKEN\s*=\s*['"][^'"]{8,}/.test(route + gate + mw);
  check('no hardcoded token in source', noHardcoded);
  check('token is not exposed to the client bundle', !/NEXT_PUBLIC_[A-Z_]*TOKEN/.test(route + gate + mw));

  // ── Config documentation ─────────────────────────────────────────────────
  section('First-run configuration docs');

  const envExample = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  check('.env.example contains CONTENT_WORKFORCE_ENABLED', /^CONTENT_WORKFORCE_ENABLED=/m.test(envExample));
  check('.env.example contains CONTENT_RESEARCH_ENABLED', /^CONTENT_RESEARCH_ENABLED=/m.test(envExample));
  check('both default to false', /^CONTENT_WORKFORCE_ENABLED=false$/m.test(envExample) && /^CONTENT_RESEARCH_ENABLED=false$/m.test(envExample));
  check('.env.example explains the workforce symptom', /is not set to true/.test(envExample));
  check('.env.example explains the research fallback', /model-synthesis/.test(envExample));
  check('.env.example explains browser cookie auth', /HttpOnly cookie/.test(envExample));
  check('.env.example holds no real secret values',
    !/^[A-Z_]+=(sk-|AKIA|Bearer )/m.test(envExample) && !/^[A-Z_]+=[A-Za-z0-9]{32,}$/m.test(envExample));

  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  check('README documents first-run configuration', /First run — required local configuration/.test(readme));
  check('README states both flags default disabled', /default false/.test(readme));
  check('README lists the symptoms', /Symptoms if you skip this/.test(readme));
  check('README says these belong in .env.local only', /\.env\.local/.test(readme));
  check('README has a first-run verification checklist', /First-run verification checklist/.test(readme));
  check('README documents the admin session prompt', /Admin session required/.test(readme));

  const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  check('.env.local remains git-ignored', /\.env\*\.local/.test(gitignore));
  check('README contains no real token value', !TOKEN || !readme.includes(TOKEN));
  check('.env.example contains no real token value', !TOKEN || !envExample.includes(TOKEN));
} catch (err) {
  check('validator ran without throwing', false, err.message);
}

const passed = results.filter(r => r.ok).length;
const failed = results.length - passed;
console.log('═'.repeat(64));
console.log(`Admin session auth validation: ${passed}/${results.length} passed, ${failed} failed`);
if (failed) results.filter(r => !r.ok).forEach(r => console.log(`  ✗ ${r.n}${r.d ? ` — ${r.d}` : ''}`));
process.exit(failed ? 1 : 0);
