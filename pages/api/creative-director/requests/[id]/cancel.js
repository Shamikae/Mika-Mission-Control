// POST /api/creative-director/requests/[id]/cancel
// Cancels a non-terminal content request. Never touches an already-created
// package — cancelling the request does not retroactively affect the
// Package Pipeline.

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

  if (!isValidRequestTransition(request.status, 'cancelled')) {
    return res.status(409).json({ ok: false, error: `Cannot cancel from status "${request.status}".` });
  }

  const { note } = req.body || {};
  const updated = updateContentRequest(id, {
    status: 'cancelled',
    activityHistory: [...request.activityHistory, makeActivityEvent('cancelled', { actor: 'user', note: typeof note === 'string' ? note.slice(0, 500) : null })],
  });

  return res.status(200).json({ ok: true, request: updated });
}
