// lib/production/execution/higgsfieldReconciliationMatcher.js
// Pure — no I/O, no fs, no network, no imports beyond Node's crypto. Split
// out from higgsfieldReconciliation.js specifically so this matching logic
// can be unit-tested directly (by the validator, or anything else) without
// pulling in productionJobStore.js and its own dependency chain.

import { createHash } from 'crypto';

const TIME_WINDOW_BEFORE_MS = 2 * 60 * 1000; // 2 minutes before submit started
const TIME_WINDOW_AFTER_MS = 30 * 60 * 1000; // 30 minutes after — video renders can take a while
const MAX_CANDIDATES_RETURNED = 5;

export function promptHash(text) {
  return createHash('sha256').update(String(text || '').trim(), 'utf8').digest('hex').slice(0, 16);
}

/**
 * Pure matcher. Takes already-fetched raw generation items (the flat shape
 * confirmed live via show_generations: { id, type, status, model, params:
 * { prompt, aspect_ratio, duration }, createdAt (unix seconds) }) and the
 * job's own recorded intent, and returns only candidates that agree on
 * EVERY signal the job specified. Never returns a candidate matched on a
 * single weak signal alone. Returns sanitized candidate summaries only —
 * never a raw prompt or provider URL.
 *
 * model is intentionally NOT a hard filter: confirmed live (2026-08-05)
 * that Higgsfield may record a generation under an internally-aliased
 * model id different from the one requested (a real image submission for
 * "nano_banana_2" was recorded in history as "nano_banana_flash").
 * Requiring exact model equality would silently produce false negatives on
 * exactly the kind of real submission this module exists to recover. Media
 * type + an exact prompt hash + a narrow creation window (+ aspect
 * ratio/duration where the job specified them) remain hard requirements —
 * model match is reported for human review only.
 */
export function matchHiggsfieldGenerations({ providerInput, submittedAtIso, generations }) {
  if (!providerInput || !Array.isArray(generations)) return [];

  const targetHash = promptHash(providerInput.prompt);
  const submittedAtMs = new Date(submittedAtIso).getTime();
  const windowStart = Number.isFinite(submittedAtMs) ? submittedAtMs - TIME_WINDOW_BEFORE_MS : -Infinity;
  const windowEnd = Number.isFinite(submittedAtMs) ? submittedAtMs + TIME_WINDOW_AFTER_MS : Infinity;

  const candidates = [];
  for (const gen of generations) {
    if (!gen || typeof gen !== 'object' || !gen.id) continue;
    if (gen.type !== providerInput.mediaType) continue;
    if (promptHash(gen.params?.prompt) !== targetHash) continue;

    const genCreatedMs = typeof gen.createdAt === 'number' ? gen.createdAt * 1000 : NaN;
    if (!Number.isFinite(genCreatedMs) || genCreatedMs < windowStart || genCreatedMs > windowEnd) continue;

    if (providerInput.aspectRatio && gen.params?.aspect_ratio && gen.params.aspect_ratio !== providerInput.aspectRatio) continue;
    if (providerInput.mediaType === 'video' && providerInput.durationSeconds != null && gen.params?.duration != null
      && Number(gen.params.duration) !== Number(providerInput.durationSeconds)) continue;

    candidates.push({
      providerGenerationId: String(gen.id),
      mediaType: gen.type,
      model: gen.model,
      modelMatches: gen.model === providerInput.model,
      aspectRatioMatches: !providerInput.aspectRatio || gen.params?.aspect_ratio === providerInput.aspectRatio,
      durationMatches: providerInput.mediaType !== 'video' || providerInput.durationSeconds == null
        || gen.params?.duration == null || Number(gen.params.duration) === Number(providerInput.durationSeconds),
      promptHashMatches: true,
      createdAt: new Date(genCreatedMs).toISOString(),
    });
  }

  return candidates.slice(0, MAX_CANDIDATES_RETURNED);
}

/** @returns {'no_match'|'confident_match'|'ambiguous'} — never auto-resolves ambiguity. */
export function classifyHiggsfieldMatches(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return 'no_match';
  if (candidates.length === 1) return 'confident_match';
  return 'ambiguous';
}
