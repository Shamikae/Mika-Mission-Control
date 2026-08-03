// POST /api/hyperframes/compositions/[id]/preview
// Starts (or returns the already-running) local preview server for a
// composition. Only ever returns a localhost/127.0.0.1 URL — see
// lib/hyperframes/hyperframesRunner.js for the PID-ownership design.

import { isValidCompositionId } from '../../../../../../lib/hyperframes/hyperframesSecurity';
import { startHyperFramesPreview } from '../../../../../../lib/hyperframes/hyperframesRunner';
import { statusForError } from '../../../../../../lib/hyperframes/hyperframesErrors';
import { sanitizeRunForResponse } from '../../../../../../lib/hyperframes/hyperframesRunStore';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const { id } = req.query;
  if (!isValidCompositionId(id)) {
    return res.status(400).json({ ok: false, error: 'Invalid composition id.' });
  }
  try {
    const run = await startHyperFramesPreview(id);
    if (run.status !== 'running') {
      return res.status(422).json({ ok: false, error: run.error || 'Preview did not start.', run: sanitizeRunForResponse(run) });
    }
    const previewUrl = `http://localhost:${run.previewPort}`;
    return res.status(200).json({ ok: true, run: sanitizeRunForResponse(run), previewUrl });
  } catch (e) {
    return res.status(statusForError(e)).json({ ok: false, error: e.message });
  }
}
