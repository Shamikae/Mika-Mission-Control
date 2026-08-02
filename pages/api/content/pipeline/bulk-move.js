// POST /api/content/pipeline/bulk-move
// Moves several content packages to the same stage in one call, for the
// board's multi-select bulk action bar. Each package is gate-checked
// independently — one blocked package never stops the rest.
//
// Input:  { ids: string[], toStage, note? }
// Output: { ok: boolean, results: { id, ok, error? }[] }

import { bulkMoveStage } from '../../../../lib/content/contentPipelineStore';
import { isValidStage } from '../../../../lib/content/contentPipelineRules';

const MAX_BULK = 100;

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { ids, toStage, note } = req.body || {};

  if (!Array.isArray(ids) || !ids.length || !ids.every(id => typeof id === 'string')) {
    return res.status(400).json({ ok: false, error: 'ids must be a non-empty array of package ids.' });
  }
  if (ids.length > MAX_BULK) {
    return res.status(400).json({ ok: false, error: `A maximum of ${MAX_BULK} packages can be moved at once.` });
  }
  if (!toStage || !isValidStage(toStage)) {
    return res.status(400).json({ ok: false, error: 'toStage is required and must be a valid pipeline stage.' });
  }

  const result = bulkMoveStage(ids, toStage, { actor: 'user', note: typeof note === 'string' ? note.slice(0, 300) : null });
  return res.status(200).json(result);
}
