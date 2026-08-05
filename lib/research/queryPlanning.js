// lib/research/queryPlanning.js
// Pure functions — no I/O, no fs, no network. Deterministic query planning:
// the SAME request fields always produce the SAME query plan — no AI call
// involved, mirrors the deterministic-keyword-scoring philosophy already
// established in lib/production/productionRules.js's recommendProductionMode().

import { getResearchConfig } from './researchRules.js';

const QUERY_TYPES = [
  'topic_fundamentals', 'current_developments', 'audience_pain_points',
  'platform_content_patterns', 'statistics_and_facts', 'competing_angles',
];

function currentDateLabel(now) {
  return now.toISOString().slice(0, 10);
}

/**
 * @param {object} request — { brand, platform, goal, topic, targetAudience, cta, desiredRuntime }
 * @param {Date} [now]
 * @returns {{ queries: Array<{ id, purpose, query, freshness, resultLimit, allowedDomains, excludedDomains }> }}
 */
export function buildQueryPlan(request, now = new Date()) {
  const cfg = getResearchConfig();
  const dateLabel = currentDateLabel(now);
  const topic = (request.topic || '').trim();
  const audience = (request.targetAudience || '').trim();
  const platform = (request.platform || '').trim();

  const candidates = [
    {
      id: 'q-topic-fundamentals',
      type: 'topic_fundamentals',
      purpose: 'Establish baseline factual understanding of the topic.',
      query: topic,
      freshness: 'any',
    },
    {
      id: 'q-current-developments',
      type: 'current_developments',
      purpose: 'Surface recent developments or trends related to the topic.',
      query: `${topic} latest developments trends ${dateLabel.slice(0, 4)}`,
      freshness: 'recent',
    },
    audience ? {
      id: 'q-audience-pain-points',
      type: 'audience_pain_points',
      purpose: 'Understand the target audience\'s pain points relevant to the topic.',
      query: `${audience} pain points challenges ${topic}`,
      freshness: 'any',
    } : null,
    platform ? {
      id: 'q-platform-patterns',
      type: 'platform_content_patterns',
      purpose: `Understand successful ${platform} content patterns for this topic.`,
      query: `${topic} ${platform} content examples what works`,
      freshness: 'recent',
    } : null,
    {
      id: 'q-statistics',
      type: 'statistics_and_facts',
      purpose: 'Find statistics or factual claims that can ground the script.',
      query: `${topic} statistics data facts`,
      freshness: 'any',
    },
    {
      id: 'q-competing-angles',
      type: 'competing_angles',
      purpose: 'See how competitors or other creators frame this topic.',
      query: `${topic} content ideas angles examples`,
      freshness: 'any',
    },
  ].filter(Boolean);

  const queries = candidates.slice(0, cfg.maxQueries).map(c => ({
    id: c.id,
    purpose: c.purpose,
    query: c.query.trim().slice(0, 400),
    freshness: c.freshness,
    resultLimit: cfg.maxResultsPerQuery,
    allowedDomains: [],
    excludedDomains: [],
  }));

  return { queries };
}

export const QUERY_TYPE_IDS = QUERY_TYPES;
