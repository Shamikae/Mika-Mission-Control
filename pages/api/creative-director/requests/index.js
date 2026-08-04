// GET  /api/creative-director/requests — list content requests (filters: status, priority, brand)
// POST /api/creative-director/requests — create a new draft content request
//
// The Creative Director never generates content or calls a provider here —
// this only records a structured request. See generate-brief.js and
// create-package.js for the (deterministic, non-AI) next steps.

import {
  validateContentRequest, sanitizeContentRequestInput, defaultAgentStages, makeActivityEvent,
} from '../../../../lib/creative-director/creativeDirectorRules';
import {
  generateContentRequestId, createContentRequest, listContentRequests,
} from '../../../../lib/creative-director/contentRequestStore';

export const config = {
  api: { bodyParser: { sizeLimit: '16kb' } },
};

export default function handler(req, res) {
  if (req.method === 'GET') {
    const { status, priority, brand } = req.query;
    let requests = listContentRequests();
    if (status) requests = requests.filter(r => r.status === status);
    if (priority) requests = requests.filter(r => r.priority === priority);
    if (brand) requests = requests.filter(r => r.brand === brand);
    return res.status(200).json({ ok: true, requests, total: requests.length });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const clean = sanitizeContentRequestInput(req.body || {});
  const validation = validateContentRequest(clean);
  if (!validation.ok) {
    return res.status(400).json({ ok: false, error: 'Invalid content request.', errors: validation.errors });
  }

  const now = new Date().toISOString();
  const id = generateContentRequestId();
  const request = {
    id,
    ...clean,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    packageId: null,
    brief: null,
    agents: defaultAgentStages(),
    activityHistory: [makeActivityEvent('request_created', { actor: 'user', note: clean.topic })],
  };

  createContentRequest(request);
  return res.status(201).json({ ok: true, request });
}
