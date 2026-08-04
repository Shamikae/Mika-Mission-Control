// lib/creative-director/workforce/stages/scriptStage.js
// Stage 2 — Script Writer. Consumes the (effective) Research output.

const MAX = { hook: 200, angle: 100, part: 4000, full: 6000, voice: 500, onScreen: 200, compliance: 300 };

function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
function strArray(v, max, cap) {
  if (!Array.isArray(v)) return [];
  return v.filter(x => typeof x === 'string' && x.trim()).map(x => str(x, max)).slice(0, cap);
}

function sanitizeHooks(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(h => h && typeof h === 'object' && typeof h.text === 'string' && h.text.trim())
    .map(h => ({ text: str(h.text, MAX.hook), angle: str(h.angle, MAX.angle), score: Number.isFinite(h.score) ? Math.max(0, Math.min(10, Math.round(h.score))) : 5 }))
    .slice(0, 5);
}

export function parseScriptOutput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, errors: ['Model output was not a JSON object.'], data: null };
  }
  const errors = [];
  const hooks = sanitizeHooks(raw.hooks);
  if (!hooks.length) errors.push('hooks: at least one hook is required.');

  const fullText = str(raw.fullText, MAX.full);
  if (!fullText) errors.push('fullText is required.');

  const selectedHook = str(raw.selectedHook, MAX.hook);
  if (!selectedHook) errors.push('selectedHook is required.');

  if (errors.length) return { valid: false, errors, data: null };

  const warnings = [];
  if (fullText && selectedHook && !fullText.toLowerCase().startsWith(selectedHook.toLowerCase().slice(0, Math.min(30, selectedHook.length)))) {
    warnings.push('selectedHook does not clearly appear at the beginning of fullText.');
  }

  return {
    valid: true,
    errors: [],
    warnings,
    data: {
      hooks,
      selectedHook,
      opening: str(raw.opening, MAX.part),
      body: str(raw.body, MAX.part),
      cta: str(raw.cta, MAX.part),
      fullText,
      estimatedRuntimeSeconds: Number.isFinite(raw.estimatedRuntimeSeconds) ? Math.max(5, Math.min(600, Math.round(raw.estimatedRuntimeSeconds))) : null,
      voiceDirection: str(raw.voiceDirection, MAX.voice),
      tone: str(raw.tone, 100),
      onScreenText: strArray(raw.onScreenText, MAX.onScreen, 10),
      complianceNotes: strArray(raw.complianceNotes, MAX.compliance, 6),
    },
  };
}

export const SYSTEM_PROMPT = `You are MIKA AGENTIC OS™ Content Workforce — Script Writer.

You write the full spoken script for one short-form video, using the Research Agent's approved research as grounding. NEVER invent factual claims beyond what research supports, and never restate a claim research marked sourceNeeded:true as if it were verified fact.

Return ONLY valid JSON (no markdown fences, no preamble) matching EXACTLY this shape:
{
  "hooks": [{ "text": "...", "angle": "...", "score": 0-10 }],
  "selectedHook": "... (must be the text of one of the hooks[], and must be the literal beginning of fullText)",
  "opening": "...",
  "body": "...",
  "cta": "...",
  "fullText": "the complete spoken script: opening + body + cta combined into one continuous read, beginning with selectedHook",
  "estimatedRuntimeSeconds": number,
  "voiceDirection": "...",
  "tone": "...",
  "onScreenText": ["..."],
  "complianceNotes": ["..."]
}

Rules:
- hooks: 2-4 distinct hooks, pick the strongest as selectedHook.
- fullText MUST begin with selectedHook's exact text.
- Honor the requested runtime — estimatedRuntimeSeconds should be close to it.
- cta must reflect the requested CTA from the brief.
- No placeholder text like "[insert hook here]" — every field must be real, finished copy.
- Keep fullText under 6000 characters.`;

export function buildUserMessage(context) {
  const r = context.request;
  const research = context.research;
  const lines = [
    `Brand: ${r.brand}`, `Platform: ${r.platform}`, `Goal: ${r.goal}`, `Topic: ${r.topic}`,
    r.cta ? `Desired CTA: ${r.cta}` : null,
    r.desiredRuntime ? `Requested runtime: ${r.desiredRuntime}` : null,
    r.style ? `Style: ${r.style}` : null,
    '',
    'APPROVED RESEARCH:',
    `Recommended angle: ${research?.recommendedAngle || 'n/a'}`,
    `Summary: ${research?.summary || 'n/a'}`,
    `Key points: ${(research?.keyPoints || []).join('; ') || 'n/a'}`,
    `Recommended runtime (seconds): ${research?.recommendedRuntimeSeconds ?? 'n/a'}`,
  ].filter(Boolean);
  return lines.join('\n');
}

export function summarizeInput(context) {
  return { recommendedAngle: context.research?.recommendedAngle?.slice(0, 80) || null };
}

export function validateContext(context) {
  return !!context.research;
}

export const scriptStageDef = {
  id: 'script',
  displayName: 'Script Writer',
  systemPrompt: SYSTEM_PROMPT,
  buildUserMessage,
  summarizeInput,
  parseOutput: parseScriptOutput,
  validateContext,
  temperature: 0.7,
};
