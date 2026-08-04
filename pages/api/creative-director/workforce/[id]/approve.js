// POST /api/creative-director/workforce/[id]/approve
// Records explicit human approval. Requires the run to be "waiting_review"
// AND the AI Creative Review to have already set approvedForPackageCreation
// — AI approval alone never creates a package, but it IS a precondition
// for a human to approve (address blocking issues + rerun Review otherwise).

import { isValidId, unknownKeys, WorkforceError } from '../../../../../lib/creative-director/workforce/workforceRules';
import { approveRun } from '../../../../../lib/creative-director/workforce/workforceEngine';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const { id } = req.query;
  if (!id || !isValidId(id)) {
    return res.status(400).json({ ok: false, error: 'Invalid workforce run id.' });
  }
  const extraKeys = unknownKeys(req.body, []);
  if (extraKeys.length) return res.status(400).json({ ok: false, error: `Unknown field(s): ${extraKeys.join(', ')}` });

  try {
    const run = approveRun(id, { actor: 'user' });
    return res.status(200).json({ ok: true, run });
  } catch (err) {
    if (err instanceof WorkforceError) return res.status(err.status).json({ ok: false, code: err.code, error: err.message });
    return res.status(500).json({ ok: false, error: 'Unexpected error approving the run.' });
  }
}
