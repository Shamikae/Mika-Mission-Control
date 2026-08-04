// POST /api/creative-director/workforce/run
// One-click: creates or resumes the single active workforce run for a
// content request, then executes every remaining stage in order, stopping
// at any failure, budget block, or once Creative Review completes (status
// becomes "waiting_review"). Never creates a Package Pipeline package.

import { isValidId } from '../../../../lib/creative-director/creativeDirectorRules';
import { getContentRequest } from '../../../../lib/creative-director/contentRequestStore';
import { unknownKeys, WorkforceError } from '../../../../lib/creative-director/workforce/workforceRules';
import { getOrCreateRunForRequest, requestAllowsWorkforce, runAllRemaining } from '../../../../lib/creative-director/workforce/workforceEngine';

export const config = {
  api: { bodyParser: { sizeLimit: '16kb' } },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const extraKeys = unknownKeys(req.body, ['requestId', 'overrideBudget']);
  if (extraKeys.length) {
    return res.status(400).json({ ok: false, error: `Unknown field(s): ${extraKeys.join(', ')}` });
  }

  const { requestId, overrideBudget } = req.body || {};
  if (!requestId || !isValidId(requestId)) {
    return res.status(400).json({ ok: false, error: 'A valid requestId is required.' });
  }

  const request = getContentRequest(requestId);
  if (!request) return res.status(404).json({ ok: false, error: `Content request "${requestId}" not found.` });
  if (!requestAllowsWorkforce(request)) {
    return res.status(409).json({ ok: false, error: `Cannot run the Content Workforce for a request in status "${request.status}".` });
  }

  try {
    const { run } = getOrCreateRunForRequest(request);
    const finalRun = await runAllRemaining(run.id, { overrideBudget: overrideBudget === true });
    return res.status(200).json({ ok: true, run: finalRun });
  } catch (err) {
    if (err instanceof WorkforceError) return res.status(err.status).json({ ok: false, code: err.code, error: err.message });
    return res.status(500).json({ ok: false, error: 'Unexpected error running the Content Workforce.' });
  }
}
