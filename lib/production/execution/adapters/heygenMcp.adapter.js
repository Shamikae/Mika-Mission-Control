// lib/production/execution/adapters/heygenMcp.adapter.js
// SERVER-SIDE ONLY.
//
// Real HeyGen MCP provider adapter — Checkpoint 2. Generates through the
// single live-discovered, schema-confirmed tool "create_video_from_avatar"
// (OAuth 2.1 + PKCE, Streamable HTTP, billed against the authenticated
// user's HeyGen web-plan premium credits — no HEYGEN_API_KEY). Polls via
// "get_video". Supports exactly avatar_video and talking_head.
//
// "create_video_agent" (one-shot prompt-driven generation) and
// "create_video_from_template" were evaluated during live schema discovery
// and rejected for V1: create_video_agent has no direct script-text field
// (it interprets a freeform prompt itself, which cannot honor "use
// package script.fullText verbatim"), and create_video_from_template does
// not exist in this account's live discovered tool list at all.
//
// No cancellation tool exists for a create_video_from_avatar render (only
// delete_video — a destructive, unrelated "delete the video record" action
// — and stop_video_agent_session, which applies to create_video_agent
// sessions only). cancel() is honest about this rather than inventing one.
//
// No cost/estimate/credit/usage/balance tool exists anywhere in the live
// 75-tool discovery. estimate() returns a provisional, approval-required
// shape rather than a fabricated number.

import { createHash } from 'crypto';
import {
  callHeyGenTool, checkHeyGenMcpHealth, getHeyGenGenerationSchema,
  listHeyGenAvatars, listHeyGenVoices,
} from '../../../heygen/heygenMcpClient.js';
import { isRetryableErrorReason } from '../executionRules.js';

const SUPPORTED_MODES = ['avatar_video', 'talking_head'];
const GENERATION_TOOL = 'create_video_from_avatar';
const STATUS_TOOL = 'get_video';
const DEFAULT_RESOLUTION = '1080p';
// The live create_video_from_avatar schema's resolution enum, as confirmed
// via real discovery (Checkpoint 2). Not re-fetched per request — this is a
// fixed tool-schema property, not account-specific data.
const KNOWN_RESOLUTION_OPTIONS = ['4k', '1080p', '720p'];

// Not derived from HeyGen's schema — "script" has no declared maxLength in
// the live create_video_from_avatar schema. This is a Mika-side safety cap
// only (clearly distinct from a provider-declared limit), generous enough
// for any realistic single avatar-video script.
const MIKA_SCRIPT_SAFETY_MAX_CHARS = 5000;

function redirectUrlFromEnv() {
  return String(process.env.HEYGEN_MCP_OAUTH_REDIRECT_URL || '').trim() || undefined;
}

function scriptHash(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

function classifySubmitError(e) {
  if (e.code === 'authorization_required') return 'authentication_error';
  if (e.code === 'disabled') return 'validation_error';
  return 'provider_error';
}

// ── HeyGen poll-failure normalization ────────────────────────────────────
// HeyGen's real get_video failure shape (confirmed via a live rejected
// render — RESOLUTION_NOT_ALLOWED) uses failure_code + failure_message,
// fields this adapter did not originally anticipate. Existing fallback
// fields (error.message / error_message / failure_reason / message) remain
// supported — failure_message just takes priority when present, since it's
// the most specific field HeyGen itself actually populates.

const MAX_FAILURE_MESSAGE_CHARS = 500;
const MAX_FAILURE_CODE_CHARS = 60;

/** Lowercases/snake_cases an arbitrary provider failure code into a value
 * safe to persist as errorReason — never passes provider text through raw. */
function sanitizeFailureCode(code) {
  if (!code || typeof code !== 'string') return null;
  const normalized = code.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized ? normalized.slice(0, MAX_FAILURE_CODE_CHARS) : null;
}

function extractHeyGenFailureMessage(raw) {
  const msg = raw.failure_message || raw.error?.message || raw.error_message || raw.failure_reason || raw.message
    || 'HeyGen reported the render failed.';
  return String(msg).slice(0, MAX_FAILURE_MESSAGE_CHARS);
}

/**
 * Normalizes a failed get_video response. If HeyGen supplied a failure_code,
 * that becomes errorReason (sanitized) — this is what makes plan/entitlement
 * rejections like RESOLUTION_NOT_ALLOWED naturally non-retryable: a
 * provider-specific code is never a member of RETRYABLE_ERROR_REASONS
 * (network_error/timeout/provider_error/rate_limited/unknown_error), so
 * isRetryableErrorReason() — the SAME function the execution engine's own
 * retry endpoint checks — correctly refuses a retry, with no separate
 * plan/entitlement keyword list to keep in sync. A genuinely transient
 * provider failure code that happens to normalize to one of those five
 * reserved reasons (e.g. HeyGen using "RATE_LIMITED") stays retryable, as
 * it should. No failure_code at all falls back to the prior behavior
 * (errorReason: 'provider_error', retryable) — unchanged for callers that
 * never gave us a specific reason to distrust.
 */
function normalizeHeyGenFailure(raw, rawStatus) {
  const rawFailureCode = typeof raw.failure_code === 'string' ? raw.failure_code : null;
  const errorReason = sanitizeFailureCode(rawFailureCode) || 'provider_error';
  return {
    ok: false,
    status: 'failed',
    error: extractHeyGenFailureMessage(raw),
    errorReason,
    retryable: isRetryableErrorReason(errorReason),
    rawMetadata: rawFailureCode ? { failureCode: rawFailureCode } : { providerStatus: rawStatus },
  };
}

// ── Shared, pure-ish validation (also used by the provider-input API route
// so both places agree on exactly the same rules — no parallel logic). ────

/**
 * @param {{ job: object, pkg: object, avatars: Array, voices: Array }} ctx
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateHeyGenProviderInputSync({ job, pkg, avatars, voices }) {
  const errors = [];
  const warnings = [];

  if (!SUPPORTED_MODES.includes(job?.selectedMode)) {
    errors.push(`HeyGen MCP only supports avatar_video and talking_head modes (selected: "${job?.selectedMode || 'none'}").`);
  }

  const scriptText = (pkg?.script?.fullText || '').trim();
  if (!scriptText) {
    errors.push('Package script is required.');
  } else if (scriptText.length > MIKA_SCRIPT_SAFETY_MAX_CHARS) {
    errors.push(`Script is ${scriptText.length} characters — exceeds Mika's safety maximum of ${MIKA_SCRIPT_SAFETY_MAX_CHARS} characters for a single HeyGen avatar render.`);
  }

  const providerInput = job?.providerInput || null;
  if (!providerInput?.avatarId) {
    errors.push('An avatar must be selected in HeyGen Setup.');
  } else if (Array.isArray(avatars)) {
    const found = avatars.find(a => a.avatarId === providerInput.avatarId);
    if (!found) errors.push('Selected avatar was not found in the current HeyGen avatar list — it may have been removed. Re-select in HeyGen Setup.');
    else if (found.availability !== 'available') errors.push(`Selected avatar is not currently available (status: ${found.availability}).`);
  }

  if (!providerInput?.voiceId) {
    errors.push('A voice must be selected in HeyGen Setup.');
  } else if (Array.isArray(voices)) {
    const found = voices.find(v => v.voiceId === providerInput.voiceId);
    if (!found) errors.push('Selected voice was not found in the current HeyGen voice list. Re-select in HeyGen Setup.');
  }

  if (providerInput?.selectedTool && providerInput.selectedTool !== GENERATION_TOOL) {
    errors.push(`Unsupported generation tool "${providerInput.selectedTool}" — only "${GENERATION_TOOL}" is implemented in this checkpoint.`);
  }

  if (providerInput?.voiceSpeed != null) {
    const speed = Number(providerInput.voiceSpeed);
    if (!Number.isFinite(speed) || speed < 0.5 || speed > 1.5) {
      errors.push('voiceSpeed must be a number between 0.5 and 1.5.');
    }
  }

  if (providerInput?.resolution != null && !KNOWN_RESOLUTION_OPTIONS.includes(providerInput.resolution)) {
    errors.push(`resolution must be one of: ${KNOWN_RESOLUTION_OPTIONS.join(', ')}.`);
  }

  warnings.push('Submitting may consume HeyGen web-plan premium credits — exact cost is not available before generation.');
  return { valid: errors.length === 0, errors, warnings };
}

// ── Pure payload-mapping / response-parsing helpers ─────────────────────────
// Extracted from submit()/poll() specifically so they can be unit-tested
// (validate-heygen-mcp-adapter.mjs) WITHOUT ever calling callHeyGenTool —
// i.e. without any live network I/O and with zero risk of invoking the real
// generation tool. Pure — no I/O, no fs, no network.

/**
 * Builds the exact create_video_from_avatar argument object from the live
 * schema + job/pkg/providerInput. Never sends a field the live schema
 * doesn't support (caption/voiceSettings are only included when the live
 * schema reports support).
 */
export function buildHeyGenSubmitArgs({ job, pkg, schema, scriptText, providerInput }) {
  const resolution = providerInput.resolution && KNOWN_RESOLUTION_OPTIONS.includes(providerInput.resolution)
    ? providerInput.resolution
    : DEFAULT_RESOLUTION;
  const args = {
    avatarId: providerInput.avatarId,
    script: scriptText,
    voiceId: providerInput.voiceId,
    aspectRatio: job.outputSpec?.aspectRatio || 'auto',
    resolution,
    outputFormat: 'mp4',
    title: String(pkg.topic || job.id).slice(0, 100),
  };
  if (providerInput.captionEnabled && schema.supportsCaption) {
    args.caption = { file_format: 'srt', style: 'default' };
  }
  if (providerInput.voiceSpeed != null && schema.supportsVoiceSpeed) {
    args.voiceSettings = { speed: Number(providerInput.voiceSpeed) };
  }
  return args;
}

/** Extracts a provider job/video id from create_video_from_avatar's response. */
export function parseHeyGenSubmitResponse(json) {
  const raw = json || {};
  const videoId = raw.video_id || raw.videoId || raw.id || null;
  return { videoId: videoId ? String(videoId) : null };
}

/**
 * Maps a get_video response onto the adapter's normalized poll() result.
 * Never fabricates a progress percentage — only passes through a numeric
 * value the provider itself reported. bulk_video_statuses' documented enum
 * (queued/processing/completed/failed, +not_found) is used as the basis for
 * get_video's status field too; anything unrecognized is treated as still
 * waiting rather than crashing.
 */
export function mapHeyGenPollResponse(json) {
  const raw = json || {};
  const rawStatus = String(raw.status || raw.video_status || raw.state || '').toLowerCase();
  const progress = typeof raw.progress === 'number' ? raw.progress
    : (typeof raw.percent_complete === 'number' ? raw.percent_complete : null);

  if (['completed', 'succeeded', 'success'].includes(rawStatus)) {
    const videoUrl = raw.video_url || raw.videoUrl || raw.url || null;
    if (!videoUrl || !/^https:\/\//i.test(videoUrl)) {
      return { ok: false, status: 'failed', error: 'HeyGen reported the video as completed but did not return a valid https video URL.', errorReason: 'malformed_output', retryable: isRetryableErrorReason('malformed_output'), rawMetadata: { providerStatus: rawStatus } };
    }
    return {
      ok: true,
      status: 'completed',
      progress: 100,
      nextPollSeconds: null,
      outputs: [{
        type: 'video',
        url: videoUrl,
        mimeType: 'video/mp4',
        filename: 'heygen-avatar-video.mp4',
        metadata: { kind: 'heygen-avatar-video', durationSeconds: typeof raw.duration === 'number' ? raw.duration : null },
      }],
      error: null,
      rawMetadata: { providerStatus: rawStatus, durationSeconds: typeof raw.duration === 'number' ? raw.duration : null },
    };
  }

  if (['failed', 'error'].includes(rawStatus)) {
    return normalizeHeyGenFailure(raw, rawStatus);
  }

  if (rawStatus === 'not_found') {
    return { ok: false, status: 'failed', error: 'HeyGen no longer recognizes this video id.', errorReason: 'malformed_output', retryable: isRetryableErrorReason('malformed_output'), rawMetadata: { providerStatus: rawStatus } };
  }

  // queued / processing / any unrecognized status — never fabricate progress.
  return {
    ok: true,
    status: 'waiting_provider',
    progress,
    nextPollSeconds: 20,
    outputs: [],
    error: null,
    rawMetadata: { providerStatus: rawStatus || 'unknown' },
  };
}

async function fetchLiveAvatarsAndVoices(redirectUrl) {
  const [avatars, voices] = await Promise.all([
    listHeyGenAvatars({ redirectUrl }).catch(() => null),
    listHeyGenVoices({ redirectUrl }).catch(() => null),
  ]);
  return { avatars, voices };
}

// ── Adapter ───────────────────────────────────────────────────────────────

const heygenMcpAdapter = {
  id: 'heygen-mcp',
  displayName: 'HeyGen MCP',
  status: 'staged', // true executable status is only ever reported via healthCheck()
  supportedModes: SUPPORTED_MODES,
  executionType: 'mcp-oauth',
  billingPool: 'web-plan-premium-credits',
  mock: false,

  async healthCheck() {
    return checkHeyGenMcpHealth();
  },

  async validateInput({ job, pkg }) {
    const redirectUrl = redirectUrlFromEnv();
    const health = await checkHeyGenMcpHealth();
    if (!health.ok) {
      return { valid: false, errors: [health.error || `HeyGen MCP is not ready (status: ${health.status}).`], warnings: [] };
    }

    const { avatars, voices } = await fetchLiveAvatarsAndVoices(redirectUrl);
    const result = validateHeyGenProviderInputSync({ job, pkg, avatars, voices });
    if (avatars === null || voices === null) {
      result.warnings.push('Could not fully re-verify avatar/voice availability against HeyGen right now — proceeding with cached selection.');
    }
    return result;
  },

  estimate() {
    return {
      estimateType: 'provisional',
      estimatedRange: null,
      costTier: 'variable',
      currency: 'web-plan-premium-credits',
      provisional: true,
      approvalRequired: true,
      note: 'Exact HeyGen web-plan credit usage was not available before generation.',
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
    const schema = await getHeyGenGenerationSchema(redirectUrl);
    if (!schema) {
      return {
        ok: false, providerJobId: null, status: 'failed', nextPollSeconds: null,
        error: `HeyGen's "${GENERATION_TOOL}" tool is not currently discoverable.`,
        errorReason: 'tooling_incomplete', rawMetadata: {},
      };
    }

    const scriptText = pkg.script.fullText.trim();
    const providerInput = job.providerInput;
    const args = buildHeyGenSubmitArgs({ job, pkg, schema, scriptText, providerInput });

    let result;
    try {
      result = await callHeyGenTool(GENERATION_TOOL, args, { redirectUrl });
    } catch (e) {
      return {
        ok: false, providerJobId: null, status: 'failed', nextPollSeconds: null,
        error: e.message, errorReason: classifySubmitError(e), rawMetadata: {},
      };
    }

    const parsed = parseHeyGenSubmitResponse(result.json);
    if (!parsed.videoId) {
      return {
        ok: false, providerJobId: null, status: 'failed', nextPollSeconds: null,
        error: 'HeyGen did not return a video/provider job ID.', errorReason: 'malformed_output', rawMetadata: {},
      };
    }

    return {
      ok: true,
      providerJobId: parsed.videoId,
      status: 'waiting_provider',
      nextPollSeconds: 20,
      rawMetadata: {
        scriptCharCount: scriptText.length,
        scriptHash: scriptHash(scriptText),
        avatarId: providerInput.avatarId,
        voiceId: providerInput.voiceId,
        selectedTool: GENERATION_TOOL,
        aspectRatio: args.aspectRatio,
        resolution: args.resolution,
        captionEnabled: !!args.caption,
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
      result = await callHeyGenTool(STATUS_TOOL, { videoId: providerJobId }, { redirectUrl });
    } catch (e) {
      return { ok: false, status: 'failed', error: e.message, errorReason: classifySubmitError(e), rawMetadata: null };
    }

    return mapHeyGenPollResponse(result.json);
  },

  async cancel({ providerJobId }) {
    return {
      ok: false,
      status: 'unsupported',
      error: providerJobId
        ? `HeyGen has no cancellation tool for a "${GENERATION_TOOL}" render already in progress (provider job ${providerJobId}). The render may continue and consume premium credits even though this job will be marked cancelled locally.`
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

export default heygenMcpAdapter;
