// POST /api/content/pipeline/move
// Moves one content package to a new pipeline stage. This is the
// persistence endpoint behind drag-and-drop — the UI applies the move
// optimistically, then rolls back if this call fails.
//
// Input:  { id, toStage, note? }
// Output: { ok: true, package } | { ok: false, error, package? }
//         (package is included on a blocked gate so the UI can show exactly
//         what stage it's actually in without a second round-trip)

import { moveStage } from '../../../../lib/content/contentPipelineStore';
import { isValidStage } from '../../../../lib/content/contentPipelineRules';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { id, toStage, note } = req.body || {};

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ ok: false, error: 'id is required.' });
  }
  if (!toStage || !isValidStage(toStage)) {
    return res.status(400).json({ ok: false, error: 'toStage is required and must be a valid pipeline stage.' });
  }

  const result = moveStage(id, toStage, { actor: 'user', note: typeof note === 'string' ? note.slice(0, 300) : null });

  // 200 even on a blocked gate — it's an expected, renderable outcome, not a
  // network/server error (same convention as the synthesis honest-failure routes).
  return res.status(200).json(result);
}
