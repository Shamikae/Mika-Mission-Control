// lib/production/execution/adapters/kie.adapter.js
// SERVER-SIDE ONLY.
//
// Kie.ai provider adapter — v1, IMAGE GENERATION ONLY.
//
// Kie.ai is an aggregator: one API key, one async task API, many third-party
// models behind it. That shape matters architecturally — `kie` is ONE provider
// in this engine and the model is chosen inside the ProviderBinding. Individual
// models are never registered as providers.
//
// ── FROZEN DECISION: direct REST, never MCP ──────────────────────────────
//
// A third-party Kie MCP server + CLI exists (felores/kie-cli-mcp). It is a
// legitimate tool for agents and development. It is PERMANENTLY NOT Mika's
// execution path, and this adapter is not to be replaced by it. Five reasons,
// recorded here so the decision does not have to be re-argued:
//
//   1. MCP buys nothing here. Higgsfield and HeyGen need MCP because OAuth is
//      the only governed way into the user's account. Kie is a plain Bearer-key
//      REST API — routing through MCP would wrap an API this file already calls.
//   2. That server exposes ONE TOOL PER MODEL (nano_banana_image,
//      veo3_generate_video, …). It moves model selection into the transport,
//      where policy can no longer change it. Mika keeps model choice inside the
//      ProviderBinding: providers are stable, models change, and Diamond Control
//      owns that mapping.
//   3. It keeps its own SQLite task database. Mika already has Production Jobs,
//      the Ledger and the Asset Library; a second task history would fragment
//      spend tracking. The Ledger is the single source of truth.
//   4. It blocks waiting for completion (wait_for_task). This engine is
//      deliberately asynchronous: submit() → taskId → poll() → ingest.
//   5. It exposes no account balance. healthCheck() below reads the real
//      balance endpoint; going through MCP would lose that.
//
// The MCP server may be used by Claude / Hermes / OpenClaw / Diamond for prompt
// experimentation, model discovery, capability exploration and debugging. It
// must never be the path that spends money.
//
// ── OPERATIONAL FACTS FROM THE AUDIT (both are expiry windows) ───────────
//
//   • Result download URLs expire QUICKLY after generation (~10 minutes; see
//     the hazard note below). Artifacts are downloaded on the poll that first
//     observes success.
//   • Remote task history is TEMPORARY — Kie retains tasks roughly 14 days,
//     after which recordInfo can no longer answer for them.
//
// Neither is a place to keep anything. Mika's permanent record is:
//
//     Production Job  →  Ledger  →  Asset Library
//
// NEVER the provider's remote task history. Kie's task list is a diagnostic
// convenience with an expiry date; if a fact matters after the fact, it must
// already be in Mika's own records by the time the task ages out.
//
// ── What is verified, and what is not ────────────────────────────────────
//
// Verified against the official docs (docs.kie.ai, audited 2026-08-08):
//   • auth        Bearer <KIE_API_KEY> in the Authorization header
//   • base        https://api.kie.ai
//   • submit      POST /api/v1/jobs/createTask   -> { code, msg, data.taskId }
//   • poll        GET  /api/v1/jobs/recordInfo?taskId=...
//   • states      waiting | queuing | generating | success | fail
//   • result      data.resultJson (a JSON *string*) -> { resultUrls: [...] }
//   • actual cost data.creditsConsumed — real credits deducted, post-completion
//   • balance     GET /api/v1/chat/credit -> { code, msg, data: <integer> }
//
// NOT offered by the API, confirmed by reading the docs rather than assumed:
//   • no cost-preflight endpoint          -> estimate() can never be confirmed
//   • no model-catalog endpoint           -> the allowlist below is static
//   • no task-cancellation endpoint       -> cancel() reports unsupported
//   • no pricing endpoint                 -> see PRICING PROVENANCE below
//
// ── PRICING PROVENANCE (read before trusting any number here) ────────────
//
// Kie publishes prices on marketing pages, NOT through the API and NOT in the
// developer docs. Nothing in this file's pricing table is provider-confirmed
// for a specific request, so estimate() ALWAYS returns provisional: true. The
// only authoritative cost figure Kie ever produces is `creditsConsumed`, and it
// arrives AFTER the work is done and paid for.
//
// There is also a genuine UNIT MISMATCH: published prices are in USD, while
// creditsConsumed is in Kie credits. The API documents no conversion rate, so
// this adapter does not convert. The estimate is reported in USD and the actual
// in kie-credits, both labelled. Inventing a rate to make them comparable would
// be exactly the fabricated precision this system is built to refuse.
//
// ── OPERATIONAL HAZARD: result URLs expire in ~10 minutes ────────────────
//
// Kie's docs state generated image URLs expire ~10 minutes after completion.
// The engine downloads immediately on the poll that observes `success`, so the
// normal path is safe — but a download that fails is NOT recoverable by polling
// again once the window closes. Kie documents POST /api/v1/common/download-url
// to re-mint a link; that recovery path is deliberately NOT implemented in v1
// (its request/response schema was not verified in this audit) and is recorded
// here as the known next step.

import { randomUUID } from 'crypto';
import crypto from 'crypto';
import { isRetryableErrorReason } from '../executionRules.js';

const DEFAULT_BASE_URL = 'https://api.kie.ai';
const CREATE_TASK_PATH = '/api/v1/jobs/createTask';
const RECORD_INFO_PATH = '/api/v1/jobs/recordInfo';
const CREDIT_PATH = '/api/v1/chat/credit';

const REQUEST_TIMEOUT_MS = 30_000;

// Kie's documented task-state vocabulary. Anything outside this set is treated
// as "still working" and never fabricated into progress.
export const KIE_TASK_STATES = ['waiting', 'queuing', 'generating', 'success', 'fail'];
const KIE_PENDING_STATES = ['waiting', 'queuing', 'generating'];

// ── v1 model allowlist ───────────────────────────────────────────────────
//
// Two models, both text-to-image, both confirmed present in Kie's official
// model documentation. The catalog behind Kie is 100+ models; exposing it whole
// would hand Diamond Control an unbounded, unverified surface.
//
// Note the model IDENTIFIERS are inconsistent between models — `google/nano-banana`
// is namespaced, `nano-banana-2` is bare. That is Kie's own inconsistency, not a
// typo. Each id is stored verbatim exactly as its own doc page specifies and is
// NEVER constructed from a pattern; a "helpful" normalizer here would silently
// produce a model id that does not exist.
//
// Neither model accepts a negative prompt, pixel width/height, or a batch count.
// Those absences are declared in `supports` so Diamond Control can publish them
// in the ProviderBinding — the same mechanism learned from Higgsfield M1, where
// an undeclared unsupported field failed at submit time.

const KIE_MODELS = {
  'google/nano-banana': {
    modelId: 'google/nano-banana',
    label: 'Nano Banana (Google, via Kie)',
    docs: 'https://docs.kie.ai/market/google/nano-banana',
    maxPromptChars: 5000,
    aspectRatios: ['1:1', '9:16', '16:9', '3:4', '4:3', '3:2', '2:3', '5:4', '4:5', '21:9', 'auto'],
    outputFormats: ['png', 'jpeg'],
    // This model exposes no `resolution` parameter at all.
    resolutions: null,
    supports: {
      negativePrompt: false,
      width: false,
      height: false,
      multipleOutputs: false,
      resolution: false,
      referenceImages: false,
    },
    pricing: {
      amount: 0.02,
      currency: 'USD',
      basis: 'per image',
      isFloor: false,
      // Provenance is carried, not stripped, so the estimate can never be
      // mistaken for a provider-confirmed figure later.
      source: 'kie.ai public pricing page (marketing), not the API',
      authoritative: false,
      recordedOn: '2026-08-08',
    },
  },
  'nano-banana-2': {
    modelId: 'nano-banana-2',
    label: 'Nano Banana 2 (Google, via Kie)',
    docs: 'https://docs.kie.ai/market/google/nanobanana2',
    maxPromptChars: 20000,
    aspectRatios: ['1:1', '2:3', '3:2', '1:4', '4:1', '3:4', '4:3', '4:5', '5:4', '1:8', '8:1', '9:16', '16:9', '21:9', 'auto'],
    outputFormats: ['png', 'jpg'],
    resolutions: ['1K', '2K', '4K'],
    supports: {
      negativePrompt: false,
      width: false,
      height: false,
      multipleOutputs: false,
      resolution: true,
      referenceImages: true,
    },
    pricing: {
      // Kie's own product page advertises "from $0.04" and prices vary by
      // resolution, which the published material does not break down. It is
      // therefore recorded as a FLOOR, never as the price. estimate() reports
      // an open-ended range so a caller cannot read it as a total.
      amount: 0.04,
      currency: 'USD',
      basis: 'per image, lowest advertised tier',
      isFloor: true,
      source: 'kie.ai public product page (marketing), not the API',
      authoritative: false,
      recordedOn: '2026-08-08',
    },
  },
};

export function listKieModels() {
  return Object.values(KIE_MODELS).map(m => ({
    modelId: m.modelId,
    label: m.label,
    maxPromptChars: m.maxPromptChars,
    aspectRatios: [...m.aspectRatios],
    resolutions: m.resolutions ? [...m.resolutions] : null,
    outputFormats: [...m.outputFormats],
    supports: { ...m.supports },
    pricing: m.pricing ? { ...m.pricing } : null,
  }));
}

export function getKieModel(modelId) {
  return Object.prototype.hasOwnProperty.call(KIE_MODELS, modelId) ? KIE_MODELS[modelId] : null;
}

// ── Configuration ────────────────────────────────────────────────────────

function isEnabled() {
  return String(process.env.KIE_ENABLED || '').trim().toLowerCase() === 'true';
}

function apiKeyFromEnv() {
  const key = String(process.env.KIE_API_KEY || '').trim();
  return key || null;
}

function baseUrlFromEnv() {
  const raw = String(process.env.KIE_API_URL || '').trim() || DEFAULT_BASE_URL;
  return raw.replace(/\/+$/, '');
}

/**
 * Configuration state, resolved without any network call.
 * Kept separate from healthCheck() so "disabled" and "no key" never look like
 * an outage, and so neither costs a round-trip.
 */
export function resolveKieConfigState() {
  if (!isEnabled()) {
    return { ok: false, status: 'disabled', error: 'Kie.ai adapter is disabled. Set KIE_ENABLED=true to enable it.' };
  }
  if (!apiKeyFromEnv()) {
    return { ok: false, status: 'configuration_pending', error: 'KIE_API_KEY is not configured. Create a key at https://kie.ai/api-key and set it server-side.' };
  }
  const base = baseUrlFromEnv();
  if (!base.startsWith('https://')) {
    return { ok: false, status: 'configuration_pending', error: 'KIE_API_URL must be an https:// URL — refusing to send an API key over a non-TLS connection.' };
  }
  return { ok: true, status: 'active', error: null };
}

// ── Transport ────────────────────────────────────────────────────────────

function kieError(message, reason) {
  const e = new Error(message);
  e.reason = reason;
  return e;
}

/**
 * Maps an HTTP status (or Kie's own `code` field, which mirrors HTTP codes)
 * onto the engine's shared error-reason vocabulary.
 */
export function classifyKieCode(code) {
  if (code === 401 || code === 403) return 'authentication_error';
  if (code === 402) return 'insufficient_credits';
  if (code === 429) return 'rate_limited';
  if (code === 400 || code === 404 || code === 422) return 'validation_error';
  if (typeof code === 'number' && code >= 500) return 'provider_error';
  return 'provider_error';
}

/**
 * One authenticated JSON call. The API key is attached here and NOWHERE else —
 * it never enters a return value, an error message, or rawMetadata.
 */
async function kieFetch(path, { method = 'GET', body = null, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const config = resolveKieConfigState();
  if (!config.ok) throw kieError(config.error, config.status === 'configuration_pending' ? 'validation_error' : 'validation_error');

  const url = `${baseUrlFromEnv()}${path}`;
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiKeyFromEnv()}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const timedOut = e?.name === 'TimeoutError' || /timeout|aborted/i.test(e?.message || '');
    throw kieError(`Could not reach Kie.ai: ${e.message}`, timedOut ? 'timeout' : 'network_error');
  }

  let json = null;
  try { json = await response.json(); } catch { json = null; }

  if (!response.ok) {
    const message = String(json?.msg || `Kie.ai returned HTTP ${response.status}.`).slice(0, 500);
    throw kieError(message, classifyKieCode(response.status));
  }
  // Kie returns HTTP 200 with a non-200 `code` for application-level failures.
  if (json && typeof json.code === 'number' && json.code !== 200) {
    throw kieError(String(json.msg || `Kie.ai returned code ${json.code}.`).slice(0, 500), classifyKieCode(json.code));
  }
  return json;
}

// ── Input validation (pure, no network) ──────────────────────────────────

/**
 * Validates a providerInput against the selected model's REAL documented
 * schema. Exported so it can be exercised offline without credentials.
 *
 * Unsupported optional fields are DROPPED WITH A WARNING rather than silently
 * ignored; a field that would change the output but cannot be honoured is an
 * error, never a quiet degradation.
 */
export function validateKieProviderInput(providerInput) {
  const errors = [];
  const warnings = [];
  const input = providerInput || {};

  if (input.mediaType && input.mediaType !== 'image') {
    errors.push(`Kie.ai v1 supports image generation only — "${input.mediaType}" is not available through this adapter.`);
  }

  const model = getKieModel(input.model);
  if (!input.model) {
    errors.push('A model is required. The binding must name one of the allowlisted Kie models.');
  } else if (!model) {
    errors.push(`Model "${input.model}" is not in the Kie v1 allowlist (${Object.keys(KIE_MODELS).join(', ')}).`);
  }

  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (!prompt) {
    errors.push('A prompt is required.');
  } else if (model && prompt.length > model.maxPromptChars) {
    errors.push(`Prompt is ${prompt.length} characters; ${model.modelId} accepts at most ${model.maxPromptChars}.`);
  }

  if (model && input.aspectRatio && !model.aspectRatios.includes(input.aspectRatio)) {
    errors.push(`Aspect ratio "${input.aspectRatio}" is not supported by ${model.modelId}. Supported: ${model.aspectRatios.join(', ')}.`);
  }

  // outputCount is capped at exactly 1: neither allowlisted model exposes a
  // batch parameter, so any value above 1 would silently produce one image
  // while the caller believed it had bought several.
  if (input.outputCount != null && input.outputCount !== 1) {
    errors.push(`outputCount must be 1 — no allowlisted Kie model supports batch output (requested: ${input.outputCount}).`);
  }

  if (input.negativePrompt) {
    errors.push('This Kie model does not accept a negative prompt. The binding must declare supports.negativePrompt=false so the field is dropped upstream rather than reaching the provider.');
  }
  if (input.width != null || input.height != null) {
    warnings.push('Kie image models size output by aspect ratio, not pixel width/height — the requested pixel dimensions were ignored.');
  }
  if (input.resolution && model && !model.resolutions) {
    warnings.push(`${model.modelId} exposes no resolution parameter — the requested resolution was ignored.`);
  }
  if (input.resolution && model?.resolutions && !model.resolutions.includes(input.resolution)) {
    errors.push(`Resolution "${input.resolution}" is not supported by ${model.modelId}. Supported: ${model.resolutions.join(', ')}.`);
  }
  if (input.outputFormat && model && !model.outputFormats.includes(input.outputFormat)) {
    errors.push(`Output format "${input.outputFormat}" is not supported by ${model.modelId}. Supported: ${model.outputFormats.join(', ')}.`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Builds the exact `input` object Kie's createTask expects. Only parameters
 * proven present in the selected model's own documentation are emitted.
 */
export function buildKieTaskInput(providerInput) {
  const model = getKieModel(providerInput.model);
  const input = {
    prompt: String(providerInput.prompt).trim(),
  };
  if (providerInput.aspectRatio) input.aspect_ratio = providerInput.aspectRatio;

  const format = providerInput.outputFormat || (model.outputFormats.includes('png') ? 'png' : model.outputFormats[0]);
  input.output_format = format;

  if (model.resolutions) {
    input.resolution = providerInput.resolution && model.resolutions.includes(providerInput.resolution)
      ? providerInput.resolution
      : model.resolutions[0];
  }
  return input;
}

// ── Result parsing ───────────────────────────────────────────────────────

/** resultJson is documented as a JSON *string*; tolerate an already-parsed object. */
export function parseKieResultUrls(resultJson) {
  if (!resultJson) return [];
  let parsed = resultJson;
  if (typeof resultJson === 'string') {
    try { parsed = JSON.parse(resultJson); } catch { return []; }
  }
  const urls = parsed?.resultUrls;
  if (!Array.isArray(urls)) return [];
  return urls.filter(u => typeof u === 'string' && /^https:\/\//i.test(u));
}

function mimeForUrl(url, requestedFormat) {
  const ext = String(url).split('?')[0].split('#')[0].split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  // Fall back to what was actually requested rather than guessing.
  if (requestedFormat === 'jpeg' || requestedFormat === 'jpg') return 'image/jpeg';
  return 'image/png';
}

/**
 * Maps a recordInfo response onto engine execution states. Pure and exported
 * so every branch can be exercised without a live task.
 */
export function mapKiePollResponse(json, { requestedFormat = 'png' } = {}) {
  const data = json?.data && typeof json.data === 'object' ? json.data : {};
  const state = String(data.state || '').toLowerCase();
  // Kie documents `progress` for sora2 models only — never invented elsewhere.
  const progress = typeof data.progress === 'number' ? data.progress : null;
  const creditsConsumed = typeof data.creditsConsumed === 'number' ? data.creditsConsumed : null;

  if (state === 'success') {
    const urls = parseKieResultUrls(data.resultJson);
    if (!urls.length) {
      return {
        ok: false, status: 'failed',
        error: 'Kie.ai reported the task succeeded but returned no usable https result URL.',
        errorReason: 'malformed_output', retryable: isRetryableErrorReason('malformed_output'),
        rawMetadata: { providerStatus: state, creditsConsumed },
      };
    }
    const url = urls[0];
    const mimeType = mimeForUrl(url, requestedFormat);
    return {
      ok: true,
      status: 'completed',
      progress: 100,
      nextPollSeconds: null,
      error: null,
      outputs: [{
        type: 'image',
        url,
        mimeType,
        filename: `kie-image.${mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1]}`,
        metadata: { kind: 'kie-image', model: data.model || null },
      }],
      // Provider-neutral actual-cost shape. The engine reads THIS, not a
      // vendor-specific field, so any adapter can report real spend in its own
      // unit. Kie bills in its own credits — never dollars — so no conversion
      // is attempted and `unit` says exactly what the number is.
      actualCost: creditsConsumed === null ? null : {
        amount: creditsConsumed,
        unit: 'provider_credits',
        providerCreditUnit: 'kie-credits',
        confirmed: true,
      },
      rawMetadata: {
        providerStatus: state,
        // The ONLY authoritative cost Kie ever reports. Carried up so the
        // engine can record what was actually spent rather than what was
        // guessed — the accounting itself is entirely the engine's business.
        creditsConsumed,
        actualCostCurrency: creditsConsumed == null ? null : 'kie-credits',
        costTimeMs: typeof data.costTime === 'number' ? data.costTime : null,
        resultCount: urls.length,
        // Recorded so a stalled download has a diagnosable cause.
        resultUrlExpiresInSeconds: 600,
      },
    };
  }

  if (state === 'fail') {
    const failCode = data.failCode == null ? null : String(data.failCode);
    const errorReason = failCode
      ? (failCode.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'provider_error')
      : 'provider_error';
    return {
      ok: false,
      status: 'failed',
      error: String(data.failMsg || 'Kie.ai reported the generation failed.').slice(0, 500),
      errorReason,
      retryable: isRetryableErrorReason(errorReason),
      rawMetadata: {
        providerStatus: state,
        failCode,
        creditsConsumed,
        // Kie's public policy is that failed tasks are not charged. It is
        // recorded as a CLAIM, not asserted as fact: it appears nowhere in the
        // API reference, and creditsConsumed above is the only real evidence.
        // Nothing in this adapter enables a retry on the strength of it.
        billingNote: 'Kie states publicly that failed tasks are not charged. Unverified in the API docs — treat creditsConsumed as the only evidence.',
      },
    };
  }

  if (state && !KIE_PENDING_STATES.includes(state)) {
    // An undocumented state. Keep waiting rather than inventing a terminal
    // outcome, but say plainly that it was not recognised.
    return {
      ok: true, status: 'waiting_provider', progress, nextPollSeconds: 10, outputs: [], error: null,
      rawMetadata: { providerStatus: state, unrecognizedState: true },
    };
  }

  return {
    ok: true, status: 'waiting_provider', progress, nextPollSeconds: 5, outputs: [], error: null,
    rawMetadata: { providerStatus: state || 'unknown' },
  };
}

function promptHash(prompt) {
  return crypto.createHash('sha256').update(String(prompt)).digest('hex').slice(0, 16);
}

// ── Adapter ──────────────────────────────────────────────────────────────

const kieAdapter = {
  id: 'kie',
  displayName: 'Kie.ai',
  status: 'staged', // true executable status is only ever reported via healthCheck()
  supportedModes: ['cinematic_broll', 'product_demo', 'faceless_social', 'custom'],
  executionType: 'direct-api',
  billingPool: 'kie-credits',
  mock: false,

  async healthCheck() {
    const config = resolveKieConfigState();
    if (!config.ok) {
      return { ok: false, status: config.status, error: config.error, latencyMs: null, adapterId: 'kie' };
    }

    // Authentication is proven by a real authenticated call, never by the
    // presence of a key. The balance endpoint is read-only and free.
    const startedAt = Date.now();
    try {
      const json = await kieFetch(CREDIT_PATH, { method: 'GET' });
      const credits = typeof json?.data === 'number' ? json.data : null;
      return {
        ok: true,
        status: 'active',
        error: null,
        latencyMs: Date.now() - startedAt,
        adapterId: 'kie',
        // Balance in Kie credits. Never a dollar figure — the API documents no
        // credit-to-USD conversion.
        balance: credits,
        balanceCurrency: credits == null ? null : 'kie-credits',
      };
    } catch (e) {
      const status = e.reason === 'authentication_error' ? 'auth_error' : 'unavailable';
      return { ok: false, status, error: e.message, latencyMs: Date.now() - startedAt, adapterId: 'kie' };
    }
  },

  /**
   * Pure/local validation only — deliberately no network call. The engine
   * already gates execution on isProviderExecutable(), which runs healthCheck()
   * and therefore proves authentication before submit() is ever reached.
   */
  validateInput({ job }) {
    const config = resolveKieConfigState();
    if (!config.ok) return { valid: false, errors: [config.error], warnings: [] };
    return validateKieProviderInput(job?.providerInput);
  },

  /**
   * Kie exposes NO cost-preflight endpoint, so this can never return a
   * provider-confirmed figure. provisional is hardcoded true — not derived from
   * a condition that a future edit could accidentally flip.
   */
  estimate({ job }) {
    const providerInput = job?.providerInput || {};
    const model = getKieModel(providerInput.model);

    if (!model || !model.pricing) {
      return {
        estimateType: 'unknown',
        estimatedRange: null,
        costTier: 'variable',
        currency: null,
        // No unit is declared when there is no figure. Claiming USD here would
        // let an unknown cost join a dollar total as if it were zero.
        unit: null,
        provisional: true,
        approvalRequired: true,
        note: model
          ? `No published price is on record for ${model.modelId}, and Kie.ai offers no cost-preflight endpoint. The cost stays unknown rather than guessed.`
          : 'No allowlisted Kie model is selected — cost cannot be estimated.',
      };
    }

    const { amount, currency, isFloor, source, basis, recordedOn } = model.pricing;
    return {
      estimateType: 'provisional_catalog',
      // A floor price is reported open-ended: min without max, so no caller can
      // read it as a total.
      estimatedRange: isFloor ? { min: amount, max: null } : { min: amount, max: amount },
      costTier: 'low',
      currency,
      // Kie publishes real money, so this is a currency — NOT the Kie credits
      // that `creditsConsumed` later reports. The two are different units and
      // the API documents no rate between them, so nothing here converts.
      unit: 'currency',
      // Carried so a downstream total can say the amount is a minimum rather
      // than silently absorbing a "from" price as if it were the price.
      isLowerBound: isFloor === true,
      pricingSource: source,
      pricedAt: recordedOn,
      provisional: true,
      approvalRequired: true,
      note: `Kie.ai has no cost-preflight endpoint. ${isFloor ? 'Lowest advertised price' : 'Published price'} for ${model.modelId}: ${amount} ${currency} ${basis}${isFloor ? ' — higher tiers cost more' : ''}. Source: ${source}. The actual charge is reported in Kie credits only after completion.`,
    };
  },

  async submit({ job }) {
    const validation = this.validateInput({ job });
    if (!validation.valid) {
      return {
        ok: false, providerJobId: null, status: 'failed', nextPollSeconds: null,
        error: validation.errors.join(' '), errorReason: 'validation_error', rawMetadata: {},
      };
    }

    // Never double-submit a paid task within one execution attempt.
    if (job.execution?.providerJobId) {
      return {
        ok: false, providerJobId: null, status: 'failed', nextPollSeconds: null,
        error: 'A provider task already exists for this execution attempt — refusing to double-submit.',
        errorReason: 'validation_error', rawMetadata: {},
      };
    }

    const providerInput = job.providerInput;
    const taskInput = buildKieTaskInput(providerInput);

    let json;
    try {
      // No callBackUrl in v1: completion is observed by polling, which the
      // engine already drives. A webhook would be a second, unreconciled
      // completion path. See the webhook note in the file header.
      json = await kieFetch(CREATE_TASK_PATH, {
        method: 'POST',
        body: { model: providerInput.model, input: taskInput },
      });
    } catch (e) {
      return {
        ok: false, providerJobId: null, status: 'failed', nextPollSeconds: null,
        error: e.message, errorReason: e.reason || 'provider_error', rawMetadata: {},
      };
    }

    const taskId = typeof json?.data?.taskId === 'string' ? json.data.taskId.trim() : '';
    if (!taskId) {
      // Kie accepted the request (code 200) but returned no task id. A task may
      // exist and may already be consuming credits, so resubmitting could
      // create duplicate paid work. Non-retryable by design — same protection
      // proven necessary on Higgsfield.
      return {
        ok: false, providerJobId: null, status: 'failed', nextPollSeconds: null,
        error: 'Kie.ai accepted the submission but returned no task id. A task may already be running and credits may already be committed, so retrying could duplicate paid work. Check https://kie.ai/logs before taking any action.',
        errorReason: 'provider_submission_unresolved',
        rawMetadata: { responseKeys: Object.keys(json || {}).slice(0, 10), dataKeys: Object.keys(json?.data || {}).slice(0, 10) },
      };
    }

    return {
      ok: true,
      providerJobId: taskId,
      status: 'waiting_provider',
      // Image tasks are fast; the ~10-minute result-URL window makes a slow
      // first poll a real risk rather than a courtesy.
      nextPollSeconds: 5,
      rawMetadata: {
        model: providerInput.model,
        promptCharCount: String(providerInput.prompt).trim().length,
        promptHash: promptHash(providerInput.prompt),
        aspectRatio: taskInput.aspect_ratio || null,
        resolution: taskInput.resolution || null,
        outputFormat: taskInput.output_format || null,
        submittedAt: new Date().toISOString(),
        correlationId: randomUUID(),
      },
    };
  },

  async poll({ job, providerJobId }) {
    if (!providerJobId) {
      return { ok: false, status: 'failed', error: 'No provider task id recorded for this execution.', errorReason: 'malformed_output', rawMetadata: null };
    }

    let json;
    try {
      json = await kieFetch(`${RECORD_INFO_PATH}?taskId=${encodeURIComponent(providerJobId)}`, { method: 'GET' });
    } catch (e) {
      return { ok: false, status: 'failed', error: e.message, errorReason: e.reason || 'provider_error', rawMetadata: null };
    }

    const requestedFormat = job?.execution?.providerMetadata?.outputFormat || job?.providerInput?.outputFormat || 'png';
    return mapKiePollResponse(json, { requestedFormat });
  },

  async cancel({ providerJobId }) {
    // No cancellation endpoint exists anywhere in Kie's documented API. Saying
    // so is the honest answer; pretending otherwise would let an operator
    // believe a running paid task had been stopped.
    return {
      ok: false,
      status: 'unsupported',
      error: providerJobId
        ? `Kie.ai documents no cancellation endpoint (task ${providerJobId}). The task may continue and consume credits even though this job is marked cancelled locally.`
        : 'No provider task was ever submitted for this attempt.',
      errorReason: 'provider_cancel_unsupported',
    };
  },

  normalizeResult(result) {
    return {
      status: result.status,
      outputs: result.outputs || [],
      // Passed through so the engine can record REAL spend in its real unit.
      actualCost: result.actualCost || null,
      providerMetadata: result.rawMetadata || null,
    };
  },
};

export default kieAdapter;
