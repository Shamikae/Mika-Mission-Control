// POST /api/research/run
// Standalone trigger for the live-research pipeline, scoped to one
// workforce run + content request. This is independent of (but reused by)
// the Research stage's prepareContext() hook inside the workforce engine —
// calling this directly lets the UI show sources/evidence BEFORE the
// Research Agent's synthesis call runs, or lets a user retry just the
// search portion without spending a model call. Never a second, competing
// workflow — it operates on the exact same data/research-runs/ records.

import { isValidId as isValidWorkforceRunId } from '../../../lib/creative-director/workforce/workforceRules';
import { getWorkforceRun } from '../../../lib/creative-director/workforce/workforceRunStore';
import { getContentRequest } from '../../../lib/creative-director/contentRequestStore';
import { unknownKeys, ResearchError } from '../../../lib/research/researchRules.js';
import { getOrCreateResearchRun, runLiveResearch } from '../../../lib/research/researchEngine.js';

export const config = {
  api: { bodyParser: { sizeLimit: '16kb' } },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const extraKeys = unknownKeys(req.body, ['workforceRunId', 'overrideBudget']);
  if (extraKeys.length) return res.status(400).json({ ok: false, error: `Unknown field(s): ${extraKeys.join(', ')}` });

  const { workforceRunId, overrideBudget } = req.body || {};
  if (!workforceRunId || !isValidWorkforceRunId(workforceRunId)) {
    return res.status(400).json({ ok: false, error: 'A valid workforceRunId is required.' });
  }

  const workforceRun = getWorkforceRun(workforceRunId);
  if (!workforceRun) return res.status(404).json({ ok: false, error: `Workforce run "${workforceRunId}" not found.` });

  const request = getContentRequest(workforceRun.requestId);
  if (!request) return res.status(404).json({ ok: false, error: `Content request "${workforceRun.requestId}" not found.` });

  try {
    const { run } = getOrCreateResearchRun(workforceRunId, request.id);
    const finalRun = await runLiveResearch(run.id, request, { overrideBudget: overrideBudget === true });
    return res.status(200).json({ ok: true, run: finalRun });
  } catch (err) {
    if (err instanceof ResearchError) return res.status(err.status).json({ ok: false, code: err.code, error: err.message });
    return res.status(500).json({ ok: false, error: 'Unexpected error running live research.' });
  }
}
