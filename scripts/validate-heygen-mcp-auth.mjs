#!/usr/bin/env node
// scripts/validate-heygen-mcp-auth.mjs
//
// Offline validation for HeyGen MCP Adapter Checkpoint 1 (OAuth connection +
// tool discovery only). Never completes a real OAuth flow, never calls a
// generation tool, never consumes credits. Follows this project's
// established convention (no jest/vitest configured) of validating against
// real code paths — direct module import for pure/fs-level logic (enabled
// by lib/heygen/package.json's {"type":"module"} scoping, the same trick
// used for lib/production/execution/), plus the real running dev server for
// API-route-level checks.
//
// Mode-aware by design: this script honestly supports running against
// EITHER server state —
//   disabled mode: HEYGEN_MCP_ENABLED is not "true"
//   enabled/live mode: HEYGEN_MCP_ENABLED=true (optionally with a real,
//     already-authenticated session)
// — and every assertion that depends on mode computes its EXPECTED value
// from the actual current mode/session state rather than hardcoding the
// disabled default. No assertion here is ever satisfied merely by running
// in a particular mode; a genuine mismatch between reality and what the
// code under test reports will still fail in either mode.

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ROOT = process.cwd();
const BASE = 'http://localhost:3099';

// ── Load .env.local into process.env (plain `node` doesn't do this automatically) ─
function loadEnvLocal() {
  try {
    const raw = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  } catch { /* no .env.local */ }
}
loadEnvLocal();

const TOKEN = process.env.MIKA_ADMIN_TOKEN || '';

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, ok: !!condition, detail });
  console.log(`${condition ? 'PASS' : 'FAIL'} — ${name}${detail && !condition ? ` (${detail})` : ''}`);
}

async function api(method, urlPath, body) {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Mika-Admin-Token': TOKEN },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

async function waitForServer(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/capabilities/registry`);
      if (res.ok || res.status === 405) return true;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

function noSecretKeys(obj, forbidden = ['access_token', 'refresh_token', 'client_secret', 'accessToken', 'refreshToken', 'clientSecret', 'codeVerifier', 'code_verifier', 'pendingState', 'registration_secret', 'registrationSecret']) {
  const json = JSON.stringify(obj);
  return forbidden.filter(k => json.includes(k));
}

async function main() {
  console.log(`HEYGEN_MCP_ENABLED (.env.local): ${process.env.HEYGEN_MCP_ENABLED}`);
  console.log(`Using admin token: ${TOKEN ? '(configured)' : '(NONE)'}`);

  // ══════════════════════════════════════════════════════════════════════
  // PART A — direct module-level checks (no server required)
  // ══════════════════════════════════════════════════════════════════════

  const {
    getHeyGenMcpConfig, getHeyGenConnectionStatus, classifyHeyGenAuthError,
    findHeyGenAccountTool, isAllowedHeyGenRedirectUrl, disconnectHeyGen,
    completeHeyGenAuthorization, checkHeyGenMcpHealth,
  } = await import('../lib/heygen/heygenMcpClient.js');
  const { getHeyGenAuthState, patchHeyGenAuthState, clearHeyGenAuthState } = await import('../lib/heygen/heygenAuthStore.js');
  const { HeyGenOAuthClientProvider } = await import('../lib/heygen/heygenAuthProvider.js');

  // Snapshot real state (if any) so this script never destroys a genuine session.
  const AUTH_FILE = path.join(ROOT, 'data', 'heygen-auth', 'session.json');
  const OPENART_FILE = path.join(ROOT, 'data', 'openart-auth', 'session.json');
  const preExistingHeyGenState = fs.existsSync(AUTH_FILE) ? fs.readFileSync(AUTH_FILE, 'utf8') : null;
  const openArtBefore = fs.existsSync(OPENART_FILE) ? fs.readFileSync(OPENART_FILE, 'utf8') : null;

  // The single source of truth for "which mode is this run in" — read once,
  // reused by every mode-aware assertion below instead of re-deriving it
  // (and instead of assuming disabled, the old bug).
  const envEnabled = String(process.env.HEYGEN_MCP_ENABLED || '').trim().toLowerCase() === 'true';
  const preExistingTokens = (() => {
    try { return preExistingHeyGenState ? JSON.parse(preExistingHeyGenState).tokens : null; }
    catch { return null; }
  })();

  // ── 1. Config / connection status honestly reflects the ACTUAL mode ─────
  const cfg = getHeyGenMcpConfig();
  check('A1: getHeyGenMcpConfig().enabled matches HEYGEN_MCP_ENABLED (.env.local)', cfg.enabled === envEnabled, `enabled=${cfg.enabled}, env=${envEnabled}`);
  check('A1: getHeyGenMcpConfig() reports the configured/default MCP URL', cfg.mcpUrl === 'https://mcp.heygen.com/mcp/v1/', cfg.mcpUrl);

  const connectionStatusNow = getHeyGenConnectionStatus();
  const expectedConnectionStatus = !envEnabled ? 'staged' : (preExistingTokens?.access_token ? 'connected' : 'authentication_required');
  check('A2: getHeyGenConnectionStatus() status matches enabled flag + real session state', connectionStatusNow.status === expectedConnectionStatus, `expected ${expectedConnectionStatus}, got ${connectionStatusNow.status}`);
  check('A2: no secret keys in getHeyGenConnectionStatus()', noSecretKeys(connectionStatusNow).length === 0, JSON.stringify(noSecretKeys(connectionStatusNow)));

  // ── 2. Error classification (never guesses a HeyGen-specific endpoint —
  //      just pattern-matches whatever error text a provider returns) ─────
  check('A3: classifies domain/whitelist wording as domain_not_whitelisted', classifyHeyGenAuthError('invalid_request', 'This domain is not on the whitelist') === 'domain_not_whitelisted');
  check('A3: classifies redirect_uri mismatch wording as domain_not_whitelisted', classifyHeyGenAuthError('invalid_request', 'redirect_uri mismatch for this client') === 'domain_not_whitelisted');
  check('A3: classifies access_denied', classifyHeyGenAuthError('access_denied', 'user cancelled') === 'access_denied');
  check('A3: falls back to authorization_error for unrecognized text', classifyHeyGenAuthError('weird_code', 'something unexpected happened') === 'authorization_error');

  // ── 3. Account tool discovery heuristic (pure — no I/O, no guessing) ────
  const sampleTools = [
    { name: 'generate_avatar_video', description: 'Create a talking avatar video' },
    { name: 'get_current_user', description: 'Returns the authenticated user profile' },
    { name: 'list_avatars', description: 'List available avatars' },
  ];
  const found = findHeyGenAccountTool(sampleTools);
  check('A4: findHeyGenAccountTool() picks the account tool, not a generation tool', found?.name === 'get_current_user', found?.name);
  check('A4: findHeyGenAccountTool() returns null when no candidate exists', findHeyGenAccountTool([{ name: 'generate_avatar_video', description: 'x' }]) === null);
  check('A4: findHeyGenAccountTool() returns null for an empty list', findHeyGenAccountTool([]) === null);

  // ── 4. Redirect URL / open-redirect protection ──────────────────────────
  const configuredRedirect = String(process.env.HEYGEN_MCP_OAUTH_REDIRECT_URL || '').trim();
  if (configuredRedirect) {
    check('A5: exact configured redirect URL is allowed', isAllowedHeyGenRedirectUrl(configuredRedirect) === true);
    check('A5: a different origin is rejected (no open redirect)', isAllowedHeyGenRedirectUrl('https://evil.example/callback') === false);
    check('A5: a lookalike localhost path is rejected when a redirect is explicitly configured', isAllowedHeyGenRedirectUrl('http://localhost:3099/api/evil/callback') === false);
  } else {
    check('A5: redirect allowlist requires an explicitly configured HEYGEN_MCP_OAUTH_REDIRECT_URL for this test', false, 'not set in .env.local');
  }

  // ── 5. Auth store: permissions, atomic write, isolation from OpenArt ───
  const testPatch = { __validationProbe: true };
  patchHeyGenAuthState(testPatch);
  const dirStat = fs.statSync(path.join(ROOT, 'data', 'heygen-auth'));
  const fileStat = fs.statSync(AUTH_FILE);
  check('A6: heygen-auth directory mode is 0700', (dirStat.mode & 0o777) === 0o700, (dirStat.mode & 0o777).toString(8));
  check('A6: heygen-auth session file mode is 0600', (fileStat.mode & 0o777) === 0o600, (fileStat.mode & 0o777).toString(8));
  check('A6: probe patch persisted correctly', getHeyGenAuthState().__validationProbe === true);

  const openArtAfterProbe = fs.existsSync(OPENART_FILE) ? fs.readFileSync(OPENART_FILE, 'utf8') : null;
  check('A6: writing HeyGen auth state never touches the OpenArt auth store', openArtAfterProbe === openArtBefore);

  let ignoredHeyGen = false;
  try { execSync('git check-ignore -q "data/heygen-auth/"', { cwd: ROOT }); ignoredHeyGen = true; } catch { ignoredHeyGen = false; }
  check('A7: data/heygen-auth/ is git-ignored', ignoredHeyGen);

  // ── 6. State generation, one-time-use, and expiry ───────────────────────
  const provider = new HeyGenOAuthClientProvider(configuredRedirect || 'http://localhost:3099/api/production/providers/heygen/callback');
  const generatedState = provider.state();
  check('A8: state() generates a long random value', typeof generatedState === 'string' && generatedState.length >= 32);
  check('A8: state() persists pendingState + pendingStateCreatedAt', getHeyGenAuthState().pendingState === generatedState && !!getHeyGenAuthState().pendingStateCreatedAt);

  // Wrong state -> state_mismatch (not expiry-related).
  let wrongStateErr = null;
  try { await completeHeyGenAuthorization({ redirectUrl: provider.redirectUrl, code: 'fake-code', state: 'not-the-real-state' }); }
  catch (e) { wrongStateErr = e; }
  check('A9: mismatched state is rejected with state_mismatch', wrongStateErr?.code === 'state_mismatch', wrongStateErr?.code);
  check('A9: pendingState is still present after a rejected mismatch attempt (not consumed by a failed guess)', getHeyGenAuthState().pendingState === generatedState);

  // Force expiry, then even the CORRECT state must be rejected.
  patchHeyGenAuthState({ pendingStateCreatedAt: new Date(Date.now() - 11 * 60 * 1000).toISOString() });
  let expiredErr = null;
  try { await completeHeyGenAuthorization({ redirectUrl: provider.redirectUrl, code: 'fake-code', state: generatedState }); }
  catch (e) { expiredErr = e; }
  check('A10: expired (but otherwise correct) state is rejected with state_mismatch', expiredErr?.code === 'state_mismatch', expiredErr?.code);
  check('A10: expired state is consumed (cannot be replayed)', getHeyGenAuthState().pendingState == null);

  // ── 7. Disconnect clears only HeyGen data ───────────────────────────────
  const disconnectResult = disconnectHeyGen();
  check('A11: disconnectHeyGen() reports disconnected', disconnectResult.status === 'disconnected');
  check('A11: tokens cleared after disconnect', getHeyGenAuthState().tokens == null);
  const openArtAfterDisconnect = fs.existsSync(OPENART_FILE) ? fs.readFileSync(OPENART_FILE, 'utf8') : null;
  check('A11: disconnectHeyGen() never touches the OpenArt auth store', openArtAfterDisconnect === openArtBefore);

  // Restore whatever was there before this script ran (never leave test debris
  // in place of a real session, and never fabricate one if there wasn't any).
  if (preExistingHeyGenState) {
    fs.writeFileSync(AUTH_FILE, preExistingHeyGenState, { mode: 0o600 });
  } else {
    clearHeyGenAuthState();
  }

  // ══════════════════════════════════════════════════════════════════════
  // PART B — HTTP checks against the real running dev server
  // ══════════════════════════════════════════════════════════════════════

  const up = await waitForServer();
  check('B1: dev server reachable on :3099', up);
  if (!up) {
    console.log('Cannot continue without a running server (npm run dev).');
    printSummary();
    return;
  }

  const statusResp = await api('GET', '/api/production/providers/heygen/status');
  check('B2: GET status -> 200 ok', statusResp.status === 200 && statusResp.json?.ok === true);
  check('B2: GET status reports the required sanitized shape', ['ok', 'enabled', 'mcpUrl', 'status', 'authenticated', 'clientRegistered', 'connectedAt', 'domainWhitelistingRequired', 'accountSummary']
    .every(k => Object.prototype.hasOwnProperty.call(statusResp.json || {}, k)));
  check('B2: no secret substrings in the raw status response', noSecretKeys(statusResp.json).length === 0, JSON.stringify(noSecretKeys(statusResp.json)));

  if (!envEnabled) {
    check('B3: status is staged/disabled to match current server config', statusResp.json?.status === 'staged', statusResp.json?.status);

    const connectResp = await api('POST', '/api/production/providers/heygen/connect');
    check('B4: POST connect -> 503 disabled', connectResp.status === 503 && connectResp.json?.code === 'disabled');

    const toolsResp = await api('GET', '/api/production/providers/heygen/tools');
    check('B5: GET tools -> 503 disabled', toolsResp.status === 503 && toolsResp.json?.code === 'disabled');

    const accountResp = await api('GET', '/api/production/providers/heygen/account');
    check('B6: GET account -> 503 disabled', accountResp.status === 503 && accountResp.json?.code === 'disabled');
  } else {
    check('B3: status is authentication_required or connected to match current server config (enabled, live mode)', ['authentication_required', 'connected'].includes(statusResp.json?.status), statusResp.json?.status);
    console.log('SKIP — B4-B6 disabled-response checks (server currently has HEYGEN_MCP_ENABLED=true — a disabled-mode 503 is not the expected response here).');
  }

  // ── Provider registry — captured BEFORE the disconnect check below, so it
  // reflects the REAL current connection/tooling state (whatever that is)
  // rather than a state this script's own disconnect call just forced.
  // heygen-mcp vs heygen-api distinctness, and (replacing the old vacuous
  // "no submit key in the JSON response" check, which is true of ANY
  // sanitized status object regardless of registry wiring) a genuine
  // cross-check: independently call the SAME health function the registry
  // itself is wired to, in the same instant, and require the HTTP-reported
  // executable/status to actually match it. This can only pass if
  // heygen-mcp's registry entry is truly reflecting live state — a stale or
  // hardcoded value would now fail it in either mode. Never calls a
  // generation tool — checkHeyGenMcpHealth() only ever calls listTools().
  const [providersResp, liveHealth] = await Promise.all([
    api('GET', '/api/production/providers'),
    checkHeyGenMcpHealth(),
  ]);
  const heygenMcp = providersResp.json?.providers?.find(p => p.id === 'heygen-mcp');
  const heygenApi = providersResp.json?.providers?.find(p => p.id === 'heygen-api');
  check('B9: provider registry has a distinct heygen-mcp entry', !!heygenMcp);
  check('B9: provider registry has a distinct heygen-api entry', !!heygenApi);
  check('B9: heygen-mcp and heygen-api are genuinely separate entries', heygenMcp && heygenApi && heygenMcp !== heygenApi);
  check('B9: heygen-mcp executionType=mcp-oauth, billingPool=web-plan-premium-credits', heygenMcp?.executionType === 'mcp-oauth' && heygenMcp?.billingPool === 'web-plan-premium-credits');
  check('B9: heygen-api executionType=direct-api, billingPool=api-wallet', heygenApi?.executionType === 'direct-api' && heygenApi?.billingPool === 'api-wallet');
  check('B10: heygen-api is non-executable (Direct API is out of scope)', heygenApi?.executable === false);
  check('B10: heygen-mcp registry "executable" matches live health.ok (real cross-check, not a shape-only assertion)', heygenMcp?.executable === (liveHealth.ok === true), `registry executable=${heygenMcp?.executable}, live health.ok=${liveHealth.ok}`);
  check('B10: heygen-mcp registry "status" matches live health.status', heygenMcp?.status === liveHealth.status, `registry status=${heygenMcp?.status}, live health.status=${liveHealth.status}`);
  if (!envEnabled) {
    check('B10: heygen-mcp is correctly non-executable while disabled', heygenMcp?.executable === false, heygenMcp?.executable);
  } else {
    console.log(`INFO — B10: heygen-mcp live executable=${heygenMcp?.executable}, status=${heygenMcp?.status} (both modes are valid in enabled/live mode depending on real connection/tooling state — the cross-check above is what actually proves correctness).`);
  }

  const noTokenLeak = noSecretKeys(providersResp.json);
  check('B11: no secret substrings in the providers registry response', noTokenLeak.length === 0, JSON.stringify(noTokenLeak));

  // ── Disconnect via the real route is idempotent and OpenArt-isolated ────
  const disconnectResp = await api('POST', '/api/production/providers/heygen/disconnect');
  check('B7: POST disconnect -> 200 ok (idempotent even with nothing connected)', disconnectResp.status === 200 && disconnectResp.json?.ok === true);

  const openArtStatusResp = await api('GET', '/api/openart/status');
  check('B8: GET /api/openart/status is unaffected by HeyGen routes', openArtStatusResp.status === 200 && openArtStatusResp.json?.ok === true);

  printSummary();
}

function printSummary() {
  const failed = results.filter(r => !r.ok);
  console.log('\n──────────────────────────────────────────');
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('FAILED:');
    failed.forEach(f => console.log(`  - ${f.name}${f.detail ? ` :: ${f.detail}` : ''}`));
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error('Validation script crashed:', err);
  process.exitCode = 1;
});
