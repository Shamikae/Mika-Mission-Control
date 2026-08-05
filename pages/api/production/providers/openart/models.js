// GET /api/production/providers/openart/models
// Calls the live "openart_model_list" tool and returns the sanitized
// text2image-capable model catalog — id and description only. Read-only,
// never a generation call. This is the SAME live discovery + filter logic
// generateOpenArtImage() already uses to auto-select a model (see
// lib/openart/openartMcpClient.js) — surfaced here so a human can browse
// the real catalog. This route is informational/browse-only because
// standalone IMAGE generation still has no job-submission flow inside
// Production Router (only Content Workforce/thumbnails use it) — it is
// never wired into a job-submission flow. (OpenArt VIDEO now has a real,
// separate execution adapter — see
// lib/production/execution/adapters/openartVideoMcp.adapter.js and
// pages/api/production/providers/openart-video/models.js — this route is
// unrelated to that one and only ever queries the image model catalog.)

import { callOpenArtTool, buildOpenArtCallbackUrl } from '../../../../../lib/openart/openartMcpClient';

const STATUS_BY_CODE = {
  disabled:               503,
  authentication_required: 401,
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const redirectUrl = buildOpenArtCallbackUrl(req);

  try {
    const result = await callOpenArtTool('openart_model_list', {}, { redirectUrl });
    const allModels = Array.isArray(result.json?.models) ? result.json.models : [];
    const text2imageModels = allModels.filter(m =>
      Array.isArray(m.modes?.image) && m.modes.image.some(entry => entry.mode === 'text2image')
    );
    const models = text2imageModels.map(m => ({
      id: m.id,
      description: m.description || '',
    }));
    return res.status(200).json({ ok: true, models, count: models.length });
  } catch (e) {
    const status = STATUS_BY_CODE[e.code] || 502;
    return res.status(status).json({ ok: false, code: e.code || 'models_failed', error: e.message });
  }
}
