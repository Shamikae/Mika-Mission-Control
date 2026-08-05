// POST /api/creative-director/workforce/run-next
// Controlled manual progression: executes exactly the next pending/failed
// stage for a run, then stops (does not continue to subsequent stages).
// Accepts EITHER an existing runId, OR a requestId (the run is created —
// or the existing active one resumed — via the same getOrCreateRunForRequest
// used by POST run, but nothing is executed beyond this one stage). This is
// what lets "Run Live Research" / "Use Model Synthesis" work as a genuine
// first action from a blank Creative Director request, without forcing the
// full one-click sequential flow.

import { unknownKeys, isValidId, WorkforceError } from '../../../../lib/creative-director/workforce/workforceRules';
import { isValidId as isValidRequestId } from '../../../../lib/creative-director/creativeDirectorRules';
import { getContentRequest } from '../../../../lib/creative-director/contentRequestStore';
import { getWorkforceRun } from '../../../../lib/creative-director/workforce/workforceRunStore';
import { executeOneStage, nextPendingStageId, getOrCreateRunForRequest, requestAllowsWorkforce } from '../../../../lib/creative-director/workforce/workforceEngine';

export const config = {
  api: { bodyParser: { sizeLimit: '16kb' } },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const extraKeys = unknownKeys(req.body, ['runId', 'requestId', 'overrideBudget', 'researchMode']);
  if (extraKeys.length) {
    return res.status(400).json({ ok: false, error: `Unknown field(s): ${extraKeys.join(', ')}` });
  }

  const { runId, requestId, overrideBudget, researchMode } = req.body || {};
  if (!runId && !requestId) {
    return res.status(400).json({ ok: false, error: 'Either runId or requestId is required.' });
  }
  if (runId && !isValidId(runId)) {
    return res.status(400).json({ ok: false, error: 'Invalid runId.' });
  }
  if (requestId && !isValidRequestId(requestId)) {
    return res.status(400).json({ ok: false, error: 'Invalid requestId.' });
  }
  if (researchMode !== undefined && !['model-synthesis', 'live-search'].includes(researchMode)) {
    return res.status(400).json({ ok: false, error: 'researchMode must be "model-synthesis" or "live-search".' });
  }

  let run;
  if (runId) {
    run = getWorkforceRun(runId);
    if (!run) return res.status(404).json({ ok: false, error: `Workforce run "${runId}" not found.` });
  } else {
    const request = getContentRequest(requestId);
    if (!request) return res.status(404).json({ ok: false, error: `Content request "${requestId}" not found.` });
    if (!requestAllowsWorkforce(request)) {
      return res.status(409).json({ ok: false, error: `Cannot run the Content Workforce for a request in status "${request.status}".` });
    }
    ({ run } = getOrCreateRunForRequest(request));
  }

  const stageId = nextPendingStageId(run);
  if (!stageId) {
    return res.status(409).json({ ok: false, error: 'Every stage has already completed for this run.' });
  }

  try {
    const updated = await executeOneStage(run.id, stageId, { overrideBudget: overrideBudget === true, researchMode });
    return res.status(200).json({ ok: true, run: updated, stageRun: stageId });
  } catch (err) {
    if (err instanceof WorkforceError) return res.status(err.status).json({ ok: false, code: err.code, error: err.message });
    return res.status(500).json({ ok: false, error: 'Unexpected error running the next stage.' });
  }
}
