// lib/openrouter/fusionClient.js
// SERVER-SIDE ONLY. Never import this from client components.
// Calls OpenRouter Fusion for governed multi-model synthesis.
// API keys are read from environment and never returned to callers.

const BASE_URL     = process.env.OPENROUTER_API_URL   || 'https://openrouter.ai/api/v1';
const FUSION_MODEL = process.env.OPENROUTER_FUSION_MODEL || 'openrouter/fusion';

// ── Review type directives ────────────────────────────────────────────────────

const TYPE_DIRECTIVE = {
  boardroom:
    'Strategic planning review. Evaluate the provided proposal for risks, hidden assumptions, strategic blind spots, and alignment with stated goals. Apply business strategy, competitive analysis, and risk management lenses.',
  'content-factory':
    'Content package review. Evaluate this content package for audience alignment, message quality, strategic gaps, channel suitability, execution risk, and missing elements. Apply content strategy, conversion optimisation, and platform algorithm lenses.',
  script:
    'Script critique. Evaluate this script for hook strength, message clarity, pacing, audience resonance, platform suitability, and conversion potential. Apply copywriting, behavioural psychology, and platform content lenses.',
  'offer-strategy':
    'Offer and lead strategy critique. Evaluate this offer for value clarity, pricing rationale, competitive positioning, objection handling, and conversion optimisation. Apply sales psychology, positioning strategy, and funnel design lenses.',
  'pipeline-stage':
    'Content pipeline stage review. Evaluate this content for readiness to advance, quality standards, platform suitability, and approval readiness. Apply editorial standards, brand voice, and platform requirement lenses.',
};

const SYSTEM_PROMPT = `You are MIKA AGENTIC OS™ Fusion Review — a multi-model synthesis engine for governed business strategy, content critique, and offer evaluation.

Analyse the provided content using multiple analytical perspectives and return a single structured synthesis.

Return ONLY valid JSON matching this exact schema. No markdown fences. No preamble. No explanation outside the JSON:
{
  "consensus": "The main conclusion all analytical perspectives agree on (2-3 sentences)",
  "contradictions": ["A specific point where analytical perspectives disagree", "Second disagreement point"],
  "blindSpots": ["A risk, gap, or angle the content fails to address", "Second blind spot"],
  "uniqueInsights": ["A non-obvious, high-value observation", "Second unique insight"],
  "recommendation": "A clear, specific, actionable next step (2-4 sentences)"
}

Arrays must have 2-4 items. Be specific, direct, and critical. Do not pad with generic observations.`;

// ── Config check ──────────────────────────────────────────────────────────────

/**
 * Returns whether Fusion is fully configured.
 * Safe to call from API routes — never touches the key value itself in output.
 *
 * @returns {{ configured: boolean, reason?: string }}
 */
export function getFusionConfig() {
  const enabled       = String(process.env.OPENROUTER_ENABLED        || '').trim().toLowerCase() === 'true';
  const fusionEnabled = String(process.env.OPENROUTER_FUSION_ENABLED || '').trim().toLowerCase() === 'true';
  const apiKey        = String(process.env.OPENROUTER_API_KEY        || '').trim();

  if (!enabled)       return { configured: false, reason: 'OPENROUTER_ENABLED is not set to true' };
  if (!fusionEnabled) return { configured: false, reason: 'OPENROUTER_FUSION_ENABLED is not set to true' };
  if (!apiKey)        return { configured: false, reason: 'OPENROUTER_API_KEY is not configured' };

  return { configured: true };
}

// ── Main client ───────────────────────────────────────────────────────────────

/**
 * Call OpenRouter Fusion to synthesise a structured multi-model review.
 *
 * @param {object} params
 * @param {'boardroom'|'content-factory'|'script'|'offer-strategy'|'pipeline-stage'} params.reviewType
 * @param {string} params.context  — Brief description of what is being reviewed (max 2000 chars)
 * @param {string} params.content  — The content to review (max 8000 chars)
 * @returns {Promise<FusionResult>}
 */
export async function callFusion({ reviewType, context, content }) {
  const cfg = getFusionConfig();
  if (!cfg.configured) {
    return { ok: false, status: 'configuration_pending', message: cfg.reason };
  }

  const directive   = TYPE_DIRECTIVE[reviewType] || TYPE_DIRECTIVE.boardroom;
  const userMessage = [
    `REVIEW TYPE: ${reviewType.toUpperCase()}`,
    `DIRECTIVE: ${directive}`,
    ``,
    `CONTEXT:`,
    context.trim(),
    ``,
    `CONTENT TO REVIEW:`,
    content.trim(),
  ].join('\n');

  // API key is read here, used in the header, and never surfaced again
  const apiKey = process.env.OPENROUTER_API_KEY;

  let response;
  try {
    response = await fetch(`${BASE_URL}/chat/completions`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer':  'https://mika-mission-control.local',
        'X-Title':       'MIKA AGENTIC OS Fusion Review',
      },
      body: JSON.stringify({
        model:           FUSION_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: userMessage    },
        ],
        temperature:     0.35,
        max_tokens:      1400,
        response_format: { type: 'json_object' },
      }),
    });
  } catch {
    return {
      ok:      false,
      status:  'network_error',
      message: 'Could not reach OpenRouter. Check your connection and retry.',
    };
  }

  if (!response.ok) {
    const status = response.status;
    // Never expose raw provider error bodies — they may contain key fragments
    if (status === 401 || status === 403) {
      return { ok: false, status: 'auth_error',    message: 'OpenRouter authentication failed. Verify OPENROUTER_API_KEY.' };
    }
    if (status === 429) {
      return { ok: false, status: 'rate_limited',  message: 'OpenRouter rate limit reached. Retry in a moment.' };
    }
    if (status === 402) {
      return { ok: false, status: 'billing_error', message: 'OpenRouter billing issue. Check your account credits.' };
    }
    return   { ok: false, status: 'provider_error', message: 'Fusion review could not be completed. Please retry.' };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return { ok: false, status: 'parse_error', message: 'OpenRouter returned an unexpected response format.' };
  }

  const rawContent = data?.choices?.[0]?.message?.content;
  if (!rawContent) {
    return { ok: false, status: 'empty_response', message: 'Fusion returned no content. Retry or adjust your input.' };
  }

  let parsed;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    return { ok: false, status: 'parse_error', message: 'Fusion response could not be parsed. Retry or shorten your input.' };
  }

  // Validate schema — all required fields must be present
  const required = ['consensus', 'contradictions', 'blindSpots', 'uniqueInsights', 'recommendation'];
  const missing  = required.filter(k => !parsed[k]);
  if (missing.length) {
    return { ok: false, status: 'incomplete_response', message: `Fusion response was incomplete (missing: ${missing.join(', ')}). Retry.` };
  }

  return {
    ok:             true,
    reviewType,
    model:          data.model || FUSION_MODEL,
    consensus:      String(parsed.consensus),
    contradictions: toStringArray(parsed.contradictions),
    blindSpots:     toStringArray(parsed.blindSpots),
    uniqueInsights: toStringArray(parsed.uniqueInsights),
    recommendation: String(parsed.recommendation),
    tokensUsed:     data.usage?.total_tokens ?? null,
  };
}

function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(String).filter(Boolean);
}
