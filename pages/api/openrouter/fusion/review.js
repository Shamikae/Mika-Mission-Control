// POST /api/openrouter/fusion/review
// Governed OpenRouter Fusion synthesis endpoint.
//
// If OpenRouter is not configured, returns HTTP 200 with status: 'configuration_pending'
// so the UI can render a graceful unconfigured state rather than a network error.
//
// Input:
//   { reviewType, context, content }
//
// Output (success):
//   { ok: true, reviewType, model, consensus, contradictions, blindSpots, uniqueInsights, recommendation, tokensUsed }
//
// Output (not configured):
//   { ok: false, status: 'configuration_pending', message }
//
// Output (error):
//   { ok: false, status, message }
//
// Raw provider errors and API keys are never returned.

import { callFusion, getFusionConfig } from '../../../../lib/openrouter/fusionClient';

export const config = {
  api: { bodyParser: { sizeLimit: '512kb' } },
};

const VALID_REVIEW_TYPES = ['boardroom', 'content-factory', 'script', 'offer-strategy', 'pipeline-stage'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // Config check first — return 200 with status flag so the UI renders
  // a clean "not configured" state rather than a hard error.
  const fusionConfig = getFusionConfig();
  if (!fusionConfig.configured) {
    return res.status(200).json({
      ok:      false,
      status:  'configuration_pending',
      message: 'OpenRouter Fusion is not configured. Set OPENROUTER_ENABLED=true, OPENROUTER_API_KEY, and OPENROUTER_FUSION_ENABLED=true in your .env.local file.',
    });
  }

  const { reviewType, context, content } = req.body || {};

  if (!reviewType || !VALID_REVIEW_TYPES.includes(reviewType)) {
    return res.status(400).json({
      ok:    false,
      error: `Invalid reviewType. Valid: ${VALID_REVIEW_TYPES.join(', ')}.`,
    });
  }
  if (!context || typeof context !== 'string' || !context.trim()) {
    return res.status(400).json({ ok: false, error: 'context is required.' });
  }
  if (context.trim().length > 2000) {
    return res.status(400).json({ ok: false, error: 'context must be 2000 characters or fewer.' });
  }
  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ ok: false, error: 'content is required.' });
  }
  if (content.trim().length > 8000) {
    return res.status(400).json({ ok: false, error: 'content must be 8000 characters or fewer.' });
  }

  const result = await callFusion({
    reviewType,
    context: context.trim(),
    content: content.trim(),
  });

  // Return 200 in all cases — ok:false communicates failure to the client
  // without triggering network-level error handling in the UI.
  return res.status(200).json(result);
}
