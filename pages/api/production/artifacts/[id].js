// GET /api/production/artifacts/[id]
// Serves a stored production execution artifact (document/image/video) by
// hex filename. Same security shape as pages/api/image/artifacts/[id].js:
//
//   - id must match /^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|mp4|webm|json|md)$/
//   - file is located by scanning production-artifacts two levels deep
//     (brand/productionJobId/) — no arbitrary filesystem path input, no
//     directory listing exposure
//   - resolved path is double-checked to stay within the artifacts base
//     directory before read
//   - artifacts are immutable once written, so responses are cached
//     aggressively

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

export const config = {
  api: { responseLimit: '80mb' },
};

export default function handler(req, res) {
  if (req.method !== 'GET') {
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

  try {
    const data = fs.readFileSync(filePath);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Length', data.length);
    return res.status(200).send(data);
  } catch {
    return res.status(500).json({ error: 'Could not read artifact' });
  }
}
