// POST /api/research/runs/[id]/cancel

import { isValidId, unknownKeys, ResearchError } from '../../../../../lib/research/researchRules.js';
import { cancelResearchRun } from '../../../../../lib/research/researchEngine.js';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const { id } = req.query;
  if (!id || !isValidId(id)) {
    return res.status(400).json({ ok: false, error: 'Invalid research run id.' });
  }
  const extraKeys = unknownKeys(req.body, []);
  if (extraKeys.length) return res.status(400).json({ ok: false, error: `Unknown field(s): ${extraKeys.join(', ')}` });

  try {
    const run = cancelResearchRun(id);
    return res.status(200).json({ ok: true, run });
  } catch (err) {
    if (err instanceof ResearchError) return res.status(err.status).json({ ok: false, code: err.code, error: err.message });
    return res.status(500).json({ ok: false, error: 'Unexpected error cancelling the research run.' });
  }
}
