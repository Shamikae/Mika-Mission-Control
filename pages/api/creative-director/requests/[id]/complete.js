// POST /api/creative-director/requests/[id]/complete
// Manually marks a package_created request as "completed" from the
// Creative Director's own tracking perspective — purely a bookkeeping
// marker. The underlying package's real lifecycle (review, production,
// publishing) continues independently in its own systems regardless.

import { isValidId, isValidRequestTransition, makeActivityEvent } from '../../../../../lib/creative-director/creativeDirectorRules';
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

  if (!isValidRequestTransition(request.status, 'completed')) {
    return res.status(409).json({ ok: false, error: `Cannot complete from status "${request.status}".` });
  }

  const updated = updateContentRequest(id, {
    status: 'completed',
    activityHistory: [...request.activityHistory, makeActivityEvent('completed', { actor: 'user' })],
  });

  return res.status(200).json({ ok: true, request: updated });
}
