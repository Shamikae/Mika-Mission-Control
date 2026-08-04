// POST /api/creative-director/workforce/[id]/reject

import { isValidId, unknownKeys, WorkforceError } from '../../../../../lib/creative-director/workforce/workforceRules';
import { rejectRun } from '../../../../../lib/creative-director/workforce/workforceEngine';

export const config = {
  api: { bodyParser: { sizeLimit: '8kb' } },
};

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const { id } = req.query;
  if (!id || !isValidId(id)) {
    return res.status(400).json({ ok: false, error: 'Invalid workforce run id.' });
  }
  const extraKeys = unknownKeys(req.body, ['reason']);
  if (extraKeys.length) return res.status(400).json({ ok: false, error: `Unknown field(s): ${extraKeys.join(', ')}` });

  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 1000) : null;

  try {
    const run = rejectRun(id, { actor: 'user', reason });
    return res.status(200).json({ ok: true, run });
  } catch (err) {
    if (err instanceof WorkforceError) return res.status(err.status).json({ ok: false, code: err.code, error: err.message });
    return res.status(500).json({ ok: false, error: 'Unexpected error rejecting the run.' });
  }
}
