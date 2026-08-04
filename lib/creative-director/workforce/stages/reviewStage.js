// lib/creative-director/workforce/stages/reviewStage.js
// Stage 7 — Creative Review. Consumes the EFFECTIVE (human-edited) output of
// every prior stage. This stage's own AI approval is NEVER sufficient to
// create a package — approvedForPackageCreation only reflects the AI's
// verdict; a human must still explicitly approve the run (see
// workforceEngine.js / the approve API route) before create-package is ever
// callable.

const MAX = { issue: 400, note: 400 };

function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
function strArray(v, max, cap) {
  if (!Array.isArray(v)) return [];
  return v.filter(x => typeof x === 'string' && x.trim()).map(x => str(x, max)).slice(0, cap);
}

const VERDICTS = ['approved', 'revisions_required', 'rejected'];
const CATEGORY_KEYS = ['brandFit', 'hookStrength', 'clarity', 'platformFit', 'productionReadiness', 'factualSafety', 'ctaStrength'];

function sanitizeCategoryScores(raw) {
  const out = {};
  for (const key of CATEGORY_KEYS) {
    const v = raw?.[key];
    out[key] = Number.isFinite(v) ? Math.max(0, Math.min(10, Math.round(v))) : 5;
  }
  return out;
}

export function parseReviewOutput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, errors: ['Model output was not a JSON object.'], data: null };
  }
  const errors = [];
  const verdict = VERDICTS.includes(raw.verdict) ? raw.verdict : null;
  if (!verdict) errors.push(`verdict must be one of: ${VERDICTS.join(', ')}.`);

  if (errors.length) return { valid: false, errors, data: null };

  const blockingIssues = strArray(raw.blockingIssues, MAX.issue, 12);
  // Governance rule, enforced server-side regardless of what the model
  // claims: approvedForPackageCreation can never be true when there are
  // blocking issues.
  const approvedForPackageCreation = raw.approvedForPackageCreation === true && blockingIssues.length === 0 && verdict === 'approved';

  return {
    valid: true,
    errors: [],
    warnings: [],
    data: {
      verdict,
      overallScore: Number.isFinite(raw.overallScore) ? Math.max(0, Math.min(10, Math.round(raw.overallScore))) : 5,
      categoryScores: sanitizeCategoryScores(raw.categoryScores),
      blockingIssues,
      warnings: strArray(raw.warnings, MAX.note, 12),
      revisionInstructions: strArray(raw.revisionInstructions, MAX.note, 12),
      approvedForPackageCreation,
    },
  };
}

export const SYSTEM_PROMPT = `You are MIKA AGENTIC OS™ Content Workforce — Creative Review.

You are the final AI quality gate before a human decides whether to approve this content package. Review the complete creative package (research, script, storyboard, provider prompts, thumbnail plan, caption package) as a whole. Be honest and specific — this is a real governance checkpoint, not a formality. Your approval alone NEVER creates a package; a human always makes the final call.

Return ONLY valid JSON (no markdown fences, no preamble) matching EXACTLY this shape:
{
  "verdict": "approved|revisions_required|rejected",
  "overallScore": 0-10,
  "categoryScores": { "brandFit": 0-10, "hookStrength": 0-10, "clarity": 0-10, "platformFit": 0-10, "productionReadiness": 0-10, "factualSafety": 0-10, "ctaStrength": 0-10 },
  "blockingIssues": ["specific, concrete blocking problems — empty array if none"],
  "warnings": ["non-blocking concerns"],
  "revisionInstructions": ["specific instructions if revisions_required or rejected"],
  "approvedForPackageCreation": true|false
}

Rules:
- approvedForPackageCreation must be false whenever blockingIssues is non-empty.
- approvedForPackageCreation must be false unless verdict is "approved".
- factualSafety must be scored low if any research claim marked sourceNeeded:true is presented in the script as if verified.
- Be critical — a passable-but-mediocre package should get revisions_required, not approved.`;

export function buildUserMessage(context) {
  const { research, script, storyboard, prompts, thumbnail, caption, request } = context;
  return [
    `ORIGINAL REQUEST: brand=${request.brand} platform=${request.platform} goal=${request.goal} topic=${request.topic} cta=${request.cta || 'n/a'}`,
    '',
    `RESEARCH — recommendedAngle: ${research?.recommendedAngle}`,
    `RESEARCH — claims needing sources: ${(research?.claims || []).filter(c => c.sourceNeeded).map(c => c.text).join(' | ') || 'none'}`,
    '',
    `SCRIPT — fullText: ${script?.fullText}`,
    `SCRIPT — cta: ${script?.cta}`,
    '',
    `STORYBOARD — sceneCount: ${(storyboard?.scenes || []).length}, totalDurationSeconds: ${storyboard?.totalDurationSeconds}`,
    '',
    `PROMPTS — productionMode: ${prompts?.productionMode}`,
    '',
    `THUMBNAIL — headline: ${thumbnail?.headline}, imagePrompt: ${thumbnail?.imagePrompt}`,
    '',
    `CAPTION — primaryCaption: ${caption?.primaryCaption}`,
    `CAPTION — hashtags: ${(caption?.hashtags || []).join(', ')}`,
  ].join('\n');
}

export function summarizeInput() {
  return { reviewedStages: ['research', 'script', 'storyboard', 'prompts', 'thumbnail', 'caption'] };
}

export function validateContext(context) {
  return !!context.research && !!context.script && !!context.storyboard && !!context.prompts && !!context.thumbnail && !!context.caption;
}

export const reviewStageDef = {
  id: 'review',
  displayName: 'Creative Review',
  systemPrompt: SYSTEM_PROMPT,
  buildUserMessage,
  summarizeInput,
  parseOutput: parseReviewOutput,
  validateContext,
  temperature: 0.3,
};
