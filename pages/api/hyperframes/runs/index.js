// GET /api/hyperframes/runs?compositionId=<id>
// Lists recent HyperFrames runs (lint/check/preview/render), most recent
// first. Sanitized — never exposes previewPid.

import { isValidCompositionId } from '../../../../lib/hyperframes/hyperframesSecurity';
import { listHyperFramesRuns, sanitizeRunForResponse } from '../../../../lib/hyperframes/hyperframesRunStore';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const { compositionId } = req.query;
  if (compositionId !== undefined && !isValidCompositionId(compositionId)) {
    return res.status(400).json({ ok: false, error: 'Invalid compositionId.' });
  }
  const runs = listHyperFramesRuns({ compositionId }).map(sanitizeRunForResponse);
  return res.status(200).json({ ok: true, runs });
}
