// POST /api/hyperframes/compositions/[id]/check
// Runs `hyperframes check --json` to completion (fast) and returns the run.

import { isValidCompositionId } from '../../../../../lib/hyperframes/hyperframesSecurity';
import { runHyperFramesCheck } from '../../../../../lib/hyperframes/hyperframesRunner';
import { statusForError } from '../../../../../lib/hyperframes/hyperframesErrors';
import { sanitizeRunForResponse } from '../../../../../lib/hyperframes/hyperframesRunStore';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const { id } = req.query;
  if (!isValidCompositionId(id)) {
    return res.status(400).json({ ok: false, error: 'Invalid composition id.' });
  }
  try {
    const run = await runHyperFramesCheck(id);
    return res.status(200).json({ ok: true, run: sanitizeRunForResponse(run) });
  } catch (e) {
    return res.status(statusForError(e)).json({ ok: false, error: e.message });
  }
}
