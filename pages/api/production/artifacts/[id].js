// GET  /api/production/artifacts/[id] — serve a stored production execution
// artifact (document/image/video) by hex filename.
// HEAD /api/production/artifacts/[id] — same headers, no body (used by the
// Universal Output Viewer to probe an artifact before rendering it).
//
// Same security shape as pages/api/image/artifacts/[id].js:
//
//   - id must match /^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|mp4|webm|json|md)$/
//   - file is located by scanning production-artifacts two levels deep
//     (brand/productionJobId/) — no arbitrary filesystem path input, no
//     directory listing exposure
//   - resolved path is double-checked to stay within the artifacts base
//     directory before read
//   - artifacts are immutable once written, so responses are cached
//     aggressively
//
// Range support (added for HeyGen MCP video artifacts — browser <video>
// seeking/streaming needs it): a byte-range GET is served via a bounded
// fs.createReadStream() and a 206 Partial Content response; a full GET is
// also served via createReadStream() (never a full readFileSync buffer) so
// a large video is never fully loaded into memory. Path-traversal and MIME
// validation are unchanged. Only a single range is ever honored — a
// malformed or multi-range request is honestly rejected with 416 rather
// than silently downgraded to a full response or partially supported.
//
// Universal Output Viewer additions: X-Content-Type-Options: nosniff and
// X-Frame-Options: SAMEORIGIN (same-origin iframe embedding, e.g. the PDF
// preview, remains possible; arbitrary third-party framing does not).
// Content-Disposition is `inline` for every MIME type this route can ever
// actually serve (all of them are viewer-previewable), or `attachment`
// when the Download action explicitly requests it via ?download=1, or for
// the generic application/octet-stream fallback (an extension outside the
// known map — never currently reachable given SAFE_ID_RE, but handled
// honestly either way).

import { findProductionArtifactPath } from '../../../../lib/production/execution/productionArtifactStore';
import path from 'path';
import fs from 'fs';

const SAFE_ID_RE = /^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|mp4|webm|json|md)$/;
const ARTIFACTS_BASE = path.join(process.cwd(), 'production-artifacts');

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  mp4: 'video/mp4', webm: 'video/webm',
  json: 'application/json', md: 'text/markdown',
};
const PREVIEW_SAFE_MIME_TYPES = new Set(Object.values(MIME));

export const config = {
  api: { responseLimit: '80mb' },
};

export default function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }

  const { id } = req.query;
  if (!id || !SAFE_ID_RE.test(id)) {
    return res.status(400).json({ error: 'Invalid artifact ID' });
  }

  const filePath = findProductionArtifactPath(id);
  if (!filePath) {
    return res.status(404).json({ error: 'Artifact not found' });
  }
  if (!filePath.startsWith(ARTIFACTS_BASE + path.sep)) {
    return res.status(400).json({ error: 'Invalid artifact path' });
  }

  const ext = id.split('.').pop().toLowerCase();
  const mimeType = MIME[ext] || 'application/octet-stream';

  let size;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    return res.status(500).json({ error: 'Could not read artifact' });
  }

  const forceDownload = req.query.download === '1';
  const disposition = (forceDownload || !PREVIEW_SAFE_MIME_TYPES.has(mimeType)) ? 'attachment' : 'inline';

  res.setHeader('Content-Type', mimeType);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Disposition', `${disposition}; filename="${id}"`);

  if (req.method === 'HEAD') {
    res.status(200);
    res.setHeader('Content-Length', size);
    return res.end();
  }

  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    const start = match && match[1] !== '' ? parseInt(match[1], 10) : 0;
    const end = match && match[2] !== '' ? parseInt(match[2], 10) : size - 1;

    if (!match || Number.isNaN(start) || Number.isNaN(end) || start > end || start < 0 || end >= size) {
      res.setHeader('Content-Range', `bytes */${size}`);
      return res.status(416).end();
    }

    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', end - start + 1);
    const stream = fs.createReadStream(filePath, { start, end });
    stream.on('error', () => res.destroy());
    return stream.pipe(res);
  }

  res.status(200);
  res.setHeader('Content-Length', size);
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => res.destroy());
  return stream.pipe(res);
}
