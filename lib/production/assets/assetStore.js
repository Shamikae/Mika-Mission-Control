// lib/production/assets/assetStore.js
// SERVER-SIDE ONLY (filesystem).
//
// ── Assets are not artifacts (F6) ────────────────────────────────────────
//
// An ARTIFACT is the terminal output of one job, keyed by that job
// (production-artifacts/<Brand>/<jobId>/…). An ASSET is a reusable INPUT that
// may serve many jobs, across brands and months. Same bytes, opposite
// lifecycle — so assets live in their own store rather than being retrofitted
// into the frozen, job-scoped artifact store.
//
//   data/assets/<assetId>.json        immutable record
//   assets-library/<brand>/<capability>/<assetId>/source.<ext>
//
// Immutability (F7) is a filesystem property here: a record is written with an
// exclusive create and never reopened for writing. Regeneration produces a NEW
// asset id, never a mutation — mutating in place would silently change videos
// that were already rendered from it.
//
// M1 scope: no cache, no semantic fingerprint, no variant sets, no dedup.
// Those arrive with the real Asset Library.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { isValidAssetId, validateAssetRecord, isAllowedAssetMime } from './assetRules.js';

export const ASSET_RECORD_DIR = path.join(process.cwd(), 'data', 'assets');
export const ASSET_LIBRARY_DIR = path.join(process.cwd(), 'assets-library');

const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export function generateAssetId() {
  return `ast-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** Filesystem-safe segment. Never derived from unsanitized user input. */
function safeSegment(value, fallback) {
  const s = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
  return s || fallback;
}

function recordPath(assetId) {
  if (!isValidAssetId(assetId)) {
    const err = new Error('Invalid asset id.');
    err.code = 'invalid_id';
    throw err;
  }
  const resolved = path.resolve(ASSET_RECORD_DIR, `${assetId}.json`);
  if (path.dirname(resolved) !== path.resolve(ASSET_RECORD_DIR)) {
    const err = new Error('Refusing an asset record path that escapes the asset directory.');
    err.code = 'traversal_rejected';
    throw err;
  }
  return resolved;
}

/**
 * Resolves the binary path for an asset. Every segment is sanitized, so no
 * caller-supplied string can steer the write outside the library root.
 */
export function assetBinaryPath(assetId, { brandId, capability, mimeType }) {
  if (!isValidAssetId(assetId)) {
    const err = new Error('Invalid asset id.');
    err.code = 'invalid_id';
    throw err;
  }
  const ext = MIME_EXT[mimeType];
  if (!ext) {
    const err = new Error(`MIME type "${mimeType}" is not in the asset allowlist.`);
    err.code = 'mime_rejected';
    throw err;
  }
  const dir = path.join(ASSET_LIBRARY_DIR, safeSegment(brandId, 'unbranded'), safeSegment(capability, 'uncategorised'), assetId);
  const resolved = path.resolve(dir, `source.${ext}`);
  const root = path.resolve(ASSET_LIBRARY_DIR);
  if (!resolved.startsWith(root + path.sep)) {
    const err = new Error('Refusing an asset path that escapes the asset library.');
    err.code = 'traversal_rejected';
    throw err;
  }
  return resolved;
}

/**
 * Writes the binary and its immutable record together.
 *
 * @returns {{ ok: boolean, record?: object, error?: string, errors?: string[] }}
 */
export function saveAsset({ assetId, buffer, mimeType, record }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return { ok: false, error: 'Asset buffer is empty.' };
  if (!isAllowedAssetMime(mimeType)) return { ok: false, error: `MIME type "${mimeType}" is not in the asset allowlist.` };

  let binPath;
  let recPath;
  try {
    binPath = assetBinaryPath(assetId, { brandId: record.brandId, capability: record.capability, mimeType });
    recPath = recordPath(assetId);
  } catch (err) {
    return { ok: false, error: err.message };
  }

  if (fs.existsSync(recPath)) return { ok: false, error: `Asset "${assetId}" already exists — assets are immutable.` };

  const finalRecord = {
    ...record,
    assetId,
    mimeType,
    sizeBytes: buffer.length,
    contentHash: sha256(buffer),
    // Project-relative only — an absolute path must never reach a record.
    storagePath: path.relative(process.cwd(), binPath),
  };

  const validation = validateAssetRecord(finalRecord);
  if (!validation.valid) return { ok: false, error: 'Asset record failed validation.', errors: validation.errors };

  try {
    fs.mkdirSync(path.dirname(binPath), { recursive: true });
    fs.mkdirSync(ASSET_RECORD_DIR, { recursive: true });
    fs.writeFileSync(binPath, buffer, { flag: 'wx' });        // exclusive create
    fs.writeFileSync(recPath, JSON.stringify(finalRecord, null, 2), { encoding: 'utf-8', flag: 'wx' });
  } catch (err) {
    return { ok: false, error: `Could not persist asset: ${err.message}` };
  }

  return { ok: true, record: finalRecord };
}

export function getAsset(assetId) {
  try { return JSON.parse(fs.readFileSync(recordPath(assetId), 'utf-8')); } catch { return null; }
}

export function listAssets({ packageId, capability } = {}) {
  if (!fs.existsSync(ASSET_RECORD_DIR)) return [];
  return fs.readdirSync(ASSET_RECORD_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => { try { return JSON.parse(fs.readFileSync(path.join(ASSET_RECORD_DIR, f), 'utf-8')); } catch { return null; } })
    .filter(Boolean)
    .filter(a => !packageId || a.sourcePackageId === packageId)
    .filter(a => !capability || a.capability === capability)
    .sort((a, b) => new Date(b.provenance?.generatedAt || 0) - new Date(a.provenance?.generatedAt || 0));
}

/** Absolute path for server-side reads (e.g. copying into a composition). Never returned to a browser. */
export function resolveAssetBinaryAbsolute(assetId) {
  const record = getAsset(assetId);
  if (!record) return null;
  const resolved = path.resolve(process.cwd(), record.storagePath);
  if (!resolved.startsWith(path.resolve(ASSET_LIBRARY_DIR) + path.sep)) return null;
  return fs.existsSync(resolved) ? resolved : null;
}
