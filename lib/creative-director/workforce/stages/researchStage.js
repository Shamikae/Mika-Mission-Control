// lib/creative-director/workforce/stages/researchStage.js
// Stage 1 — Research Agent. Model-assisted SYNTHESIS, not live web research.
// No governed search/research adapter exists in this repo to reuse safely,
// so this is honestly labeled researchMode: "model-synthesis" — never claims
// current trends were searched, and any claim needing verification must be
// marked sourceNeeded: true.

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

function sanitizeClaims(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(c => c && typeof c === 'object' && typeof c.text === 'string' && c.text.trim())
    .map(c => ({
      text: str(c.text, MAX.listItem),
      verificationStatus: str(c.verificationStatus, 60) || 'unverified',
      // Honesty rule: default to true (needs a source) unless the model
      // explicitly and correctly says false — we never silently downgrade
      // an unmarked claim to "safe."
      sourceNeeded: c.sourceNeeded !== false,
    }))
    .slice(0, 10);
}

export function parseResearchOutput(raw) {
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
  const claims = sanitizeClaims(raw.claims);
  if (claims.some(c => c.sourceNeeded === undefined)) warnings.push('Some claims did not explicitly mark sourceNeeded — defaulted to true.');

  return {
    valid: true,
    errors: [],
    warnings,
    data: {
      summary,
      researchMode: 'model-synthesis',
      audienceInsights: strArray(raw.audienceInsights),
      contentAngles,
      recommendedAngle,
      keyPoints: strArray(raw.keyPoints),
      claims,
      competitorPatterns: strArray(raw.competitorPatterns),
      platformNotes: strArray(raw.platformNotes),
      risks: strArray(raw.risks),
      recommendedRuntimeSeconds: Number.isFinite(raw.recommendedRuntimeSeconds) ? Math.max(5, Math.min(600, Math.round(raw.recommendedRuntimeSeconds))) : null,
    },
  };
}

export const SYSTEM_PROMPT = `You are MIKA AGENTIC OS™ Content Workforce — Research Agent.

You perform MODEL-ASSISTED SYNTHESIS from your own training knowledge and the brief provided. You do NOT have live web/search access in this system. NEVER claim to have searched the web or checked "current" trends — you have not. Any specific factual claim (statistics, named competitor behavior, platform algorithm specifics) that would need verification against a live source MUST be marked sourceNeeded: true. Do not fabricate citations, sources, or study names.

Given a content brief, return ONLY valid JSON (no markdown fences, no preamble, no explanation outside the JSON) matching EXACTLY this shape:
{
  "summary": "...",
  "researchMode": "model-synthesis",
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
  return lines.join('\n');
}

export function summarizeInput(context) {
  const r = context.request;
  return { brand: r.brand, platform: r.platform, topic: r.topic.slice(0, 80) };
}

export const researchStageDef = {
  id: 'research',
  displayName: 'Research Agent',
  systemPrompt: SYSTEM_PROMPT,
  buildUserMessage,
  summarizeInput,
  parseOutput: parseResearchOutput,
  temperature: 0.6,
};
