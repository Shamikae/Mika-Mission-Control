// GET   /api/creative-director/requests/[id] — detail, enriched with the
//       created package summary (if any) for convenience.
// PATCH /api/creative-director/requests/[id] — edit fields while "draft" only.

import { loadPackage } from '../../../../../lib/content/contentPackageStore';
import {
  isValidId, validateContentRequest, sanitizeContentRequestInput, makeActivityEvent,
} from '../../../../../lib/creative-director/creativeDirectorRules';
import { getContentRequest, updateContentRequest, appendRequestHistory } from '../../../../../lib/creative-director/contentRequestStore';

export const config = {
  api: { bodyParser: { sizeLimit: '16kb' } },
};

function enrich(request) {
  const pkg = request.packageId ? loadPackage(request.packageId) : null;
  return {
    request,
    package: pkg ? { id: pkg.id, topic: pkg.topic, status: pkg.status, pipelineStage: pkg.pipeline?.stage || null } : null,
  };
}

export default function handler(req, res) {
  const { id } = req.query;
  if (!id || !isValidId(id)) {
    return res.status(400).json({ ok: false, error: 'Invalid content request id.' });
  }

  const existing = getContentRequest(id);
  if (!existing) return res.status(404).json({ ok: false, error: `Content request "${id}" not found.` });

  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, ...enrich(existing) });
  }

  if (req.method !== 'PATCH') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  if (existing.status !== 'draft') {
    return res.status(409).json({ ok: false, error: `Cannot edit a content request in status "${existing.status}" — only "draft" requests are editable.` });
  }

  const merged = { ...existing, ...req.body };
  const clean = sanitizeContentRequestInput(merged);
  const validation = validateContentRequest(clean);
  if (!validation.ok) {
    return res.status(400).json({ ok: false, error: 'Invalid content request.', errors: validation.errors });
  }

  let updated = updateContentRequest(id, clean);
  updated = appendRequestHistory(id, 'fields_updated', { actor: 'user', note: Object.keys(req.body || {}).join(', ') });

  return res.status(200).json({ ok: true, ...enrich(updated) });
}
