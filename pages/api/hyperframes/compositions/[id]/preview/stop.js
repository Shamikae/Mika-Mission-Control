// POST /api/hyperframes/compositions/[id]/preview/stop
// Stops the active preview run for this composition (direct SIGTERM to the
// recorded pid — see lib/hyperframes/hyperframesRunner.js).

import { isValidCompositionId } from '../../../../../../lib/hyperframes/hyperframesSecurity';
import { stopHyperFramesPreview } from '../../../../../../lib/hyperframes/hyperframesRunner';
import { listHyperFramesRuns, sanitizeRunForResponse } from '../../../../../../lib/hyperframes/hyperframesRunStore';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const { id } = req.query;
  if (!isValidCompositionId(id)) {
    return res.status(400).json({ ok: false, error: 'Invalid composition id.' });
  }
  const active = listHyperFramesRuns({ compositionId: id }).find(r => r.command === 'preview' && r.status === 'running');
  if (!active) {
    return res.status(404).json({ ok: false, error: 'No active preview for this composition.' });
  }
  const run = stopHyperFramesPreview(active.id);
  return res.status(200).json({ ok: true, run: sanitizeRunForResponse(run) });
}
