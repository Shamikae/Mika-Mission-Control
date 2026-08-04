// lib/creative-director/workforce/stages/storyboardStage.js
// Stage 3 — Storyboard Agent. Consumes Research + (effective) Script.

const MAX = { text: 500, onScreen: 200, camera: 80, motion: 80, transition: 80, assetType: 40, providerHint: 60, continuity: 300 };

function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function sanitizeScenes(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(s => s && typeof s === 'object')
    .map((s, i) => ({
      index: Number.isFinite(s.index) ? Math.max(0, Math.round(s.index)) : i,
      startSeconds: Number.isFinite(s.startSeconds) ? Math.max(0, s.startSeconds) : 0,
      endSeconds: Number.isFinite(s.endSeconds) ? Math.max(0, s.endSeconds) : 0,
      narration: str(s.narration, MAX.text),
      visual: str(s.visual, MAX.text),
      onScreenText: str(s.onScreenText, MAX.onScreen),
      camera: str(s.camera, MAX.camera),
      motion: str(s.motion, MAX.motion),
      transition: str(s.transition, MAX.transition),
      assetType: str(s.assetType, MAX.assetType) || 'video',
      // Advisory only — the Storyboard Agent never claims a provider is
      // actually available; Production Router's own provider catalog is the
      // sole source of truth for real availability.
      providerHint: str(s.providerHint, MAX.providerHint) || 'manual-export',
    }))
    .sort((a, b) => a.index - b.index)
    .slice(0, 20);
}

export function parseStoryboardOutput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, errors: ['Model output was not a JSON object.'], data: null };
  }
  const errors = [];
  const scenes = sanitizeScenes(raw.scenes);
  if (!scenes.length) errors.push('scenes: at least one scene is required.');

  const warnings = [];
  for (let i = 1; i < scenes.length; i += 1) {
    if (scenes[i].startSeconds < scenes[i - 1].endSeconds - 0.01) {
      warnings.push(`Scene ${scenes[i].index} overlaps the previous scene — timings were not perfectly sequential.`);
      break;
    }
  }
  if (scenes.some(s => s.endSeconds <= s.startSeconds)) {
    warnings.push('One or more scenes have a non-positive duration.');
  }

  if (errors.length) return { valid: false, errors, data: null };

  const totalDurationSeconds = Number.isFinite(raw.totalDurationSeconds)
    ? Math.max(1, Math.round(raw.totalDurationSeconds))
    : Math.round(scenes.reduce((max, s) => Math.max(max, s.endSeconds), 0));

  return {
    valid: true,
    errors: [],
    warnings,
    data: {
      scenes,
      totalDurationSeconds,
      pacing: str(raw.pacing, 60) || 'medium',
      visualStyle: str(raw.visualStyle, 400),
      continuityNotes: Array.isArray(raw.continuityNotes) ? raw.continuityNotes.filter(x => typeof x === 'string' && x.trim()).map(x => str(x, MAX.continuity)).slice(0, 8) : [],
    },
  };
}

export const SYSTEM_PROMPT = `You are MIKA AGENTIC OS™ Content Workforce — Storyboard Agent.

You break an approved script into a sequential, non-overlapping scene-by-scene shot plan. providerHint is ADVISORY ONLY — you never claim a specific production provider is actually available or will be used; that decision belongs to Production Router.

Return ONLY valid JSON (no markdown fences, no preamble) matching EXACTLY this shape:
{
  "scenes": [{
    "index": 0-based integer,
    "startSeconds": number,
    "endSeconds": number,
    "narration": "the portion of the script spoken during this scene",
    "visual": "...",
    "onScreenText": "...",
    "camera": "...",
    "motion": "...",
    "transition": "...",
    "assetType": "video|image",
    "providerHint": "advisory only, e.g. manual-export, heygen, hyperframes"
  }],
  "totalDurationSeconds": number,
  "pacing": "slow|medium|fast",
  "visualStyle": "...",
  "continuityNotes": ["..."]
}

Rules:
- Scenes must be sequential and non-overlapping (each scene's startSeconds >= the previous scene's endSeconds).
- Scene narration text, concatenated in order, must map to the provided script's fullText.
- totalDurationSeconds must cover the full script runtime.
- 3-12 scenes depending on runtime.`;

export function buildUserMessage(context) {
  const research = context.research;
  const script = context.script;
  const lines = [
    `Recommended runtime (seconds): ${research?.recommendedRuntimeSeconds ?? script?.estimatedRuntimeSeconds ?? 'n/a'}`,
    '',
    'APPROVED SCRIPT (fullText):',
    script?.fullText || '',
    '',
    `Voice direction: ${script?.voiceDirection || 'n/a'}`,
    `Tone: ${script?.tone || 'n/a'}`,
  ];
  return lines.join('\n');
}

export function summarizeInput(context) {
  return { scriptLength: (context.script?.fullText || '').length };
}

export function validateContext(context) {
  return !!context.research && !!context.script;
}

export const storyboardStageDef = {
  id: 'storyboard',
  displayName: 'Storyboard Agent',
  systemPrompt: SYSTEM_PROMPT,
  buildUserMessage,
  summarizeInput,
  parseOutput: parseStoryboardOutput,
  validateContext,
  temperature: 0.6,
};
