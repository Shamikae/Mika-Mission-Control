// lib/production/execution/adapters/higgsfieldMcp.adapter.js
// SERVER-SIDE ONLY.
//
// Real Higgsfield MCP provider adapter — Checkpoint 2. Generates through two
// live-discovered, schema-confirmed tools: "generate_image" (text-to-image)
// and "generate_video" (text-to-video / image-to-video), both confirmed via
// real MCP discovery against https://mcp.higgsfield.ai/mcp (90 live tools).
// Polls via "job_status". Billed against the authenticated user's Higgsfield
// account credits (or free-trial "unlim" allowance where the selected model
// supports it) — no HIGGSFIELD_API_KEY.
//
// Higgsfield's live tool list is a full agentic platform (90 tools: website
// building, game deployment, TikTok publishing, a shell sandbox, character
// training, marketplace apps, etc.). This adapter deliberately allowlists
// ONLY generate_image, generate_video, job_status, models_explore, and
// balance — every other tool (generate_*_batch, sandbox_exec, apps_invoke,
// show_characters' train action, deploy_game/publish_game,
// create_website/deploy_website/website_*, tiktok_*, confirm_billing_purchase,
// cancel_trial_auto_renewal, etc.) is never called from this file, by design.
//
// No cancellation tool exists anywhere in the live 90-tool discovery for a
// generate_image/generate_video job already in flight. cancel() is honest
// about this rather than inventing one.
//
// Unlike HeyGen, Higgsfield's generate_image/generate_video tools support a
// real, non-generating cost preflight (get_cost: true — confirmed live,
// "return the cost in credits for this generation without submitting any
// job") and a real "balance" account/credit tool. estimate() uses the real
// preflight rather than a fabricated number whenever the call succeeds.
//
// IMPORTANT — submit()/poll() response-shape status: job_status's response
// shape is CONFIRMED against two real successful generations (image and
// video, 2026-08-05): { generation: { id, type, status, model, params,
// results: { rawUrl, minUrl }, createdAt } }. The SUBMIT-time response
// shape (generate_image/generate_video's own return value) is NOT
// confirmed — both real submissions accepted the request and spent real
// credits, yet neither response could be parsed for a job id even after
// job_status's shape was folded in as a candidate. parseHiggsfieldSubmitResponse()
// currently guesses several candidate shapes (generation / generations[] /
// results[] / flat id fields) — none of these guesses should be presented
// as verified. See buildSafeSubmitDiagnostics() below: a submit response
// that still can't be parsed is now classified errorReason
// "provider_submission_unresolved" (non-retryable) with sanitized
// structural diagnostics preserved in job.execution.providerMetadata, so
// the exact real shape can finally be confirmed from a job record the next
// time this occurs — without needing another live call or a manual script.
//
// OPERATIONAL RECOVERY — direct job-file editing is diagnostic-only and
// UNSUPPORTED for routine use. Both real "provider_submission_unresolved"
// failures in this milestone were initially recovered by hand-editing the
// job's JSON file directly (setting execution.providerJobId to a generation
// id found via a one-off offline script, then calling the normal poll
// route). That was acceptable for first-time diagnosis with no governed
// alternative yet, but it is NOT a supported operational path: it bypasses
// activity-history logging discipline, has no confirmation step, and
// depends on hand-run scripts outside the app. Now that
// lib/production/execution/higgsfieldReconciliation.js exists, ANY future
// "provider_submission_unresolved" job must be recovered exclusively via
// POST /api/production/execution/[id]/reconcile-provider-submission —
// never by editing data/production-jobs/*.json directly.

import { createHash } from 'crypto';
import {
  callHiggsfieldTool, checkHiggsfieldMcpConnection, listHiggsfieldTools,
} from '../../../higgsfield/higgsfieldMcpClient.js';
import { isRetryableErrorReason } from '../executionRules.js';

const SUPPORTED_MODES = ['cinematic_broll', 'product_demo', 'image_to_video'];
const IMAGE_TOOL = 'generate_image';
const VIDEO_TOOL = 'generate_video';
const STATUS_TOOL = 'job_status';
const MODELS_TOOL = 'models_explore';
const ACCOUNT_TOOL = 'balance';

// The five tools this adapter depends on — checked by name against the live
// discovered list, never guessed. Real discovery (Checkpoint 1, this
// session) confirmed all five exist with these exact names.
export const REQUIRED_HIGGSFIELD_TOOLS = [IMAGE_TOOL, VIDEO_TOOL, STATUS_TOOL, MODELS_TOOL, ACCOUNT_TOOL];

const MEDIA_TYPES = ['image', 'video'];
const MAX_PROMPT_CHARS = 2000;
const MAX_OUTPUT_COUNT = 1; // v1 hard cap — "one output by default and maximum one in v1"

function redirectUrlFromEnv() {
  return String(process.env.HIGGSFIELD_MCP_OAUTH_REDIRECT_URL || '').trim() || undefined;
}

/** Exported so higgsfieldReconciliation.js hashes prompts identically —
 * one definition of "same prompt", never two that could silently diverge. */
export function promptHash(text) {
  return createHash('sha256').update(String(text || '').trim(), 'utf8').digest('hex').slice(0, 16);
}

// ── Safe structural diagnostics (never provider content) ────────────────────
// Used exactly once: when a submit response cannot be parsed for a job id.
// Key NAMES and booleans only — never values, URLs, prompts, tokens,
// account identifiers, or filesystem paths. This exists because the
// original submit-failure path discarded the raw response entirely
// (rawMetadata: {}), which is what forced a manual, ad hoc, offline
// recovery script for both real failures in this milestone. A future
// occurrence should be diagnosable from job.execution.providerMetadata
// alone.

const URL_PATTERN = /https?:\/\/\S+/gi;
const TOKEN_LIKE_PATTERN = /[A-Za-z0-9_-]{8,}/g;
const MAX_TEXT_PREVIEW_CHARS = 40;

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

/** Redacts URLs and any id/token/hash-like run of 8+ chars, then clamps
 * tightly. Applied before anything is returned or persisted — never the
 * raw text itself. */
function redactTextPreview(text) {
  if (typeof text !== 'string' || !text) return null;
  const redacted = text.replace(URL_PATTERN, '[url]').replace(TOKEN_LIKE_PATTERN, '[id]').replace(/\s+/g, ' ').trim();
  return redacted.slice(0, MAX_TEXT_PREVIEW_CHARS) || null;
}

/**
 * Builds structure-only diagnostics from a raw callHiggsfieldTool() result.
 * Pure — no I/O. Safe to persist directly into execution.providerMetadata
 * (which is also independently re-sanitized by executionRules.js's
 * sanitizeProviderMetadata as a second, defense-in-depth layer).
 */
export function buildSafeSubmitDiagnostics(result) {
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
    textPreview: isObj ? redactTextPreview(result.text) : null,
  };
}

function classifySubmitError(e) {
  if (e.code === 'authorization_required') return 'authentication_error';
  if (e.code === 'disabled') return 'validation_error';
  return 'provider_error';
}

// ── Model catalog (cached per-process by the discovery cache module used
// inside higgsfieldMcpClient.js's callHiggsfieldTool — this function itself
// does not cache, callers may) ────────────────────────────────────────────

async function fetchModelCatalog(mediaType, redirectUrl) {
  const result = await callHiggsfieldTool(MODELS_TOOL, { action: 'list', type: mediaType, limit: 100 }, { redirectUrl });
  return Array.isArray(result.json?.items) ? result.json.items : [];
}

// ── Shared, pure-ish validation (also usable by a future provider-input API
// route so both places would agree on exactly the same rules). ────────────

/**
 * @param {{ job: object, pkg: object, models: Array }} ctx — models is the
 *   live catalog for the selected mediaType (or null if not fetched)
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateHiggsfieldProviderInputSync({ job, pkg, models }) {
  const errors = [];
  const warnings = [];

  if (!SUPPORTED_MODES.includes(job?.selectedMode)) {
    errors.push(`Higgsfield MCP only supports cinematic_broll, product_demo, and image_to_video modes (selected: "${job?.selectedMode || 'none'}").`);
  }

  const providerInput = job?.providerInput || null;
  if (!providerInput?.mediaType || !MEDIA_TYPES.includes(providerInput.mediaType)) {
    errors.push(`providerInput.mediaType must be one of: ${MEDIA_TYPES.join(', ')}.`);
  }
  if (!providerInput?.model) {
    errors.push('A model must be selected in Higgsfield Setup.');
  } else if (Array.isArray(models)) {
    const found = models.find(m => m.id === providerInput.model);
    if (!found) errors.push(`Selected model "${providerInput.model}" was not found in the current live Higgsfield model catalog for this media type.`);
    else if (providerInput.aspectRatio && Array.isArray(found.aspect_ratios) && found.aspect_ratios.length && !found.aspect_ratios.includes(providerInput.aspectRatio)) {
      errors.push(`Model "${providerInput.model}" does not support aspect ratio "${providerInput.aspectRatio}". Supported: ${found.aspect_ratios.join(', ')}.`);
    }
  }

  const prompt = (providerInput?.prompt || '').trim();
  if (!prompt) {
    errors.push('A prompt is required.');
  } else if (prompt.length > MAX_PROMPT_CHARS) {
    errors.push(`Prompt is ${prompt.length} characters — exceeds Mika's safety maximum of ${MAX_PROMPT_CHARS} characters.`);
  }

  if (providerInput?.mediaType === 'video' && providerInput?.durationSeconds != null) {
    const d = Number(providerInput.durationSeconds);
    if (!Number.isFinite(d) || d <= 0 || d > 30) {
      errors.push('durationSeconds must be a positive number no greater than 30 for this checkpoint.');
    }
  }

  if (providerInput?.outputCount != null && Number(providerInput.outputCount) !== 1) {
    errors.push(`outputCount must be exactly 1 in this checkpoint (maximum one output).`);
  }

  // Explicitly out of scope for v1 — see file header caveat. A non-empty
  // referenceArtifactIds is rejected rather than silently ignored or
  // half-implemented against an untested media_upload/media_import_url path.
  if (Array.isArray(providerInput?.referenceArtifactIds) && providerInput.referenceArtifactIds.length > 0) {
    errors.push('Reference image input is not implemented in this checkpoint — submit a prompt-only (text-to-image / text-to-video) request.');
  }

  if (providerInput?.negativePrompt) {
    errors.push('negativePrompt is not a supported field on Higgsfield\'s live generate_image/generate_video schema — remove it.');
  }

  warnings.push('Submitting may consume Higgsfield account credits (or free-trial "unlim" allowance if the selected model supports it and is chosen) — see the cost preview before approving.');
  return { valid: errors.length === 0, errors, warnings };
}

// ── Pure payload-mapping / response-parsing helpers ─────────────────────────
// Extracted from submit()/poll()/estimate() specifically so they can be
// unit-tested (validate-higgsfield-mcp-adapter.mjs) WITHOUT ever calling
// callHiggsfieldTool — i.e. without any live network I/O and with zero risk
// of invoking a real generation tool. Pure — no I/O, no fs, no network.

/** Builds the exact generate_image/generate_video argument object. */
export function buildHiggsfieldSubmitArgs({ providerInput }) {
  const params = {
    model: providerInput.model,
    prompt: providerInput.prompt.trim(),
    count: MAX_OUTPUT_COUNT,
  };
  if (providerInput.aspectRatio) params.aspect_ratio = providerInput.aspectRatio;
  if (providerInput.mediaType === 'video' && providerInput.durationSeconds != null) {
    params.duration = Number(providerInput.durationSeconds);
  }
  if (providerInput.useUnlim === true || providerInput.useUnlim === false) {
    params.use_unlim = providerInput.useUnlim;
  }
  return { params };
}

/** Builds the get_cost:true preflight argument object — never submits a job. */
export function buildHiggsfieldCostPreviewArgs({ providerInput }) {
  const { params } = buildHiggsfieldSubmitArgs({ providerInput });
  return { params: { ...params, get_cost: true } };
}

/**
 * Extracts a provider job id from a generate_image/generate_video response.
 * job_status's response shape is CONFIRMED against two real successful
 * generations (image and video, 2026-08-05): { generation: { id, type,
 * status, model, params, results: { rawUrl, minUrl }, createdAt } }.
 *
 * The SUBMIT-time response shape (generate_image/generate_video's own
 * return value, as opposed to a later job_status call) is NOT yet
 * confirmed — the first real video submission still failed to parse even
 * after generation.id extraction was added, meaning the submit response is
 * not simply an early copy of the job_status shape. Both submissions
 * genuinely succeeded and spent real credits despite the parse failure
 * (confirmed via job_status + balance deltas), so this is a response-shape
 * gap, not a generation failure. generate_image/generate_video's own docs
 * describe `count` (1-4) rendering "together in one widget", which suggests
 * the submit response may use a plural `generations[]` array rather than a
 * singular `generation` object — checked here as a second candidate. If a
 * future submission still fails to parse, the raw response is now preserved
 * in the failure's rawMetadata (see submit() below) instead of discarded,
 * so root-causing it never again requires a manual recovery script.
 */
export function parseHiggsfieldSubmitResponse(json) {
  const raw = json || {};
  let gen = raw;
  if (raw.generation && typeof raw.generation === 'object') {
    gen = raw.generation;
  } else if (Array.isArray(raw.generations) && raw.generations.length && raw.generations[0] && typeof raw.generations[0] === 'object') {
    gen = raw.generations[0];
  } else if (Array.isArray(raw.results) && raw.results.length && raw.results[0] && typeof raw.results[0] === 'object') {
    gen = raw.results[0];
  }
  const jobId = gen.id || gen.job_id || gen.jobId || gen.generation_id || gen.generationId || null;
  return { jobId: jobId ? String(jobId) : null };
}

/**
 * Maps a job_status response onto the adapter's normalized poll() result.
 * CONFIRMED against a real successful generation (image, 2026-08-05): same
 * "generation" wrapper as parseHiggsfieldSubmitResponse, with the actual
 * output URL at generation.results.rawUrl (never output_url/url/media_url/
 * result_url — those are kept only as a defensive fallback). type ("image"
 * or "video") is reported directly by the provider — never inferred from
 * the URL unless type is absent. Never fabricates a progress percentage —
 * only passes through a numeric value the provider itself reported.
 */
export function mapHiggsfieldPollResponse(json) {
  const raw = json || {};
  const gen = raw.generation && typeof raw.generation === 'object' ? raw.generation : raw;
  const rawStatus = String(gen.status || gen.job_status || gen.state || '').toLowerCase();
  const progress = typeof gen.progress === 'number' ? gen.progress
    : (typeof gen.percent_complete === 'number' ? gen.percent_complete : null);
  const nextPollSeconds = typeof gen.poll_after_seconds === 'number' ? gen.poll_after_seconds : 15;

  if (['completed', 'succeeded', 'success'].includes(rawStatus)) {
    const outputUrl = gen.results?.rawUrl || gen.output_url || gen.url || gen.media_url || gen.result_url
      || (Array.isArray(gen.outputs) && gen.outputs[0]?.url) || null;
    if (!outputUrl || !/^https:\/\//i.test(outputUrl)) {
      return { ok: false, status: 'failed', error: 'Higgsfield reported the job as completed but did not return a valid https output URL.', errorReason: 'malformed_output', retryable: isRetryableErrorReason('malformed_output'), rawMetadata: { providerStatus: rawStatus } };
    }
    const mediaType = gen.type === 'video' || (!gen.type && /\.mp4($|\?)/i.test(outputUrl)) ? 'video' : 'image';
    return {
      ok: true,
      status: 'completed',
      progress: 100,
      nextPollSeconds: null,
      outputs: [{
        type: mediaType,
        url: outputUrl,
        mimeType: mediaType === 'video' ? 'video/mp4' : 'image/png',
        filename: `higgsfield-${mediaType}.${mediaType === 'video' ? 'mp4' : 'png'}`,
        metadata: { kind: `higgsfield-${mediaType}`, durationSeconds: typeof gen.params?.duration === 'number' ? gen.params.duration : (typeof gen.duration === 'number' ? gen.duration : null) },
      }],
      error: null,
      rawMetadata: { providerStatus: rawStatus },
    };
  }

  if (['failed', 'error'].includes(rawStatus)) {
    const rawFailureCode = typeof gen.failure_code === 'string' ? gen.failure_code : (typeof gen.fail_reason === 'string' ? gen.fail_reason : null);
    const errorReason = rawFailureCode ? rawFailureCode.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'provider_error' : 'provider_error';
    const message = String(gen.failure_message || gen.error?.message || gen.error_message || gen.message || 'Higgsfield reported the generation failed.').slice(0, 500);
    return { ok: false, status: 'failed', error: message, errorReason, retryable: isRetryableErrorReason(errorReason), rawMetadata: rawFailureCode ? { failureCode: rawFailureCode } : { providerStatus: rawStatus } };
  }

  if (rawStatus === 'not_found') {
    return { ok: false, status: 'failed', error: 'Higgsfield no longer recognizes this job id.', errorReason: 'malformed_output', retryable: isRetryableErrorReason('malformed_output'), rawMetadata: { providerStatus: rawStatus } };
  }

  // queued / processing / running / any unrecognized status — never fabricate progress.
  return {
    ok: true,
    status: 'waiting_provider',
    progress,
    nextPollSeconds,
    outputs: [],
    error: null,
    rawMetadata: { providerStatus: rawStatus || 'unknown' },
  };
}

// ── Adapter ───────────────────────────────────────────────────────────────

const higgsfieldMcpAdapter = {
  id: 'higgsfield-mcp',
  displayName: 'Higgsfield MCP',
  status: 'staged', // true executable status is only ever reported via healthCheck()
  supportedModes: SUPPORTED_MODES,
  executionType: 'mcp-oauth',
  billingPool: 'higgsfield-account-credits',
  mock: false,

  async healthCheck() {
    const connection = await checkHiggsfieldMcpConnection();
    if (!connection.ok) return connection;

    const redirectUrl = redirectUrlFromEnv();
    let tools;
    try {
      tools = await listHiggsfieldTools(redirectUrl);
    } catch (e) {
      return { ok: false, status: 'unavailable', error: e.message, adapterId: 'higgsfield-mcp' };
    }

    const missing = REQUIRED_HIGGSFIELD_TOOLS.filter(name => !tools.some(t => t.name === name));
    if (missing.length) {
      return {
        ok: false, status: 'tooling_incomplete',
        error: `Required Higgsfield MCP tool(s) not found in the live discovered list: ${missing.join(', ')}.`,
        adapterId: 'higgsfield-mcp', toolCount: tools.length,
      };
    }

    return { ok: true, status: 'active', latencyMs: connection.latencyMs, adapterId: 'higgsfield-mcp', toolCount: tools.length };
  },

  async validateInput({ job, pkg }) {
    const redirectUrl = redirectUrlFromEnv();
    const health = await this.healthCheck();
    if (!health.ok) {
      return { valid: false, errors: [health.error || `Higgsfield MCP is not ready (status: ${health.status}).`], warnings: [] };
    }

    const mediaType = job?.providerInput?.mediaType;
    let models = null;
    if (MEDIA_TYPES.includes(mediaType)) {
      models = await fetchModelCatalog(mediaType, redirectUrl).catch(() => null);
    }
    const result = validateHiggsfieldProviderInputSync({ job, pkg, models });
    if (mediaType && models === null) {
      result.warnings.push('Could not fully re-verify the model catalog against Higgsfield right now — proceeding with cached/prior selection.');
    }
    return result;
  },

  /**
   * Real, non-generating cost preflight via generate_image/generate_video's
   * get_cost:true — Higgsfield's own docs confirm this never submits a job.
   * Falls back to an honest provisional shape (never a fabricated number)
   * if the preflight call itself fails for any reason.
   */
  async estimate({ job }) {
    const providerInput = job?.providerInput;
    if (!providerInput?.model || !providerInput?.prompt || !MEDIA_TYPES.includes(providerInput?.mediaType)) {
      return {
        estimateType: 'provisional', estimatedRange: null, costTier: 'variable',
        currency: 'higgsfield-credits', provisional: true, approvalRequired: true,
        note: 'Cost unknown — Higgsfield credits may be consumed. Select a model and enter a prompt to preview the exact cost.',
      };
    }

    const redirectUrl = redirectUrlFromEnv();
    const tool = providerInput.mediaType === 'video' ? VIDEO_TOOL : IMAGE_TOOL;
    try {
      const args = buildHiggsfieldCostPreviewArgs({ providerInput });
      const result = await callHiggsfieldTool(tool, args, { redirectUrl });
      const credits = result.json?.cost?.credits_exact ?? result.json?.cost?.credits;
      if (typeof credits === 'number') {
        return {
          estimateType: 'live_preflight',
          estimatedRange: { min: credits, max: credits },
          costTier: null,
          currency: 'higgsfield-credits',
          provisional: false,
          approvalRequired: true,
          note: `Live Higgsfield cost preflight: ${credits} credits (get_cost preview — no job submitted).`,
        };
      }
    } catch {
      // fall through to the honest provisional shape below
    }

    return {
      estimateType: 'provisional', estimatedRange: null, costTier: 'variable',
      currency: 'higgsfield-credits', provisional: true, approvalRequired: true,
      note: 'Cost unknown — Higgsfield credits may be consumed. The live cost preflight could not be completed right now.',
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
    const tool = providerInput.mediaType === 'video' ? VIDEO_TOOL : IMAGE_TOOL;
    const { params } = buildHiggsfieldSubmitArgs({ providerInput });

    let result;
    try {
      result = await callHiggsfieldTool(tool, { params }, { redirectUrl });
    } catch (e) {
      return {
        ok: false, providerJobId: null, status: 'failed', nextPollSeconds: null,
        error: e.message, errorReason: classifySubmitError(e), rawMetadata: {},
      };
    }

    const parsed = parseHiggsfieldSubmitResponse(result.json);
    if (!parsed.jobId) {
      // The MCP call itself succeeded (no exception was thrown above, and
      // callHiggsfieldTool already throws on isError:true) — Higgsfield
      // genuinely accepted this submission and real credits may already
      // have been spent. This is NOT the same failure class as a generic
      // malformed/unparseable output (which covers a poll-time completed
      // job with no usable URL) — it specifically means "we don't know if
      // or how this can be recovered without risking a duplicate paid
      // submission," so it is deliberately non-retryable (see
      // executionRules.js's NON_RETRYABLE_ERROR_REASONS) and only
      // recoverable via the dedicated, no-spend reconciliation path.
      return {
        ok: false, providerJobId: null, status: 'failed', nextPollSeconds: null,
        error: 'Higgsfield accepted this submission but Mika could not parse a job ID from the response. The generation may have already started or completed and credits may already have been spent — retrying could create duplicate paid work, so this is not retryable. Use POST /api/production/execution/{id}/reconcile-provider-submission to search read-only Higgsfield generation history and safely recover the result without submitting anything new.',
        errorReason: 'provider_submission_unresolved',
        rawMetadata: buildSafeSubmitDiagnostics(result),
      };
    }

    return {
      ok: true,
      providerJobId: parsed.jobId,
      status: 'waiting_provider',
      nextPollSeconds: 15,
      rawMetadata: {
        promptCharCount: providerInput.prompt.trim().length,
        promptHash: promptHash(providerInput.prompt),
        mediaType: providerInput.mediaType,
        model: providerInput.model,
        selectedTool: tool,
        aspectRatio: params.aspect_ratio || null,
        durationSeconds: params.duration || null,
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
      result = await callHiggsfieldTool(STATUS_TOOL, { jobId: providerJobId }, { redirectUrl });
    } catch (e) {
      return { ok: false, status: 'failed', error: e.message, errorReason: classifySubmitError(e), rawMetadata: null };
    }

    return mapHiggsfieldPollResponse(result.json);
  },

  async cancel({ providerJobId }) {
    return {
      ok: false,
      status: 'unsupported',
      error: providerJobId
        ? `Higgsfield has no cancellation tool for a generation already in progress (provider job ${providerJobId}). The render may continue and consume credits even though this job will be marked cancelled locally.`
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

export default higgsfieldMcpAdapter;
