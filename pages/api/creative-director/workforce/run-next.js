// POST /api/creative-director/workforce/run-next
// Controlled manual progression: executes exactly the next pending/failed
// stage for a run, then stops (does not continue to subsequent stages).

import { unknownKeys, isValidId, WorkforceError } from '../../../../lib/creative-director/workforce/workforceRules';
import { getWorkforceRun } from '../../../../lib/creative-director/workforce/workforceRunStore';
import { executeOneStage, nextPendingStageId } from '../../../../lib/creative-director/workforce/workforceEngine';

export const config = {
  api: { bodyParser: { sizeLimit: '16kb' } },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const extraKeys = unknownKeys(req.body, ['runId', 'overrideBudget']);
  if (extraKeys.length) {
    return res.status(400).json({ ok: false, error: `Unknown field(s): ${extraKeys.join(', ')}` });
  }

  const { runId, overrideBudget } = req.body || {};
  if (!runId || !isValidId(runId)) {
    return res.status(400).json({ ok: false, error: 'A valid runId is required.' });
  }

  const run = getWorkforceRun(runId);
  if (!run) return res.status(404).json({ ok: false, error: `Workforce run "${runId}" not found.` });

  const stageId = nextPendingStageId(run);
  if (!stageId) {
    return res.status(409).json({ ok: false, error: 'Every stage has already completed for this run.' });
  }

  try {
    const updated = await executeOneStage(runId, stageId, { overrideBudget: overrideBudget === true });
    return res.status(200).json({ ok: true, run: updated, stageRun: stageId });
  } catch (err) {
    if (err instanceof WorkforceError) return res.status(err.status).json({ ok: false, code: err.code, error: err.message });
    return res.status(500).json({ ok: false, error: 'Unexpected error running the next stage.' });
  }
}
