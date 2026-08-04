// POST /api/creative-director/requests/[id]/create-package
// Transitions brief_generated -> package_created. Creates ONE Content
// Package through the exact same interfaces Content Pack Generator uses
// (buildContentPackage + savePackage + defaultPipelineMeta) — see
// lib/creative-director/packageFromRequest.js. The Package Pipeline is
// never bypassed: from the moment this returns, the package is a normal
// Package Pipeline citizen, indistinguishable from any other.

import { isValidId, isValidRequestTransition, makeActivityEvent } from '../../../../../lib/creative-director/creativeDirectorRules';
import { getContentRequest, updateContentRequest } from '../../../../../lib/creative-director/contentRequestStore';
import { createPackageFromRequest } from '../../../../../lib/creative-director/packageFromRequest';

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

  if (!isValidRequestTransition(request.status, 'package_created')) {
    return res.status(409).json({ ok: false, error: `Cannot create a package from status "${request.status}".` });
  }
  if (!request.brief) {
    return res.status(409).json({ ok: false, error: 'No production brief has been generated yet.' });
  }

  const pkg = createPackageFromRequest(request, request.brief);

  const updated = updateContentRequest(id, {
    status: 'package_created',
    packageId: pkg.id,
    activityHistory: [...request.activityHistory, makeActivityEvent('package_created', { actor: 'system', note: `Created package ${pkg.id} via the Package Pipeline's own interfaces.` })],
  });

  return res.status(200).json({ ok: true, request: updated, package: { id: pkg.id, topic: pkg.topic, pipelineStage: pkg.pipeline?.stage } });
}
