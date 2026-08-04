// lib/creative-director/workforce/stages/thumbnailStage.js
// Stage 5 — Thumbnail Designer. Consumes Research + Script + Prompt output.
// Produces a PLAN ONLY — no image is generated in this stage. The existing
// thumbnail/OpenArt workflow (already governed, unchanged by this milestone)
// is what later consumes imagePrompt if/when a human sends it there.

const MAX = { headline: 150, text: 500, prompt: 1000, negPrompt: 400 };

function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
function strArray(v, max, cap) {
  if (!Array.isArray(v)) return [];
  return v.filter(x => typeof x === 'string' && x.trim()).map(x => str(x, max)).slice(0, cap);
}

export function parseThumbnailOutput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, errors: ['Model output was not a JSON object.'], data: null };
  }
  const errors = [];
  const headline = str(raw.headline, MAX.headline);
  if (!headline) errors.push('headline is required.');
  const imagePrompt = str(raw.imagePrompt, MAX.prompt);
  if (!imagePrompt) errors.push('imagePrompt is required.');

  if (errors.length) return { valid: false, errors, data: null };

  return {
    valid: true,
    errors: [],
    warnings: [],
    data: {
      headline,
      alternateHeadlines: strArray(raw.alternateHeadlines, MAX.headline, 4),
      visualBrief: str(raw.visualBrief, MAX.text),
      subject: str(raw.subject, 200),
      background: str(raw.background, 200),
      composition: str(raw.composition, 300),
      emotion: str(raw.emotion, 100),
      contrastStrategy: str(raw.contrastStrategy, 300),
      brandElements: strArray(raw.brandElements, 150, 6),
      imagePrompt,
      negativePrompt: str(raw.negativePrompt, MAX.negPrompt),
      platformSafeAreaNotes: strArray(raw.platformSafeAreaNotes, 200, 4),
      score: Number.isFinite(raw.score) ? Math.max(0, Math.min(10, Math.round(raw.score))) : 5,
    },
  };
}

export const SYSTEM_PROMPT = `You are MIKA AGENTIC OS™ Content Workforce — Thumbnail Designer.

You design the PLAN for a scroll-stopping thumbnail — headline, visual brief, and an image-generation prompt. You do NOT generate the image yourself; that happens later through the existing thumbnail workflow.

Return ONLY valid JSON (no markdown fences, no preamble) matching EXACTLY this shape:
{
  "headline": "under 6 words, punchy",
  "alternateHeadlines": ["..."],
  "visualBrief": "...",
  "subject": "...",
  "background": "...",
  "composition": "...",
  "emotion": "...",
  "contrastStrategy": "...",
  "brandElements": ["..."],
  "imagePrompt": "a concrete, specific AI-image prompt: composition, subject, style, lighting, colors — sent directly to an image generator",
  "negativePrompt": "...",
  "platformSafeAreaNotes": ["..."],
  "score": 0-10
}

Rules:
- headline must work at small size, under 6 words.
- imagePrompt must be visual and concrete, never abstract.
- score is your own honest self-assessment of thumbnail strength.`;

export function buildUserMessage(context) {
  const research = context.research;
  const script = context.script;
  const prompts = context.prompts;
  const lines = [
    `Topic: ${context.request?.topic || ''}`,
    `Recommended angle: ${research?.recommendedAngle || 'n/a'}`,
    `Selected hook: ${script?.selectedHook || 'n/a'}`,
    `Prompt Engineer's thumbnail seed — imagePrompt: ${prompts?.thumbnail?.imagePrompt || 'n/a'}`,
    `Prompt Engineer's thumbnail seed — headline: ${prompts?.thumbnail?.headline || 'n/a'}`,
    `Prompt Engineer's thumbnail seed — composition: ${prompts?.thumbnail?.composition || 'n/a'}`,
  ];
  return lines.join('\n');
}

export function summarizeInput(context) {
  return { seedHeadline: context.prompts?.thumbnail?.headline || null };
}

export function validateContext(context) {
  return !!context.research && !!context.script && !!context.prompts;
}

export const thumbnailStageDef = {
  id: 'thumbnail',
  displayName: 'Thumbnail Designer',
  systemPrompt: SYSTEM_PROMPT,
  buildUserMessage,
  summarizeInput,
  parseOutput: parseThumbnailOutput,
  validateContext,
  temperature: 0.6,
};
