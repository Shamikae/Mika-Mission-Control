// GET /api/hyperframes/runs/[id]
// Poll a single run's status/progress/logTail.

import { getHyperFramesRun, sanitizeRunForResponse } from '../../../../../lib/hyperframes/hyperframesRunStore';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const { id } = req.query;
  const run = getHyperFramesRun(id);
  if (!run) {
    return res.status(404).json({ ok: false, error: `Run "${id}" not found.` });
  }
  return res.status(200).json({ ok: true, run: sanitizeRunForResponse(run) });
}
