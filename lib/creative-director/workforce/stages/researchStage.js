// lib/creative-director/workforce/stages/researchStage.js
// Stage 1 — Research Agent. Supports TWO honest modes:
//   researchMode: "model-synthesis" — the original v1 behavior, unchanged.
//     No live web access; any claim needing verification is sourceNeeded:true.
//   researchMode: "live-search" — Phase 5. prepareContext() runs the
//     governed live-research pipeline (lib/research/researchEngine.js)
//     BEFORE the model call, then the model synthesizes FROM the real
//     retrieved sources, producing source-backed claims/evidence. If live
//     search fails, this NEVER silently claims live-search succeeded — it
//     either fails the stage honestly or falls back to model-synthesis
//     (only when CONTENT_RESEARCH_ALLOW_MODEL_FALLBACK=true), and the
//     output's researchMode always reflects what ACTUALLY happened, not
//     what was requested.

import { getResearchConfig } from '../../../research/researchRules.js';
import { getOrCreateResearchRun, runLiveResearch, getKnownSourceIds } from '../../../research/researchEngine.js';
import { sanitizeEvidence, sanitizeClaimSourceIds } from '../../../research/evidenceModel.js';

const MAX = {
  str: 600, listItem: 300, angleTitle: 120,
};
const MAX_LIST = 8;

function str(v, max = MAX.str) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
function strArray(v, max = MAX.listItem, cap = MAX_LIST) {
  if (!Array.isArray(v)) return [];
  return v.filter(x => typeof x === 'string' && x.trim()).map(x => str(x, max)).slice(0, cap);
}

const RISK_LEVELS = ['low', 'medium', 'high'];
const HOOK_POTENTIALS = ['low', 'medium', 'high'];

function sanitizeAngles(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(a => a && typeof a === 'object' && typeof a.title === 'string' && a.title.trim())
    .map(a => ({
      title: str(a.title, MAX.angleTitle),
      angle: str(a.angle, 200),
      hookPotential: HOOK_POTENTIALS.includes(a.hookPotential) ? a.hookPotential : 'medium',
      relevanceScore: Number.isFinite(a.relevanceScore) ? Math.max(0, Math.min(10, Math.round(a.relevanceScore))) : 5,
      riskLevel: RISK_LEVELS.includes(a.riskLevel) ? a.riskLevel : 'low',
    }))
    .slice(0, 6);
}

function sanitizeClaims(raw, knownSourceIds) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(c => c && typeof c === 'object' && typeof c.text === 'string' && c.text.trim())
    .map(c => {
      const sourceIds = knownSourceIds ? sanitizeClaimSourceIds(c.sourceIds, knownSourceIds) : [];
      // Honesty rule: default to true (needs a source) unless the model
      // explicitly and correctly says false — we never silently downgrade
      // an unmarked claim to "safe." Additional live-search safeguard: a
      // model can't claim "no source needed" while citing zero resolved
      // sources — that specific combination is never trusted.
      let sourceNeeded = c.sourceNeeded !== false;
      if (!sourceNeeded && sourceIds.length === 0) sourceNeeded = true;
      return {
        text: str(c.text, MAX.listItem),
        verificationStatus: str(c.verificationStatus, 60) || 'unverified',
        sourceNeeded,
        sourceIds,
      };
    })
    .slice(0, 10);
}

/**
 * @param {object} raw — model output
 * @param {{ knownSourceIds?: Set<string>, requestedLiveSearch?: boolean }} [opts]
 */
export function parseResearchOutput(raw, opts = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, errors: ['Model output was not a JSON object.'], data: null };
  }
  const errors = [];
  const summary = str(raw.summary, 1200);
  if (!summary) errors.push('summary is required.');

  const contentAngles = sanitizeAngles(raw.contentAngles);
  if (!contentAngles.length) errors.push('contentAngles: at least one angle is required.');

  const recommendedAngle = str(raw.recommendedAngle, MAX.angleTitle);
  if (!recommendedAngle) errors.push('recommendedAngle is required.');

  if (errors.length) return { valid: false, errors, data: null };

  const warnings = [];
  const knownSourceIds = opts.knownSourceIds || null;
  const claims = sanitizeClaims(raw.claims, knownSourceIds);
  if (claims.some(c => c.sourceNeeded === undefined)) warnings.push('Some claims did not explicitly mark sourceNeeded — defaulted to true.');

  // researchMode is NEVER trusted from the model — it is set by the caller
  // (prepareContext) based on what ACTUALLY happened, never what was asked.
  const researchMode = opts.actualResearchMode || 'model-synthesis';

  const data = {
    summary,
    researchMode,
    audienceInsights: strArray(raw.audienceInsights),
    contentAngles,
    recommendedAngle,
    keyPoints: strArray(raw.keyPoints),
    claims,
    competitorPatterns: strArray(raw.competitorPatterns),
    platformNotes: strArray(raw.platformNotes),
    risks: strArray(raw.risks),
    recommendedRuntimeSeconds: Number.isFinite(raw.recommendedRuntimeSeconds) ? Math.max(5, Math.min(600, Math.round(raw.recommendedRuntimeSeconds))) : null,
  };

  if (researchMode === 'live-search') {
    const { evidence, warnings: evidenceWarnings } = sanitizeEvidence(raw.evidence, knownSourceIds || new Set());
    warnings.push(...evidenceWarnings);
    data.sourceSummary = opts.sourceSummary || null;
    data.sourceIds = Array.isArray(raw.sourceIds) ? sanitizeClaimSourceIds(raw.sourceIds, knownSourceIds || new Set()) : [];
    data.evidence = evidence;
    data.unresolvedClaims = strArray(raw.unresolvedClaims, MAX.listItem, 10);
  } else {
    // model-synthesis: these fields are honestly empty — never fabricated.
    data.sourceSummary = null;
    data.sourceIds = [];
    data.evidence = [];
    data.unresolvedClaims = [];
  }

  return { valid: true, errors: [], warnings, data };
}

const MODEL_SYNTHESIS_SYSTEM_PROMPT = `You are MIKA AGENTIC OS™ Content Workforce — Research Agent.

You perform MODEL-ASSISTED SYNTHESIS from your own training knowledge and the brief provided. You do NOT have live web/search access in this system. NEVER claim to have searched the web or checked "current" trends — you have not. Any specific factual claim (statistics, named competitor behavior, platform algorithm specifics) that would need verification against a live source MUST be marked sourceNeeded: true. Do not fabricate citations, sources, or study names.

Given a content brief, return ONLY valid JSON (no markdown fences, no preamble, no explanation outside the JSON) matching EXACTLY this shape:
{
  "summary": "...",
  "audienceInsights": ["..."],
  "contentAngles": [{ "title": "...", "angle": "...", "hookPotential": "low|medium|high", "relevanceScore": 0-10, "riskLevel": "low|medium|high" }],
  "recommendedAngle": "... (must match one contentAngles[].title)",
  "keyPoints": ["..."],
  "claims": [{ "text": "...", "verificationStatus": "unverified|general_knowledge", "sourceNeeded": true|false }],
  "competitorPatterns": ["..."],
  "platformNotes": ["..."],
  "risks": ["..."],
  "recommendedRuntimeSeconds": 15-180
}

Rules:
- contentAngles: 2-6 distinct angles.
- Mark sourceNeeded: true for anything you are not certain is stable general knowledge.
- Be specific and concrete, not generic filler.`;

const LIVE_SEARCH_SYSTEM_PROMPT = `You are MIKA AGENTIC OS™ Content Workforce — Research Agent, in LIVE-SEARCH mode.

You have been given REAL, retrieved web sources below (title, url, domain, snippet/content) for this topic. Ground your synthesis in these sources. For every factual claim you make that these sources support, cite the supporting source(s) by their exact "id" field in claims[].sourceIds and/or evidence[].sourceIds. NEVER invent a source id that was not given to you. If the sources do not adequately support a claim, mark sourceNeeded: true and leave sourceIds empty — do not stretch a source to cover a claim it doesn't support. If sources disagree, note the disagreement in evidence[] with verificationStatus "conflicting" rather than picking a side silently.

Given the content brief and retrieved sources, return ONLY valid JSON (no markdown fences, no preamble) matching EXACTLY this shape:
{
  "summary": "...",
  "audienceInsights": ["..."],
  "contentAngles": [{ "title": "...", "angle": "...", "hookPotential": "low|medium|high", "relevanceScore": 0-10, "riskLevel": "low|medium|high" }],
  "recommendedAngle": "...",
  "keyPoints": ["..."],
  "claims": [{ "text": "...", "verificationStatus": "supported|unverified|general_knowledge", "sourceNeeded": true|false, "sourceIds": ["..."] }],
  "competitorPatterns": ["..."],
  "platformNotes": ["..."],
  "risks": ["..."],
  "recommendedRuntimeSeconds": 15-180,
  "sourceIds": ["... every source id you actually drew on, across the whole research"],
  "evidence": [{ "claim": "...", "sourceIds": ["..."], "evidenceType": "statistic|expert_opinion|trend|anecdotal|consensus|other", "confidence": "high|medium|low", "verificationStatus": "supported|partially_supported|conflicting|unsupported|needs_verification", "notes": "..." }],
  "unresolvedClaims": ["claims you could not find source support for, worth flagging to the human"]
}

Rules:
- Only use source ids that were actually provided to you.
- contentAngles: 2-6 distinct angles.
- Be specific and concrete, not generic filler.`;

export function buildUserMessage(context) {
  const r = context.request;
  const lines = [
    `Brand: ${r.brand}`,
    `Platform: ${r.platform}`,
    `Goal: ${r.goal}`,
    `Topic: ${r.topic}`,
  ];
  if (r.targetAudience) lines.push(`Target audience: ${r.targetAudience}`);
  if (r.style) lines.push(`Style: ${r.style}`);
  if (r.cta) lines.push(`Desired CTA: ${r.cta}`);
  if (r.desiredRuntime) lines.push(`Requested runtime: ${r.desiredRuntime}`);
  lines.push(`Avatar/faceless preference: ${r.avatarPreference || 'either'}`);

  if (context.liveResearch?.sources?.length) {
    lines.push('', 'RETRIEVED SOURCES:');
    for (const s of context.liveResearch.sources) {
      lines.push(`[id: ${s.id}] "${s.title}" — ${s.domain} (${s.publishedAt || 'undated'}, ${s.classification})`);
      lines.push(`  ${(s.content || s.snippet || '').slice(0, 800)}`);
    }
  }
  return lines.join('\n');
}

export function summarizeInput(context) {
  const r = context.request;
  return { brand: r.brand, platform: r.platform, topic: r.topic.slice(0, 80) };
}

/**
 * Runs BEFORE the model call. Determines the actual research mode from
 * context.researchOptions.requestedMode, and — only when live-search was
 * requested — runs the governed live-research pipeline first. Honestly
 * reports what actually happened via context.liveResearch.actualMode; the
 * model's own claimed researchMode is never trusted (see parseResearchOutput).
 */
export async function prepareContext(context) {
  const requestedMode = context.researchOptions?.requestedMode;
  if (requestedMode !== 'live-search') {
    return { context: { ...context, liveResearch: { actualMode: 'model-synthesis' } } };
  }

  const cfg = getResearchConfig();
  const { run } = getOrCreateResearchRun(context.researchOptions.workforceRunId, context.request.id);
  const completedRun = await runLiveResearch(run.id, context.request, { overrideBudget: context.researchOptions.overrideBudget === true });

  if (completedRun.status === 'ready') {
    return {
      context: {
        ...context,
        liveResearch: {
          actualMode: 'live-search',
          researchRunId: completedRun.id,
          sources: completedRun.sources,
          sourceSummary: {
            provider: completedRun.provider,
            queryCount: completedRun.usage?.queries || 0,
            sourceCount: completedRun.sources.length,
            retrievedAt: completedRun.completedAt,
          },
        },
      },
      warnings: completedRun.warnings || [],
    };
  }

  // live search failed — honest fallback governance
  const failureNote = `Live research failed (${completedRun.errorReason}): ${completedRun.error}`;
  if (!cfg.allowModelFallback) {
    return { error: { errorReason: completedRun.errorReason || 'live_research_failed', error: failureNote } };
  }
  return {
    context: { ...context, liveResearch: { actualMode: 'model-synthesis', researchRunId: completedRun.id } },
    warnings: [`${failureNote} — fell back to model-synthesis (CONTENT_RESEARCH_ALLOW_MODEL_FALLBACK=true).`],
  };
}

function actualModeFor(context) {
  return context?.liveResearch?.actualMode || 'model-synthesis';
}

/**
 * The system prompt varies by what prepareContext() actually accomplished
 * (never by what was merely requested) — live-search mode gets the sources-
 * grounded prompt only when real sources are actually present in context.
 */
function systemPromptFor(context) {
  return actualModeFor(context) === 'live-search' ? LIVE_SEARCH_SYSTEM_PROMPT : MODEL_SYNTHESIS_SYSTEM_PROMPT;
}

export const researchStageDef = {
  id: 'research',
  displayName: 'Research Agent',
  systemPrompt: systemPromptFor,
  buildUserMessage,
  summarizeInput,
  prepareContext,
  parseOutput(raw, context) {
    const mode = actualModeFor(context);
    return parseResearchOutput(raw, {
      actualResearchMode: mode,
      knownSourceIds: mode === 'live-search' ? getKnownSourceIds({ sources: context?.liveResearch?.sources || [] }) : null,
      sourceSummary: context?.liveResearch?.sourceSummary || null,
    });
  },
  temperature: 0.6,
};
