// lib/research/adapters/exaAdapter.js
// SERVER-SIDE ONLY. Never import from client components.
// Governed Exa Search API adapter — implements researchAdapterContract.js's
// shared shape. Sibling in spirit to lib/openrouter/contentPackClient.js:
// same never-throws error-taxonomy convention, same "API key read from env,
// used in one header, never returned" discipline. The raw Exa response body
// is never persisted — only buildNormalizedSource()-sanitized results cross
// this boundary.
//
// API shape (Exa Search API, https://docs.exa.ai): POST /search with an
// `x-api-key` header returns { results: [{ id, url, title, publishedDate,
// author, text, score }] }. A separate POST /contents can fetch fuller text
// for specific result ids. This adapter has NOT been exercised against a
// real Exa response in this environment yet — the live smoke test (run only
// with explicit approval) is the first real call, and is exactly the
// intended place to catch any shape drift from Exa's current API.

import { buildNormalizedSource } from '../researchAdapterContract.js';

const BASE_URL = 'https://api.exa.ai';

export function getExaConfig() {
  const enabled = String(process.env.EXA_ENABLED || '').trim().toLowerCase() === 'true';
  const apiKey = String(process.env.EXA_API_KEY || '').trim();
  if (!enabled) return { configured: false, reason: 'EXA_ENABLED is not set to true' };
  if (!apiKey) return { configured: false, reason: 'EXA_API_KEY is not configured' };
  return { configured: true };
}

async function exaFetch(path, body, timeoutMs) {
  const cfg = getExaConfig();
  if (!cfg.configured) return { ok: false, status: 'configuration_pending', message: cfg.reason };

  const apiKey = process.env.EXA_API_KEY;
  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs || 30000),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError') return { ok: false, status: 'timeout', message: `Exa request timed out after ${timeoutMs || 30000}ms.` };
    return { ok: false, status: 'network_error', message: 'Could not reach Exa. Check your connection and retry.' };
  }

  if (!response.ok) {
    const status = response.status;
    if (status === 401 || status === 403) return { ok: false, status: 'auth_error', message: 'Exa authentication failed. Verify EXA_API_KEY.' };
    if (status === 429) return { ok: false, status: 'rate_limited', message: 'Exa rate limit reached. Retry in a moment.' };
    if (status === 402) return { ok: false, status: 'billing_error', message: 'Exa billing issue. Check your account credits.' };
    return { ok: false, status: 'provider_error', message: `Exa returned an error (HTTP ${status}).` };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return { ok: false, status: 'parse_error', message: 'Exa returned an unexpected response format.' };
  }
  return { ok: true, data };
}

export function createExaAdapter() {
  return {
    id: 'exa',
    displayName: 'Exa',
    executionType: 'api_key',

    async healthCheck() {
      const cfg = getExaConfig();
      if (!cfg.configured) return { healthy: false, message: cfg.reason };
      // Exa has no dedicated no-op health endpoint; a genuinely free health
      // check would still be a real request, which this adapter never makes
      // outside an explicit search/fetch call. Health is therefore reported
      // as "configured" (key present) rather than "verified reachable" —
      // honest about what was actually checked, never claiming more.
      return { healthy: true, message: 'Configured (key present). Reachability is confirmed on first real search, not by a separate probe call.' };
    },

    async search(query, { numResults = 5, timeoutMs } = {}) {
      const result = await exaFetch('/search', {
        query,
        numResults: Math.max(1, Math.min(5, numResults)),
        type: 'auto',
        contents: { text: { maxCharacters: 1200 } },
      }, timeoutMs);
      if (!result.ok) return result;

      const raw = Array.isArray(result.data?.results) ? result.data.results : [];
      return {
        ok: true,
        usage: { queries: 1 },
        results: raw.map(r => ({
          id: r.id,
          title: r.title,
          url: r.url,
          domain: null,
          publishedAt: r.publishedDate || null,
          author: r.author || null,
          snippet: typeof r.text === 'string' ? r.text.slice(0, 600) : '',
          content: typeof r.text === 'string' ? r.text : '',
          contentType: 'other',
          score: typeof r.score === 'number' ? r.score : null,
        })),
      };
    },

    async fetch(result, { maxCharacters = 4000, timeoutMs } = {}) {
      if (!result?.id && !result?.url) return { ok: false, status: 'invalid_request', message: 'fetch() requires a result id or url.' };
      const resp = await exaFetch('/contents', {
        ids: result.id ? [result.id] : undefined,
        urls: !result.id && result.url ? [result.url] : undefined,
        text: { maxCharacters },
      }, timeoutMs);
      if (!resp.ok) return resp;

      const first = Array.isArray(resp.data?.results) ? resp.data.results[0] : null;
      if (!first) return { ok: false, status: 'empty_response', message: 'Exa /contents returned no content for this result.' };
      return { ok: true, usage: { fetches: 1 }, content: typeof first.text === 'string' ? first.text.slice(0, maxCharacters) : '' };
    },

    normalizeResults(rawResults, { query } = {}) {
      return (rawResults || [])
        .map(r => buildNormalizedSource(r, { provider: 'exa', query }))
        .filter(Boolean);
    },

    estimate(query, { numResults = 5 } = {}) {
      return { queryCount: 1, resultCount: numResults, provisional: true };
    },

    sanitizeResult(source) {
      // buildNormalizedSource already clamps/sanitizes every field; this
      // exists to satisfy the shared contract and as an explicit second
      // pass point if a future provider needs adapter-specific stripping.
      return source;
    },
  };
}
