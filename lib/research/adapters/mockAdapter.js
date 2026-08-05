// lib/research/adapters/mockAdapter.js
// TEST-ONLY deterministic adapter for the offline validator suite — never
// wired into the provider registry as a real, selectable provider. Mirrors
// lib/creative-director/workforce/workforceModelClient.js's mock-mode
// philosophy: deterministic fixtures flow through the SAME
// normalizeResults()/buildNormalizedSource() sanitization path as a real
// adapter, so the validator exercises real validation logic, not a bypass.

import { buildNormalizedSource } from '../researchAdapterContract.js';

const FIXTURE_RESULTS = [
  { id: 'mock-1', title: 'Mock Primary Source on the Topic', url: 'https://example.com/primary-article', publishedAt: '2026-01-15T00:00:00.000Z', author: 'Mock Author', snippet: 'A mock snippet describing the topic in detail for validator fixtures.', content: 'A longer mock article body describing the topic in detail for validator fixtures, including a specific statistic: 42% of small businesses reported X.', contentType: 'article', score: 0.92 },
  { id: 'mock-2', title: 'Mock Industry Report', url: 'https://industry-example.org/report', publishedAt: '2025-11-01T00:00:00.000Z', author: null, snippet: 'A mock industry snippet.', content: 'A mock industry report body with corroborating figures.', contentType: 'reference', score: 0.81 },
  { id: 'mock-3', title: 'Mock Forum Discussion', url: 'https://forum.example.net/thread/123', publishedAt: null, author: 'anon_user', snippet: 'A mock community discussion snippet.', content: 'A mock forum thread with anecdotal, unverifiable claims.', contentType: 'forum', score: 0.4 },
  // Intentionally unsafe entries — must be rejected by buildNormalizedSource, never persisted.
  { id: 'mock-unsafe-1', title: 'Should be rejected (private IP)', url: 'https://127.0.0.1/internal', snippet: '', content: '', contentType: 'other', score: 0.5 },
  { id: 'mock-unsafe-2', title: 'Should be rejected (non-https)', url: 'http://example.com/insecure', snippet: '', content: '', contentType: 'other', score: 0.5 },
];

export function createMockResearchAdapter() {
  return {
    id: 'mock',
    displayName: 'Mock (validator only)',
    executionType: 'mock',

    async healthCheck() {
      return { healthy: true, message: 'Mock adapter — always healthy, never a real network call.' };
    },

    async search(query, { numResults = 5 } = {}) {
      if (query.includes('__MOCK_RESEARCH_PROVIDER_FAILURE__')) {
        return { ok: false, status: 'provider_error', message: 'Mocked provider failure for validator fallback test.' };
      }
      if (query.includes('__MOCK_RESEARCH_FAIL_FIRST_ATTEMPT_ONLY__')) {
        const key = 'mock-first-attempt';
        globalThis.__mockResearchFirstAttemptSeen = globalThis.__mockResearchFirstAttemptSeen || new Set();
        if (!globalThis.__mockResearchFirstAttemptSeen.has(key)) {
          globalThis.__mockResearchFirstAttemptSeen.add(key);
          return { ok: false, status: 'provider_error', message: 'Mocked first-attempt-only failure for validator retry test.' };
        }
      }
      return { ok: true, usage: { queries: 1 }, results: FIXTURE_RESULTS.slice(0, numResults) };
    },

    async fetch(result) {
      return { ok: true, usage: { fetches: 1 }, content: `Fuller mock content for ${result.id || result.url}. Includes an additional detail not in the snippet.` };
    },

    normalizeResults(rawResults, { query } = {}) {
      return (rawResults || [])
        .map(r => buildNormalizedSource(r, { provider: 'mock', query }))
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
