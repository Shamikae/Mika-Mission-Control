// lib/research/sourceQuality.js
// Pure functions — no I/O. Deterministic source scoring/classification.
// IMPORTANT: this score is a heuristic signal for triage and ranking, never
// a proof of truth — sources are evidence, not trusted truth (see the
// Research Agent's own system prompt, which repeats this same caveat).

const AUTHORITATIVE_TLDS = /\.(gov|edu)$/i;
const REFERENCE_DOMAINS = /\b(wikipedia\.org|reuters\.com|apnews\.com|bloomberg\.com|nature\.com|nih\.gov|who\.int)\b/i;
const COMMERCIAL_SIGNALS = /\b(shop|store|buy|pricing|checkout)\b/i;
const COMMUNITY_DOMAINS = /\b(reddit\.com|forum\.|community\.|quora\.com|stackexchange\.com|stackoverflow\.com)\b/i;

/**
 * @param {object} source — a NormalizedSource
 * @returns {'primary'|'authoritative-secondary'|'industry-source'|'community-source'|'commercial'|'unknown'}
 */
export function classifySource(source) {
  const domain = (source.domain || '').toLowerCase();
  const contentType = source.contentType;

  if (AUTHORITATIVE_TLDS.test(domain) || REFERENCE_DOMAINS.test(domain)) return 'authoritative-secondary';
  if (contentType === 'forum' || COMMUNITY_DOMAINS.test(domain)) return 'community-source';
  if (COMMERCIAL_SIGNALS.test(domain) || contentType === 'documentation' && COMMERCIAL_SIGNALS.test(domain)) return 'commercial';
  if (contentType === 'reference') return 'industry-source';
  if (!source.author && !source.publishedAt) return 'unknown';
  return 'industry-source';
}

/**
 * Deterministic 0-100 relevance/quality score from available signals —
 * recency, primary-source-ness, presence of a publish date/author,
 * corroboration is scored separately (dedupe count), provider's own
 * relevance score is blended in when present.
 */
export function scoreSource(source, { now = new Date(), corroborationCount = 1 } = {}) {
  let score = 40;

  const classification = classifySource(source);
  const classificationBonus = { 'authoritative-secondary': 25, 'industry-source': 12, 'community-source': -5, commercial: -10, primary: 30, unknown: -10 };
  score += classificationBonus[classification] ?? 0;

  if (source.publishedAt) {
    const ageMs = now.getTime() - new Date(source.publishedAt).getTime();
    const ageDays = Number.isFinite(ageMs) ? ageMs / 86400000 : null;
    if (ageDays !== null) {
      if (ageDays < 90) score += 15;
      else if (ageDays < 365) score += 8;
      else if (ageDays < 365 * 3) score += 2;
    }
  } else {
    score -= 5; // no publish date available — mild penalty, not disqualifying
  }

  if (source.author) score += 5;
  if (typeof source.score === 'number') score += Math.round(source.score * 15);
  score += Math.min(15, (corroborationCount - 1) * 7);

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Deduplicates sources by canonical URL key, keeping the highest-scored
 * instance and recording how many raw hits corroborated it.
 */
export function dedupeAndScoreSources(sources, { now = new Date(), dedupeKeyFn } = {}) {
  const groups = new Map();
  for (const s of sources) {
    const key = dedupeKeyFn ? dedupeKeyFn(s) : s.url;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  return [...groups.values()].map(group => {
    const best = group[0];
    const classification = classifySource(best);
    const score = scoreSource(best, { now, corroborationCount: group.length });
    return { ...best, classification, qualityScore: score, corroborationCount: group.length };
  });
}
