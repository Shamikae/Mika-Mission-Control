// POST /api/hyperframes/runs/[id]/cancel
// Cancels an active (queued/running) render or preview run via direct
// SIGTERM to the tracked child process.

import { cancelHyperFramesRun, stopHyperFramesPreview } from '../../../../../lib/hyperframes/hyperframesRunner';
import { getHyperFramesRun, sanitizeRunForResponse } from '../../../../../lib/hyperframes/hyperframesRunStore';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const { id } = req.query;
  const existing = getHyperFramesRun(id);
  if (!existing) {
    return res.status(404).json({ ok: false, error: `Run "${id}" not found.` });
  }
  const run = existing.command === 'preview' ? stopHyperFramesPreview(id) : cancelHyperFramesRun(id);
  return res.status(200).json({ ok: true, run: sanitizeRunForResponse(run) });
}
