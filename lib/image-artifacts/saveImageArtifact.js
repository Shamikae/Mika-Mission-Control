// lib/image-artifacts/saveImageArtifact.js
// Saves image Buffers to content-artifacts/<laneId>/<workflowId>/<hex>.<ext>
// All filenames are server-generated hex strings — user input never reaches the filename.
// Path traversal guard: resolved path must stay within ARTIFACTS_BASE.

import fs     from 'fs';
import path   from 'path';
import crypto from 'crypto';

const ARTIFACTS_BASE = path.join(process.cwd(), 'content-artifacts');

const MIME_TO_EXT = {
  'image/png':  'png',
  'image/jpeg': 'jpg',
  'image/jpg':  'jpg',
  'image/webp': 'webp',
};

// Allow only alphanumeric, dash, underscore in path segments
function sanitizeSegment(segment) {
  if (!segment || typeof segment !== 'string') throw new Error('Path segment is required');
  const safe = String(segment).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) throw new Error(`Invalid path segment after sanitization: "${segment}"`);
  return safe;
}

// All paths must resolve to within ARTIFACTS_BASE
function guardedPath(...segments) {
  const resolved = path.resolve(ARTIFACTS_BASE, ...segments);
  if (resolved !== ARTIFACTS_BASE && !resolved.startsWith(ARTIFACTS_BASE + path.sep)) {
    throw new Error('Path traversal guard: path escapes artifact storage directory');
  }
  return resolved;
}

/**
 * Save image buffers as persistent artifact files under content-artifacts/.
 *
 * @param {object}   opts
 * @param {string}   opts.laneId       — brand lane (e.g. 'digital-diamond')
 * @param {string}   opts.workflowId   — task or workflow ID
 * @param {Buffer[]} opts.buffers       — downloaded image bytes
 * @param {string}   [opts.mimeType]   — 'image/png' | 'image/jpeg' | 'image/webp'
 * @returns {{ filename: string, sizeBytes: number, laneId: string, workflowId: string }[]}
 */
export function saveImageArtifact({ laneId, workflowId, buffers, mimeType = 'image/jpeg' }) {
  if (!laneId || !workflowId) {
    throw new Error('laneId and workflowId are required');
  }
  if (!Array.isArray(buffers) || !buffers.length) {
    throw new Error('buffers must be a non-empty array');
  }

  const ext      = MIME_TO_EXT[mimeType] || 'jpg';
  const safeLane = sanitizeSegment(laneId);
  const safeWf   = sanitizeSegment(workflowId);
  const dirPath  = guardedPath(safeLane, safeWf);

  fs.mkdirSync(dirPath, { recursive: true });

  const saved = [];
  for (const buf of buffers) {
    if (!Buffer.isBuffer(buf) || buf.length === 0) continue;
    const hexName  = crypto.randomBytes(16).toString('hex') + '.' + ext;
    const filePath = guardedPath(safeLane, safeWf, hexName);
    fs.writeFileSync(filePath, buf);
    saved.push({ filename: hexName, sizeBytes: buf.length, laneId: safeLane, workflowId: safeWf });
  }

  if (!saved.length) throw new Error('No valid image buffers were saved');

  return saved;
}
