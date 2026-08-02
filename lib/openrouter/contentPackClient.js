// lib/openrouter/contentPackClient.js
// SERVER-SIDE ONLY. Never import this from client components.
// Governed OpenRouter call for Content Pack Generator synthesis.
// Sibling to fusionClient.js — same provider, env vars, and error-handling
// conventions, but its own sub-capability flag and schema-specific prompt
// (Fusion's schema is fixed to strategy/content critique output, not
// short-form content packages, so its schema is not reused here).
// API keys are read from environment and never returned to callers.

import { parseSynthesisOutput } from '../content/contentPackageSchema';

const BASE_URL      = process.env.OPENROUTER_API_URL      || 'https://openrouter.ai/api/v1';
const CONTENT_MODEL = process.env.OPENROUTER_CONTENT_MODEL || 'openai/gpt-4o-mini';

const SYSTEM_PROMPT = `You are MIKA AGENTIC OS™ Content Pack Generator — a governed short-form content synthesis engine.

Given a content brief, produce ONE complete content package as valid JSON. No markdown fences. No preamble. No explanation outside the JSON. Return ONLY this exact shape:

{
  "hooks": [{ "text": "...", "angle": "..." }],
  "script": { "opening": "...", "body": "...", "cta": "...", "fullText": "..." },
  "scenes": [{ "order": 1, "durationSeconds": 3, "visual": "...", "voiceover": "...", "onScreenText": "..." }],
  "caption": "...",
  "cta": "...",
  "hashtags": ["..."],
  "keywords": ["..."],
  "thumbnail": { "headline": "...", "visualBrief": "..." }
}

Rules:
- hooks: exactly 3 entries, each a distinct angle (e.g. curiosity gap, bold claim, pattern interrupt, story opener).
- script.fullText: the complete spoken script combining opening + body + cta into one continuous read.
- scenes: break the script into 4-8 shootable beats in order, with realistic durationSeconds that sum close to the requested video duration if one was given.
- hashtags: 8-15 relevant tags, no "#" symbol.
- keywords: 5-10 searchable terms distinct from the hashtags.
- thumbnail.headline: under 6 words, punchy, works at small size.
- thumbnail.visualBrief: a concrete AI-image prompt — composition, subject, style, lighting, colors — specific and visual, not abstract, because it is sent directly to an image generator.`;

// ── Config check ──────────────────────────────────────────────────────────────

/**
 * Returns whether Content Pack synthesis is fully configured.
 * Safe to call from API routes — never touches the key value itself.
 *
 * @returns {{ configured: boolean, reason?: string }}
 */
export function getContentPackConfig() {
  const enabled        = String(process.env.OPENROUTER_ENABLED             || '').trim().toLowerCase() === 'true';
  const contentEnabled  = String(process.env.OPENROUTER_CONTENT_PACK_ENABLED || '').trim().toLowerCase() === 'true';
  const apiKey          = String(process.env.OPENROUTER_API_KEY            || '').trim();

  if (!enabled)       return { configured: false, reason: 'OPENROUTER_ENABLED is not set to true' };
  if (!contentEnabled) return { configured: false, reason: 'OPENROUTER_CONTENT_PACK_ENABLED is not set to true' };
  if (!apiKey)        return { configured: false, reason: 'OPENROUTER_API_KEY is not configured' };

  return { configured: true };
}

function buildUserMessage({ brand, platform, goal, topic, audience, offer, tone, videoDuration, cta, instructions }) {
  const lines = [
    `Brand:            ${brand}`,
    `Platform:         ${platform}`,
    `Content goal:     ${goal}`,
    `Topic / idea:     ${topic}`,
  ];
  if (audience)      lines.push(`Target audience:  ${audience}`);
  if (offer)         lines.push(`Product/offer:    ${offer}`);
  if (tone)          lines.push(`Tone:             ${tone}`);
  if (videoDuration) lines.push(`Target duration:  ${videoDuration}`);
  if (cta)           lines.push(`Desired CTA:      ${cta}`);
  if (instructions) {
    lines.push('', 'Additional instructions:', instructions);
  }
  return lines.join('\n');
}

// ── Main client ───────────────────────────────────────────────────────────────

/**
 * Synthesizes a structured content package via OpenRouter. Returns a
 * result object with a `status` field for every non-success outcome
 * (configuration_pending, network_error, auth_error, rate_limited,
 * billing_error, provider_error, parse_error, malformed_output) — never
 * throws for expected failure modes.
 *
 * @returns {Promise<{ ok: boolean, model?: string, data?: object, tokensUsed?: number|null, status?: string, message?: string }>}
 */
export async function synthesizeContentPack(input) {
  const cfg = getContentPackConfig();
  if (!cfg.configured) {
    return { ok: false, status: 'configuration_pending', message: cfg.reason };
  }

  const userMessage = buildUserMessage(input);
  const apiKey = process.env.OPENROUTER_API_KEY;

  let response;
  try {
    response = await fetch(`${BASE_URL}/chat/completions`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer':  'https://mika-mission-control.local',
        'X-Title':       'MIKA AGENTIC OS Content Pack Generator',
      },
      body: JSON.stringify({
        model: CONTENT_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: userMessage    },
        ],
        temperature:     0.7,
        max_tokens:      2200,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return { ok: false, status: 'network_error', message: 'Could not reach OpenRouter. Check your connection and retry.' };
  }

  if (!response.ok) {
    const status = response.status;
    if (status === 401 || status === 403) {
      return { ok: false, status: 'auth_error',    message: 'OpenRouter authentication failed. Verify OPENROUTER_API_KEY.' };
    }
    if (status === 429) {
      return { ok: false, status: 'rate_limited',  message: 'OpenRouter rate limit reached. Retry in a moment.' };
    }
    if (status === 402) {
      return { ok: false, status: 'billing_error', message: 'OpenRouter billing issue. Check your account credits.' };
    }
    return { ok: false, status: 'provider_error', message: 'Content synthesis could not be completed. Please retry.' };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return { ok: false, status: 'parse_error', message: 'OpenRouter returned an unexpected response format.' };
  }

  const rawContent = data?.choices?.[0]?.message?.content;
  if (!rawContent) {
    return { ok: false, status: 'empty_response', message: 'Synthesis returned no content. Retry or adjust your brief.' };
  }

  let parsed;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    return { ok: false, status: 'malformed_output', message: 'Model output was not valid JSON. Retry — this is not billed against your written package.' };
  }

  const validation = parseSynthesisOutput(parsed);
  if (!validation.valid) {
    return {
      ok:      false,
      status:  'malformed_output',
      message: `Model output failed validation: ${validation.errors.join('; ')}`,
    };
  }

  return {
    ok:         true,
    model:      data.model || CONTENT_MODEL,
    data:       validation.data,
    tokensUsed: data.usage?.total_tokens ?? null,
  };
}
