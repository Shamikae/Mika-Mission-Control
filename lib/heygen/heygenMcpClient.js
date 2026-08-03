// lib/heygen/heygenMcpClient.js
// SERVER-SIDE ONLY. Never import from client components.
//
// OAuth-authenticated MCP connection to HeyGen's official Remote MCP server
// (Streamable HTTP transport, https://mcp.heygen.com/mcp/v1/). There is no
// HEYGEN_API_KEY — authentication is per-account OAuth, billed against the
// authenticated user's existing HeyGen web-plan premium credits.
//
// Checkpoint 1 scope ONLY: connect, discover tools, report status, identify
// (and optionally call) an account/profile tool. This file intentionally
// does not implement — and must not be extended to implement — generation
// tool invocation. Never returns access tokens, refresh tokens, client
// secrets, registration secrets, PKCE verifiers, or OAuth state. Callers
// only ever see sanitized, non-secret shapes. Deliberately independent of
// lib/openart/* — no shared imports, no shared auth state.

import { Client }                        from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { auth, UnauthorizedError }       from '@modelcontextprotocol/sdk/client/auth.js';

import { HeyGenOAuthClientProvider } from './heygenAuthProvider.js';
import { getHeyGenAuthState, patchHeyGenAuthState } from './heygenAuthStore.js';
import { getCachedHeyGenDiscovery, setCachedHeyGenDiscovery, invalidateHeyGenDiscoveryCache } from './heygenDiscoveryCache.js';

const DEFAULT_MCP_URL = 'https://mcp.heygen.com/mcp/v1/';
const PENDING_STATE_TTL_MS = 10 * 60 * 1000; // one-time-use CSRF state, expires if never completed

// ── Config ────────────────────────────────────────────────────────────────────

export function isHeyGenMcpEnabled() {
  return String(process.env.HEYGEN_MCP_ENABLED || '').trim().toLowerCase() === 'true';
}

export function getHeyGenMcpUrl() {
  return String(process.env.HEYGEN_MCP_URL || DEFAULT_MCP_URL).trim();
}

/** Sanitized, non-secret config summary. */
export function getHeyGenMcpConfig() {
  return { enabled: isHeyGenMcpEnabled(), mcpUrl: getHeyGenMcpUrl() };
}

// ── Error classification ─────────────────────────────────────────────────────
// Best-effort classification of whatever error text the provider's own
// authorization server / the MCP SDK actually returns — never a fabricated
// or guessed HeyGen-specific endpoint/response shape. Falls back to a
// generic, still-honest code when nothing matches.

const ERROR_PATTERNS = [
  { code: 'domain_not_whitelisted', pattern: /domain|whitelist|origin|not[\s_-]?allowed|unauthorized[\s_-]?client|redirect_uri/i },
  { code: 'access_denied',          pattern: /access_denied|user[\s_-]?denied|declined/i },
];

export function classifyHeyGenAuthError(rawCode, rawDescription) {
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
export function getHeyGenConnectionStatus() {
  const enabled = isHeyGenMcpEnabled();
  const state   = getHeyGenAuthState();

  const clientRegistered = !!state.clientInformation?.client_id;
  const authenticated    = !!state.tokens?.access_token;

  let status;
  if (!enabled)             status = 'staged';
  else if (!authenticated)  status = 'authentication_required';
  else                      status = 'connected';

  return {
    enabled,
    mcpUrl:          getHeyGenMcpUrl(),
    status,
    clientRegistered,
    authenticated,
    connectedAt:     state.connectedAt || null,
    domainWhitelistingRequired: state.lastError?.code === 'domain_not_whitelisted',
    lastErrorCode:   state.lastError?.code || null,
    lastErrorAt:     state.lastError?.at || null,
  };
}

// ── Redirect URL helper ──────────────────────────────────────────────────────

export function buildHeyGenCallbackUrl(req) {
  const configured = String(process.env.HEYGEN_MCP_OAUTH_REDIRECT_URL || '').trim();
  if (configured) return configured;

  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host  = req.headers.host;
  return `${proto}://${host}/api/production/providers/heygen/callback`;
}

/**
 * Safe redirect URI validation — only ever accepted if it matches the
 * explicitly configured HEYGEN_MCP_OAUTH_REDIRECT_URL, or is a localhost URL
 * during non-production development. Prevents an open-redirect style abuse
 * of the OAuth flow via a manipulated Host header.
 */
export function isAllowedHeyGenRedirectUrl(url) {
  const configured = String(process.env.HEYGEN_MCP_OAUTH_REDIRECT_URL || '').trim();
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
export async function beginHeyGenAuthorization(redirectUrl) {
  if (!isHeyGenMcpEnabled()) {
    const err = new Error('HeyGen MCP is not enabled. Set HEYGEN_MCP_ENABLED=true before connecting.');
    err.code = 'disabled';
    throw err;
  }
  if (!isAllowedHeyGenRedirectUrl(redirectUrl)) {
    const err = new Error('Refusing to start OAuth with an unrecognized redirect URL.');
    err.code = 'invalid_redirect';
    throw err;
  }

  const provider = new HeyGenOAuthClientProvider(redirectUrl);
  let result;
  try {
    result = await auth(provider, { serverUrl: getHeyGenMcpUrl() });
  } catch (e) {
    const code = /regist/i.test(e.message || '') ? 'registration_failed' : classifyHeyGenAuthError(e.code, e.message);
    patchHeyGenAuthState({ lastError: { code, message: e.message, at: new Date().toISOString() } });
    const err = new Error(e.message || 'HeyGen authorization could not be started.');
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
 * beginHeyGenAuthorization() time (one-time-use CSRF protection, with a
 * 10-minute expiry so an abandoned flow can never be replayed later), then
 * exchanges the authorization code for tokens.
 */
export async function completeHeyGenAuthorization({ redirectUrl, code, state: returnedState }) {
  if (!isAllowedHeyGenRedirectUrl(redirectUrl)) {
    const err = new Error('Refusing to complete OAuth with an unrecognized redirect URL.');
    err.code = 'invalid_redirect';
    throw err;
  }
  if (!code) {
    const err = new Error('Missing authorization code from HeyGen.');
    err.code = 'callback_missing_code';
    throw err;
  }

  const stored = getHeyGenAuthState();
  const pendingCreatedAt = stored.pendingStateCreatedAt ? new Date(stored.pendingStateCreatedAt).getTime() : 0;
  const stateExpired = !pendingCreatedAt || (Date.now() - pendingCreatedAt) > PENDING_STATE_TTL_MS;

  if (!returnedState || !stored.pendingState || returnedState !== stored.pendingState || stateExpired) {
    const err = new Error(stateExpired && stored.pendingState ? 'OAuth state expired — reconnect and try again.' : 'OAuth state mismatch — possible CSRF attempt. Reconnect and try again.');
    err.code = 'state_mismatch';
    // An expired state is dead regardless — clear it so it can't linger.
    // A mismatched-but-unexpired state is NOT cleared here: it may just be a
    // stray/forged request, and the real pending state must survive so the
    // legitimate callback can still complete (otherwise a guesser could DoS
    // an in-flight authorization by racing a bad state value ahead of it).
    const patch = { lastError: { code: 'state_mismatch', message: err.message, at: new Date().toISOString() } };
    if (stateExpired) Object.assign(patch, { pendingState: null, pendingStateCreatedAt: null, pendingAuthorizationUrl: null });
    patchHeyGenAuthState(patch);
    throw err;
  }

  // Consume the pending state immediately so it cannot be replayed.
  patchHeyGenAuthState({ pendingState: null, pendingStateCreatedAt: null, pendingAuthorizationUrl: null });

  const provider = new HeyGenOAuthClientProvider(redirectUrl);
  let result;
  try {
    result = await auth(provider, { serverUrl: getHeyGenMcpUrl(), authorizationCode: code });
  } catch (e) {
    const code2 = classifyHeyGenAuthError(e.code, e.message) === 'authorization_error' ? 'token_exchange_failed' : classifyHeyGenAuthError(e.code, e.message);
    patchHeyGenAuthState({ lastError: { code: code2, message: e.message, at: new Date().toISOString() } });
    const err = new Error(e.message || 'HeyGen token exchange failed.');
    err.code = code2;
    throw err;
  }

  if (result !== 'AUTHORIZED') {
    const err = new Error('HeyGen did not confirm authorization.');
    err.code = 'token_exchange_failed';
    patchHeyGenAuthState({ lastError: { code: 'token_exchange_failed', message: err.message, at: new Date().toISOString() } });
    throw err;
  }

  return { status: 'authorized' };
}

// ── Disconnect ───────────────────────────────────────────────────────────────

/**
 * Clears the local HeyGen OAuth session (tokens + in-flight PKCE/state).
 * The dynamic client registration is intentionally kept so reconnecting
 * does not require re-registering a new OAuth client with HeyGen. Never
 * touches the separate, isolated OpenArt auth store.
 */
export function disconnectHeyGen() {
  patchHeyGenAuthState({
    tokens:                  null,
    codeVerifier:            null,
    pendingState:            null,
    pendingStateCreatedAt:   null,
    pendingAuthorizationUrl: null,
    connectedAt:             null,
    lastError:               null,
  });
  invalidateHeyGenDiscoveryCache();
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
export async function listHeyGenTools(redirectUrl) {
  if (!isHeyGenMcpEnabled()) {
    const err = new Error('HeyGen MCP is not enabled. Set HEYGEN_MCP_ENABLED=true.');
    err.code = 'disabled';
    throw err;
  }

  const state = getHeyGenAuthState();
  if (!state.tokens?.access_token) {
    const err = new Error('HeyGen is not authenticated. Connect via POST /api/production/providers/heygen/connect first.');
    err.code = 'authorization_required';
    throw err;
  }

  const provider  = new HeyGenOAuthClientProvider(redirectUrl);
  const transport = new StreamableHTTPClientTransport(new URL(getHeyGenMcpUrl()), { authProvider: provider });
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
      const err = new Error('HeyGen authorization is missing or expired. Reconnect via POST /api/production/providers/heygen/connect.');
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
 * equivalent OpenArt helper — this module stays fully independent.
 */
function normalizeHeyGenToolResult(result) {
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
export async function callHeyGenTool(toolName, args = {}, { redirectUrl } = {}) {
  if (!isHeyGenMcpEnabled()) {
    const err = new Error('HeyGen MCP is not enabled. Set HEYGEN_MCP_ENABLED=true.');
    err.code = 'disabled';
    throw err;
  }

  const state = getHeyGenAuthState();
  if (!state.tokens?.access_token) {
    const err = new Error('HeyGen is not authenticated. Connect via POST /api/production/providers/heygen/connect first.');
    err.code = 'authorization_required';
    throw err;
  }

  const provider  = new HeyGenOAuthClientProvider(redirectUrl);
  const transport = new StreamableHTTPClientTransport(new URL(getHeyGenMcpUrl()), { authProvider: provider });
  const client    = new Client({ name: 'mika-mission-control', version: '1.0.0' }, { capabilities: {} });

  try {
    await client.connect(transport);
    const result = await client.callTool({ name: toolName, arguments: args });
    const normalized = normalizeHeyGenToolResult(result);
    if (normalized.isError) {
      const err = new Error(normalized.text || `HeyGen tool "${toolName}" returned an error.`);
      err.code = 'tool_error';
      err.toolName = toolName;
      throw err;
    }
    return normalized;
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      const err = new Error('HeyGen authorization is missing or expired. Reconnect via POST /api/production/providers/heygen/connect.');
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

const ACCOUNT_TOOL_PATTERN = /current[_\s-]?user|get[_\s-]?user|account|profile|subscription|credits?|plan|workspace|whoami|\bme\b/i;

export function findHeyGenAccountTool(tools) {
  if (!Array.isArray(tools)) return null;
  // Prefer the most specific, unambiguous match first.
  const priority = [
    /^get[_\s-]?current[_\s-]?user$/i,
    /current[_\s-]?user/i,
    /account[_\s-]?summary|account[_\s-]?info/i,
    /profile/i,
    /subscription|credits?|plan/i,
    ACCOUNT_TOOL_PATTERN,
  ];
  for (const pattern of priority) {
    const found = tools.find(t => pattern.test(t.name) || pattern.test(t.description || ''));
    if (found) return found;
  }
  return null;
}

/**
 * Best-effort extraction of plan/credit fields from whatever shape the
 * discovered account tool actually returns — HeyGen's MCP response format
 * for this tool is not documented ahead of a real discovery call, so this
 * scans common key names rather than assuming one exact schema. Never
 * exposes email unless no other identifying field is present. Never
 * persists the raw response — this function's return value only.
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

  // HeyGen's live get_current_user response (confirmed via real discovery)
  // nests plan under subscription.plan and web-plan premium credits under
  // subscription.credits.premium_credits.remaining — the generic top-level
  // key scan below is kept as a fallback for other account-tool shapes.
  const subscription = raw.subscription && typeof raw.subscription === 'object' ? raw.subscription : null;
  const premiumCredits = subscription?.credits?.premium_credits;
  const wallet = raw.wallet && typeof raw.wallet === 'object' ? raw.wallet : null;

  const planName        = subscription?.plan ?? firstDefined('plan_name', 'planName', 'plan', 'subscription_plan', 'tier');
  const remainingCredits = premiumCredits?.remaining ?? wallet?.balance ?? firstDefined('remaining_credits', 'remainingCredits', 'credits', 'credit_balance', 'balance', 'remaining_quota');
  const accountName      = firstDefined('workspace_name', 'workspaceName', 'display_name', 'displayName', 'name', 'username')
    || (Object.keys(flat).length === 0 ? null : null); // never fall back to email here

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
export async function getHeyGenAccountSummary(redirectUrl) {
  let tools;
  try {
    tools = await listHeyGenTools(redirectUrl);
  } catch (e) {
    return { ok: false, reason: e.code || 'discovery_failed', error: e.message };
  }

  const accountTool = findHeyGenAccountTool(tools);
  if (!accountTool) {
    return { ok: false, reason: 'no_account_tool' };
  }

  try {
    const result = await callHeyGenTool(accountTool.name, {}, { redirectUrl });
    return { ok: true, toolName: accountTool.name, accountSummary: extractAccountSummary(result) };
  } catch (e) {
    return { ok: false, reason: e.code || 'account_tool_failed', error: e.message, toolName: accountTool.name };
  }
}

// ── Health check ─────────────────────────────────────────────────────────────
// Checkpoint 2 note: this is the EXECUTION-readiness status (six-value
// vocabulary below), a distinct namespace from getHeyGenConnectionStatus()'s
// CONNECTION status (staged/authentication_required/connected), which is
// unchanged and still drives HeyGenConnectionPanel/GET .../status exactly as
// in Checkpoint 1. Nothing here alters that function or its callers.

// The two live-discovered tools the adapter actually depends on. Checked by
// name, never guessed — Checkpoint 1's real discovery confirmed both exist.
export const REQUIRED_HEYGEN_GENERATION_TOOLS = ['create_video_from_avatar', 'get_video'];
const REQUIRED_GENERATION_SCHEMA_FIELDS = ['avatarId', 'script', 'voiceId'];

/**
 * disabled                 — HEYGEN_MCP_ENABLED is not true
 * authentication_required  — enabled, but no OAuth tokens on file
 * tooling_incomplete       — authenticated, but a required tool or its
 *                             expected schema fields are missing from the
 *                             live discovered tool list
 * active                   — authenticated, required tools + schema present
 * auth_failed              — tokens existed but were rejected, or refresh failed
 * unavailable              — any other transport/provider failure
 */
export async function checkHeyGenMcpHealth() {
  if (!isHeyGenMcpEnabled()) {
    return {
      ok:        false,
      status:    'disabled',
      error:     'HeyGen MCP is disabled. Set HEYGEN_MCP_ENABLED=true, then connect via POST /api/production/providers/heygen/connect.',
      adapterId: 'heygen-mcp',
    };
  }

  const state = getHeyGenAuthState();
  if (!state.tokens?.access_token) {
    return {
      ok:        false,
      status:    'authentication_required',
      error:     'HeyGen is enabled but not authenticated. Connect via POST /api/production/providers/heygen/connect.',
      adapterId: 'heygen-mcp',
    };
  }

  const t0 = Date.now();
  try {
    const redirectUrl = String(process.env.HEYGEN_MCP_OAUTH_REDIRECT_URL || '').trim() || undefined;
    const tools = await listHeyGenTools(redirectUrl);

    const missing = REQUIRED_HEYGEN_GENERATION_TOOLS.filter(name => !tools.some(t => t.name === name));
    if (missing.length) {
      return {
        ok: false, status: 'tooling_incomplete',
        error: `Required HeyGen MCP tool(s) not found in the live discovered list: ${missing.join(', ')}.`,
        latencyMs: Date.now() - t0, adapterId: 'heygen-mcp', toolCount: tools.length,
      };
    }

    const genTool = tools.find(t => t.name === 'create_video_from_avatar');
    const schemaFields = Object.keys(genTool?.inputSchema?.properties || {});
    const missingFields = REQUIRED_GENERATION_SCHEMA_FIELDS.filter(f => !schemaFields.includes(f));
    if (missingFields.length) {
      return {
        ok: false, status: 'tooling_incomplete',
        error: `HeyGen's "create_video_from_avatar" schema is missing expected field(s): ${missingFields.join(', ')}.`,
        latencyMs: Date.now() - t0, adapterId: 'heygen-mcp', toolCount: tools.length,
      };
    }

    return {
      ok:        true,
      status:    'active',
      latencyMs: Date.now() - t0,
      adapterId: 'heygen-mcp',
      toolCount: tools.length,
    };
  } catch (e) {
    const authFailed = ['authorization_required', 'token_exchange_failed', 'refresh_failed'].includes(e.code);
    return {
      ok:        false,
      status:    authFailed ? 'auth_failed' : 'unavailable',
      error:     e.message,
      latencyMs: Date.now() - t0,
      adapterId: 'heygen-mcp',
    };
  }
}

// ── Avatar / voice discovery (sanitized, UI-facing) ──────────────────────────
// list_avatar_looks / list_voices are plain listing tools — read-only, never
// generation. "The look id is the avatar_id to pass when creating a video"
// (confirmed via live discovery), so list_avatar_looks — not
// list_avatar_groups — is the correct avatar-selection source.

function matchesSearch(haystack, search) {
  if (!search) return true;
  return String(haystack || '').toLowerCase().includes(String(search).toLowerCase());
}

/**
 * Sanitized avatar list: { avatarId, displayName, type, gender, previewUrl,
 * availability }[]. previewUrl is for temporary UI display only — callers
 * must never persist it into a Production Job or Content Package.
 */
export async function listHeyGenAvatars({ redirectUrl, search, limit = 50 } = {}) {
  const cacheKey = 'avatars';
  let all = getCachedHeyGenDiscovery(cacheKey);
  if (!all) {
    const result = await callHeyGenTool('list_avatar_looks', { limit: 50 }, { redirectUrl });
    const items = Array.isArray(result.json?.items) ? result.json.items : [];
    all = items.map(it => ({
      avatarId:     it.id,
      displayName:  typeof it.name === 'string' ? it.name.trim() : it.name,
      type:         it.avatar_type || null,
      gender:       it.gender || null,
      previewUrl:   it.preview_image_url || it.preview_video_url || null,
      availability: it.status === 'completed' ? 'available' : (it.status || 'unknown'),
    }));
    setCachedHeyGenDiscovery(cacheKey, all);
  }
  return all.filter(it => matchesSearch(it.displayName, search)).slice(0, Math.min(Math.max(Number(limit) || 50, 1), 50));
}

/**
 * Sanitized voice list: { voiceId, displayName, language, gender, locale,
 * previewUrl, availability }[]. previewUrl is temporary-display-only.
 */
export async function listHeyGenVoices({ redirectUrl, search, language, gender, limit = 50 } = {}) {
  const cacheKey = `voices:${language || ''}:${gender || ''}`;
  let all = getCachedHeyGenDiscovery(cacheKey);
  if (!all) {
    const args = { limit: 100 };
    if (language) args.language = String(language).slice(0, 60);
    if (gender) args.gender = String(gender).slice(0, 20);
    const result = await callHeyGenTool('list_voices', args, { redirectUrl });
    const items = Array.isArray(result.json?.items) ? result.json.items : [];
    all = items.map(it => ({
      voiceId:      it.voice_id,
      displayName:  typeof it.name === 'string' ? it.name.trim() : it.name,
      language:     it.language || null,
      gender:       it.gender || null,
      locale:       it.locale || null,
      previewUrl:   it.preview_audio_url || null,
      availability: 'available',
    }));
    setCachedHeyGenDiscovery(cacheKey, all);
  }
  return all.filter(it => matchesSearch(it.displayName, search)).slice(0, Math.min(Math.max(Number(limit) || 50, 1), 100));
}

/**
 * Sanitized, relevant-only fields from the live "create_video_from_avatar"
 * schema — the tool the adapter actually submits to. Never returns the raw
 * MCP schema verbatim (drops unrelated fields like callbackUrl/engine/
 * motionPrompt that Checkpoint 2 does not use). Returns null if the tool is
 * not currently discoverable.
 */
export async function getHeyGenGenerationSchema(redirectUrl) {
  const cacheKey = 'generation-schema';
  const cached = getCachedHeyGenDiscovery(cacheKey);
  if (cached) return cached;

  const tools = await listHeyGenTools(redirectUrl);
  const tool = tools.find(t => t.name === 'create_video_from_avatar');
  if (!tool) return null;

  const props = tool.inputSchema?.properties || {};
  const resolutionEnum = props.resolution?.anyOf?.find(v => Array.isArray(v.enum))?.enum || null;
  const aspectRatioEnum = props.aspectRatio?.anyOf?.find(v => Array.isArray(v.enum))?.enum || null;
  const outputFormatEnum = Array.isArray(props.outputFormat?.enum) ? props.outputFormat.enum : null;

  const voiceSettingsDef = tool.inputSchema?.$defs?.VoiceSettingsInput?.properties || {};
  const speedRange = voiceSettingsDef.speed
    ? { min: voiceSettingsDef.speed.minimum ?? null, max: voiceSettingsDef.speed.maximum ?? null, default: voiceSettingsDef.speed.default ?? null }
    : null;

  const captionDef = tool.inputSchema?.$defs?.CaptionStyle;
  const captionStyleEnum = Array.isArray(captionDef?.enum) ? captionDef.enum : null;

  const schema = {
    toolName: tool.name,
    supportsScript: 'script' in props,
    supportsVoiceId: 'voiceId' in props,
    supportsResolution: !!resolutionEnum,
    resolutionOptions: resolutionEnum,
    supportsAspectRatio: !!aspectRatioEnum,
    aspectRatioOptions: aspectRatioEnum,
    supportsOutputFormat: !!outputFormatEnum,
    outputFormatOptions: outputFormatEnum,
    supportsCaption: 'caption' in props,
    captionStyleOptions: captionStyleEnum,
    supportsVoiceSpeed: !!speedRange,
    voiceSpeedRange: speedRange,
    supportsAvatarStyle: false, // no style enum exists on this tool's avatarId path — style comes from the selected look itself
  };
  setCachedHeyGenDiscovery(cacheKey, schema);
  return schema;
}
