// GET /api/hyperframes/compositions
// Lists local HyperFrames compositions under tools/hyperframes/. Read-only,
// sanitized (no absolute paths, no shell output).

import { listHyperFramesCompositions } from '../../../../lib/hyperframes/hyperframesCompositionStore';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const compositions = await listHyperFramesCompositions();
  return res.status(200).json({ ok: true, compositions });
}
