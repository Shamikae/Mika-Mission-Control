// lib/production/assets/assetLibraryStore.js
// SERVER-SIDE ONLY (filesystem).
//
// ── Sidecars, not mutations ──────────────────────────────────────────────
//
// Asset records are IMMUTABLE (F7). The library therefore adds two append-only
// sidecar stores rather than editing an asset:
//
//   data/asset-index/<assetId>.json   fingerprint index — one per asset
//   data/asset-usage/<usageId>.json   usage records — one per use
//
// This is why usage is recorded as append-only entries rather than an
// incrementing `usageCount` inside the asset: a counter is a mutation, and a
// mutated record can no longer be trusted to describe what was rendered.
// Counting usages becomes a read over the usage store.
//
// The index also solves a real M1 problem — assets generated before
// fingerprinting existed can be indexed retroactively without rewriting (and
// therefore invalidating) their immutable records.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { isValidAssetId } from './assetRules.js';

export const ASSET_INDEX_DIR = path.join(process.cwd(), 'data', 'asset-index');
export const ASSET_USAGE_DIR = path.join(process.cwd(), 'data', 'asset-usage');

const FINGERPRINT_RE = /^[0-9a-f]{64}$/;

export function isValidFingerprint(fp) {
  return typeof fp === 'string' && FINGERPRINT_RE.test(fp);
}

export function generateUsageId() {
  return `use-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function safePath(dir, id) {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(String(id || ''))) {
    const err = new Error('Invalid identifier.');
    err.code = 'invalid_id';
    throw err;
  }
  const resolved = path.resolve(dir, `${id}.json`);
  if (path.dirname(resolved) !== path.resolve(dir)) {
    const err = new Error('Refusing a path that escapes its store directory.');
    err.code = 'traversal_rejected';
    throw err;
  }
  return resolved;
}

// ── Fingerprint index ─────────────────────────────────────────────────────

/**
 * Records an asset's semantic fingerprint. Append-only: an existing index
 * entry is never rewritten, so an asset's fingerprint cannot drift after the
 * fact.
 */
export function indexAsset({ assetId, semanticFingerprint, brandId, capability, fingerprintVersion }) {
  if (!isValidAssetId(assetId)) return { ok: false, error: 'Invalid assetId.' };
  if (!isValidFingerprint(semanticFingerprint)) return { ok: false, error: 'semanticFingerprint must be a sha256 hex digest.' };

  let target;
  try { target = safePath(ASSET_INDEX_DIR, assetId); } catch (err) { return { ok: false, error: err.message }; }
  if (fs.existsSync(target)) {
    return { ok: true, alreadyIndexed: true, entry: JSON.parse(fs.readFileSync(target, 'utf-8')) };
  }

  const entry = {
    assetId,
    semanticFingerprint,
    brandId: brandId || null,
    capability: capability || null,
    fingerprintVersion: fingerprintVersion ?? 1,
    indexedAt: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(ASSET_INDEX_DIR, { recursive: true });
    fs.writeFileSync(target, JSON.stringify(entry, null, 2), { encoding: 'utf-8', flag: 'wx' });
  } catch (err) {
    return { ok: false, error: `Could not index asset: ${err.message}` };
  }
  return { ok: true, alreadyIndexed: false, entry };
}

export function getAssetIndexEntry(assetId) {
  try { return JSON.parse(fs.readFileSync(safePath(ASSET_INDEX_DIR, assetId), 'utf-8')); } catch { return null; }
}

export function listAssetIndex() {
  if (!fs.existsSync(ASSET_INDEX_DIR)) return [];
  return fs.readdirSync(ASSET_INDEX_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => { try { return JSON.parse(fs.readFileSync(path.join(ASSET_INDEX_DIR, f), 'utf-8')); } catch { return null; } })
    .filter(Boolean);
}

/** Every assetId whose fingerprint matches exactly. Oldest-indexed first — deterministic. */
export function findAssetIdsByFingerprint(semanticFingerprint) {
  if (!isValidFingerprint(semanticFingerprint)) return [];
  return listAssetIndex()
    .filter(e => e.semanticFingerprint === semanticFingerprint)
    .sort((a, b) => (new Date(a.indexedAt) - new Date(b.indexedAt)) || String(a.assetId).localeCompare(String(b.assetId)))
    .map(e => e.assetId);
}

// ── Usage records ─────────────────────────────────────────────────────────

/**
 * Appends one immutable usage record. Never touches the asset record — usage
 * is a fact ABOUT an asset, not a property OF it.
 */
export function recordAssetUsage({ assetId, packageId, renderSpecId, sceneId, productionJobId, actor, source }) {
  if (!isValidAssetId(assetId)) return { ok: false, error: 'Invalid assetId.' };
  const usageId = generateUsageId();
  let target;
  try { target = safePath(ASSET_USAGE_DIR, usageId); } catch (err) { return { ok: false, error: err.message }; }

  const record = {
    usageId,
    assetId,
    packageId: packageId || null,
    renderSpecId: renderSpecId || null,
    sceneId: sceneId ?? null,
    productionJobId: productionJobId || null,
    source: source || 'cache_hit',
    usedAt: new Date().toISOString(),
    actor: typeof actor === 'string' ? { type: 'human', id: actor } : (actor || { type: 'system', id: 'system' }),
  };
  try {
    fs.mkdirSync(ASSET_USAGE_DIR, { recursive: true });
    fs.writeFileSync(target, JSON.stringify(record, null, 2), { encoding: 'utf-8', flag: 'wx' });
  } catch (err) {
    return { ok: false, error: `Could not record usage: ${err.message}` };
  }
  return { ok: true, record };
}

export function listAssetUsage(assetId) {
  if (!fs.existsSync(ASSET_USAGE_DIR)) return [];
  return fs.readdirSync(ASSET_USAGE_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => { try { return JSON.parse(fs.readFileSync(path.join(ASSET_USAGE_DIR, f), 'utf-8')); } catch { return null; } })
    .filter(Boolean)
    .filter(u => !assetId || u.assetId === assetId)
    .sort((a, b) => new Date(a.usedAt) - new Date(b.usedAt));
}

/** Derived, never stored — the immutable record stays authoritative. */
export function usageCountFor(assetId) {
  return listAssetUsage(assetId).length;
}
