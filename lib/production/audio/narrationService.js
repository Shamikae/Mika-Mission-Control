// lib/production/audio/narrationService.js
// SERVER-SIDE ONLY. The ONE place narration audio is actually synthesized.
//
// ── Governed narration generation ────────────────────────────────────────
//
// URS narration → one local audio file → a persisted record. Everything
// policy-shaped (voice allowlist, speed bounds, sanitization, cost, timing
// fit) lives in narrationRules.js; everything path-shaped lives in
// narrationStore.js. This module only orchestrates and owns the single
// provider adapter.
//
// It deliberately does NOT touch the HyperFrames adapter, the Provider
// Execution Engine, the Production Router, or any remote provider. It is a
// leaf service: callers ask for narration and get a record back.
//
// ── Safety ───────────────────────────────────────────────────────────────
//   • The synthesizer is invoked with execFile (NEVER a shell), so no model
//     text can ever be interpreted as a command.
//   • Narration text is written to a temp .txt and passed via `-f`, so it is
//     never an argv element at all — length and quoting are non-issues.
//   • Output paths come only from narrationStore's validated resolvers.
//   • Voice and speed are validated against a closed allowlist before use.
//   • No retry loop. A failure is returned, never silently re-attempted.

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import {
  NARRATION_PROVIDER, NARRATION_MODEL, NARRATION_SCHEMA_VERSION,
  DEFAULT_VOICE_ID, DEFAULT_SPEED, isValidVoiceId, isValidSpeed,
  sanitizeNarrationText, speedToWordsPerMinute, estimateNarrationCost,
  narrationFingerprintInput, NARRATION_FILENAME, NARRATION_MIME,
  isAllowedNarrationMime, MAX_NARRATION_CHARS,
} from './narrationRules.js';
import {
  getNarrationRecord, saveNarrationRecord, narrationAssetExists,
  ensureNarrationAudioDir, resolveNarrationAudioPath,
} from './narrationStore.js';

const execFileAsync = promisify(execFile);

const SYNTH_TIMEOUT_MS = 120_000;
const PROBE_TIMEOUT_MS = 15_000;

/** Deterministic audio id — identical text/voice/speed always reuse one asset. */
export function narrationIdFor({ text, voiceId, speed }) {
  const hash = crypto.createHash('sha256').update(narrationFingerprintInput({ text, voiceId, speed })).digest('hex');
  return `nar-${hash.slice(0, 16)}`;
}

/** Real measured duration. Never estimated from word count once audio exists. */
async function probeAudioDuration(filePath) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'json',
      filePath,
    ], { timeout: PROBE_TIMEOUT_MS });
    const parsed = JSON.parse(stdout);
    const d = Number(parsed?.format?.duration);
    return Number.isFinite(d) ? Math.round(d * 100) / 100 : null;
  } catch {
    return null; // honest null — never a fabricated duration
  }
}

/**
 * Synthesizes narration audio locally.
 *
 * @param {object} input
 * @param {string} input.packageId
 * @param {string} input.renderSpecId
 * @param {string} input.text            raw narration (sanitized here)
 * @param {string} [input.voiceId]       must be in the allowlist
 * @param {number} [input.speed]         bounded multiplier
 * @param {number} [input.targetDurationSeconds] advisory only — never truncates
 * @param {boolean} [input.force]        regenerate even if a cached asset exists
 * @returns {Promise<{ok, record?, reused?, error?, warnings?}>}
 */
export async function generateNarration({
  packageId, renderSpecId, text, voiceId = DEFAULT_VOICE_ID,
  speed = DEFAULT_SPEED, targetDurationSeconds = null, force = false,
} = {}) {
  const warnings = [];

  const cleanText = sanitizeNarrationText(text);
  if (!cleanText) {
    return { ok: false, error: 'No narration text available to synthesize.', warnings };
  }
  if (typeof text === 'string' && text.length > MAX_NARRATION_CHARS) {
    warnings.push(`Narration text was clamped to ${MAX_NARRATION_CHARS} characters.`);
  }
  if (!isValidVoiceId(voiceId)) {
    return { ok: false, error: `Voice "${voiceId}" is not in the allowlist.`, warnings };
  }
  if (!isValidSpeed(speed)) {
    return { ok: false, error: `Speed ${speed} is outside the supported range.`, warnings };
  }

  const audioId = narrationIdFor({ text: cleanText, voiceId, speed });

  // ── Deterministic reuse ────────────────────────────────────────────────
  if (!force) {
    const existing = getNarrationRecord(audioId);
    if (existing && narrationAssetExists(audioId, existing.filename || NARRATION_FILENAME)) {
      return { ok: true, record: existing, reused: true, warnings };
    }
  }

  const dir = ensureNarrationAudioDir(audioId);
  const outPath = resolveNarrationAudioPath(audioId, NARRATION_FILENAME);
  const textPath = path.join(dir, 'source.txt');

  // Text goes to a FILE, never argv — model text can never become an argument.
  fs.writeFileSync(textPath, cleanText, 'utf-8');

  const wpm = speedToWordsPerMinute(speed);
  const startedAt = new Date().toISOString();

  try {
    // execFile, not exec: no shell, so no interpolation of any kind.
    await execFileAsync('say', [
      '-v', voiceId,
      '-r', String(wpm),
      '-o', outPath,
      '--data-format=LEI16@24000',
      '-f', textPath,
    ], { timeout: SYNTH_TIMEOUT_MS });
  } catch (err) {
    return { ok: false, error: `Narration synthesis failed: ${err.message}`, warnings };
  }

  if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
    return { ok: false, error: 'Narration synthesis produced no audio.', warnings };
  }

  const durationSeconds = await probeAudioDuration(outPath);
  if (durationSeconds == null) {
    warnings.push('Could not probe narration duration (ffprobe unavailable) — timing fit cannot be verified.');
  }
  if (!isAllowedNarrationMime(NARRATION_MIME)) {
    return { ok: false, error: `Produced MIME ${NARRATION_MIME} is not in the allowlist.`, warnings };
  }

  const cost = estimateNarrationCost({ characterCount: cleanText.length });

  const record = {
    schemaVersion: NARRATION_SCHEMA_VERSION,
    audioId,
    packageId: packageId || null,
    renderSpecId: renderSpecId || null,
    // Project-relative ONLY. Never absolute, never returned to a browser.
    localPathInternal: path.relative(process.cwd(), outPath),
    filename: NARRATION_FILENAME,
    mimeType: NARRATION_MIME,
    durationSeconds,
    characterCount: cleanText.length,
    wordCount: cleanText.split(/\s+/).length,
    voiceId,
    speed,
    wordsPerMinute: wpm,
    provider: NARRATION_PROVIDER,
    model: NARRATION_MODEL,
    estimatedCost: cost,
    // Local synthesis: the estimate IS the actual. Not a guess.
    actualCost: { amountUsd: 0, currency: 'USD', confirmed: true },
    targetDurationSeconds: Number.isFinite(targetDurationSeconds) ? targetDurationSeconds : null,
    sizeBytes: fs.statSync(outPath).size,
    generatedAt: startedAt,
    warnings,
  };

  saveNarrationRecord(record);
  return { ok: true, record, reused: false, warnings };
}

/**
 * Copies a narration asset into a destination directory that the CALLER has
 * already validated. Never resolves or trusts a caller-supplied filename, and
 * never writes anywhere but `<destDir>/assets/<NARRATION_FILENAME>`.
 *
 * @returns {{ ok, relativeSrc?, sizeBytes?, error? }}
 */
export function copyNarrationIntoComposition(audioId, destCompositionDir) {
  let sourcePath;
  try {
    sourcePath = resolveNarrationAudioPath(audioId, NARRATION_FILENAME);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  if (!fs.existsSync(sourcePath)) return { ok: false, error: `Narration asset "${audioId}" not found.` };

  if (typeof destCompositionDir !== 'string' || !path.isAbsolute(destCompositionDir)) {
    return { ok: false, error: 'Destination composition directory must be an absolute, pre-validated path.' };
  }

  const assetsDir = path.join(destCompositionDir, 'assets');
  const destPath = path.join(assetsDir, NARRATION_FILENAME);
  if (!destPath.startsWith(destCompositionDir + path.sep)) {
    return { ok: false, error: 'Refusing a narration destination that escapes the composition directory.' };
  }

  try {
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.copyFileSync(sourcePath, destPath);
  } catch (err) {
    return { ok: false, error: `Could not copy narration into the composition: ${err.message}` };
  }

  return {
    ok: true,
    // Relative, composition-local — exactly what the <audio src> needs.
    relativeSrc: `assets/${NARRATION_FILENAME}`,
    sizeBytes: fs.statSync(destPath).size,
  };
}
