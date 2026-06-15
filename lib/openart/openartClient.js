// lib/openart/openartClient.js
// SERVER-SIDE ONLY. Never import from client components.
// Calls OpenArt API for governed AI image generation.
// API keys are read from environment and never returned to callers.
// Provider image URLs expire — this module downloads bytes immediately
// and returns Buffers for persistent storage via saveImageArtifact.

const BASE_URL       = 'https://openart.ai/api';
const DEFAULT_MODEL  = process.env.OPENART_DEFAULT_MODEL  || 'photoreal';
const DEFAULT_WIDTH  = Number(process.env.OPENART_DEFAULT_WIDTH  || 1024);
const DEFAULT_HEIGHT = Number(process.env.OPENART_DEFAULT_HEIGHT || 1024);

// ── Config check ──────────────────────────────────────────────────────────────

/**
 * Returns whether OpenArt is fully configured.
 * Safe to call from API routes — never surfaces the key value.
 *
 * @returns {{ configured: boolean, reason?: string }}
 */
export function getOpenArtConfig() {
  const enabled = String(process.env.OPENART_ENABLED || '').trim().toLowerCase() === 'true';
  const apiKey  = String(process.env.OPENART_API_KEY  || '').trim();

  if (!enabled) return { configured: false, reason: 'OPENART_ENABLED is not set to true' };
  if (!apiKey)  return { configured: false, reason: 'OPENART_API_KEY is not configured' };

  return { configured: true };
}

// ── Image downloader ──────────────────────────────────────────────────────────

async function downloadImageBuffer(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Image download failed: HTTP ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ── URL extractor — handles multiple OpenArt response shapes ─────────────────

function extractImageUrls(data) {
  if (!data || typeof data !== 'object') return [];

  // { images: [{ url: '...' }, ...] }
  if (Array.isArray(data.images)) {
    const urls = data.images
      .map(item => (typeof item === 'string' ? item : (item?.url || item?.image_url || null)))
      .filter(Boolean);
    if (urls.length) return urls;
  }

  // { data: [{ url: '...' }, ...] } — OpenAI-compatible shape
  if (Array.isArray(data.data)) {
    const urls = data.data
      .map(item => (typeof item === 'string' ? item : (item?.url || item?.image_url || null)))
      .filter(Boolean);
    if (urls.length) return urls;
  }

  // { urls: ['...', ...] }
  if (Array.isArray(data.urls)) return data.urls.filter(u => typeof u === 'string');

  // { url: '...' } — single image
  if (typeof data.url === 'string') return [data.url];

  return [];
}

// ── Main client ───────────────────────────────────────────────────────────────

/**
 * Generate images via the OpenArt API and return downloaded Buffers.
 *
 * @param {object}  params
 * @param {string}  params.prompt
 * @param {string}  [params.negativePrompt]
 * @param {string}  [params.model]
 * @param {number}  [params.width]
 * @param {number}  [params.height]
 * @param {number}  [params.numImages]
 * @returns {Promise<{ ok: boolean, imageBuffers?: Buffer[], model?: string, count?: number, status?: string, error?: string }>}
 */
export async function callOpenArt({
  prompt,
  negativePrompt = '',
  model          = DEFAULT_MODEL,
  width          = DEFAULT_WIDTH,
  height         = DEFAULT_HEIGHT,
  numImages      = 1,
}) {
  const cfg = getOpenArtConfig();
  if (!cfg.configured) {
    return { ok: false, status: 'configuration_pending', error: cfg.reason };
  }

  if (!prompt || !String(prompt).trim()) {
    return { ok: false, status: 'invalid_input', error: 'prompt is required' };
  }

  const apiKey        = process.env.OPENART_API_KEY;
  const safeNumImages = Math.min(Math.max(1, Number(numImages) || 1), 4);

  let response;
  try {
    response = await fetch(`${BASE_URL}/v1/images/generate`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        prompt,
        negative_prompt: negativePrompt || undefined,
        model,
        width,
        height,
        num_images: safeNumImages,
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    return {
      ok:     false,
      status: 'network_error',
      error:  'Could not reach OpenArt API. Check your connection and retry.',
    };
  }

  if (!response.ok) {
    const status = response.status;
    if (status === 401 || status === 403) {
      return { ok: false, status: 'auth_error',    error: 'OpenArt authentication failed. Verify OPENART_API_KEY.' };
    }
    if (status === 429) {
      return { ok: false, status: 'rate_limited',  error: 'OpenArt rate limit reached. Retry in a moment.' };
    }
    if (status === 402) {
      return { ok: false, status: 'billing_error', error: 'OpenArt billing issue. Check your account credits.' };
    }
    return { ok: false, status: 'provider_error', error: 'Image generation could not be completed. Please retry.' };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return { ok: false, status: 'parse_error', error: 'OpenArt returned an unexpected response format.' };
  }

  const imageUrls = extractImageUrls(data);
  if (!imageUrls.length) {
    return {
      ok:     false,
      status: 'empty_response',
      error:  'OpenArt returned no images. Retry or adjust your prompt.',
    };
  }

  // Download all image bytes — provider URLs expire; never store them
  const imageBuffers = [];
  for (const url of imageUrls) {
    try {
      const buf = await downloadImageBuffer(url);
      imageBuffers.push(buf);
    } catch {
      // Partial success: skip failed downloads but continue
    }
  }

  if (!imageBuffers.length) {
    return {
      ok:     false,
      status: 'download_error',
      error:  'Images were generated but could not be downloaded. Retry.',
    };
  }

  return {
    ok:           true,
    imageBuffers,
    model:        data.model || model,
    count:        imageBuffers.length,
  };
}
