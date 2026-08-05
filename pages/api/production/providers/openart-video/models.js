// GET /api/production/providers/openart-video/models
// Live text2video-capable OpenArt model catalog, each with its resolved
// live form-schema constraints (duration min/max/default, aspectRatio
// enum/default, resolution enum/default) embedded — one fetch gives the
// UI everything it needs to build the setup form per model. Read-only,
// never a generation call. Used by OpenArt Video Setup to populate the
// model picker.
//
// `supported` is false for any model whose form uses a multi-variant
// (oneOf/anyOf) schema this checkpoint does not resolve (confirmed live:
// gemini-omni-flash, kling-3-omni, wan2-7) — surfaced explicitly so the UI
// can show them as unavailable rather than letting a user pick one and
// hit a confusing validation error at submit time.

import {
  fetchVideoModelCatalog, fetchVideoModelForm,
} from '../../../../../lib/production/execution/adapters/openartVideoMcp.adapter';

const STATUS_BY_CODE = {
  disabled:                503,
  authentication_required: 401,
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const redirectUrl = String(process.env.OPENART_OAUTH_REDIRECT_URL || '').trim() || undefined;

  try {
    const catalog = await fetchVideoModelCatalog(redirectUrl);
    const models = await Promise.all(catalog.map(async m => {
      const form = await fetchVideoModelForm(m.id, redirectUrl).catch(() => null);
      const props = form?.properties || {};
      return {
        id: m.id,
        displayName: m.displayName,
        description: m.description,
        supported: form?.supported === true,
        unsupportedReason: form?.supported === false ? form.reason : null,
        duration: props.duration ? { minimum: props.duration.minimum, maximum: props.duration.maximum, default: props.duration.default } : null,
        aspectRatios: Array.isArray(props.aspectRatio?.enum) ? props.aspectRatio.enum : [],
        defaultAspectRatio: props.aspectRatio?.default || null,
        resolutions: Array.isArray(props.resolution?.enum) ? props.resolution.enum : [],
        defaultResolution: props.resolution?.default || null,
      };
    }));
    return res.status(200).json({ ok: true, models, count: models.length });
  } catch (e) {
    const status = STATUS_BY_CODE[e.code] || 502;
    return res.status(status).json({ ok: false, code: e.code || 'models_failed', error: e.message });
  }
}
