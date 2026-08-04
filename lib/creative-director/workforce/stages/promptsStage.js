// lib/creative-director/workforce/stages/promptsStage.js
// Stage 4 — Prompt Engineer. Consumes (effective) Script + Storyboard.
// PROMPTS ONLY — this stage never calls a provider, never assumes provider
// availability, and never submits anything to HeyGen, HyperFrames, or
// OpenArt. Its output is planning data consumed later by a human or by the
// existing, already-governed Production Router / provider adapters.

const MAX = { text: 800, prompt: 1000, negPrompt: 400, aspect: 20, typography: 300, headline: 150 };

function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
function strArray(v, max, cap) {
  if (!Array.isArray(v)) return [];
  return v.filter(x => typeof x === 'string' && x.trim()).map(x => str(x, max)).slice(0, cap);
}
function bool(v) { return v === true; }

function sanitizeHeygen(raw) {
  return {
    applicable: bool(raw?.applicable),
    avatarDirection: str(raw?.avatarDirection, MAX.text),
    voiceDirection: str(raw?.voiceDirection, MAX.text),
    sceneInstructions: strArray(raw?.sceneInstructions, MAX.text, 12),
    constraints: strArray(raw?.constraints, 300, 8),
  };
}
function sanitizeHyperframes(raw) {
  return {
    applicable: bool(raw?.applicable),
    compositionBrief: str(raw?.compositionBrief, MAX.text),
    animationDirections: strArray(raw?.animationDirections, 300, 12),
    typography: str(raw?.typography, MAX.typography),
    transitions: strArray(raw?.transitions, 200, 12),
    aspectRatio: str(raw?.aspectRatio, MAX.aspect) || '9:16',
  };
}
function sanitizeImagePrompts(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(p => p && typeof p === 'object' && typeof p.prompt === 'string' && p.prompt.trim())
    .map(p => ({
      sceneIndex: Number.isFinite(p.sceneIndex) ? Math.max(0, Math.round(p.sceneIndex)) : 0,
      prompt: str(p.prompt, MAX.prompt),
      negativePrompt: str(p.negativePrompt, MAX.negPrompt),
      aspectRatio: str(p.aspectRatio, MAX.aspect) || '9:16',
    }))
    .slice(0, 20);
}

export function parsePromptsOutput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, errors: ['Model output was not a JSON object.'], data: null };
  }
  const errors = [];
  const productionMode = str(raw.productionMode, 60);
  if (!productionMode) errors.push('productionMode is required.');

  const thumbnail = {
    imagePrompt: str(raw.thumbnail?.imagePrompt, MAX.prompt),
    headline: str(raw.thumbnail?.headline, MAX.headline),
    composition: str(raw.thumbnail?.composition, 300),
    exclusions: strArray(raw.thumbnail?.exclusions, 200, 8),
  };
  if (!thumbnail.imagePrompt) errors.push('thumbnail.imagePrompt is required.');

  if (errors.length) return { valid: false, errors, data: null };

  return {
    valid: true,
    errors: [],
    warnings: [],
    data: {
      productionMode,
      heygen: sanitizeHeygen(raw.heygen),
      hyperframes: sanitizeHyperframes(raw.hyperframes),
      imageGeneration: {
        applicable: bool(raw.imageGeneration?.applicable),
        prompts: sanitizeImagePrompts(raw.imageGeneration?.prompts),
      },
      thumbnail,
    },
  };
}

export const SYSTEM_PROMPT = `You are MIKA AGENTIC OS™ Content Workforce — Prompt Engineer.

You translate an approved script and storyboard into PROMPTS AND PLANNING DATA ONLY for possible downstream production providers (HeyGen avatar video, HyperFrames motion-graphics compositions, AI image generation). You NEVER execute anything, never call a tool, never assume a provider is actually configured or available in this deployment — "applicable: true" only means the content is a plausible fit for that provider type, not that it will run.

Return ONLY valid JSON (no markdown fences, no preamble) matching EXACTLY this shape:
{
  "productionMode": "avatar_video|cinematic_broll|product_demo|faceless_social|talking_head|image_to_video|slideshow|custom",
  "heygen": { "applicable": true|false, "avatarDirection": "...", "voiceDirection": "...", "sceneInstructions": ["..."], "constraints": ["..."] },
  "hyperframes": { "applicable": true|false, "compositionBrief": "...", "animationDirections": ["..."], "typography": "...", "transitions": ["..."], "aspectRatio": "9:16" },
  "imageGeneration": { "applicable": true|false, "prompts": [{ "sceneIndex": 0, "prompt": "...", "negativePrompt": "...", "aspectRatio": "9:16" }] },
  "thumbnail": { "imagePrompt": "...", "headline": "...", "composition": "...", "exclusions": ["..."] }
}

Rules:
- Set applicable:true only for provider types genuinely well-suited to the storyboard's visual style — it is fine and common for only one or two of heygen/hyperframes/imageGeneration to be applicable:true.
- thumbnail.imagePrompt must be concrete and visual (composition, subject, lighting, colors) — it will be used directly as an image-generation prompt later.
- Never write text implying you already generated, submitted, or executed anything.`;

export function buildUserMessage(context) {
  const script = context.script;
  const storyboard = context.storyboard;
  const lines = [
    `Requested avatar/faceless preference: ${context.request?.avatarPreference || 'either'}`,
    '',
    'SCRIPT (fullText):', script?.fullText || '',
    '',
    'STORYBOARD SCENES:',
    ...((storyboard?.scenes || []).map(s => `[${s.index}] ${s.startSeconds}-${s.endSeconds}s | visual: ${s.visual} | narration: ${s.narration}`)),
    '',
    `Visual style: ${storyboard?.visualStyle || 'n/a'}`,
    `Pacing: ${storyboard?.pacing || 'n/a'}`,
  ];
  return lines.join('\n');
}

export function summarizeInput(context) {
  return { sceneCount: (context.storyboard?.scenes || []).length };
}

export function validateContext(context) {
  return !!context.script && !!context.storyboard;
}

export const promptsStageDef = {
  id: 'prompts',
  displayName: 'Prompt Engineer',
  systemPrompt: SYSTEM_PROMPT,
  buildUserMessage,
  summarizeInput,
  parseOutput: parsePromptsOutput,
  validateContext,
  temperature: 0.5,
};
