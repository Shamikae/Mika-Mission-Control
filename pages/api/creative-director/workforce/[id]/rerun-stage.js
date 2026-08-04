// POST  /api/creative-director/workforce/[id]/rerun-stage — re-executes one
//       stage's model call. Invalidates its documented downstream stages.
// PATCH /api/creative-director/workforce/[id]/rerun-stage — applies a human
//       EDIT (sanitized override) to an already-completed stage WITHOUT
//       spending a new model call. Also invalidates downstream stages,
//       since the effective output changed. This is the "Editing" surface
//       from the spec, folded into this route to keep the API surface
//       compact (no separate path) while still supporting edit-without-
//       rerun as a distinct, cheaper operation from a full model rerun.

import { isValidStageId, isValidId, unknownKeys, sanitizeStageOverride, WorkforceError } from '../../../../../lib/creative-director/workforce/workforceRules';
import { rerunStage, applyStageOverride } from '../../../../../lib/creative-director/workforce/workforceEngine';

export const config = {
  api: { bodyParser: { sizeLimit: '32kb' } },
};

export default async function handler(req, res) {
  const { id } = req.query;
  if (!id || !isValidId(id)) {
    return res.status(400).json({ ok: false, error: 'Invalid workforce run id.' });
  }

  if (req.method === 'POST') {
    const extraKeys = unknownKeys(req.body, ['stageId', 'overrideBudget', 'note']);
    if (extraKeys.length) return res.status(400).json({ ok: false, error: `Unknown field(s): ${extraKeys.join(', ')}` });

    const { stageId, overrideBudget, note } = req.body || {};
    if (!stageId || !isValidStageId(stageId)) {
      return res.status(400).json({ ok: false, error: 'A valid stageId is required.' });
    }
    try {
      const run = await rerunStage(id, stageId, { overrideBudget: overrideBudget === true, note: typeof note === 'string' ? note.slice(0, 500) : null });
      return res.status(200).json({ ok: true, run });
    } catch (err) {
      if (err instanceof WorkforceError) return res.status(err.status).json({ ok: false, code: err.code, error: err.message });
      return res.status(500).json({ ok: false, error: 'Unexpected error rerunning the stage.' });
    }
  }

  if (req.method === 'PATCH') {
    const extraKeys = unknownKeys(req.body, ['stageId', 'override']);
    if (extraKeys.length) return res.status(400).json({ ok: false, error: `Unknown field(s): ${extraKeys.join(', ')}` });

    const { stageId, override } = req.body || {};
    if (!stageId || !isValidStageId(stageId)) {
      return res.status(400).json({ ok: false, error: 'A valid stageId is required.' });
    }
    const clean = sanitizeStageOverride(stageId, override);
    if (!Object.keys(clean).length) {
      return res.status(400).json({ ok: false, error: 'No editable fields were provided for this stage.' });
    }
    try {
      const run = applyStageOverride(id, stageId, clean);
      return res.status(200).json({ ok: true, run });
    } catch (err) {
      if (err instanceof WorkforceError) return res.status(err.status).json({ ok: false, code: err.code, error: err.message });
      return res.status(500).json({ ok: false, error: 'Unexpected error applying the edit.' });
    }
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
