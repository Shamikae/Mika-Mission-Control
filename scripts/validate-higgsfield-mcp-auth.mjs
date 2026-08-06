#!/usr/bin/env node
// scripts/validate-higgsfield-mcp-auth.mjs
//
// Offline validation for Higgsfield MCP Adapter Checkpoint 1 (OAuth
// connection + tool discovery only). Never completes a real OAuth flow (it
// probes state-mismatch/expiry rejection paths, then restores whatever real
// session existed before), never calls a generation tool, never consumes
// credits. Mirrors scripts/validate-heygen-mcp-auth.mjs exactly.
//
// Mode-aware by design: honestly supports running against EITHER server
// state — disabled (HIGGSFIELD_MCP_ENABLED not "true") or enabled/live
// (optionally with a real, already-authenticated session) — and every
// assertion that depends on mode computes its EXPECTED value from the
// actual current mode/session state rather than hardcoding a default.

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ROOT = process.cwd();
const BASE = 'http://localhost:3099';

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
  console.log(`HIGGSFIELD_MCP_ENABLED (.env.local): ${process.env.HIGGSFIELD_MCP_ENABLED}`);
  console.log(`Using admin token: ${TOKEN ? '(configured)' : '(NONE)'}`);

  // ══════════════════════════════════════════════════════════════════════
  // PART A — direct module-level checks (no server required)
  // ══════════════════════════════════════════════════════════════════════

  const {
    getHiggsfieldMcpConfig, getHiggsfieldConnectionStatus, classifyHiggsfieldAuthError,
    findHiggsfieldAccountTool, isAllowedHiggsfieldRedirectUrl, disconnectHiggsfield,
    completeHiggsfieldAuthorization,
  } = await import('../lib/higgsfield/higgsfieldMcpClient.js');
  const { getHiggsfieldAuthState, patchHiggsfieldAuthState, clearHiggsfieldAuthState } = await import('../lib/higgsfield/higgsfieldAuthStore.js');
  const { HiggsfieldOAuthClientProvider } = await import('../lib/higgsfield/higgsfieldAuthProvider.js');

  // Snapshot real state (if any) so this script never destroys a genuine session.
  const AUTH_FILE = path.join(ROOT, 'data', 'higgsfield-auth', 'session.json');
  const HEYGEN_FILE = path.join(ROOT, 'data', 'heygen-auth', 'session.json');
  const OPENART_FILE = path.join(ROOT, 'data', 'openart-auth', 'session.json');
  const preExistingHiggsfieldState = fs.existsSync(AUTH_FILE) ? fs.readFileSync(AUTH_FILE, 'utf8') : null;
  const heygenBefore = fs.existsSync(HEYGEN_FILE) ? fs.readFileSync(HEYGEN_FILE, 'utf8') : null;
  const openArtBefore = fs.existsSync(OPENART_FILE) ? fs.readFileSync(OPENART_FILE, 'utf8') : null;

  const envEnabled = String(process.env.HIGGSFIELD_MCP_ENABLED || '').trim().toLowerCase() === 'true';
  const preExistingTokens = (() => {
    try { return preExistingHiggsfieldState ? JSON.parse(preExistingHiggsfieldState).tokens : null; }
    catch { return null; }
  })();

  // ── 1. Config / connection status honestly reflects the ACTUAL mode ─────
  const cfg = getHiggsfieldMcpConfig();
  check('A1: getHiggsfieldMcpConfig().enabled matches HIGGSFIELD_MCP_ENABLED (.env.local)', cfg.enabled === envEnabled, `enabled=${cfg.enabled}, env=${envEnabled}`);
  check('A1: getHiggsfieldMcpConfig() reports the configured/default MCP URL', cfg.mcpUrl === 'https://mcp.higgsfield.ai/mcp', cfg.mcpUrl);

  const connectionStatusNow = getHiggsfieldConnectionStatus();
  // Verified-status semantics: stored tokens alone never yield a connected
  // state. With tokens present the session is either verified (a real
  // authenticated call succeeded recently), unverified, or needs a reconnect.
  const TOKENED_STATES = ['connected_verified', 'token_present_unverified', 'refresh_required', 'authorization_error'];
  const expectedConnectionStatus = !envEnabled ? 'staged' : (preExistingTokens?.access_token ? TOKENED_STATES : 'authentication_required');
  check('A2: getHiggsfieldConnectionStatus() status matches enabled flag + real session state',
    Array.isArray(expectedConnectionStatus)
      ? expectedConnectionStatus.includes(connectionStatusNow.status)
      : connectionStatusNow.status === expectedConnectionStatus,
    `expected ${expectedConnectionStatus}, got ${connectionStatusNow.status}`);
  check('A2b: token presence alone never reports authenticated',
    !(connectionStatusNow.hasTokens && connectionStatusNow.status === 'token_present_unverified' && connectionStatusNow.authenticated));
  check('A2c: reconnectRequired is exposed for the UI',
    typeof connectionStatusNow.reconnectRequired === 'boolean');
  check('A2: no secret keys in getHiggsfieldConnectionStatus()', noSecretKeys(connectionStatusNow).length === 0, JSON.stringify(noSecretKeys(connectionStatusNow)));

  // ── 2. Error classification ──────────────────────────────────────────────
  check('A3: classifies domain/whitelist wording as domain_not_whitelisted', classifyHiggsfieldAuthError('invalid_request', 'This domain is not on the whitelist') === 'domain_not_whitelisted');
  check('A3: classifies redirect_uri mismatch wording as domain_not_whitelisted', classifyHiggsfieldAuthError('invalid_request', 'redirect_uri mismatch for this client') === 'domain_not_whitelisted');
  check('A3: classifies access_denied', classifyHiggsfieldAuthError('access_denied', 'user cancelled') === 'access_denied');
  check('A3: falls back to authorization_error for unrecognized text', classifyHiggsfieldAuthError('weird_code', 'something unexpected happened') === 'authorization_error');

  // ── 3. Account tool discovery heuristic (pure — no I/O) ──────────────────
  // Regression fixture for the REAL bug found during live discovery: a broad
  // description-pattern match on "current user" must never win over an
  // exact-name match on "balance" (Higgsfield's real account tool).
  const sampleTools = [
    { name: 'apps_invoke', description: 'Run one described action on a Marketplace app AS the current user.' },
    { name: 'balance', description: "Get the user's available credits and current subscription plan." },
    { name: 'generate_image', description: 'Generate one image request.' },
  ];
  const found = findHiggsfieldAccountTool(sampleTools);
  check('A4: findHiggsfieldAccountTool() picks the exact-named "balance" tool, not a description-pattern false positive', found?.name === 'balance', found?.name);
  check('A4: findHiggsfieldAccountTool() returns null when no candidate exists', findHiggsfieldAccountTool([{ name: 'generate_image', description: 'x' }]) === null);
  check('A4: findHiggsfieldAccountTool() returns null for an empty list', findHiggsfieldAccountTool([]) === null);
  const found2 = findHiggsfieldAccountTool([{ name: 'get_current_user', description: 'profile' }, { name: 'balance', description: 'credits' }]);
  check('A4: exact-name priority order — get_current_user still wins if balance is absent from that priority slot check ordering (balance is checked first in EXACT_NAME_PRIORITY, so with both present balance wins)', found2?.name === 'balance', found2?.name);

  // ── 4. Redirect URL / open-redirect protection ──────────────────────────
  const configuredRedirect = String(process.env.HIGGSFIELD_MCP_OAUTH_REDIRECT_URL || '').trim();
  if (configuredRedirect) {
    check('A5: exact configured redirect URL is allowed', isAllowedHiggsfieldRedirectUrl(configuredRedirect) === true);
    check('A5: a different origin is rejected (no open redirect)', isAllowedHiggsfieldRedirectUrl('https://evil.example/callback') === false);
    check('A5: a lookalike localhost path is rejected when a redirect is explicitly configured', isAllowedHiggsfieldRedirectUrl('http://localhost:3099/api/evil/callback') === false);
  } else {
    check('A5: redirect allowlist requires an explicitly configured HIGGSFIELD_MCP_OAUTH_REDIRECT_URL for this test', false, 'not set in .env.local');
  }

  // ── 5. Auth store: permissions, atomic write, isolation from HeyGen/OpenArt ──
  const testPatch = { __validationProbe: true };
  patchHiggsfieldAuthState(testPatch);
  const dirStat = fs.statSync(path.join(ROOT, 'data', 'higgsfield-auth'));
  const fileStat = fs.statSync(AUTH_FILE);
  check('A6: higgsfield-auth directory mode is 0700', (dirStat.mode & 0o777) === 0o700, (dirStat.mode & 0o777).toString(8));
  check('A6: higgsfield-auth session file mode is 0600', (fileStat.mode & 0o777) === 0o600, (fileStat.mode & 0o777).toString(8));
  check('A6: probe patch persisted correctly', getHiggsfieldAuthState().__validationProbe === true);

  const heygenAfterProbe = fs.existsSync(HEYGEN_FILE) ? fs.readFileSync(HEYGEN_FILE, 'utf8') : null;
  const openArtAfterProbe = fs.existsSync(OPENART_FILE) ? fs.readFileSync(OPENART_FILE, 'utf8') : null;
  check('A6: writing Higgsfield auth state never touches the HeyGen auth store', heygenAfterProbe === heygenBefore);
  check('A6: writing Higgsfield auth state never touches the OpenArt auth store', openArtAfterProbe === openArtBefore);

  let ignoredHiggsfield = false;
  try { execSync('git check-ignore -q "data/higgsfield-auth/"', { cwd: ROOT }); ignoredHiggsfield = true; } catch { ignoredHiggsfield = false; }
  check('A7: data/higgsfield-auth/ is git-ignored', ignoredHiggsfield);

  // ── 6. State generation, one-time-use, and expiry ───────────────────────
  const provider = new HiggsfieldOAuthClientProvider(configuredRedirect || 'http://localhost:3099/api/production/providers/higgsfield/callback');
  const generatedState = provider.state();
  check('A8: state() generates a long random value', typeof generatedState === 'string' && generatedState.length >= 32);
  check('A8: state() persists pendingState + pendingStateCreatedAt', getHiggsfieldAuthState().pendingState === generatedState && !!getHiggsfieldAuthState().pendingStateCreatedAt);

  let wrongStateErr = null;
  try { await completeHiggsfieldAuthorization({ redirectUrl: provider.redirectUrl, code: 'fake-code', state: 'not-the-real-state' }); }
  catch (e) { wrongStateErr = e; }
  check('A9: mismatched state is rejected with state_mismatch', wrongStateErr?.code === 'state_mismatch', wrongStateErr?.code);
  check('A9: pendingState is still present after a rejected mismatch attempt (not consumed by a failed guess)', getHiggsfieldAuthState().pendingState === generatedState);

  patchHiggsfieldAuthState({ pendingStateCreatedAt: new Date(Date.now() - 11 * 60 * 1000).toISOString() });
  let expiredErr = null;
  try { await completeHiggsfieldAuthorization({ redirectUrl: provider.redirectUrl, code: 'fake-code', state: generatedState }); }
  catch (e) { expiredErr = e; }
  check('A10: expired (but otherwise correct) state is rejected with state_mismatch', expiredErr?.code === 'state_mismatch', expiredErr?.code);
  check('A10: expired state is consumed (cannot be replayed)', getHiggsfieldAuthState().pendingState == null);

  // ── 7. Disconnect clears only Higgsfield data ───────────────────────────
  const disconnectResult = disconnectHiggsfield();
  check('A11: disconnectHiggsfield() reports disconnected', disconnectResult.status === 'disconnected');
  check('A11: tokens cleared after disconnect', getHiggsfieldAuthState().tokens == null);
  const heygenAfterDisconnect = fs.existsSync(HEYGEN_FILE) ? fs.readFileSync(HEYGEN_FILE, 'utf8') : null;
  const openArtAfterDisconnect = fs.existsSync(OPENART_FILE) ? fs.readFileSync(OPENART_FILE, 'utf8') : null;
  check('A11: disconnectHiggsfield() never touches the HeyGen auth store', heygenAfterDisconnect === heygenBefore);
  check('A11: disconnectHiggsfield() never touches the OpenArt auth store', openArtAfterDisconnect === openArtBefore);

  // Restore whatever was there before this script ran.
  if (preExistingHiggsfieldState) {
    fs.writeFileSync(AUTH_FILE, preExistingHiggsfieldState, { mode: 0o600 });
  } else {
    clearHiggsfieldAuthState();
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

  const statusResp = await api('GET', '/api/production/providers/higgsfield/status');
  check('B2: GET status -> 200 ok', statusResp.status === 200 && statusResp.json?.ok === true);
  check('B2: GET status reports the required sanitized shape', ['ok', 'enabled', 'mcpUrl', 'status', 'authenticated', 'clientRegistered', 'connectedAt', 'domainWhitelistingRequired', 'accountSummary']
    .every(k => Object.prototype.hasOwnProperty.call(statusResp.json || {}, k)));
  check('B2: no secret substrings in the raw status response', noSecretKeys(statusResp.json).length === 0, JSON.stringify(noSecretKeys(statusResp.json)));

  if (!envEnabled) {
    check('B3: status is staged/disabled to match current server config', statusResp.json?.status === 'staged', statusResp.json?.status);
    const connectResp = await api('POST', '/api/production/providers/higgsfield/connect');
    check('B4: POST connect -> 503 disabled', connectResp.status === 503 && connectResp.json?.code === 'disabled');
    const toolsResp = await api('GET', '/api/production/providers/higgsfield/tools');
    check('B5: GET tools -> 503 disabled', toolsResp.status === 503 && toolsResp.json?.code === 'disabled');
    const accountResp = await api('GET', '/api/production/providers/higgsfield/account');
    check('B6: GET account -> 503 disabled', accountResp.status === 503 && accountResp.json?.code === 'disabled');
  } else {
    check('B3: status is one of the verified-semantics states (enabled, live mode)', ['authentication_required', 'connected_verified', 'token_present_unverified', 'refresh_required', 'authorization_error'].includes(statusResp.json?.status), statusResp.json?.status);

    // ── Verified-status semantics + auth recovery (BUG A / BUG B) ──────────
    const st = statusResp.json || {};
    check('B3a: authenticated is true ONLY for connected_verified',
      st.authenticated === (st.status === 'connected_verified'), `${st.status}/${st.authenticated}`);
    check('B3b: reconnectRequired is set for every unhealthy auth state',
      st.reconnectRequired === ['authentication_required', 'refresh_required', 'authorization_error'].includes(st.status));
    check('B3c: refresh-token presence is reported as a boolean, never a value',
      typeof st.hasRefreshToken === 'boolean' && !JSON.stringify(st).match(/[A-Za-z0-9_-]{40,}/));

    // A real authenticated call is the ONLY thing that may verify a session.
    const acct = await api('GET', '/api/production/providers/higgsfield/account');
    if (acct.status === 200 && acct.json?.ok) {
      const after = await api('GET', '/api/production/providers/higgsfield/status');
      check('B3d: a successful authenticated call yields connected_verified',
        after.json?.status === 'connected_verified', after.json?.status);
      check('B3e: verification stamps lastVerifiedAt', !!after.json?.lastVerifiedAt);
      check('B3f: a successful call clears a stale lastError', after.json?.lastErrorCode === null, String(after.json?.lastErrorCode));
      check('B3g: account summary carries plan + credits, no raw payload',
        typeof acct.json.accountSummary?.planName === 'string' && Number.isFinite(acct.json.accountSummary?.remainingCredits));
    } else {
      check('B3d: an authenticated call that fails must NOT report connected_verified',
        (await api('GET', '/api/production/providers/higgsfield/status')).json?.status !== 'connected_verified');
    }

    // Refresh capability is provided by the MCP SDK's auth() — assert it is
    // reachable rather than reimplemented.
    const clientSrc = fs.readFileSync(path.join(ROOT, 'lib/higgsfield/higgsfieldMcpClient.js'), 'utf8');
    check('B3h: refresh is delegated to the SDK auth() flow, not hand-rolled',
      /await auth\(provider, \{ serverUrl/.test(clientSrc) && !/grant_type=refresh_token/.test(clientSrc));
    check('B3i: unauthorized responses are classified for reconnect',
      /noteHiggsfieldAuthOutcome\(false, 'refresh_required'/.test(clientSrc));
    check('B3j: only a real successful call marks the session verified',
      /noteHiggsfieldAuthOutcome\(true\)/.test(clientSrc));

    // Provider isolation must survive all of this.
    const heygenSrc = fs.readFileSync(path.join(ROOT, 'lib/heygen/heygenMcpClient.js'), 'utf8');
    check('B3k: HeyGen session remains isolated from Higgsfield',
      !/higgsfield/i.test(heygenSrc));
    check('B3l: Higgsfield client does not import HeyGen/OpenArt state',
      !/heygenAuthStore|openartAuthStore/.test(clientSrc));
    console.log('SKIP — B4-B6 disabled-response checks (server currently has HIGGSFIELD_MCP_ENABLED=true — a disabled-mode 503 is not the expected response here).');
  }

  // ── Live tool-count/account cross-check (only if actually connected) ────
  if (envEnabled && statusResp.json?.status === 'connected') {
    check('B6b: live status reports a real toolCount-bearing account summary path (accountSummary present or honestly null)', 'accountSummary' in statusResp.json);
    if (statusResp.json.accountSummary) {
      check('B6b: live accountSummary.remainingCredits is a real number (balance tool confirmed live)', typeof statusResp.json.accountSummary.remainingCredits === 'number');
    }
    const toolsResp = await api('GET', '/api/production/providers/higgsfield/tools');
    check('B6c: GET tools succeeds while connected', toolsResp.status === 200 && Array.isArray(toolsResp.json?.tools));
    check('B6c: live discovered tool list includes all 5 allowlisted tools', ['generate_image', 'generate_video', 'job_status', 'models_explore', 'balance'].every(n => toolsResp.json.tools.some(t => t.name === n)));
  }

  const [providersResp] = await Promise.all([api('GET', '/api/production/providers')]);
  const higgsfieldMcp = providersResp.json?.providers?.find(p => p.id === 'higgsfield-mcp');
  const higgsfieldOld = providersResp.json?.providers?.find(p => p.id === 'higgsfield');
  check('B9: provider registry has a distinct higgsfield-mcp entry', !!higgsfieldMcp);
  check('B9: old agent-domain "higgsfield" catalog entry is untouched (still staged, unrelated)', higgsfieldOld?.status === 'staged' && higgsfieldOld?.executionType === 'api_staged');
  check('B9: higgsfield-mcp and higgsfield are genuinely separate entries', higgsfieldMcp && higgsfieldOld && higgsfieldMcp !== higgsfieldOld);
  check('B9: higgsfield-mcp executionType=mcp-oauth, billingPool=higgsfield-account-credits', higgsfieldMcp?.executionType === 'mcp-oauth' && higgsfieldMcp?.billingPool === 'higgsfield-account-credits');

  const noTokenLeak = noSecretKeys(providersResp.json);
  check('B11: no secret substrings in the providers registry response', noTokenLeak.length === 0, JSON.stringify(noTokenLeak));

  const disconnectResp = await api('POST', '/api/production/providers/higgsfield/disconnect');
  check('B7: POST disconnect -> 200 ok (idempotent even with nothing connected)', disconnectResp.status === 200 && disconnectResp.json?.ok === true);

  // Restore the real session again — the HTTP disconnect above also cleared
  // the live file, so restore identically to the module-level restore.
  if (preExistingHiggsfieldState) {
    fs.writeFileSync(AUTH_FILE, preExistingHiggsfieldState, { mode: 0o600 });
  } else {
    clearHiggsfieldAuthState();
  }

  const heygenStatusResp = await api('GET', '/api/production/providers/heygen/status');
  check('B8: GET /api/production/providers/heygen/status is unaffected by Higgsfield routes', heygenStatusResp.status === 200 && heygenStatusResp.json?.ok === true);
  const openArtStatusResp = await api('GET', '/api/openart/status');
  check('B8: GET /api/openart/status is unaffected by Higgsfield routes', openArtStatusResp.status === 200 && openArtStatusResp.json?.ok === true);

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

// ── Live-session safety net ────────────────────────────────────────────────
// This validator exercises real disconnect behaviour, which necessarily
// touches the on-disk Higgsfield session. It snapshots that file up front and
// restores it inline — but an exception thrown BETWEEN the disconnect and the
// restore would leave the operator genuinely signed out, forcing a manual
// browser OAuth round-trip. That has happened.
//
// The snapshot/restore is therefore repeated here as a guaranteed finally, so
// no failure path can leave a real session destroyed. Restoration is
// idempotent: if the run already restored correctly, rewriting identical bytes
// is a no-op.
const AUTH_SNAPSHOT_FILE = path.join(ROOT, 'data', 'higgsfield-auth', 'session.json');
const AUTH_SNAPSHOT = fs.existsSync(AUTH_SNAPSHOT_FILE) ? fs.readFileSync(AUTH_SNAPSHOT_FILE, 'utf8') : null;

function restoreLiveSession() {
  try {
    if (AUTH_SNAPSHOT === null) return;
    const current = fs.existsSync(AUTH_SNAPSHOT_FILE) ? fs.readFileSync(AUTH_SNAPSHOT_FILE, 'utf8') : null;
    if (current === AUTH_SNAPSHOT) return;
    fs.mkdirSync(path.dirname(AUTH_SNAPSHOT_FILE), { recursive: true });
    fs.writeFileSync(AUTH_SNAPSHOT_FILE, AUTH_SNAPSHOT, { mode: 0o600 });
    console.log('NOTE — restored the live Higgsfield session that this validator had modified.');
  } catch (e) {
    console.error('WARNING — could not restore the live Higgsfield session:', e.message);
  }
}

main()
  .catch(err => {
    console.error('Validation script crashed:', err);
    process.exitCode = 1;
  })
  .finally(restoreLiveSession);
