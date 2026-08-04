// POST /api/creative-director/requests/[id]/reject
// Rejects a submitted content request (e.g. the request itself needs
// rework before a brief should be generated). Requires a reason.

import { isValidId, isValidRequestTransition, makeActivityEvent } from '../../../../../lib/creative-director/creativeDirectorRules';
import { getContentRequest, updateContentRequest } from '../../../../../lib/creative-director/contentRequestStore';

export const config = {
  api: { bodyParser: { sizeLimit: '4kb' } },
};

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

  if (!isValidRequestTransition(request.status, 'rejected')) {
    return res.status(409).json({ ok: false, error: `Cannot reject from status "${request.status}".` });
  }

  const { reason } = req.body || {};
  if (typeof reason !== 'string' || !reason.trim()) {
    return res.status(400).json({ ok: false, error: 'A reason is required to reject a content request.' });
  }

  const updated = updateContentRequest(id, {
    status: 'rejected',
    activityHistory: [...request.activityHistory, makeActivityEvent('rejected', { actor: 'user', note: reason.trim().slice(0, 500) })],
  });

  return res.status(200).json({ ok: true, request: updated });
}
