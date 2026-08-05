// lib/production/execution/adapters/openartVideoMcp.adapter.js
// SERVER-SIDE ONLY.
//
// Real OpenArt Video provider adapter. Generates through OpenArt's live,
// already-connected MCP server (the SAME OAuth session used for real image
// generation — lib/openart/openartMcpClient.js) via two confirmed real
// tools: "openart_generate_video" (async submit, text2video only in this
// checkpoint) and "openart_creation_get" (a genuinely documented,
// read-only status poll: PENDING/RUNNING with pollAfterSeconds, then
// terminal COMPLETED/FAILED/CANCELLED). Billed against the authenticated
// user's OpenArt account credits — no OPENART_API_KEY.
//
// IMPORTANT — this adapter deliberately does NOT use
// generateOpenArtImage()'s waitForOpenArtCreation() blocking-poll helper
// (openart_creation_wait). That helper blocks a single call for up to 5
// minutes, which does not match the Provider Execution Engine's own
// async submit()-then-poll() contract (the engine already owns retry/
// backoff/polling cadence — see executionEngine.js). Instead this adapter
// calls openart_generate_video directly and polls openart_creation_get on
// the engine's own schedule, exactly like heygenMcp/higgsfieldMcp adapters
// do. It DOES reuse the already-proven, exported pure response-parsing
// helpers from openartMcpClient.js (extractHistoryId, extractCreationStatus,
// extractPollAfterSeconds, collectResourceUrls) — the same functions the
// real, working image pipeline already depends on in production — rather
// than re-deriving response-shape assumptions from scratch. Unlike
// Higgsfield's first submission, openart_generate_video's response shape
// is NOT a fresh guess: openart_generate_image uses the identical submit
// contract ("Returns a historyId...") and extractHistoryId has been proven
// correct against real, live image generations already.
//
// v1 scope: text2video only. image2video and element2video (both require
// reference media/uploads) are deliberately out of scope — see
// validateOpenArtVideoProviderInputSync()'s explicit rejection of any
// reference-media field. No batch generation, no cancellation (no such
// tool exists in OpenArt's live MCP discovery — see cancel()).

import { createHash } from 'crypto';
import {
  callOpenArtTool, checkOpenArtHealth, listOpenArtTools,
  extractHistoryId, extractCreationStatus, extractPollAfterSeconds, collectResourceUrls,
} from '../../../openart/openartMcpClient.js';
import { isRetryableErrorReason } from '../executionRules.js';

const SUPPORTED_MODES = ['cinematic_broll', 'product_demo']; // text2video needs no reference media — image_to_video stays unsupported until a real reference-media path is implemented
const GENERATE_TOOL = 'openart_generate_video';
const STATUS_TOOL = 'openart_creation_get';
const MODELS_TOOL = 'openart_model_list';
const FORM_TOOL = 'openart_model_form_get';
const COST_TOOL = 'openart_model_cost';
const ACCOUNT_TOOL = 'openart_account_get';
const MODE = 'text2video';

// The six tools this adapter depends on — checked by name against the live
// discovered list, never guessed. Real discovery (this session) confirmed
// all six exist with these exact names.
export const REQUIRED_OPENART_VIDEO_TOOLS = [GENERATE_TOOL, STATUS_TOOL, MODELS_TOOL, FORM_TOOL, COST_TOOL, ACCOUNT_TOOL];

const MAX_PROMPT_CHARS = 2000; // OpenArt's own schema allows up to 30000 — Mika's own safety maximum, same value used for Higgsfield
const MAX_OUTPUT_COUNT = 1; // v1 hard cap — "one output maximum in v1"

function redirectUrlFromEnv() {
  return String(process.env.OPENART_OAUTH_REDIRECT_URL || '').trim() || undefined;
}

export function promptHash(text) {
  return createHash('sha256').update(String(text || '').trim(), 'utf8').digest('hex').slice(0, 16);
}

function classifySubmitError(e) {
  if (e.code === 'authentication_required') return 'authentication_error';
  if (e.code === 'disabled') return 'validation_error';
  return 'provider_error';
}

// ── Live model + form-schema discovery (video/text2video only) ──────────────

/** @returns {Promise<Array<{id,displayName,description}>>} — text2video-capable models only. */
async function fetchVideoModelCatalog(redirectUrl) {
  const result = await callOpenArtTool(MODELS_TOOL, {}, { redirectUrl });
  const allModels = Array.isArray(result.json?.models) ? result.json.models : [];
  return allModels
    .filter(m => Array.isArray(m.modes?.video) && m.modes.video.some(entry => entry.mode === MODE))
    .map(m => {
      const modeEntry = m.modes.video.find(entry => entry.mode === MODE);
      return { id: m.id, displayName: m.displayName || m.id, description: modeEntry?.description || m.description || '' };
    });
}

/**
 * Resolves OpenArt's $ref/$defs-indirected JSON schema into a flat
 * { properties: { fieldName: { type, enum?, minimum?, maximum?, default? } }, required: [] }
 * shape a UI or validator can read directly, without needing to understand
 * OpenArt's schema-composition format itself.
 */
export function resolveOpenArtVideoFormSchema(formJson) {
  const root = formJson?.jsonSchema;
  const objSchema = Array.isArray(root?.allOf) ? root.allOf[0] : null;
  const defs = root?.$defs || {};

  if (!objSchema) {
    return { supported: false, reason: 'No usable form schema was returned.', properties: {}, required: [] };
  }

  // Confirmed live (this session, 7 real text2video-capable models): not
  // every model uses the same schema shape. byte-plus-seedance-2/-fast/-mini
  // and pixverseV6 use a simple single-object shape (handled below).
  // gemini-omni-flash (oneOf) and wan2-7 (oneOf), and kling-3-omni (anyOf)
  // use a multi-variant/discriminated shape (e.g. choosing between a
  // text-prompt-only input and a reference-element input) that this
  // checkpoint does not resolve. Rather than guess which variant is the
  // "text2video" one and risk submitting fields the model's schema doesn't
  // declare (its own additionalProperties:false would reject them), those
  // models are excluded from the v1 catalog — see
  // fetchVideoModelCatalog()'s callers / validateOpenArtVideoProviderInputSync().
  if (Array.isArray(objSchema.oneOf) || Array.isArray(objSchema.anyOf)) {
    return { supported: false, reason: "This model's generation form uses a multi-variant schema (oneOf/anyOf) not yet supported in this checkpoint.", properties: {}, required: [] };
  }

  const rawProps = objSchema.properties || {};
  const properties = {};
  for (const [key, ref] of Object.entries(rawProps)) {
    const refKey = typeof ref?.$ref === 'string' ? ref.$ref.replace('#/$defs/', '') : null;
    properties[key] = refKey && defs[refKey] ? defs[refKey] : ref;
  }
  return { supported: true, properties, required: Array.isArray(objSchema.required) ? objSchema.required : [] };
}

async function fetchVideoModelForm(model, redirectUrl) {
  const result = await callOpenArtTool(FORM_TOOL, { model, mode: MODE }, { redirectUrl });
  return resolveOpenArtVideoFormSchema(result.json);
}

// ── Shared, pure-ish validation ──────────────────────────────────────────────

/**
 * @param {{ job: object, pkg: object, models: Array|null, formSchema: object|null }} ctx
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateOpenArtVideoProviderInputSync({ job, pkg, models, formSchema }) {
  const errors = [];
  const warnings = [];

  if (!SUPPORTED_MODES.includes(job?.selectedMode)) {
    errors.push(`OpenArt Video only supports ${SUPPORTED_MODES.join(', ')} in this checkpoint (selected: "${job?.selectedMode || 'none'}").`);
  }

  const providerInput = job?.providerInput || null;
  if (!providerInput?.model) {
    errors.push('A model must be selected in OpenArt Video Setup.');
  } else if (Array.isArray(models) && !models.find(m => m.id === providerInput.model)) {
    errors.push(`Selected model "${providerInput.model}" was not found in the current live OpenArt text2video-capable model catalog.`);
  }

  const prompt = (providerInput?.prompt || '').trim();
  if (!prompt) {
    errors.push('A prompt is required.');
  } else if (prompt.length > MAX_PROMPT_CHARS) {
    errors.push(`Prompt is ${prompt.length} characters — exceeds Mika's safety maximum of ${MAX_PROMPT_CHARS} characters.`);
  }

  if (formSchema && formSchema.supported === false) {
    errors.push(`Selected model's generation form is not supported in this checkpoint: ${formSchema.reason}`);
  }

  if (formSchema?.supported && formSchema.properties) {
    const durationConstraint = formSchema.properties.duration;
    if (durationConstraint) {
      const d = Number(providerInput?.durationSeconds);
      if (providerInput?.durationSeconds == null) {
        errors.push('durationSeconds is required for this model.');
      } else if (!Number.isFinite(d) || (durationConstraint.minimum != null && d < durationConstraint.minimum) || (durationConstraint.maximum != null && d > durationConstraint.maximum)) {
        errors.push(`durationSeconds must be between ${durationConstraint.minimum} and ${durationConstraint.maximum} for this model.`);
      }
    }

    const aspectConstraint = formSchema.properties.aspectRatio;
    if (aspectConstraint) {
      if (!providerInput?.aspectRatio) {
        errors.push('aspectRatio is required for this model.');
      } else if (Array.isArray(aspectConstraint.enum) && !aspectConstraint.enum.includes(providerInput.aspectRatio)) {
        errors.push(`aspectRatio "${providerInput.aspectRatio}" is not supported by this model. Supported: ${aspectConstraint.enum.join(', ')}.`);
      }
    }

    const resolutionConstraint = formSchema.properties.resolution;
    if (resolutionConstraint) {
      if (!providerInput?.resolution) {
        errors.push('resolution is required for this model.');
      } else if (Array.isArray(resolutionConstraint.enum) && !resolutionConstraint.enum.includes(providerInput.resolution)) {
        errors.push(`resolution "${providerInput.resolution}" is not supported by this model. Supported: ${resolutionConstraint.enum.join(', ')}.`);
      }
    }
  }

  if (providerInput?.outputCount != null && Number(providerInput.outputCount) !== 1) {
    errors.push('outputCount must be exactly 1 in this checkpoint (maximum one output).');
  }

  // Explicitly out of scope for v1 — image2video/element2video both require
  // reference media, which this checkpoint does not implement. Rejected
  // rather than silently ignored or half-implemented against an untested
  // upload path.
  const REFERENCE_FIELD_NAMES = ['referenceMedia', 'elements', 'imageUrl', 'startImage', 'medias', 'imageReference'];
  if (REFERENCE_FIELD_NAMES.some(k => providerInput?.[k] != null)) {
    errors.push('Reference/element-based video (image2video, element2video) is not implemented in this checkpoint — submit a prompt-only (text2video) request.');
  }

  warnings.push('Submitting may consume OpenArt account credits — see the cost preview before approving.');
  return { valid: errors.length === 0, errors, warnings };
}

// ── Pure payload-mapping / response-parsing helpers ─────────────────────────
// Extracted specifically so they can be unit-tested
// (validate-openart-video-mcp-adapter.mjs) WITHOUT ever calling
// callOpenArtTool — i.e. without any live network I/O and with zero risk of
// invoking a real generation tool. Pure — no I/O, no fs, no network.

/**
 * Builds the exact openart_generate_video argument object (model/mode/params)
 * — driven by the SELECTED MODEL's own live form schema, never a fixed
 * field set. Confirmed live (this session): even among the "supported
 * shape" models, field sets differ — pixverseV6 has no `seed` field at
 * all, and every supported model's schema declares
 * additionalProperties:false, so sending an undeclared field would be
 * rejected by OpenArt itself. Only fields the schema actually declares are
 * ever included; user-controlled values are used where present
 * (prompt/duration/aspectRatio/resolution), schema defaults are used for
 * anything not user-configurable in this checkpoint (generateAudio, seed).
 */
export function buildOpenArtVideoSubmitArgs({ providerInput, formSchema }) {
  const props = formSchema?.properties || {};
  const params = { prompt: providerInput.prompt.trim(), videoCount: MAX_OUTPUT_COUNT };
  if (props.duration) params.duration = Number(providerInput.durationSeconds);
  if (props.aspectRatio) params.aspectRatio = providerInput.aspectRatio;
  if (props.resolution) params.resolution = providerInput.resolution;
  if (props.generateAudio) params.generateAudio = props.generateAudio.default ?? true;
  if (props.seed) params.seed = props.seed.default ?? -1;
  return { model: providerInput.model, mode: MODE, params };
}

/** Builds the openart_model_cost preflight argument object — never submits a job. */
export function buildOpenArtVideoCostPreviewArgs({ providerInput, formSchema }) {
  const { model, mode, params } = buildOpenArtVideoSubmitArgs({ providerInput, formSchema });
  return { model, mode, params };
}

/**
 * Extracts a provider job id (OpenArt's "historyId") from a
 * openart_generate_video response. Reuses extractHistoryId() — the SAME
 * function already proven correct in production against real
 * openart_generate_image submissions (identical response contract, per
 * OpenArt's own tool description: "Returns a historyId with status PENDING").
 */
export function parseOpenArtVideoSubmitResponse(result) {
  const historyId = extractHistoryId(result);
  return { historyId: historyId ? String(historyId) : null };
}

function extractTotalCredits(costJson) {
  const items = costJson?.items;
  if (!Array.isArray(items) || !items.length) return null;
  const total = items.reduce((sum, item) => sum + (Number(item.totalCredits) || 0), 0);
  return Number.isFinite(total) ? total : null;
}

// ── Safe structural diagnostics (never provider content) ────────────────────
// Mirrors higgsfieldMcp.adapter.js's buildSafeSubmitDiagnostics() — used
// only if a submit response ever fails to parse (not expected here, given
// extractHistoryId's production track record, but kept as defense in depth
// rather than silently discarding the response the way the original
// Higgsfield submit-failure path once did).

function collectNestedKeys(json) {
  const nested = {};
  if (!json || typeof json !== 'object') return nested;
  for (const [key, value] of Object.entries(json)) {
    if (Array.isArray(value)) {
      const first = value[0];
      nested[key] = { isArray: true, length: value.length, firstItemKeys: first && typeof first === 'object' ? Object.keys(first) : [] };
    } else if (value && typeof value === 'object') {
      nested[key] = Object.keys(value);
    }
  }
  return nested;
}

export function buildSafeOpenArtVideoDiagnostics(result) {
  const isObj = result && typeof result === 'object';
  const json = isObj ? result.json : undefined;
  return {
    topLevelKeys: isObj ? Object.keys(result) : [],
    jsonKeys: json && typeof json === 'object' ? Object.keys(json) : [],
    nestedKeys: collectNestedKeys(json),
    isError: !!(isObj && result.isError),
    hasText: !!(isObj && typeof result.text === 'string' && result.text.length > 0),
    hasJson: !!(json && typeof json === 'object'),
    hasResources: !!(isObj && Array.isArray(result.resources) && result.resources.length > 0),
  };
}

/**
 * Maps an openart_creation_get response onto the adapter's normalized
 * poll() result. Status vocabulary is CONFIRMED live and documented by
 * OpenArt itself: PENDING/RUNNING (in-progress, pollAfterSeconds hint) then
 * terminal COMPLETED/FAILED/CANCELLED. Never fabricates a progress
 * percentage or output URL.
 */
export function mapOpenArtVideoPollResponse(result) {
  const json = result?.json;
  const rawStatus = String(extractCreationStatus(json) || '').toUpperCase();
  const nextPollSeconds = extractPollAfterSeconds(json);

  if (rawStatus === 'PENDING' || rawStatus === 'RUNNING') {
    return { ok: true, status: 'waiting_provider', progress: null, nextPollSeconds, outputs: [], error: null, rawMetadata: { providerStatus: rawStatus } };
  }

  if (rawStatus === 'COMPLETED') {
    const urls = collectResourceUrls(result);
    const outputUrl = urls[0] || null;
    if (!outputUrl || !/^https:\/\//i.test(outputUrl)) {
      return { ok: false, status: 'failed', error: 'OpenArt reported the video as completed but did not return a valid https output URL.', errorReason: 'malformed_output', retryable: isRetryableErrorReason('malformed_output'), rawMetadata: { providerStatus: rawStatus } };
    }
    return {
      ok: true,
      status: 'completed',
      progress: 100,
      nextPollSeconds: null,
      outputs: [{
        type: 'video',
        url: outputUrl,
        mimeType: 'video/mp4',
        filename: 'openart-video.mp4',
        metadata: { kind: 'openart-video', durationSeconds: null },
      }],
      error: null,
      rawMetadata: { providerStatus: rawStatus },
    };
  }

  if (rawStatus === 'FAILED') {
    const message = String(json?.error || json?.message || 'OpenArt reported the generation failed.').slice(0, 500);
    // OpenArt does not (as far as this checkpoint has confirmed) expose a
    // structured failure code the way Higgsfield's failure_code does — this
    // is a best-effort message-pattern classification, documented as such
    // rather than presented as a confirmed structured error taxonomy.
    const lower = message.toLowerCase();
    const errorReason = /insufficient|not enough credit/.test(lower) ? 'insufficient_credits'
      : /plan|upgrade|entitlement|subscription required/.test(lower) ? 'entitlement_required'
      : 'provider_error';
    return { ok: false, status: 'failed', error: message, errorReason, retryable: isRetryableErrorReason(errorReason), rawMetadata: { providerStatus: rawStatus } };
  }

  if (rawStatus === 'CANCELLED') {
    return { ok: false, status: 'failed', error: 'OpenArt reported this generation as cancelled.', errorReason: 'cancelled', retryable: false, rawMetadata: { providerStatus: rawStatus } };
  }

  // Unrecognized/empty status — never fabricate; treat as still in progress
  // (honestly logging the raw value) rather than guessing a terminal state.
  return { ok: true, status: 'waiting_provider', progress: null, nextPollSeconds, outputs: [], error: null, rawMetadata: { providerStatus: rawStatus || 'unknown' } };
}

// ── Adapter ───────────────────────────────────────────────────────────────

const openartVideoMcpAdapter = {
  id: 'openart-video',
  displayName: 'OpenArt Video',
  status: 'staged', // true executable status is only ever reported via healthCheck()
  supportedModes: SUPPORTED_MODES,
  executionType: 'mcp',
  billingPool: 'openart-credits',
  mock: false,

  async healthCheck() {
    const connection = await checkOpenArtHealth();
    if (!connection.ok) return { ...connection, adapterId: 'openart-video' };

    const redirectUrl = redirectUrlFromEnv();
    let tools;
    try {
      tools = await listOpenArtTools(redirectUrl);
    } catch (e) {
      return { ok: false, status: 'unavailable', error: e.message, adapterId: 'openart-video' };
    }

    const missing = REQUIRED_OPENART_VIDEO_TOOLS.filter(name => !tools.some(t => t.name === name));
    if (missing.length) {
      return {
        ok: false, status: 'tooling_incomplete',
        error: `Required OpenArt tool(s) not found in the live discovered list: ${missing.join(', ')}.`,
        adapterId: 'openart-video', toolCount: tools.length,
      };
    }

    return { ok: true, status: 'active', latencyMs: connection.latencyMs, adapterId: 'openart-video', toolCount: tools.length };
  },

  async validateInput({ job, pkg }) {
    const redirectUrl = redirectUrlFromEnv();
    const health = await this.healthCheck();
    if (!health.ok) {
      return { valid: false, errors: [health.error || `OpenArt Video is not ready (status: ${health.status}).`], warnings: [] };
    }

    const providerInput = job?.providerInput;
    let models = null;
    let formSchema = null;
    if (providerInput?.model) {
      models = await fetchVideoModelCatalog(redirectUrl).catch(() => null);
      if (models) {
        formSchema = await fetchVideoModelForm(providerInput.model, redirectUrl).catch(() => null);
      }
    }
    const result = validateOpenArtVideoProviderInputSync({ job, pkg, models, formSchema });
    if (providerInput?.model && !models) {
      result.warnings.push('Could not fully re-verify the model catalog against OpenArt right now — proceeding with cached/prior selection.');
    }
    return result;
  },

  /**
   * Real, non-generating cost preflight via openart_model_cost. Confirmed
   * live (this session): never submits a job. Falls back to an honest
   * provisional shape (never a fabricated number) if the preflight call
   * itself fails for any reason.
   */
  async estimate({ job }) {
    const providerInput = job?.providerInput;
    if (!providerInput?.model || !providerInput?.prompt || !providerInput?.durationSeconds || !providerInput?.aspectRatio || !providerInput?.resolution) {
      return {
        estimateType: 'provisional', estimatedRange: null, costTier: 'variable',
        currency: 'openart-credits', provisional: true, approvalRequired: true,
        note: 'Cost unknown — OpenArt credits may be consumed. Select a model, duration, aspect ratio, and resolution, and enter a prompt to preview the exact cost.',
      };
    }

    const redirectUrl = redirectUrlFromEnv();
    try {
      const formSchema = await fetchVideoModelForm(providerInput.model, redirectUrl);
      const args = buildOpenArtVideoCostPreviewArgs({ providerInput, formSchema });
      const result = await callOpenArtTool(COST_TOOL, args, { redirectUrl });
      const credits = extractTotalCredits(result.json);
      if (typeof credits === 'number') {
        return {
          estimateType: 'live_preflight',
          estimatedRange: { min: credits, max: credits },
          costTier: null,
          currency: 'openart-credits',
          provisional: false,
          approvalRequired: true,
          note: `Live OpenArt cost preflight: ${credits} credits (openart_model_cost — no job submitted).`,
        };
      }
    } catch {
      // fall through to the honest provisional shape below
    }

    return {
      estimateType: 'provisional', estimatedRange: null, costTier: 'variable',
      currency: 'openart-credits', provisional: true, approvalRequired: true,
      note: 'Cost unknown — OpenArt credits may be consumed. The live cost preflight could not be completed right now.',
    };
  },

  async submit({ job, pkg }) {
    const validation = await this.validateInput({ job, pkg });
    if (!validation.valid) {
      return {
        ok: false, providerJobId: null, status: 'failed', nextPollSeconds: null,
        error: validation.errors.join(' '), errorReason: 'validation_error', rawMetadata: {},
      };
    }

    if (job.execution?.providerJobId) {
      return {
        ok: false, providerJobId: null, status: 'failed', nextPollSeconds: null,
        error: 'A provider job already exists for this execution attempt — refusing to double-submit.',
        errorReason: 'validation_error', rawMetadata: {},
      };
    }

    const redirectUrl = redirectUrlFromEnv();
    const providerInput = job.providerInput;
    const formSchema = await fetchVideoModelForm(providerInput.model, redirectUrl);
    const { model, mode, params } = buildOpenArtVideoSubmitArgs({ providerInput, formSchema });

    let result;
    try {
      result = await callOpenArtTool(GENERATE_TOOL, { model, mode, params }, { redirectUrl });
    } catch (e) {
      return {
        ok: false, providerJobId: null, status: 'failed', nextPollSeconds: null,
        error: e.message, errorReason: classifySubmitError(e), rawMetadata: {},
      };
    }

    const parsed = parseOpenArtVideoSubmitResponse(result);
    if (!parsed.historyId) {
      return {
        ok: false, providerJobId: null, status: 'failed', nextPollSeconds: null,
        error: 'OpenArt did not return a historyId for this video submission.', errorReason: 'malformed_output',
        rawMetadata: buildSafeOpenArtVideoDiagnostics(result),
      };
    }

    return {
      ok: true,
      providerJobId: parsed.historyId,
      status: 'waiting_provider',
      nextPollSeconds: 5,
      rawMetadata: {
        promptCharCount: providerInput.prompt.trim().length,
        promptHash: promptHash(providerInput.prompt),
        model,
        mode,
        aspectRatio: params.aspectRatio,
        durationSeconds: params.duration,
        resolution: params.resolution,
        submittedAt: new Date().toISOString(),
      },
    };
  },

  async poll({ providerJobId }) {
    if (!providerJobId) {
      return { ok: false, status: 'failed', error: 'No provider job id recorded for this execution.', errorReason: 'malformed_output', rawMetadata: null };
    }

    const redirectUrl = redirectUrlFromEnv();
    let result;
    try {
      result = await callOpenArtTool(STATUS_TOOL, { historyId: providerJobId }, { redirectUrl });
    } catch (e) {
      return { ok: false, status: 'failed', error: e.message, errorReason: classifySubmitError(e), rawMetadata: null };
    }

    return mapOpenArtVideoPollResponse(result);
  },

  async cancel({ providerJobId }) {
    return {
      ok: false,
      status: 'unsupported',
      error: providerJobId
        ? `OpenArt has no cancellation tool for a video generation already in progress (provider job ${providerJobId}). The render may continue and consume credits even though this job will be marked cancelled locally.`
        : 'No provider job was ever submitted for this attempt.',
      errorReason: 'provider_cancel_unsupported',
    };
  },

  normalizeResult(result) {
    return {
      status: result.status,
      outputs: result.outputs || [],
      providerMetadata: result.rawMetadata || null,
    };
  },
};

export default openartVideoMcpAdapter;
export { fetchVideoModelCatalog, fetchVideoModelForm };
