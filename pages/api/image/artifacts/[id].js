// GET /api/image/artifacts/[id]
// Serves a stored image artifact by hex filename.
//
// Security:
//   - id must match /^[a-zA-Z0-9_-]+\.(png|jpg|webp)$/ — no path traversal possible
//   - file is resolved by scanning content-artifacts two levels deep (lane/workflow/)
//   - resolved path is double-checked to stay within ARTIFACTS_BASE before read
//
// Artifacts are immutable once written, so responses are cached aggressively.

import fs   from 'fs';
import path from 'path';

const SAFE_ID_RE     = /^[a-zA-Z0-9_-]+\.(png|jpg|webp)$/;
const ARTIFACTS_BASE = path.join(process.cwd(), 'content-artifacts');

const MIME = {
  png:  'image/png',
  jpg:  'image/jpeg',
  webp: 'image/webp',
};

// Scan content-artifacts/<lane>/<workflow>/<filename> (exactly 2 directory levels)
function findArtifact(filename) {
  if (!fs.existsSync(ARTIFACTS_BASE)) return null;
  for (const lane of fs.readdirSync(ARTIFACTS_BASE, { withFileTypes: true })) {
    if (!lane.isDirectory()) continue;
    const laneDir = path.join(ARTIFACTS_BASE, lane.name);
    for (const wf of fs.readdirSync(laneDir, { withFileTypes: true })) {
      if (!wf.isDirectory()) continue;
      const candidate = path.join(laneDir, wf.name, filename);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export const config = {
  api: { responseLimit: '8mb' },
};

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).end();
  }

  const { id } = req.query;

  if (!id || !SAFE_ID_RE.test(id)) {
    return res.status(400).json({ error: 'Invalid artifact ID' });
  }

  const filePath = findArtifact(id);
  if (!filePath) {
    return res.status(404).json({ error: 'Artifact not found' });
  }

  // Path traversal double-check after resolution
  if (!filePath.startsWith(ARTIFACTS_BASE + path.sep)) {
    return res.status(400).json({ error: 'Invalid artifact path' });
  }

  const ext      = id.split('.').pop().toLowerCase();
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
