// GET /api/research/runs/[id] — research run detail (sources, evidence, usage).

import { isValidId } from '../../../../../lib/research/researchRules.js';
import { getResearchRun } from '../../../../../lib/research/researchRunStore.js';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const { id } = req.query;
  if (!id || !isValidId(id)) {
    return res.status(400).json({ ok: false, error: 'Invalid research run id.' });
  }
  const run = getResearchRun(id);
  if (!run) return res.status(404).json({ ok: false, error: `Research run "${id}" not found.` });
  return res.status(200).json({ ok: true, run });
}
