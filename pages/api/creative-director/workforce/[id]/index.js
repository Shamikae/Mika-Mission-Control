// GET /api/creative-director/workforce/[id] — run detail, enriched with the
// originating request's topic/brand/platform for convenient display.

import { isValidId } from '../../../../../lib/creative-director/workforce/workforceRules';
import { getWorkforceRun } from '../../../../../lib/creative-director/workforce/workforceRunStore';
import { getContentRequest } from '../../../../../lib/creative-director/contentRequestStore';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const { id } = req.query;
  if (!id || !isValidId(id)) {
    return res.status(400).json({ ok: false, error: 'Invalid workforce run id.' });
  }
  const run = getWorkforceRun(id);
  if (!run) return res.status(404).json({ ok: false, error: `Workforce run "${id}" not found.` });

  const request = getContentRequest(run.requestId);
  return res.status(200).json({
    ok: true,
    run,
    request: request ? { id: request.id, brand: request.brand, platform: request.platform, topic: request.topic, status: request.status } : null,
  });
}
