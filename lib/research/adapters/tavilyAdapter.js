// lib/research/adapters/tavilyAdapter.js
// SERVER-SIDE ONLY. Never import from client components.
// Governed Tavily REST API adapter — implements researchAdapterContract.js's
// shared shape, sibling to exaAdapter.js (same never-throws error-taxonomy
// convention, same "API key read from env, used in one header, never
// returned" discipline). The raw Tavily response body is never persisted —
// only buildNormalizedSource()-sanitized results cross this boundary.
//
// This is a DIRECT server-side REST integration (TAVILY_API_URL, TAVILY_API_KEY
// in .env.local) — completely independent of, and never dependent on, the
// separate Tavily MCP server registered in VS Code. That MCP registration is
// editor-scoped and ungoverned (no query cap, no URL safety, no budget gate);
// Mika's runtime never calls it or relies on its presence.
//
// Only search + extract are implemented — the MCP discovery this session
// also found tavily_crawl/tavily_map/tavily_research tools, but per this
// milestone's explicit scope those are NEVER wired into Mika: no crawl, no
// site mapping, no autonomous multi-source deep-research fan-out. Only
// bounded search of a single query and extraction of already-selected URLs.

import { buildNormalizedSource } from '../researchAdapterContract.js';

const DEFAULT_BASE_URL = 'https://api.tavily.com';

function baseUrl() {
  return process.env.TAVILY_API_URL || DEFAULT_BASE_URL;
}

export function getTavilyConfig() {
  const enabled = String(process.env.TAVILY_ENABLED || '').trim().toLowerCase() === 'true';
  const apiKey = String(process.env.TAVILY_API_KEY || '').trim();
  if (!enabled) return { configured: false, reason: 'TAVILY_ENABLED is not set to true' };
  if (!apiKey) return { configured: false, reason: 'TAVILY_API_KEY is not configured' };
  return { configured: true };
}

async function tavilyFetch(path, body, timeoutMs) {
  const cfg = getTavilyConfig();
  if (!cfg.configured) return { ok: false, status: 'configuration_pending', message: cfg.reason };

  const apiKey = process.env.TAVILY_API_KEY;
  let response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs || 30000),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError') return { ok: false, status: 'timeout', message: `Tavily request timed out after ${timeoutMs || 30000}ms.` };
    return { ok: false, status: 'network_error', message: 'Could not reach Tavily. Check your connection and retry.' };
  }

  if (!response.ok) {
    const status = response.status;
    if (status === 401 || status === 403) return { ok: false, status: 'auth_error', message: 'Tavily authentication failed. Verify TAVILY_API_KEY.' };
    if (status === 429) return { ok: false, status: 'rate_limited', message: 'Tavily rate limit reached. Retry in a moment.' };
    if (status === 402) return { ok: false, status: 'billing_error', message: 'Tavily billing issue. Check your account credits.' };
    return { ok: false, status: 'provider_error', message: `Tavily returned an error (HTTP ${status}).` };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return { ok: false, status: 'parse_error', message: 'Tavily returned an unexpected response format.' };
  }
  return { ok: true, data };
}

export function createTavilyAdapter() {
  return {
    id: 'tavily',
    displayName: 'Tavily',
    executionType: 'direct-api',

    async healthCheck() {
      const cfg = getTavilyConfig();
      if (!cfg.configured) return { healthy: false, message: cfg.reason };
      // No free no-op health endpoint exists on Tavily's REST API either —
      // same honesty discipline as the Exa adapter: report "configured",
      // never "verified reachable" from a check that never actually ran.
      return { healthy: true, message: 'Configured (key present). Reachability is confirmed on first real search, not by a separate probe call.' };
    },

    async search(query, { numResults = 5, timeoutMs } = {}) {
      const result = await tavilyFetch('/search', {
        query,
        search_depth: 'basic',
        max_results: Math.max(1, Math.min(5, numResults)),
        include_raw_content: false,
      }, timeoutMs);
      if (!result.ok) return result;

      const raw = Array.isArray(result.data?.results) ? result.data.results : [];
      return {
        ok: true,
        usage: { queries: 1 },
        results: raw.map(r => ({
          id: null, // Tavily search results have no stable id — buildNormalizedSource derives one from the canonical URL
          title: r.title,
          url: r.url,
          domain: null,
          publishedAt: r.published_date || null,
          author: null,
          snippet: typeof r.content === 'string' ? r.content.slice(0, 600) : '',
          content: typeof r.content === 'string' ? r.content : '',
          contentType: 'other',
          score: typeof r.score === 'number' ? r.score : null,
        })),
      };
    },

    /**
     * Extracts full content for an already-selected, already-normalized
     * search result — NEVER an arbitrary model-supplied URL, and never a
     * whole-site operation (that's tavily_crawl/tavily_map, deliberately
     * not wired here).
     */
    async fetch(result, { maxCharacters = 4000, timeoutMs } = {}) {
      if (!result?.url) return { ok: false, status: 'invalid_request', message: 'fetch() requires a result url.' };
      const resp = await tavilyFetch('/extract', {
        urls: [result.url],
        extract_depth: 'basic',
      }, timeoutMs);
      if (!resp.ok) return resp;

      const first = Array.isArray(resp.data?.results) ? resp.data.results[0] : null;
      if (!first) {
        const failed = Array.isArray(resp.data?.failed_results) ? resp.data.failed_results[0] : null;
        return { ok: false, status: 'empty_response', message: failed?.error || 'Tavily /extract returned no content for this URL.' };
      }
      return { ok: true, usage: { fetches: 1 }, content: typeof first.raw_content === 'string' ? first.raw_content.slice(0, maxCharacters) : '' };
    },

    normalizeResults(rawResults, { query } = {}) {
      return (rawResults || [])
        .map(r => buildNormalizedSource(r, { provider: 'tavily', query }))
        .filter(Boolean);
    },

    estimate(query, { numResults = 5 } = {}) {
      return { queryCount: 1, resultCount: numResults, provisional: true };
    },

    sanitizeResult(source) {
      return source;
    },
  };
}
