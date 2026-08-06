// lib/production/assets/assetCache.js
// SERVER-SIDE ONLY (reads asset bytes to verify integrity).
//
// ── Cache v1: strict, honest, provider-blind ─────────────────────────────
//
// Resolves an AssetRequest against the library WITHOUT contacting any
// provider. A hit means no Production Job, no provider submission, and no
// spend. Contains no provider knowledge whatsoever — reuse is decided purely
// on request semantics and asset integrity.
//
// Deliberately conservative: a near-match is a MISS, and anything it cannot
// fully verify is STALE rather than a hit. Serving a wrong or corrupt asset is
// far worse than paying 0.12 credits to regenerate.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { computeSemanticFingerprint, normalizeBrandId, FINGERPRINT_SCHEMA_VERSION } from './assetFingerprint.js';
import { findAssetIdsByFingerprint, getAssetIndexEntry, indexAsset } from './assetLibraryStore.js';
import { getAsset, resolveAssetBinaryAbsolute, sha256 } from './assetStore.js';
import { isAllowedAssetMime } from './assetRules.js';

export const CACHE_STATUSES = ['hit', 'miss', 'stale', 'ambiguous'];

// An asset is reusable unless something explicitly says otherwise. Absence of
// a policy block (every M1-era asset) means "not rejected", never "approved" —
// so nothing is silently promoted, but nothing pre-policy is silently lost.
export const REUSE_BLOCKING_STATES = ['rejected', 'retired', 'unsafe', 'corrupt'];

function hashText(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

export function fingerprintForRequest(request) {
  return computeSemanticFingerprint(request, hashText);
}

/**
 * Verifies one candidate asset can actually be reused.
 * @returns {{ eligible: boolean, reason: string, stale?: boolean }}
 */
export function checkAssetEligibility(record, request) {
  if (!record) return { eligible: false, reason: 'Asset record not found.', stale: true };

  if (record.capability !== request.capability) {
    return { eligible: false, reason: `Capability mismatch (${record.capability} vs ${request.capability}).` };
  }
  // Cross-brand reuse is never permitted, even for an identical prompt — a
  // brand's imagery is part of its identity.
  if (normalizeBrandId(record.brandId) !== normalizeBrandId(request.brandId)) {
    return { eligible: false, reason: 'Brand mismatch — cross-brand reuse is not permitted.' };
  }
  if (!isAllowedAssetMime(record.mimeType)) {
    return { eligible: false, reason: `MIME "${record.mimeType}" is not in the asset allowlist.` };
  }

  const state = record.policy?.state || null;
  if (state && REUSE_BLOCKING_STATES.includes(state)) {
    return { eligible: false, reason: `Asset is marked "${state}" and must not be reused.` };
  }
  if (record.policy?.brandApproved === false) {
    return { eligible: false, reason: 'Asset was explicitly brand-rejected.' };
  }

  // ── Integrity: the bytes must still be there AND still be the same bytes ──
  const abs = resolveAssetBinaryAbsolute(record.assetId);
  if (!abs || !fs.existsSync(abs)) {
    return { eligible: false, reason: 'Asset bytes are missing from disk.', stale: true };
  }
  let buffer;
  try { buffer = fs.readFileSync(abs); } catch {
    return { eligible: false, reason: 'Asset bytes could not be read.', stale: true };
  }
  if (buffer.length === 0) return { eligible: false, reason: 'Asset file is empty.', stale: true };
  if (sha256(buffer) !== record.contentHash) {
    return { eligible: false, reason: 'Asset bytes no longer match the recorded contentHash — the file is corrupt or was replaced.', stale: true };
  }

  return { eligible: true, reason: 'Semantic fingerprint, brand, capability, MIME, policy and byte integrity all verified.' };
}

/**
 * Deterministic variant selection.
 *
 * Policy, stated explicitly because silent selection is how a cache starts
 * lying: prefer an asset explicitly marked `selected`; otherwise take the
 * OLDEST eligible asset. Oldest — not newest — because it is the one most
 * likely already used in a published render, so reusing it keeps existing
 * output consistent. Timestamp alone never decides: ties break on assetId, and
 * every candidate is preserved in the result.
 */
export function selectVariant(eligible) {
  if (!eligible.length) return null;
  const explicit = eligible.find(r => r.policy?.selected === true);
  if (explicit) return explicit;
  return [...eligible].sort((a, b) => {
    const at = new Date(a.provenance?.generatedAt || 0) - new Date(b.provenance?.generatedAt || 0);
    return at || String(a.assetId).localeCompare(String(b.assetId));
  })[0];
}

/**
 * Resolves a request against the library.
 *
 * @returns {{ status, semanticFingerprint, selectedAssetId, candidateAssetIds,
 *             reason, variants, estimatedSavings, staleAssetIds }}
 */
export function lookupAsset(request, { estimatedCost = null, currency = null } = {}) {
  const semanticFingerprint = fingerprintForRequest(request);
  const candidateIds = findAssetIdsByFingerprint(semanticFingerprint);

  if (!candidateIds.length) {
    return {
      status: 'miss',
      semanticFingerprint,
      selectedAssetId: null,
      candidateAssetIds: [],
      variants: [],
      staleAssetIds: [],
      reason: 'No indexed asset matches this semantic fingerprint.',
      // Never fabricate a saving on a miss.
      estimatedSavings: null,
    };
  }

  const eligible = [];
  const stale = [];
  const rejected = [];
  for (const id of candidateIds) {
    const record = getAsset(id);
    const verdict = checkAssetEligibility(record, request);
    if (verdict.eligible) eligible.push(record);
    else if (verdict.stale) stale.push({ assetId: id, reason: verdict.reason });
    else rejected.push({ assetId: id, reason: verdict.reason });
  }

  if (!eligible.length) {
    return {
      status: stale.length ? 'stale' : 'miss',
      semanticFingerprint,
      selectedAssetId: null,
      candidateAssetIds: candidateIds,
      variants: [],
      staleAssetIds: stale.map(s => s.assetId),
      reason: stale.length
        ? `Matching asset(s) exist but failed integrity checks: ${stale.map(s => s.reason).join('; ')}`
        : `Matching asset(s) exist but are not reusable: ${rejected.map(r => r.reason).join('; ')}`,
      estimatedSavings: null,
    };
  }

  const selected = selectVariant(eligible);
  const savings = Number.isFinite(estimatedCost) ? { amount: estimatedCost, currency: currency || null } : null;

  return {
    // Multiple eligible variants is reported as `ambiguous`, not hidden — the
    // caller still gets a deterministic selection, but is told a choice existed.
    status: eligible.length > 1 ? 'ambiguous' : 'hit',
    semanticFingerprint,
    selectedAssetId: selected.assetId,
    candidateAssetIds: candidateIds,
    variants: eligible.map(r => ({
      assetId: r.assetId,
      contentHash: r.contentHash,
      generatedAt: r.provenance?.generatedAt || null,
      selected: r.assetId === selected.assetId,
    })),
    staleAssetIds: stale.map(s => s.assetId),
    reason: eligible.length > 1
      ? `${eligible.length} eligible variants matched; selected deterministically (explicit selection, else oldest).`
      : 'Exact semantic fingerprint match with verified byte integrity.',
    estimatedSavings: savings,
  };
}

/**
 * Indexes an asset so it becomes cache-eligible.
 *
 * Also used to backfill assets created before fingerprinting existed — it adds
 * a sidecar index entry and never rewrites the immutable record.
 */
export function ensureAssetIndexed(record, request) {
  const existing = getAssetIndexEntry(record.assetId);
  if (existing) return { ok: true, alreadyIndexed: true, semanticFingerprint: existing.semanticFingerprint };
  const semanticFingerprint = fingerprintForRequest(request);
  const result = indexAsset({
    assetId: record.assetId,
    semanticFingerprint,
    brandId: record.brandId,
    capability: record.capability,
    fingerprintVersion: FINGERPRINT_SCHEMA_VERSION,
  });
  return result.ok ? { ok: true, alreadyIndexed: result.alreadyIndexed, semanticFingerprint } : { ok: false, error: result.error };
}
