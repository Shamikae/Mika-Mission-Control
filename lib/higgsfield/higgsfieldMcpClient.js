// lib/higgsfield/higgsfieldMcpClient.js
// SERVER-SIDE ONLY. Never import from client components.
//
// OAuth-authenticated MCP connection to Higgsfield's official Remote MCP
// server (Streamable HTTP transport, https://mcp.higgsfield.ai/mcp). There
// is no HIGGSFIELD_API_KEY — authentication is per-account OAuth, billed
// against the authenticated user's existing Higgsfield account credits.
//
// Checkpoint 1 scope ONLY: connect, discover tools, report status, identify
// (and optionally call) an account/profile tool. This file intentionally
// does not implement — and must not be extended to implement — generation
// tool invocation. Never returns access tokens, refresh tokens, client
// secrets, registration secrets, PKCE verifiers, or OAuth state. Callers
// only ever see sanitized, non-secret shapes. Deliberately independent of
// lib/heygen/* and lib/openart/* — no shared imports, no shared auth state.
// Mirrors lib/heygen/heygenMcpClient.js's exact structure and conventions.

import { Client }                        from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { auth, UnauthorizedError }       from '@modelcontextprotocol/sdk/client/auth.js';

import { HiggsfieldOAuthClientProvider } from './higgsfieldAuthProvider.js';
import { getHiggsfieldAuthState, patchHiggsfieldAuthState } from './higgsfieldAuthStore.js';
import { getCachedHiggsfieldDiscovery, setCachedHiggsfieldDiscovery, invalidateHiggsfieldDiscoveryCache } from './higgsfieldDiscoveryCache.js';

const DEFAULT_MCP_URL = 'https://mcp.higgsfield.ai/mcp';
const PENDING_STATE_TTL_MS = 10 * 60 * 1000; // one-time-use CSRF state, expires if never completed

// ── Config ────────────────────────────────────────────────────────────────────

export function isHiggsfieldMcpEnabled() {
  return String(process.env.HIGGSFIELD_MCP_ENABLED || '').trim().toLowerCase() === 'true';
}

export function getHiggsfieldMcpUrl() {
  return String(process.env.HIGGSFIELD_MCP_URL || DEFAULT_MCP_URL).trim();
}

/** Sanitized, non-secret config summary. */
export function getHiggsfieldMcpConfig() {
  return { enabled: isHiggsfieldMcpEnabled(), mcpUrl: getHiggsfieldMcpUrl() };
}

// ── Error classification ─────────────────────────────────────────────────────
// Best-effort classification of whatever error text the provider's own
// authorization server / the MCP SDK actually returns — never a fabricated
// or guessed Higgsfield-specific endpoint/response shape. Falls back to a
// generic, still-honest code when nothing matches.

const ERROR_PATTERNS = [
  { code: 'domain_not_whitelisted', pattern: /domain|whitelist|origin|not[\s_-]?allowed|unauthorized[\s_-]?client|redirect_uri/i },
  { code: 'access_denied',          pattern: /access_denied|user[\s_-]?denied|declined/i },
];

export function classifyHiggsfieldAuthError(rawCode, rawDescription) {
  const haystack = `${rawCode || ''} ${rawDescription || ''}`;
  if (rawCode === 'access_denied') return 'access_denied';
  for (const { code, pattern } of ERROR_PATTERNS) {
    if (pattern.test(haystack)) return code;
  }
  return 'authorization_error';
}

// ── Non-secret status ────────────────────────────────────────────────────────

/**
 * Returns connection status safe to expose to any authenticated API caller.
 * Never includes token values, client secrets, or registration secrets.
 */
// Connection states, ordered from healthiest to least healthy. Stored tokens
// alone NEVER justify 'connected_verified' — that state is only reachable
// after a real authenticated provider call has succeeded.
export const HIGGSFIELD_CONNECTION_STATES = [
  'staged',                   // provider disabled
  'connected_verified',       // an authenticated call succeeded recently
  'token_present_unverified', // tokens exist, but nothing has proven them
  'refresh_required',         // an authenticated call was rejected; a refresh may recover it
  'authentication_required',  // no tokens, or refresh definitively failed
  'authorization_error',      // provider rejected us for a non-auth reason
];

// How long a successful authenticated call vouches for the session before it
// must be re-proven. Short enough that a revoked token surfaces quickly.
const VERIFICATION_TTL_MS = 5 * 60 * 1000;

/**
 * Returns connection status safe to expose to any authenticated API caller.
 * Never includes token values, client secrets, or registration secrets.
 *
 * ── Why token presence is not authentication ─────────────────────────────
 * This previously reported `connected` whenever an access_token existed. A
 * 24h-expired token therefore still read as "connected", so the UI never
 * offered Reconnect and the SDK's silent refresh path was never invoked —
 * one bug hid the other. Status is now derived from the outcome of REAL
 * authenticated calls, recorded by noteHiggsfieldAuthOutcome().
 */
export function getHiggsfieldConnectionStatus() {
  const enabled = isHiggsfieldMcpEnabled();
  const state   = getHiggsfieldAuthState();

  const clientRegistered = !!state.clientInformation?.client_id;
  const hasTokens        = !!state.tokens?.access_token;
  const hasRefreshToken  = !!state.tokens?.refresh_token;

  const verifiedAt   = state.lastVerifiedAt ? Date.parse(state.lastVerifiedAt) : null;
  const verifyFresh  = Number.isFinite(verifiedAt) && (Date.now() - verifiedAt) < VERIFICATION_TTL_MS;
  const authFailure  = state.lastAuthFailure || null;
  // A failure only counts if it happened AFTER the last success.
  const failureIsCurrent = !!authFailure && (!verifiedAt || Date.parse(authFailure.at) > verifiedAt);

  let status;
  if (!enabled) {
    status = 'staged';
  } else if (!hasTokens) {
    status = 'authentication_required';
  } else if (failureIsCurrent) {
    status = authFailure.code === 'authorization_error' ? 'authorization_error'
      : hasRefreshToken ? 'refresh_required'
      : 'authentication_required';
  } else if (verifyFresh) {
    status = 'connected_verified';
  } else {
    status = 'token_present_unverified';
  }

  // Only a verified session may be reported as authenticated.
  const authenticated = status === 'connected_verified';

  return {
    enabled,
    mcpUrl:          getHiggsfieldMcpUrl(),
    status,
    clientRegistered,
    authenticated,
    hasTokens,
    hasRefreshToken,
    // True whenever the operator should be offered a Reconnect action.
    reconnectRequired: ['authentication_required', 'refresh_required', 'authorization_error'].includes(status),
    lastVerifiedAt:  state.lastVerifiedAt || null,
    connectedAt:     state.connectedAt || null,
    domainWhitelistingRequired: state.lastError?.code === 'domain_not_whitelisted',
    lastErrorCode:   state.lastError?.code || null,
    lastErrorAt:     state.lastError?.at || null,
  };
}

/**
 * Records the outcome of a REAL authenticated provider call. This is the only
 * thing that can move the session into 'connected_verified'.
 *
 * A success also clears a stale lastError — an old rejected callback must not
 * keep flagging a session that demonstrably works.
 */
export function noteHiggsfieldAuthOutcome(ok, errorCode = null, errorMessage = null) {
  if (ok) {
    patchHiggsfieldAuthState({
      lastVerifiedAt: new Date().toISOString(),
      lastAuthFailure: null,
      lastError: null,
    });
    return;
  }
  patchHiggsfieldAuthState({
    lastAuthFailure: {
      code: errorCode || 'authorization_error',
      message: String(errorMessage || '').slice(0, 300),
      at: new Date().toISOString(),
    },
  });
}

// ── Redirect URL helper ──────────────────────────────────────────────────────

export function buildHiggsfieldCallbackUrl(req) {
  const configured = String(process.env.HIGGSFIELD_MCP_OAUTH_REDIRECT_URL || '').trim();
  if (configured) return configured;

  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host  = req.headers.host;
  return `${proto}://${host}/api/production/providers/higgsfield/callback`;
}

/**
 * Safe redirect URI validation — only ever accepted if it matches the
 * explicitly configured HIGGSFIELD_MCP_OAUTH_REDIRECT_URL, or is a localhost
 * URL during non-production development. Prevents an open-redirect style
 * abuse of the OAuth flow via a manipulated Host header.
 */
export function isAllowedHiggsfieldRedirectUrl(url) {
  const configured = String(process.env.HIGGSFIELD_MCP_OAUTH_REDIRECT_URL || '').trim();
  if (configured) return url === configured;
  try {
    const parsed = new URL(url);
    const localHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
    return process.env.NODE_ENV !== 'production' && localHost;
  } catch {
    return false;
  }
}

// ── Connect (begin authorization) ───────────────────────────────────────────

/**
 * Starts (or silently completes, if a refresh token is already valid) the
 * OAuth flow. Returns either an authorization URL to send the user to, or
 * confirmation that a valid session already exists.
 */
export async function beginHiggsfieldAuthorization(redirectUrl) {
  if (!isHiggsfieldMcpEnabled()) {
    const err = new Error('Higgsfield MCP is not enabled. Set HIGGSFIELD_MCP_ENABLED=true before connecting.');
    err.code = 'disabled';
    throw err;
  }
  if (!isAllowedHiggsfieldRedirectUrl(redirectUrl)) {
    const err = new Error('Refusing to start OAuth with an unrecognized redirect URL.');
    err.code = 'invalid_redirect';
    throw err;
  }

  const provider = new HiggsfieldOAuthClientProvider(redirectUrl);
  let result;
  try {
    result = await auth(provider, { serverUrl: getHiggsfieldMcpUrl() });
  } catch (e) {
    const code = /regist/i.test(e.message || '') ? 'registration_failed' : classifyHiggsfieldAuthError(e.code, e.message);
    patchHiggsfieldAuthState({ lastError: { code, message: e.message, at: new Date().toISOString() } });
    const err = new Error(e.message || 'Higgsfield authorization could not be started.');
    err.code = code;
    throw err;
  }

  if (result === 'AUTHORIZED') {
    return { status: 'authorized' };
  }

  return { status: 'redirect', authorizationUrl: provider.lastAuthorizationUrl };
}

// ── Callback (complete authorization) ───────────────────────────────────────

/**
 * Validates the returned OAuth state against the value persisted at
 * beginHiggsfieldAuthorization() time (one-time-use CSRF protection, with a
 * 10-minute expiry so an abandoned flow can never be replayed later), then
 * exchanges the authorization code for tokens.
 */
export async function completeHiggsfieldAuthorization({ redirectUrl, code, state: returnedState }) {
  if (!isAllowedHiggsfieldRedirectUrl(redirectUrl)) {
    const err = new Error('Refusing to complete OAuth with an unrecognized redirect URL.');
    err.code = 'invalid_redirect';
    throw err;
  }
  if (!code) {
    const err = new Error('Missing authorization code from Higgsfield.');
    err.code = 'callback_missing_code';
    throw err;
  }

  const stored = getHiggsfieldAuthState();
  const pendingCreatedAt = stored.pendingStateCreatedAt ? new Date(stored.pendingStateCreatedAt).getTime() : 0;
  const stateExpired = !pendingCreatedAt || (Date.now() - pendingCreatedAt) > PENDING_STATE_TTL_MS;

  if (!returnedState || !stored.pendingState || returnedState !== stored.pendingState || stateExpired) {
    const err = new Error(stateExpired && stored.pendingState ? 'OAuth state expired — reconnect and try again.' : 'OAuth state mismatch — possible CSRF attempt. Reconnect and try again.');
    err.code = 'state_mismatch';
    const patch = { lastError: { code: 'state_mismatch', message: err.message, at: new Date().toISOString() } };
    if (stateExpired) Object.assign(patch, { pendingState: null, pendingStateCreatedAt: null, pendingAuthorizationUrl: null });
    patchHiggsfieldAuthState(patch);
    throw err;
  }

  // Consume the pending state immediately so it cannot be replayed.
  patchHiggsfieldAuthState({ pendingState: null, pendingStateCreatedAt: null, pendingAuthorizationUrl: null });

  const provider = new HiggsfieldOAuthClientProvider(redirectUrl);
  let result;
  try {
    result = await auth(provider, { serverUrl: getHiggsfieldMcpUrl(), authorizationCode: code });
  } catch (e) {
    const code2 = classifyHiggsfieldAuthError(e.code, e.message) === 'authorization_error' ? 'token_exchange_failed' : classifyHiggsfieldAuthError(e.code, e.message);
    patchHiggsfieldAuthState({ lastError: { code: code2, message: e.message, at: new Date().toISOString() } });
    const err = new Error(e.message || 'Higgsfield token exchange failed.');
    err.code = code2;
    throw err;
  }

  if (result !== 'AUTHORIZED') {
    const err = new Error('Higgsfield did not confirm authorization.');
    err.code = 'token_exchange_failed';
    patchHiggsfieldAuthState({ lastError: { code: 'token_exchange_failed', message: err.message, at: new Date().toISOString() } });
    throw err;
  }

  return { status: 'authorized' };
}

// ── Disconnect ───────────────────────────────────────────────────────────────

/**
 * Clears the local Higgsfield OAuth session (tokens + in-flight PKCE/state).
 * The dynamic client registration is intentionally kept so reconnecting
 * does not require re-registering a new OAuth client with Higgsfield. Never
 * touches the separate, isolated HeyGen/OpenArt auth stores.
 */
export function disconnectHiggsfield() {
  patchHiggsfieldAuthState({
    tokens:                  null,
    codeVerifier:            null,
    pendingState:            null,
    pendingStateCreatedAt:   null,
    pendingAuthorizationUrl: null,
    connectedAt:             null,
    lastError:               null,
  });
  invalidateHiggsfieldDiscoveryCache();
  return { status: 'disconnected' };
}

// ── Tool discovery ───────────────────────────────────────────────────────────

/**
 * Authenticates, connects, and calls listTools(). Returns only sanitized
 * tool metadata (name, description, input schema) — never raw MCP session
 * details, annotations that could carry sensitive data, or credentials.
 * Throws a clear, typed error instead of silently falling back when
 * authentication is missing or invalid. The returned list is the source of
 * truth for what Checkpoint 2 may implement — nothing here is hard-coded.
 */
export async function listHiggsfieldTools(redirectUrl) {
  if (!isHiggsfieldMcpEnabled()) {
    const err = new Error('Higgsfield MCP is not enabled. Set HIGGSFIELD_MCP_ENABLED=true.');
    err.code = 'disabled';
    throw err;
  }

  const state = getHiggsfieldAuthState();
  if (!state.tokens?.access_token) {
    const err = new Error('Higgsfield is not authenticated. Connect via POST /api/production/providers/higgsfield/connect first.');
    err.code = 'authorization_required';
    throw err;
  }

  const provider  = new HiggsfieldOAuthClientProvider(redirectUrl);
  const transport = new StreamableHTTPClientTransport(new URL(getHiggsfieldMcpUrl()), { authProvider: provider });
  const client    = new Client({ name: 'mika-mission-control', version: '1.0.0' }, { capabilities: {} });

  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    return tools.map(tool => ({
      name:        tool.name,
      description: tool.description || '',
      inputSchema: tool.inputSchema,
    }));
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      const err = new Error('Higgsfield authorization is missing or expired. Reconnect via POST /api/production/providers/higgsfield/connect.');
      err.code = 'authorization_required';
      throw err;
    }
    throw e;
  } finally {
    await client.close().catch(() => {});
  }
}

// ── Generic tool call ────────────────────────────────────────────────────────

/**
 * Normalizes an MCP callTool() result into a shape callers can use without
 * caring which content representation the server chose. Never includes
 * transport/session/credential details. Duplicated (not shared) from the
 * equivalent HeyGen/OpenArt helpers — this module stays fully independent.
 */
function normalizeHiggsfieldToolResult(result) {
  const content   = Array.isArray(result?.content) ? result.content : [];
  const texts     = content.filter(c => c?.type === 'text' && typeof c.text === 'string').map(c => c.text);
  const resources = content
    .filter(c => c?.type === 'resource_link' || c?.type === 'resource')
    .map(c => (c.type === 'resource_link' ? { uri: c.uri, mimeType: c.mimeType || null } : {
      uri:      c.resource?.uri || null,
      mimeType: c.resource?.mimeType || null,
      text:     typeof c.resource?.text === 'string' ? c.resource.text : undefined,
    }))
    .filter(r => r.uri);

  const text = texts.length ? texts.join('\n') : null;

  let json = result?.structuredContent ?? null;
  if (json === null && text) {
    try { json = JSON.parse(text); } catch { /* not JSON — leave null */ }
  }

  return {
    isError: result?.isError === true,
    text,
    json,
    resources,
  };
}

/**
 * Opens an authenticated Streamable HTTP MCP connection, calls a named tool
 * with arguments, and always closes the client/transport — even on error.
 * Never exposes OAuth credentials to the caller. Checkpoint 1 only ever
 * calls this for a discovered account/profile tool — never a generation tool.
 */
export async function callHiggsfieldTool(toolName, args = {}, { redirectUrl } = {}) {
  if (!isHiggsfieldMcpEnabled()) {
    const err = new Error('Higgsfield MCP is not enabled. Set HIGGSFIELD_MCP_ENABLED=true.');
    err.code = 'disabled';
    throw err;
  }

  const state = getHiggsfieldAuthState();
  if (!state.tokens?.access_token) {
    const err = new Error('Higgsfield is not authenticated. Connect via POST /api/production/providers/higgsfield/connect first.');
    err.code = 'authorization_required';
    throw err;
  }

  const provider  = new HiggsfieldOAuthClientProvider(redirectUrl);
  const transport = new StreamableHTTPClientTransport(new URL(getHiggsfieldMcpUrl()), { authProvider: provider });
  const client    = new Client({ name: 'mika-mission-control', version: '1.0.0' }, { capabilities: {} });

  try {
    await client.connect(transport);
    const result = await client.callTool({ name: toolName, arguments: args });
    const normalized = normalizeHiggsfieldToolResult(result);
    if (normalized.isError) {
      const err = new Error(normalized.text || `Higgsfield tool "${toolName}" returned an error.`);
      err.code = 'tool_error';
      err.toolName = toolName;
      // A tool-level error that reads like an expired session is an AUTH
      // failure, not a tool failure — this is exactly the case that used to
      // leave status reporting "connected" while every call failed.
      if (/session (has )?expired|no longer valid|re-?authori[sz]e|unauthori[sz]ed/i.test(normalized.text || '')) {
        noteHiggsfieldAuthOutcome(false, 'refresh_required', normalized.text);
      }
      throw err;
    }
    // A real authenticated call succeeded — the only thing that can verify a session.
    noteHiggsfieldAuthOutcome(true);
    return normalized;
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      noteHiggsfieldAuthOutcome(false, 'refresh_required', e.message);
      const err = new Error('Higgsfield authorization is missing or expired. Reconnect via POST /api/production/providers/higgsfield/connect.');
      err.code = 'authorization_required';
      throw err;
    }
    throw e;
  } finally {
    await client.close().catch(() => {});
  }
}

// ── Account/profile tool discovery ───────────────────────────────────────────
// Never assumes an exact tool name — scans the LIVE discovered tool list for
// one whose name/description reads like an account, profile, or
// credits/subscription lookup. Pure — no I/O.

const ACCOUNT_TOOL_PATTERN = /current[_\s-]?user|get[_\s-]?user|account|profile|subscription|credits?|plan|workspace|whoami|\bme\b|balance/i;

// Exact NAME matches first (highest confidence, zero false-positive risk),
// then name-pattern matches, and only as a last resort a DESCRIPTION-pattern
// match. Description-matching alone is unreliable on a large, verbose tool
// set — confirmed via real Higgsfield discovery, where a broad "current
// user" description-pattern falsely matched "apps_invoke" (whose description
// happens to contain the phrase "as the current user") before ever reaching
// the real "balance" tool. Real discovery confirmed Higgsfield's account/
// credit tool is literally named "balance" — checked first, exactly.
const EXACT_NAME_PRIORITY = ['balance', 'get_current_user', 'account', 'account_summary', 'me', 'whoami'];

export function findHiggsfieldAccountTool(tools) {
  if (!Array.isArray(tools)) return null;

  for (const exactName of EXACT_NAME_PRIORITY) {
    const found = tools.find(t => t.name === exactName);
    if (found) return found;
  }

  const namePatterns = [
    /^get[_\s-]?current[_\s-]?user$/i,
    /current[_\s-]?user/i,
    /account[_\s-]?summary|account[_\s-]?info/i,
    /profile/i,
    /subscription|credits?|plan|balance/i,
    ACCOUNT_TOOL_PATTERN,
  ];
  for (const pattern of namePatterns) {
    const found = tools.find(t => pattern.test(t.name));
    if (found) return found;
  }

  // Description-only matching — last resort, most prone to false positives.
  const descriptionPatterns = [
    /account[_\s-]?summary|account[_\s-]?info/i,
    /subscription|credits?|plan|balance/i,
  ];
  for (const pattern of descriptionPatterns) {
    const found = tools.find(t => pattern.test(t.description || ''));
    if (found) return found;
  }
  return null;
}

/**
 * Best-effort extraction of plan/credit fields from whatever shape the
 * discovered account tool actually returns. Higgsfield's live "balance"
 * tool (confirmed via real discovery) returns exactly
 * { credits: number, subscription_plan_type: string } — no account/
 * workspace name field exists at all, so accountName is honestly always
 * null for this tool. The broader key scan is kept as a fallback in case a
 * different account tool is ever matched instead. Never exposes email
 * unless no other identifying field is present. Never persists the raw
 * response — this function's return value only.
 */
function extractAccountSummary(normalized) {
  const raw = normalized.json && typeof normalized.json === 'object' ? normalized.json : {};
  const flat = { ...raw, ...(raw.data && typeof raw.data === 'object' ? raw.data : {}), ...(raw.user && typeof raw.user === 'object' ? raw.user : {}) };

  const firstDefined = (...keys) => {
    for (const k of keys) {
      if (flat[k] !== undefined && flat[k] !== null && flat[k] !== '') return flat[k];
    }
    return null;
  };

  const planName          = firstDefined('subscription_plan_type', 'plan_name', 'planName', 'plan', 'subscription_plan', 'tier');
  const remainingCredits  = firstDefined('credits', 'remaining_credits', 'remainingCredits', 'credit_balance', 'balance', 'remaining_quota');
  const accountName       = firstDefined('workspace_name', 'workspaceName', 'display_name', 'displayName', 'name', 'username');

  return {
    authenticated: true,
    planName: planName != null ? String(planName).slice(0, 200) : null,
    remainingCredits: (typeof remainingCredits === 'number' || (typeof remainingCredits === 'string' && remainingCredits.trim() !== '' && !Number.isNaN(Number(remainingCredits))))
      ? Number(remainingCredits)
      : null,
    accountName: accountName != null ? String(accountName).slice(0, 200) : null,
  };
}

/**
 * Finds an account/profile tool from the LIVE discovered list and calls it.
 * If no such tool exists, returns { ok: false, reason: 'no_account_tool' } —
 * connection can still be reported healthy from listTools() succeeding alone.
 * Never persists the response.
 */
export async function getHiggsfieldAccountSummary(redirectUrl) {
  let tools;
  try {
    tools = await listHiggsfieldTools(redirectUrl);
  } catch (e) {
    return { ok: false, reason: e.code || 'discovery_failed', error: e.message };
  }

  const accountTool = findHiggsfieldAccountTool(tools);
  if (!accountTool) {
    return { ok: false, reason: 'no_account_tool' };
  }

  try {
    const result = await callHiggsfieldTool(accountTool.name, {}, { redirectUrl });
    return { ok: true, toolName: accountTool.name, accountSummary: extractAccountSummary(result) };
  } catch (e) {
    return { ok: false, reason: e.code || 'account_tool_failed', error: e.message, toolName: accountTool.name };
  }
}

// ── Health check (Checkpoint 1 scope — connection only) ─────────────────────
// Checkpoint 2 will layer required-generation-tool checks on top of this
// once live discovery confirms the exact tool names — see
// lib/production/execution/adapters/higgsfieldMcp.adapter.js.

/**
 * disabled                 — HIGGSFIELD_MCP_ENABLED is not true
 * authentication_required  — enabled, but no OAuth tokens on file
 * active                   — authenticated, listTools() succeeds
 * auth_failed              — tokens existed but were rejected, or refresh failed
 * unavailable              — any other transport/provider failure
 */
export async function checkHiggsfieldMcpConnection() {
  if (!isHiggsfieldMcpEnabled()) {
    return {
      ok:        false,
      status:    'disabled',
      error:     'Higgsfield MCP is disabled. Set HIGGSFIELD_MCP_ENABLED=true, then connect via POST /api/production/providers/higgsfield/connect.',
      adapterId: 'higgsfield-mcp',
    };
  }

  const state = getHiggsfieldAuthState();
  if (!state.tokens?.access_token) {
    return {
      ok:        false,
      status:    'authentication_required',
      error:     'Higgsfield is enabled but not authenticated. Connect via POST /api/production/providers/higgsfield/connect.',
      adapterId: 'higgsfield-mcp',
    };
  }

  const t0 = Date.now();
  try {
    const redirectUrl = String(process.env.HIGGSFIELD_MCP_OAUTH_REDIRECT_URL || '').trim() || undefined;
    const tools = await listHiggsfieldTools(redirectUrl);
    return {
      ok:        true,
      status:    'active',
      latencyMs: Date.now() - t0,
      adapterId: 'higgsfield-mcp',
      toolCount: tools.length,
    };
  } catch (e) {
    const authFailed = ['authorization_required', 'token_exchange_failed', 'refresh_failed'].includes(e.code);
    return {
      ok:        false,
      status:    authFailed ? 'auth_failed' : 'unavailable',
      error:     e.message,
      latencyMs: Date.now() - t0,
      adapterId: 'higgsfield-mcp',
    };
  }
}
