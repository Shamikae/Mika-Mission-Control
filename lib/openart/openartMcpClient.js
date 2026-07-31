// lib/openart/openartMcpClient.js
// SERVER-SIDE ONLY. Never import from client components.
//
// OAuth-authenticated MCP connection to OpenArt (Streamable HTTP transport).
// Checkpoint 2 scope: connect, discover tools, report status, and governed
// text-to-image generation (model selection, schema-driven params, prompt
// governance, credit budget guard, bounded polling, and validated download).
//
// Never returns access tokens, refresh tokens, client secrets, or
// registration secrets. Callers only ever see sanitized, non-secret shapes.
// Provider CDN/resource URLs are never persisted — bytes are downloaded
// immediately and only local artifact paths are kept.

import { Client }                        from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { auth, UnauthorizedError }       from '@modelcontextprotocol/sdk/client/auth.js';

import { OpenArtOAuthClientProvider } from './openartAuthProvider.js';
import { getOpenArtAuthState, patchOpenArtAuthState } from './openartAuthStore.js';

const DEFAULT_MCP_URL = 'https://mcp.openart.ai/mcp';

// ── Config ────────────────────────────────────────────────────────────────────

export function isOpenArtEnabled() {
  return String(process.env.OPENART_ENABLED || '').trim().toLowerCase() === 'true';
}

export function getOpenArtMcpUrl() {
  return String(process.env.OPENART_MCP_URL || DEFAULT_MCP_URL).trim();
}

// ── Non-secret status ────────────────────────────────────────────────────────

/**
 * Returns connection status safe to expose to any authenticated API caller.
 * Never includes token values, client secrets, or registration secrets.
 */
export function getOpenArtConnectionStatus() {
  const enabled = isOpenArtEnabled();
  const state   = getOpenArtAuthState();

  const clientRegistered = !!state.clientInformation?.client_id;
  const authenticated    = !!state.tokens?.access_token;

  let status;
  if (!enabled)          status = 'staged';
  else if (!authenticated) status = 'authentication_required';
  else                    status = 'connected';

  return {
    enabled,
    mcpUrl:          getOpenArtMcpUrl(),
    status,
    clientRegistered,
    authenticated,
    connectedAt:     state.connectedAt || null,
  };
}

// ── Redirect URL helper ──────────────────────────────────────────────────────

export function buildOpenArtCallbackUrl(req) {
  const configured = String(process.env.OPENART_OAUTH_REDIRECT_URL || '').trim();
  if (configured) return configured;

  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host  = req.headers.host;
  return `${proto}://${host}/api/openart/callback`;
}

// ── Connect (begin authorization) ───────────────────────────────────────────

/**
 * Starts (or silently completes, if a refresh token is already valid) the
 * OAuth flow. Returns either an authorization URL to send the user to, or
 * confirmation that a valid session already exists.
 */
export async function beginOpenArtAuthorization(redirectUrl) {
  if (!isOpenArtEnabled()) {
    const err = new Error('OpenArt is not enabled. Set OPENART_ENABLED=true before connecting.');
    err.code = 'disabled';
    throw err;
  }

  const provider = new OpenArtOAuthClientProvider(redirectUrl);
  const result   = await auth(provider, { serverUrl: getOpenArtMcpUrl() });

  if (result === 'AUTHORIZED') {
    return { status: 'authorized' };
  }

  return { status: 'redirect', authorizationUrl: provider.lastAuthorizationUrl };
}

// ── Callback (complete authorization) ───────────────────────────────────────

/**
 * Validates the returned OAuth state against the value persisted at
 * beginOpenArtAuthorization() time (CSRF protection), then exchanges the
 * authorization code for tokens.
 */
export async function completeOpenArtAuthorization({ redirectUrl, code, state: returnedState }) {
  if (!code) {
    const err = new Error('Missing authorization code from OpenArt.');
    err.code = 'missing_code';
    throw err;
  }

  const stored = getOpenArtAuthState();
  if (!returnedState || !stored.pendingState || returnedState !== stored.pendingState) {
    const err = new Error('OAuth state mismatch — possible CSRF attempt. Reconnect and try again.');
    err.code = 'state_mismatch';
    throw err;
  }

  // Consume the pending state immediately so it cannot be replayed.
  patchOpenArtAuthState({ pendingState: null, pendingAuthorizationUrl: null });

  const provider = new OpenArtOAuthClientProvider(redirectUrl);
  const result   = await auth(provider, { serverUrl: getOpenArtMcpUrl(), authorizationCode: code });

  if (result !== 'AUTHORIZED') {
    const err = new Error('OpenArt did not confirm authorization.');
    err.code = 'not_authorized';
    throw err;
  }

  return { status: 'authorized' };
}

// ── Disconnect ───────────────────────────────────────────────────────────────

/**
 * Clears the local OAuth session (tokens + in-flight PKCE/state). The
 * dynamic client registration is intentionally kept so reconnecting does not
 * require re-registering a new OAuth client with OpenArt.
 */
export function disconnectOpenArt() {
  patchOpenArtAuthState({
    tokens:                  null,
    codeVerifier:            null,
    pendingState:            null,
    pendingAuthorizationUrl: null,
    connectedAt:             null,
  });
  return { status: 'disconnected' };
}

// ── Tool discovery ───────────────────────────────────────────────────────────

/**
 * Authenticates, connects, and calls listTools(). Returns only sanitized
 * tool metadata (name, description, input schema) — never raw MCP session
 * details or credentials. Throws a clear, typed error instead of silently
 * falling back when authentication is missing or invalid.
 */
export async function listOpenArtTools(redirectUrl) {
  if (!isOpenArtEnabled()) {
    const err = new Error('OpenArt is not enabled. Set OPENART_ENABLED=true.');
    err.code = 'disabled';
    throw err;
  }

  const state = getOpenArtAuthState();
  if (!state.tokens?.access_token) {
    const err = new Error('OpenArt is not authenticated. Connect via POST /api/openart/connect first.');
    err.code = 'authentication_required';
    throw err;
  }

  const provider  = new OpenArtOAuthClientProvider(redirectUrl);
  const transport = new StreamableHTTPClientTransport(new URL(getOpenArtMcpUrl()), { authProvider: provider });
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
      const err = new Error('OpenArt authorization is missing or expired. Reconnect via POST /api/openart/connect.');
      err.code = 'authentication_required';
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
 * transport/session/credential details.
 */
function normalizeToolResult(result) {
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
 * Never exposes OAuth credentials to the caller.
 */
export async function callOpenArtTool(toolName, args = {}, { redirectUrl } = {}) {
  if (!isOpenArtEnabled()) {
    const err = new Error('OpenArt is not enabled. Set OPENART_ENABLED=true.');
    err.code = 'disabled';
    throw err;
  }

  const state = getOpenArtAuthState();
  if (!state.tokens?.access_token) {
    const err = new Error('OpenArt is not authenticated. Connect via POST /api/openart/connect first.');
    err.code = 'authentication_required';
    throw err;
  }

  const provider  = new OpenArtOAuthClientProvider(redirectUrl);
  const transport = new StreamableHTTPClientTransport(new URL(getOpenArtMcpUrl()), { authProvider: provider });
  const client    = new Client({ name: 'mika-mission-control', version: '1.0.0' }, { capabilities: {} });

  try {
    await client.connect(transport);
    const result = await client.callTool({ name: toolName, arguments: args });
    const normalized = normalizeToolResult(result);
    if (normalized.isError) {
      const err = new Error(normalized.text || `OpenArt tool "${toolName}" returned an error.`);
      err.code = 'tool_error';
      err.toolName = toolName;
      throw err;
    }
    return normalized;
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      const err = new Error('OpenArt authorization is missing or expired. Reconnect via POST /api/openart/connect.');
      err.code = 'authentication_required';
      throw err;
    }
    throw e;
  } finally {
    await client.close().catch(() => {});
  }
}

// ── Governed text-to-image generation ───────────────────────────────────────
//
// Pipeline: resolve prompt (governance gate) → discover + select model →
// fetch form schema → build params from schema → estimate cost (budget
// guard) → optional project selection → generate → bounded poll → validate
// + download bytes. Every OpenArt network call goes through callOpenArtTool()
// above, so auth/credential handling is centralized in one place.

const IMAGE_COUNT_HARD_MAX = 4;

function firstDefined(...values) {
  return values.find(v => v !== undefined && v !== null);
}

// ── Intent-driven model selection ───────────────────────────────────────────
// Scores each live text2image-capable model by keyword overlap between the
// task's inferred intent and the model's OWN description text (fetched live
// from openart_model_list — no model catalog is hardcoded here). Baseline
// categories (text / branding / photoreal) reflect that Thumbnail Studio
// briefs are, by default, text-bearing branded visuals; product/illustration
// only engage when the task explicitly signals them.

const INTENT_CATEGORIES = [
  { key: 'text',         baseline: 1, taskPattern: /text overlay|headline|tagline|caption|title card|typography|words on|hook text/i, modelPattern: /in-image text|tiny text|accurate text|taglines?|translation|text fidelity/gi },
  { key: 'branding',     baseline: 1, taskPattern: /brand|logo|campaign|poster|advertisement|\bads?\b/i,                              modelPattern: /brand|logos?|posters?|\bads?\b|campaign/gi },
  { key: 'photoreal',    baseline: 1, taskPattern: /photoreal|realistic|hyperreal|lifelike|photo of|photograph/i,                      modelPattern: /photoreal|realistic|hyperreal|fine detail|\b4k\b/gi },
  { key: 'product',      baseline: 0, taskPattern: /product|packaging|hero shot|e-?commerce|merch|luxury/i,                            modelPattern: /product|luxury|hero shots?|fashion/gi },
  { key: 'illustration', baseline: 0, taskPattern: /anime|illustration|cartoon|manga|2d animation|stylized|hand-drawn/i,                modelPattern: /anime|illustration|cartoons?|manga|2d[- ]animation|stylized/gi },
];

function buildIntentText(task, finalPrompt = '') {
  return [task.taskType, task.style, task.platform, task.description, task.prompt, task.instructions, finalPrompt]
    .filter(Boolean)
    .join(' ');
}

function scoreModelForIntent(model, intentText) {
  const description = model.description || '';
  let score = 0;
  const matched = [];
  for (const cat of INTENT_CATEGORIES) {
    const hits = (description.match(cat.modelPattern) || []).length;
    if (!hits) continue;
    const taskSignals = cat.taskPattern.test(intentText);
    const weight = cat.baseline + (taskSignals ? 3 : 0);
    if (weight <= 0) continue;
    score += weight * hits;
    matched.push(cat.key);
  }
  return { score, matched };
}

/**
 * Selects a model from the LIVE, just-fetched list of text2image-capable
 * models. An explicit task.openartModel override is honored only if it is
 * present in that live list — never hard-coded, never trusted blindly.
 */
function selectOpenArtModel(candidates, task, intentText) {
  if (task.openartModel) {
    const found = candidates.find(m => m.id === task.openartModel);
    if (!found) {
      const err = new Error(
        `Requested model "${task.openartModel}" does not exist or does not support text2image. ` +
        `Available: ${candidates.map(m => m.id).join(', ')}`
      );
      err.code = 'invalid_model';
      throw err;
    }
    return { model: found, reason: `Explicit override — task.openartModel="${task.openartModel}" (verified against the live model list).` };
  }

  const scored = candidates
    .map(model => ({ model, ...scoreModelForIntent(model, intentText) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const reason = best.matched.length
    ? `Highest keyword-overlap score (${best.score}) for intent [${best.matched.join(', ')}] among ${candidates.length} text2image-capable models, matched against live model descriptions.`
    : `No strong intent signal detected — defaulted to the top-scoring general-purpose model (score ${best.score}) among ${candidates.length} text2image-capable models.`;

  return { model: best.model, reason };
}

// ── Prompt governance ────────────────────────────────────────────────────────
// Deterministic, local, rule-based "polish" — NOT an LLM. Labeled as such so
// task metadata never falsely implies an LLM touched the prompt. OpenRouter
// Fusion was considered and not reused here: its schema is fixed to
// strategy/content critique output (consensus/blindSpots/etc.), not prompt
// rewriting, and it isn't configured in this environment.

const STYLE_PROMPT_ADD = {
  'Bold / vibrant':     'bold saturated colors, high contrast, dynamic composition',
  'Clean / minimal':    'clean minimal composition, soft even lighting, uncluttered background',
  'Dark / dramatic':    'dramatic moody lighting, deep shadows, cinematic contrast',
  'Bright / energetic': 'bright vivid lighting, energetic composition, vibrant color palette',
};

const PLATFORM_PROMPT_ADD = {
  YouTube:   'thumbnail composition with a clear focal subject, readable at small size',
  TikTok:    'vertical mobile-first composition, bold central subject',
  Instagram: 'polished editorial composition',
  LinkedIn:  'professional, business-appropriate composition',
};

const PLATFORM_ASPECT_RATIO = {
  YouTube:   '16:9',
  TikTok:    '9:16',
  Instagram: '4:5',
  LinkedIn:  '1:1',
};

function cleanPrompt(prompt) {
  return prompt.trim().replace(/\s+/g, ' ').replace(/[.\s]+$/, '');
}

function deterministicPolishVariantA(prompt, task) {
  const parts = [cleanPrompt(prompt)];
  if (STYLE_PROMPT_ADD[task.style])       parts.push(STYLE_PROMPT_ADD[task.style]);
  if (PLATFORM_PROMPT_ADD[task.platform]) parts.push(PLATFORM_PROMPT_ADD[task.platform]);
  parts.push('high detail, professional quality');
  return `${parts.join(', ')}.`;
}

function deterministicPolishVariantB(prompt, task) {
  const parts = [cleanPrompt(prompt)];
  if (PLATFORM_PROMPT_ADD[task.platform]) parts.push(PLATFORM_PROMPT_ADD[task.platform]);
  if (STYLE_PROMPT_ADD[task.style])       parts.push(STYLE_PROMPT_ADD[task.style]);
  parts.push('eye-catching composition, optimized for click-through');
  return `${parts.join(', ')}.`;
}

const PROMPT_MODES = new Set(['automatic', 'exact', 'approval']);

/**
 * promptMode:
 *   automatic (default) — deterministic local polish applied, no approval gate.
 *   exact                — user's prompt sent as-is; explicit opt-out of polishing.
 *   approval              — returns two deterministic variants + the original for
 *                            the caller to choose from; generation does not proceed
 *                            until task.selectedPrompt is supplied on resubmission.
 */
function resolvePrompt(task) {
  const originalPrompt = String(task.prompt || task.description || task.instructions || '').trim();
  if (!originalPrompt) {
    const err = new Error('A prompt (task.prompt, description, or instructions) is required for image generation.');
    err.code = 'missing_prompt';
    throw err;
  }

  const promptMode = PROMPT_MODES.has(task.promptMode) ? task.promptMode : 'automatic';

  if (promptMode === 'exact') {
    return { originalPrompt, finalPrompt: originalPrompt, promptMode, enhancementMethod: 'none — exact mode (user opt-out of polishing)' };
  }

  if (promptMode === 'approval') {
    const selected = String(task.selectedPrompt || '').trim();
    if (selected) {
      return { originalPrompt, finalPrompt: selected, promptMode, enhancementMethod: 'user-selected (approval mode)' };
    }
    return {
      needsApproval:      true,
      originalPrompt,
      polishedPromptA:    deterministicPolishVariantA(originalPrompt, task),
      polishedPromptB:    deterministicPolishVariantB(originalPrompt, task),
      choices:            ['originalPrompt', 'polishedPromptA', 'polishedPromptB'],
      enhancementMethod:  'deterministic-local',
    };
  }

  return {
    originalPrompt,
    finalPrompt:       deterministicPolishVariantA(originalPrompt, task),
    promptMode:        'automatic',
    enhancementMethod: 'deterministic-local',
  };
}

// ── Schema-driven params ─────────────────────────────────────────────────────

const COUNT_ALIASES  = ['imageCount', 'numImages', 'count', 'n'];
const ASPECT_ALIASES = ['aspectRatio', 'aspect_ratio'];
const PROMPT_ALIASES = ['prompt'];

function findSchemaProperty(props, aliases) {
  return aliases.find(alias => props[alias]) || null;
}

/**
 * Builds a params object using ONLY fields declared in the model's own form
 * schema. Required fields with no explicit mapping above are filled from
 * their own schema-declared default — never guessed. A required field with
 * neither a mapping nor a default throws rather than sending a fabricated
 * value.
 */
function buildParamsFromSchema(jsonSchema, { prompt, imageCount, aspectRatio }, modelId) {
  const objectSchema = Array.isArray(jsonSchema?.allOf) ? jsonSchema.allOf[0] : jsonSchema;
  const props    = objectSchema?.properties || {};
  const required = Array.isArray(objectSchema?.required) ? objectSchema.required : [];

  const params = {};

  const promptKey = findSchemaProperty(props, PROMPT_ALIASES);
  if (!promptKey) {
    const err = new Error(`Model "${modelId}" form schema has no prompt field — cannot build a request.`);
    err.code = 'unsupported_schema';
    throw err;
  }
  params[promptKey] = prompt;

  const countKey = findSchemaProperty(props, COUNT_ALIASES);
  if (countKey) {
    const spec      = props[countKey];
    const schemaMax = Number.isFinite(spec.maximum) ? spec.maximum : IMAGE_COUNT_HARD_MAX;
    const max       = Math.min(schemaMax, IMAGE_COUNT_HARD_MAX);
    const min       = Number.isFinite(spec.minimum) ? spec.minimum : 1;
    const requested = Number.isFinite(imageCount) ? imageCount : (Number.isFinite(spec.default) ? spec.default : min);
    params[countKey] = Math.max(min, Math.min(max, Math.round(requested)));
  }

  const aspectKey = findSchemaProperty(props, ASPECT_ALIASES);
  if (aspectKey) {
    const spec     = props[aspectKey];
    const enumVals = Array.isArray(spec.enum) ? spec.enum : null;
    let value = aspectRatio && (!enumVals || enumVals.includes(aspectRatio)) ? aspectRatio : undefined;
    if (!value) value = spec.default;
    if (!value && enumVals) value = enumVals.includes('1:1') ? '1:1' : enumVals[0];
    if (value !== undefined) {
      params[aspectKey] = value;
    } else if (required.includes(aspectKey)) {
      const err = new Error(`Model "${modelId}" requires "${aspectKey}" but no default or valid value could be derived from the schema.`);
      err.code = 'unsupported_schema';
      throw err;
    }
  }

  for (const key of required) {
    if (key in params) continue;
    const spec = props[key];
    if (!spec) continue;
    if (spec.default !== undefined) {
      params[key] = spec.default;
    } else {
      const err = new Error(`Model "${modelId}" requires "${key}" with no schema default — governed generation does not support this field yet.`);
      err.code = 'unsupported_schema';
      throw err;
    }
  }

  return params;
}

// ── Cost / credits ───────────────────────────────────────────────────────────

function extractEstimatedCredits(costJson) {
  const items = costJson?.items;
  if (!Array.isArray(items) || !items.length) return null;
  const total = items.reduce((sum, item) => sum + (Number(item.totalCredits) || 0), 0);
  return Number.isFinite(total) ? total : null;
}

// ── Generation response parsing ──────────────────────────────────────────────
// Deliberately permissive about shape — different MCP responses may surface
// data via structuredContent, JSON text content, or nested result objects.

function extractHistoryId(normalized) {
  const json = normalized?.json;
  if (json) {
    const id = firstDefined(json.historyId, json.history_id, json.id, json.creation?.historyId, json.data?.historyId);
    if (id) return String(id);
  }
  if (normalized?.text) {
    const match = normalized.text.match(/"history_?[Ii]d"\s*:\s*"([^"]+)"/);
    if (match) return match[1];
  }
  return null;
}

function extractCreationStatus(json) {
  return firstDefined(json?.status, json?.creation?.status, json?.data?.status) || null;
}

function extractPollAfterSeconds(json) {
  const value = firstDefined(json?.pollAfterSeconds, json?.poll_after_seconds, json?.creation?.pollAfterSeconds);
  return Number.isFinite(value) && value > 0 ? value : 5;
}

// Only known asset-URL-shaped keys are followed — avoids picking up unrelated
// links (e.g. a web UI "share" URL) buried elsewhere in the payload.
const RESOURCE_URL_KEYS = ['url', 'resourceUrl', 'imageUrl', 'downloadUrl', 'cdnUrl', 'assetUrl', 'outputUrl', 'fileUrl'];

function collectResourceUrls(normalized) {
  const urls = new Set();

  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    for (const [key, value] of Object.entries(node)) {
      if (RESOURCE_URL_KEYS.includes(key) && typeof value === 'string' && value.startsWith('https://')) {
        urls.add(value);
      } else if (value && typeof value === 'object') {
        walk(value);
      }
    }
  }

  walk(normalized?.json);
  for (const resource of normalized?.resources || []) {
    if (resource.uri && resource.uri.startsWith('https://')) urls.add(resource.uri);
  }

  return Array.from(urls);
}

// ── Download + validate ──────────────────────────────────────────────────────

const MAX_IMAGE_DOWNLOAD_BYTES    = 15 * 1024 * 1024;
const ALLOWED_IMAGE_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * Downloads one candidate URL with a timeout and size limit, validating
 * content-type before accepting it. Returns null (never throws) on any
 * failure so the caller can skip a bad URL without aborting the whole batch —
 * provider URLs are never persisted, only these downloaded bytes are.
 */
async function downloadOpenArtImage(url) {
  if (!url.startsWith('https://')) return null;

  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) return null;

  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength && declaredLength > MAX_IMAGE_DOWNLOAD_BYTES) return null;

  let arrayBuffer;
  try {
    arrayBuffer = await response.arrayBuffer();
  } catch {
    return null;
  }
  if (arrayBuffer.byteLength > MAX_IMAGE_DOWNLOAD_BYTES) return null;

  return { buffer: Buffer.from(arrayBuffer), mimeType: contentType };
}

// ── Bounded polling ───────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const CREATION_WAIT_MAX_TOTAL_MS = 5 * 60 * 1000;

/**
 * Polls openart_creation_wait until a terminal state or a 5-minute total
 * wall-clock budget is exhausted — never an unbounded loop. STILL_RUNNING is
 * treated as in-progress, honoring the server's pollAfterSeconds hint.
 */
async function waitForOpenArtCreation(historyId, { redirectUrl } = {}) {
  const startedAt  = Date.now();
  let lastResult   = null;

  while (Date.now() - startedAt < CREATION_WAIT_MAX_TOTAL_MS) {
    const remainingMs   = CREATION_WAIT_MAX_TOTAL_MS - (Date.now() - startedAt);
    const timeoutSeconds = Math.max(1, Math.min(90, Math.floor(remainingMs / 1000)));

    const result = await callOpenArtTool('openart_creation_wait', { historyId, timeoutSeconds }, { redirectUrl });
    lastResult = result;
    const status = extractCreationStatus(result.json);

    if (status === 'COMPLETED') return { status: 'COMPLETED', raw: result };
    if (status === 'FAILED')    return { status: 'FAILED', error: firstDefined(result.json?.error, result.json?.message), raw: result };
    if (status === 'CANCELLED') return { status: 'CANCELLED', raw: result };

    // STILL_RUNNING (or an unrecognized in-progress shape) — keep polling.
    const pollAfterSeconds = extractPollAfterSeconds(result.json);
    const remainingAfter   = CREATION_WAIT_MAX_TOTAL_MS - (Date.now() - startedAt);
    if (remainingAfter <= 1000) break;
    await sleep(Math.min(pollAfterSeconds * 1000, remainingAfter - 500));
  }

  return { status: 'TIMED_OUT', raw: lastResult };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Governed text-to-image generation. Returns a result object with a
 * `status` field rather than throwing for expected non-error outcomes
 * (prompt_selection_required, budget_exceeded, failed, cancelled, timed_out)
 * so callers can render honest states instead of generic failures. Throws
 * only for hard pre-flight errors (auth, missing prompt, invalid model,
 * invalid project, unsupported schema).
 */
export async function generateOpenArtImage(task, { redirectUrl } = {}) {
  const promptResolution = resolvePrompt(task);
  if (promptResolution.needsApproval) {
    return { status: 'prompt_selection_required', ...promptResolution };
  }
  const { originalPrompt, finalPrompt, promptMode, enhancementMethod } = promptResolution;

  // ── Model discovery + selection ─────────────────────────────────────────
  const modelListResult = await callOpenArtTool('openart_model_list', {}, { redirectUrl });
  const allModels = Array.isArray(modelListResult.json?.models) ? modelListResult.json.models : [];
  const text2imageModels = allModels.filter(m =>
    Array.isArray(m.modes?.image) && m.modes.image.some(entry => entry.mode === 'text2image')
  );
  if (!text2imageModels.length) {
    throw new Error('OpenArt returned no models supporting text2image generation.');
  }

  const intentText = buildIntentText(task, finalPrompt);
  const { model: selectedModel, reason: selectionReason } = selectOpenArtModel(text2imageModels, task, intentText);
  const model = selectedModel.id;
  const mode  = 'text2image';

  // ── Form schema ──────────────────────────────────────────────────────────
  const formResult = await callOpenArtTool('openart_model_form_get', { model, mode }, { redirectUrl });
  const jsonSchema  = formResult.json?.jsonSchema;
  if (!jsonSchema) {
    throw new Error(`OpenArt did not return a usable form schema for model "${model}".`);
  }

  // ── Params from schema ───────────────────────────────────────────────────
  const params = buildParamsFromSchema(jsonSchema, {
    prompt:      finalPrompt,
    imageCount:  Number(task.numImages ?? task.variants) || undefined,
    aspectRatio: task.aspectRatio || PLATFORM_ASPECT_RATIO[task.platform],
  }, model);

  // ── Cost estimate + budget guard ─────────────────────────────────────────
  const costResult = await callOpenArtTool('openart_model_cost', { model, mode, params }, { redirectUrl });
  const estimatedCredits = extractEstimatedCredits(costResult.json);

  if (task.maxOpenArtCredits != null && estimatedCredits != null && estimatedCredits > Number(task.maxOpenArtCredits)) {
    return {
      status: 'budget_exceeded',
      estimatedCredits,
      maxOpenArtCredits: Number(task.maxOpenArtCredits),
      model, mode, originalPrompt, finalPrompt,
      error: `Estimated cost (${estimatedCredits} credits) exceeds the allowed maximum (${task.maxOpenArtCredits} credits).`,
    };
  }

  // ── Optional project selection ───────────────────────────────────────────
  let projectId;
  if (task.openartProjectId) {
    const projectsResult = await callOpenArtTool('openart_project_list', {}, { redirectUrl });
    const projects = Array.isArray(projectsResult.json?.items) ? projectsResult.json.items : [];
    const found = projects.find(p => p.id === task.openartProjectId);
    if (!found || !found.canGenerate) {
      const err = new Error(`Project "${task.openartProjectId}" does not exist or is not generation-enabled (canGenerate: true is required).`);
      err.code = 'invalid_project';
      throw err;
    }
    projectId = found.id;
  }

  // ── Generate ──────────────────────────────────────────────────────────────
  const genArgs = { model, mode, params };
  if (projectId) genArgs.projectId = projectId;
  const genResult = await callOpenArtTool('openart_generate_image', genArgs, { redirectUrl });

  const historyId = extractHistoryId(genResult);
  if (!historyId) {
    throw new Error('OpenArt did not return a historyId for the generation request.');
  }

  // ── Bounded wait (PENDING is accepted, not completed) ────────────────────
  const creation = await waitForOpenArtCreation(historyId, { redirectUrl });

  const commonFields = { historyId, model, mode, estimatedCredits, originalPrompt, finalPrompt, promptMode, enhancementMethod, projectId: projectId || null };

  if (creation.status === 'FAILED') {
    return { status: 'failed', ...commonFields, error: creation.error || 'OpenArt generation failed.' };
  }
  if (creation.status === 'CANCELLED') {
    return { status: 'cancelled', ...commonFields, error: 'OpenArt generation was cancelled.' };
  }
  if (creation.status !== 'COMPLETED') {
    return {
      status: 'timed_out',
      ...commonFields,
      error: 'OpenArt generation did not complete within the bounded 5-minute wait. It may still finish server-side — retry to check.',
    };
  }

  // ── Extract + download + validate ────────────────────────────────────────
  const urls = collectResourceUrls(creation.raw);
  if (!urls.length) {
    throw new Error('OpenArt reported COMPLETED but returned no https resource URLs.');
  }

  const downloaded = [];
  for (const url of urls) {
    const result = await downloadOpenArtImage(url);
    if (result) downloaded.push(result);
  }
  if (!downloaded.length) {
    throw new Error('OpenArt images could not be downloaded, or none matched an allowed image content type.');
  }

  const mimeType     = downloaded[0].mimeType;
  const imageBuffers = downloaded.filter(d => d.mimeType === mimeType).map(d => d.buffer);

  return {
    status: 'completed',
    imageBuffers,
    mimeType,
    count: imageBuffers.length,
    selectionReason,
    ...commonFields,
  };
}

// ── Health check (adapter status) ───────────────────────────────────────────

/**
 * staged                 — OPENART_ENABLED is not true
 * authentication_required — enabled, but no OAuth session
 * active                 — enabled, authenticated, and listTools() succeeded
 */
export async function checkOpenArtHealth() {
  if (!isOpenArtEnabled()) {
    return {
      ok:        false,
      status:    'staged',
      error:     'OpenArt MCP is staged. Set OPENART_ENABLED=true, then connect via POST /api/openart/connect.',
      adapterId: 'openart',
    };
  }

  const state = getOpenArtAuthState();
  if (!state.tokens?.access_token) {
    return {
      ok:        false,
      status:    'authentication_required',
      error:     'OpenArt is enabled but not authenticated. Connect via POST /api/openart/connect.',
      adapterId: 'openart',
    };
  }

  const t0 = Date.now();
  try {
    const redirectUrl = String(process.env.OPENART_OAUTH_REDIRECT_URL || '').trim() || undefined;
    const tools = await listOpenArtTools(redirectUrl);
    return {
      ok:        true,
      status:    'active',
      latencyMs: Date.now() - t0,
      adapterId: 'openart',
      toolCount: tools.length,
    };
  } catch (e) {
    return {
      ok:        false,
      status:    e.code === 'authentication_required' ? 'authentication_required' : 'offline',
      error:     e.message,
      latencyMs: Date.now() - t0,
      adapterId: 'openart',
    };
  }
}
