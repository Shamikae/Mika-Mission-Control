// lib/production/audio/narrationRules.js
// Pure functions — no I/O, no fs, no network, no process spawning. Safe on
// both server and client (same convention as productionRules.js,
// publishingRules.js, renderSpecSchema.js).
//
// ── Narration governance ─────────────────────────────────────────────────
//
// The rules layer for turning URS narration into one synchronized audio track:
// text sanitization, the voice allowlist, speed bounds, cost policy, and the
// timing-fit decision. Deliberately provider-shaped rather than provider-
// specific — narrationService.js owns the one adapter that actually speaks.
//
// v1 policy: EXACTLY ONE narration track per composition. No music (nothing
// upstream produces music intent, and none is ever fabricated), no per-scene
// segmentation, no hidden retries that could spend anything.

export const NARRATION_SCHEMA_VERSION = 1;

// The only provider wired in v1. macOS `say` is already installed on this
// machine, runs entirely locally, costs nothing, needs no credential, and
// makes no network call — so it clears the cost gate by construction.
// HyperFrames' own `hyperframes tts` (Kokoro-82M) is a strictly better-
// sounding local option but requires installing a Python stack
// (kokoro-onnx + soundfile), which v1 deliberately does not do.
export const NARRATION_PROVIDER = 'macos-say';
export const NARRATION_MODEL = 'macos-speech-synthesis';

// Explicit allowlist — a voice is never taken from model output or free text.
// Verified present via `say -v '?'` on this machine.
export const VOICE_ALLOWLIST = [
  { id: 'Samantha', label: 'Samantha (en-US)', locale: 'en_US' },
  { id: 'Daniel', label: 'Daniel (en-GB)', locale: 'en_GB' },
  { id: 'Karen', label: 'Karen (en-AU)', locale: 'en_AU' },
  { id: 'Moira', label: 'Moira (en-IE)', locale: 'en_IE' },
  { id: 'Tessa', label: 'Tessa (en-ZA)', locale: 'en_ZA' },
];
export const DEFAULT_VOICE_ID = 'Samantha';

export function isValidVoiceId(voiceId) {
  return VOICE_ALLOWLIST.some(v => v.id === voiceId);
}

// `say` speaks at a words-per-minute rate. Speed is expressed as a multiplier
// so the contract stays provider-neutral; the adapter converts.
export const BASE_WORDS_PER_MINUTE = 175;
export const MIN_SPEED = 0.85;
export const MAX_SPEED = 1.15; // beyond this, narration stops sounding natural
export const DEFAULT_SPEED = 1.0;

export function isValidSpeed(speed) {
  return Number.isFinite(speed) && speed >= MIN_SPEED && speed <= MAX_SPEED;
}

export function speedToWordsPerMinute(speed) {
  const s = isValidSpeed(speed) ? speed : DEFAULT_SPEED;
  return Math.round(BASE_WORDS_PER_MINUTE * s);
}

// ── Text sanitization ────────────────────────────────────────────────────

export const MAX_NARRATION_CHARS = 6000;

/**
 * Narration text is model-authored, so it is normalized before ever reaching
 * a process argument. Control characters are stripped, whitespace collapsed,
 * and length clamped. The text is ALWAYS passed to the synthesizer via a file
 * (never as a shell argument), so this is defence in depth, not the only
 * protection — see narrationService.js.
 */
export function sanitizeNarrationText(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NARRATION_CHARS);
}

/**
 * Pulls narration out of a URS. Prefers the complete script (one continuous
 * read sounds natural); falls back to concatenated per-scene narration.
 * Never invents text.
 */
export function extractNarrationFromSpec(spec) {
  const full = sanitizeNarrationText(spec?.audio?.narration?.text);
  if (full) return { text: full, source: 'audio.narration.text' };

  const perScene = sanitizeNarrationText(
    (spec?.scenes || []).map(s => s?.narration).filter(t => typeof t === 'string' && t.trim()).join(' '),
  );
  if (perScene) return { text: perScene, source: 'scenes[].narration' };

  return { text: '', source: 'none' };
}

// ── Cost governance ──────────────────────────────────────────────────────

/**
 * A local synthesizer has no per-character price. This returns a CONFIRMED
 * zero rather than a provisional estimate — and never fabricates a figure.
 * A future paid provider returns estimateType 'provisional_*' with a real
 * range, and the caller's approval gate applies.
 */
export function estimateNarrationCost({ characterCount = 0 } = {}) {
  return {
    provider: NARRATION_PROVIDER,
    model: NARRATION_MODEL,
    characterCount,
    estimateType: 'confirmed_local',
    amountUsd: 0,
    currency: 'USD',
    costTier: 'free',
    approvalRequired: false,
    basis: 'Local on-device speech synthesis — no API call, no credential, no metered spend.',
  };
}

// ── Timing fit ───────────────────────────────────────────────────────────

// How far past the timeline we will try to recover with a speed change before
// declaring the script genuinely too long.
export const MAX_RECOVERABLE_OVERRUN_RATIO = MAX_SPEED; // 15%

export const TIMING_FITS = ['shorter', 'exact', 'adjustable', 'too_long', 'unknown'];

/**
 * Decides what to do about a real measured audio duration against the URS
 * timeline. NEVER truncates narration and never stretches past
 * intelligibility — a script that cannot fit is reported as needing revision.
 *
 * @returns {{ fit, varianceSeconds, requiredSpeed, appliedSpeed, blocking, warnings }}
 */
export function classifyTimingFit({ audioDurationSeconds, timelineDurationSeconds, currentSpeed = DEFAULT_SPEED }) {
  const warnings = [];
  if (!Number.isFinite(audioDurationSeconds) || !Number.isFinite(timelineDurationSeconds) || timelineDurationSeconds <= 0) {
    return { fit: 'unknown', varianceSeconds: null, requiredSpeed: null, appliedSpeed: currentSpeed, blocking: false, warnings: ['Could not measure narration or timeline duration.'] };
  }

  const variance = Math.round((audioDurationSeconds - timelineDurationSeconds) * 100) / 100;

  if (Math.abs(variance) < 0.5) {
    return { fit: 'exact', varianceSeconds: variance, requiredSpeed: null, appliedSpeed: currentSpeed, blocking: false, warnings };
  }

  if (variance < 0) {
    warnings.push(`Narration is ${Math.abs(variance)}s shorter than the ${timelineDurationSeconds}s timeline — scene timing is preserved and the tail plays as natural silence.`);
    return { fit: 'shorter', varianceSeconds: variance, requiredSpeed: null, appliedSpeed: currentSpeed, blocking: false, warnings };
  }

  // Longer than the timeline: can a bounded speed-up recover it?
  const requiredSpeed = Math.round((currentSpeed * (audioDurationSeconds / timelineDurationSeconds)) * 1000) / 1000;
  if (requiredSpeed <= MAX_SPEED) {
    warnings.push(`Narration overruns the timeline by ${variance}s — recoverable with a ${requiredSpeed}x speed adjustment (within the ${MAX_SPEED}x intelligibility limit).`);
    return { fit: 'adjustable', varianceSeconds: variance, requiredSpeed, appliedSpeed: currentSpeed, blocking: false, warnings };
  }

  warnings.push(`Narration overruns the ${timelineDurationSeconds}s timeline by ${variance}s. Recovering would need ${requiredSpeed}x, past the ${MAX_SPEED}x intelligibility limit. The script or the scene timing must be revised — narration is never truncated.`);
  return { fit: 'too_long', varianceSeconds: variance, requiredSpeed, appliedSpeed: currentSpeed, blocking: true, warnings };
}

// ── Audio output contract ────────────────────────────────────────────────

export const NARRATION_MIME_ALLOWLIST = ['audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/aac'];
export const NARRATION_FILENAME = 'narration.wav';
export const NARRATION_MIME = 'audio/wav';

export function isAllowedNarrationMime(mime) {
  return NARRATION_MIME_ALLOWLIST.includes(mime);
}

/** Deterministic id for a narration request — identical inputs reuse the same asset. */
export function narrationFingerprintInput({ text, voiceId, speed }) {
  return JSON.stringify({
    v: NARRATION_SCHEMA_VERSION,
    provider: NARRATION_PROVIDER,
    model: NARRATION_MODEL,
    text,
    voiceId,
    speed: Number(speed),
  });
}
