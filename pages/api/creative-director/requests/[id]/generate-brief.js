// POST /api/creative-director/requests/[id]/generate-brief
// Transitions submitted -> brief_generated. Runs buildProductionBrief() —
// a DETERMINISTIC, rule-based transform of the request's own fields. This
// is never an AI/model call; the Creative Director is not a provider.

import { isValidId, isValidRequestTransition, buildProductionBrief, makeActivityEvent } from '../../../../../lib/creative-director/creativeDirectorRules';
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

  if (!isValidRequestTransition(request.status, 'brief_generated')) {
    return res.status(409).json({ ok: false, error: `Cannot generate a brief from status "${request.status}".` });
  }

  const brief = buildProductionBrief(request);

  const updated = updateContentRequest(id, {
    status: 'brief_generated',
    brief,
    activityHistory: [...request.activityHistory, makeActivityEvent('brief_generated', { actor: 'system', note: 'Structured brief generated (rule-based, no AI call).' })],
  });

  return res.status(200).json({ ok: true, request: updated });
}
