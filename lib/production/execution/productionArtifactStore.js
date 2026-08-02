// lib/production/execution/productionArtifactStore.js
// SERVER-SIDE ONLY — uses fs.
//
// Saves production execution outputs (documents/images/videos) under
// production-artifacts/<brand>/<productionJobId>/<hex>.<ext> — the same
// sanitizeSegment + guardedPath convention as
// lib/image-artifacts/saveImageArtifact.js, generalized beyond images since
// execution outputs may be documents (manual-export, mock-video) or, for a
// future real adapter, images/video. Image artifact storage itself is left
// completely untouched — this is a separate, parallel abstraction.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { extForMime, isAllowedArtifactMime } from './executionRules.js';

const ARTIFACTS_BASE = path.join(process.cwd(), 'production-artifacts');
const SAFE_ID_RE = /^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|mp4|webm|json|md)$/;

function sanitizeSegment(segment) {
  if (!segment || typeof segment !== 'string') throw new Error('Path segment is required');
  const safe = String(segment).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
  if (!safe) throw new Error(`Invalid path segment after sanitization: "${segment}"`);
  return safe;
}

function guardedPath(...segments) {
  const resolved = path.resolve(ARTIFACTS_BASE, ...segments);
  if (resolved !== ARTIFACTS_BASE && !resolved.startsWith(ARTIFACTS_BASE + path.sep)) {
    throw new Error('Path traversal guard: path escapes production artifact storage directory');
  }
  return resolved;
}

/**
 * @returns {{ id, filename, originalFilename, mimeType, sizeBytes, brand, productionJobId, artifactUrl }}
 */
export function saveProductionArtifact({ brand, productionJobId, buffer, mimeType, filename }) {
  if (!brand || !productionJobId) throw new Error('brand and productionJobId are required');
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('buffer must be a non-empty Buffer');
  if (!isAllowedArtifactMime(mimeType)) throw new Error(`MIME type "${mimeType}" is not in the artifact allowlist`);

  const ext = extForMime(mimeType);
  const safeBrand = sanitizeSegment(brand);
  const safeJobId = sanitizeSegment(productionJobId);
  const dirPath = guardedPath(safeBrand, safeJobId);
  fs.mkdirSync(dirPath, { recursive: true });

  const hexName = crypto.randomBytes(16).toString('hex') + '.' + ext;
  const filePath = guardedPath(safeBrand, safeJobId, hexName);
  fs.writeFileSync(filePath, buffer);

  return {
    id: hexName,
    filename: hexName,
    originalFilename: typeof filename === 'string' ? filename.slice(0, 200) : null,
    mimeType,
    sizeBytes: buffer.length,
    brand: safeBrand,
    productionJobId: safeJobId,
    artifactUrl: `/api/production/artifacts/${hexName}`,
  };
}

/**
 * Scans production-artifacts two directory levels deep for a matching
 * filename — same convention as pages/api/image/artifacts/[id].js — and
 * double-checks the resolved path stays within ARTIFACTS_BASE.
 */
export function findProductionArtifactPath(filename) {
  if (!filename || !SAFE_ID_RE.test(filename)) return null;
  if (!fs.existsSync(ARTIFACTS_BASE)) return null;
  for (const brandDir of fs.readdirSync(ARTIFACTS_BASE, { withFileTypes: true })) {
    if (!brandDir.isDirectory()) continue;
    const brandPath = path.join(ARTIFACTS_BASE, brandDir.name);
    for (const jobDir of fs.readdirSync(brandPath, { withFileTypes: true })) {
      if (!jobDir.isDirectory()) continue;
      const candidate = path.join(brandPath, jobDir.name, filename);
      if (fs.existsSync(candidate) && candidate.startsWith(ARTIFACTS_BASE + path.sep)) return candidate;
    }
  }
  return null;
}

export function getProductionArtifact(filename) {
  const filePath = findProductionArtifactPath(filename);
  if (!filePath) return null;
  try { return { buffer: fs.readFileSync(filePath), path: filePath }; }
  catch { return null; }
}

export function listProductionArtifactsForJob(brand, productionJobId) {
  try {
    const dirPath = guardedPath(sanitizeSegment(brand), sanitizeSegment(productionJobId));
    if (!fs.existsSync(dirPath)) return [];
    return fs.readdirSync(dirPath)
      .filter(f => SAFE_ID_RE.test(f))
      .map(f => {
        const stat = fs.statSync(path.join(dirPath, f));
        return { id: f, filename: f, sizeBytes: stat.size, artifactUrl: `/api/production/artifacts/${f}` };
      });
  } catch { return []; }
}

// Deletion is intentionally NOT implemented. lib/image-artifacts/saveImageArtifact.js
// (the equivalent, longer-established artifact store) has no delete capability
// either, and no governance for artifact deletion exists anywhere in this
// project yet — per instruction, delete is only added "if existing
// governance supports deletion," and it does not.
