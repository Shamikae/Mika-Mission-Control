// POST /api/creative-director/requests/[id]/submit
// Transitions draft -> submitted. Re-validates fresh.

import { isValidId, validateContentRequest, isValidRequestTransition, makeActivityEvent } from '../../../../../lib/creative-director/creativeDirectorRules';
import { getContentRequest, updateContentRequest } from '../../../../../lib/creative-director/contentRequestStore';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const { id } = req.query;
  if (!id || !isValidId(id)) {
    return res.status(400).json({ ok: false, error: 'Invalid content request id.' });
  }
  const request = getContentRequest(id);
  if (!request) return res.status(404).json({ ok: false, error: `Content request "${id}" not found.` });

  if (!isValidRequestTransition(request.status, 'submitted')) {
    return res.status(409).json({ ok: false, error: `Cannot submit from status "${request.status}".` });
  }

  const validation = validateContentRequest(request);
  if (!validation.ok) {
    return res.status(422).json({ ok: false, error: 'Request is incomplete.', errors: validation.errors });
  }

  const updated = updateContentRequest(id, {
    status: 'submitted',
    activityHistory: [...request.activityHistory, makeActivityEvent('submitted', { actor: 'user' })],
  });

  return res.status(200).json({ ok: true, request: updated });
}
