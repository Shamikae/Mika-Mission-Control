// POST /api/research/runs/[id]/retry — resets a failed research run to
// draft and re-runs the live-research pipeline once. Requires the
// originating content request to still exist.

import { isValidId, unknownKeys, ResearchError } from '../../../../../lib/research/researchRules.js';
import { getContentRequest } from '../../../../../lib/creative-director/contentRequestStore';
import { getResearchRun } from '../../../../../lib/research/researchRunStore.js';
import { retryResearchRun, runLiveResearch } from '../../../../../lib/research/researchEngine.js';

export const config = {
  api: { bodyParser: { sizeLimit: '8kb' } },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const { id } = req.query;
  if (!id || !isValidId(id)) {
    return res.status(400).json({ ok: false, error: 'Invalid research run id.' });
  }
  const extraKeys = unknownKeys(req.body, ['overrideBudget']);
  if (extraKeys.length) return res.status(400).json({ ok: false, error: `Unknown field(s): ${extraKeys.join(', ')}` });

  const priorRun = getResearchRun(id);
  if (!priorRun) return res.status(404).json({ ok: false, error: `Research run "${id}" not found.` });
  const request = getContentRequest(priorRun.requestId);
  if (!request) return res.status(404).json({ ok: false, error: `Content request "${priorRun.requestId}" not found.` });

  try {
    retryResearchRun(id);
    const finalRun = await runLiveResearch(id, request, { overrideBudget: req.body?.overrideBudget === true });
    return res.status(200).json({ ok: true, run: finalRun });
  } catch (err) {
    if (err instanceof ResearchError) return res.status(err.status).json({ ok: false, code: err.code, error: err.message });
    return res.status(500).json({ ok: false, error: 'Unexpected error retrying live research.' });
  }
}
