// lib/research/evidenceModel.js
// Pure functions — no I/O. Validates and sanitizes the Research Agent's
// model-produced evidence[] array against the ACTUALLY retrieved source
// list — the model never gets to invent a sourceId. Every sourceId that
// doesn't resolve to a real, stored normalized source is stripped, and if
// that empties a claim's sourceIds entirely its verificationStatus is
// forced to "needs_verification" (never left claiming support it doesn't
// have).

import { VERIFICATION_STATUSES, CONFIDENCE_LEVELS } from './researchRules.js';

const MAX = { claim: 400, notes: 400 };
const EVIDENCE_TYPES = ['statistic', 'expert_opinion', 'trend', 'anecdotal', 'consensus', 'other'];

function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/**
 * @param {Array} raw — model-produced evidence array
 * @param {Set<string>} knownSourceIds — ids of sources actually retrieved this run
 * @returns {{ evidence: object[], warnings: string[] }}
 */
export function sanitizeEvidence(raw, knownSourceIds) {
  if (!Array.isArray(raw)) return { evidence: [], warnings: [] };
  const warnings = [];
  const evidence = raw
    .filter(e => e && typeof e === 'object' && typeof e.claim === 'string' && e.claim.trim())
    .slice(0, 20)
    .map((e, i) => {
      const requestedIds = Array.isArray(e.sourceIds) ? e.sourceIds : [];
      const resolvedIds = requestedIds.filter(id => typeof id === 'string' && knownSourceIds.has(id));
      if (requestedIds.length && resolvedIds.length < requestedIds.length) {
        warnings.push(`Evidence item ${i}: ${requestedIds.length - resolvedIds.length} sourceId(s) did not resolve to a retrieved source and were dropped.`);
      }

      let verificationStatus = VERIFICATION_STATUSES.includes(e.verificationStatus) ? e.verificationStatus : 'needs_verification';
      if (!resolvedIds.length && verificationStatus === 'supported') {
        verificationStatus = 'needs_verification';
        warnings.push(`Evidence item ${i}: verificationStatus downgraded to needs_verification — no resolvable sourceIds.`);
      }

      return {
        id: `ev-${i}`,
        claim: str(e.claim, MAX.claim),
        sourceIds: resolvedIds,
        evidenceType: EVIDENCE_TYPES.includes(e.evidenceType) ? e.evidenceType : 'other',
        confidence: CONFIDENCE_LEVELS.includes(e.confidence) ? e.confidence : 'low',
        verificationStatus,
        notes: str(e.notes, MAX.notes),
      };
    });
  return { evidence, warnings };
}

/**
 * Cross-checks claims[].sourceIds (a Research Agent output field distinct
 * from evidence[]) against the known source set the same way.
 */
export function sanitizeClaimSourceIds(sourceIds, knownSourceIds) {
  if (!Array.isArray(sourceIds)) return [];
  return sourceIds.filter(id => typeof id === 'string' && knownSourceIds.has(id)).slice(0, 10);
}
