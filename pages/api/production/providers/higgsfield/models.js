// GET /api/production/providers/higgsfield/models?type=image|video
// Calls the live "models_explore" tool (action: list) for the requested
// output type and returns the sanitized model catalog — id, name,
// aspect_ratios, parameters, supports_unlim. Read-only, never a generation
// call. Used by Higgsfield Setup to populate the model picker.

import { callHiggsfieldTool, buildHiggsfieldCallbackUrl } from '../../../../../lib/higgsfield/higgsfieldMcpClient';

const ALLOWED_TYPES = ['image', 'video'];
const STATUS_BY_CODE = {
  disabled:              503,
  authorization_required: 401,
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const type = String(req.query.type || '').trim();
  if (!ALLOWED_TYPES.includes(type)) {
    return res.status(400).json({ ok: false, error: `type must be one of: ${ALLOWED_TYPES.join(', ')}.` });
  }

  const redirectUrl = buildHiggsfieldCallbackUrl(req);

  try {
    const result = await callHiggsfieldTool('models_explore', { action: 'list', type, limit: 100 }, { redirectUrl });
    const items = Array.isArray(result.json?.items) ? result.json.items : [];
    const models = items.map(m => ({
      id: m.id,
      name: m.name,
      providerName: m.provider_name || null,
      description: m.description || '',
      aspectRatios: Array.isArray(m.aspect_ratios) ? m.aspect_ratios : [],
      durationParam: (m.parameters || []).find(p => p.name === 'duration') || null,
      supportsUnlim: m.supports_unlim === true,
      tags: Array.isArray(m.tags) ? m.tags : [],
    }));
    return res.status(200).json({ ok: true, models, count: models.length });
  } catch (e) {
    const status = STATUS_BY_CODE[e.code] || 502;
    return res.status(status).json({ ok: false, code: e.code || 'models_failed', error: e.message });
  }
}
