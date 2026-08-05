// lib/research/researchAdapterContract.js
// Pure functions — no I/O. The ONE shared shape every research provider
// adapter (Exa, Tavily, Brave Search, ...) must implement, plus the shared
// normalization/sanitization every adapter's raw results are forced through
// before anything is persisted. Never trusts a provider's raw JSON blindly.

import { isSafeWebUrl, stripTrackingParams, canonicalUrlKey, extractDomain } from './urlSafety.js';

const MAX = {
  title: 300, snippet: 600, content: 4000, author: 150, domain: 200,
};

function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/**
 * Every adapter's search()/fetch() raw results must be passed through this
 * before being returned to the research engine. Rejects (returns null for)
 * anything that fails URL safety — never silently "fixes" an unsafe URL.
 *
 * @returns {object|null} a NormalizedSource, or null if the raw result must be discarded
 */
export function buildNormalizedSource(raw, { provider, query }) {
  if (!raw || typeof raw !== 'object') return null;
  const rawUrl = typeof raw.url === 'string' ? raw.url : '';
  const safety = isSafeWebUrl(rawUrl);
  if (!safety.safe) return null;

  const cleanUrl = stripTrackingParams(rawUrl);
  const title = str(raw.title, MAX.title);
  if (!title) return null;

  return {
    id: raw.id && typeof raw.id === 'string' ? raw.id.slice(0, 100) : canonicalUrlKey(cleanUrl),
    title,
    url: cleanUrl,
    domain: str(raw.domain || extractDomain(cleanUrl), MAX.domain),
    publishedAt: typeof raw.publishedAt === 'string' ? raw.publishedAt.slice(0, 40) : null,
    author: str(raw.author, MAX.author) || null,
    snippet: str(raw.snippet, MAX.snippet),
    content: str(raw.content, MAX.content),
    contentType: ['article', 'reference', 'forum', 'social', 'documentation', 'other'].includes(raw.contentType) ? raw.contentType : 'other',
    score: Number.isFinite(raw.score) ? Math.max(0, Math.min(1, raw.score)) : null,
    retrievedAt: new Date().toISOString(),
    provider,
    query: str(query, 300),
  };
}

/**
 * Defines the shared contract shape (documentation + a light runtime check
 * used by the provider registry to confirm an adapter implements every
 * required member before it is ever marked executable).
 */
export const RESEARCH_ADAPTER_CONTRACT_METHODS = ['healthCheck', 'search', 'fetch', 'normalizeResults', 'estimate', 'sanitizeResult'];

export function implementsResearchAdapterContract(adapter) {
  if (!adapter || typeof adapter !== 'object') return false;
  return RESEARCH_ADAPTER_CONTRACT_METHODS.every(m => typeof adapter[m] === 'function')
    && typeof adapter.id === 'string' && typeof adapter.displayName === 'string' && typeof adapter.executionType === 'string';
}

export function canonicalDedupeKey(source) {
  return canonicalUrlKey(source.url);
}
