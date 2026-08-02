// lib/content/contentPackageSchema.js
// Pure functions — no I/O. Validates and normalizes structured content
// package data, both from raw model synthesis output and from user edits.
// Never trusts model JSON blindly — every field is type-checked, length-
// clamped, and shape-corrected before it enters the package store.

const MAX = {
  hookText:    200,
  hookAngle:   100,
  scriptPart:  4000,
  scriptFull:  6000,
  sceneVisual: 500,
  sceneVO:     500,
  sceneText:   200,
  caption:     2200,
  cta:         300,
  hashtag:     40,
  keyword:     60,
  headline:    150,
  visualBrief: 1000,
};

const MAX_HOOKS  = 5;
const MAX_SCENES = 20;
const MAX_TAGS   = 30;

export const PACKAGE_STATUSES = ['draft', 'needs_review', 'approved', 'rejected'];

function str(v, max) {
  if (typeof v !== 'string') return '';
  const t = v.trim();
  return Number.isFinite(max) ? t.slice(0, max) : t;
}

function sanitizeHooks(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(h => h && typeof h === 'object' && typeof h.text === 'string' && h.text.trim())
    .map(h => ({ text: str(h.text, MAX.hookText), angle: str(h.angle, MAX.hookAngle) }))
    .slice(0, MAX_HOOKS);
}

function sanitizeScript(raw) {
  const script = {
    opening:  str(raw?.opening, MAX.scriptPart),
    body:     str(raw?.body, MAX.scriptPart),
    cta:      str(raw?.cta, MAX.scriptPart),
    fullText: str(raw?.fullText, MAX.scriptFull),
  };
  if (!script.fullText) {
    const derived = [script.opening, script.body, script.cta].filter(Boolean).join('\n\n');
    if (derived) script.fullText = derived.slice(0, MAX.scriptFull);
  }
  return script;
}

function sanitizeScenes(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(s => s && typeof s === 'object')
    .map((s, i) => ({
      order:           Number.isFinite(s.order) ? Math.max(1, Math.round(s.order)) : i + 1,
      durationSeconds: Number.isFinite(s.durationSeconds) ? Math.max(1, Math.min(120, Math.round(s.durationSeconds))) : null,
      visual:          str(s.visual, MAX.sceneVisual),
      voiceover:       str(s.voiceover, MAX.sceneVO),
      onScreenText:    str(s.onScreenText, MAX.sceneText),
    }))
    .slice(0, MAX_SCENES);
}

function sanitizeTagArray(raw, itemMax) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(t => typeof t === 'string' && t.trim())
    .map(t => t.trim().replace(/^#/, '').slice(0, itemMax))
    .slice(0, MAX_TAGS);
}

function sanitizeThumbnailFields(raw) {
  return {
    headline:    str(raw?.headline, MAX.headline),
    visualBrief: str(raw?.visualBrief, MAX.visualBrief),
  };
}

/**
 * Validates and normalizes raw model synthesis output (already JSON-parsed).
 * Rejects malformed output rather than guessing — hooks and a full script
 * are the required written sections; everything else degrades gracefully
 * to empty/safe defaults so a package is never silently half-built.
 *
 * @returns {{ valid: boolean, errors: string[], data: object|null }}
 */
export function parseSynthesisOutput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, errors: ['Model output was not a JSON object.'], data: null };
  }

  const errors = [];
  const hooks  = sanitizeHooks(raw.hooks);
  if (!hooks.length) errors.push('hooks: at least one hook with non-empty text is required.');

  const script = sanitizeScript(raw.script);
  if (!script.fullText) errors.push('script.fullText: a non-empty full script is required.');

  if (errors.length) return { valid: false, errors, data: null };

  return {
    valid: true,
    errors: [],
    data: {
      hooks,
      script,
      scenes:    sanitizeScenes(raw.scenes),
      caption:   str(raw.caption, MAX.caption),
      cta:       str(raw.cta, MAX.cta),
      hashtags:  sanitizeTagArray(raw.hashtags, MAX.hashtag),
      keywords:  sanitizeTagArray(raw.keywords, MAX.keyword),
      thumbnail: sanitizeThumbnailFields(raw.thumbnail),
    },
  };
}

/**
 * Builds the full, persisted content package object from validated
 * synthesis data plus request/context fields. Thumbnail starts
 * 'not_requested' — the thumbnail pipeline populates it separately so a
 * thumbnail failure can never affect the written package.
 */
export function buildContentPackage({
  id, brand, platform, goal, topic, audience, offer, tone, videoDuration,
  ctaInput, instructions, synthesized, model, provider,
}) {
  const now = new Date().toISOString();
  return {
    id,
    status: 'draft',
    brand:    str(brand, 200),
    platform: str(platform, 100),
    goal:     str(goal, 100),
    topic:    str(topic, 500),
    audience: str(audience, 300),
    offer:    str(offer, 300),
    tone:     str(tone, 100),
    videoDuration: str(videoDuration, 50),
    hooks:    synthesized.hooks,
    script:   synthesized.script,
    scenes:   synthesized.scenes,
    caption:  synthesized.caption,
    cta:      synthesized.cta || str(ctaInput, MAX.cta),
    hashtags: synthesized.hashtags,
    keywords: synthesized.keywords,
    thumbnail: {
      headline:    synthesized.thumbnail.headline,
      visualBrief: synthesized.thumbnail.visualBrief,
      artifactId:  null,
      artifactUrl: null,
      status:      'not_requested',
      error:       null,
    },
    metadata: {
      workflowId:    id,
      model:         model || null,
      provider:      provider || 'openrouter',
      createdAt:     now,
      updatedAt:     now,
      estimatedCost: null,
      actualCost:    null,
      instructions:  str(instructions, 2000),
    },
  };
}

/**
 * Sanitizes a user-submitted edit patch — only whitelisted, editable fields
 * pass through, each re-validated with the same rules as synthesis output.
 * Status transitions are handled separately (not part of a content edit).
 */
export function sanitizeEditPatch(patch) {
  if (!patch || typeof patch !== 'object') return {};
  const out = {};

  if (patch.hooks !== undefined)    out.hooks    = sanitizeHooks(patch.hooks);
  if (patch.script !== undefined)   out.script   = sanitizeScript(patch.script);
  if (patch.scenes !== undefined)   out.scenes   = sanitizeScenes(patch.scenes);
  if (patch.caption !== undefined)  out.caption  = str(patch.caption, MAX.caption);
  if (patch.cta !== undefined)      out.cta      = str(patch.cta, MAX.cta);
  if (patch.hashtags !== undefined) out.hashtags = sanitizeTagArray(patch.hashtags, MAX.hashtag);
  if (patch.keywords !== undefined) out.keywords = sanitizeTagArray(patch.keywords, MAX.keyword);

  if (patch.thumbnail && typeof patch.thumbnail === 'object') {
    const t = {};
    if (patch.thumbnail.headline !== undefined)    t.headline    = str(patch.thumbnail.headline, MAX.headline);
    if (patch.thumbnail.visualBrief !== undefined) t.visualBrief = str(patch.thumbnail.visualBrief, MAX.visualBrief);
    if (Object.keys(t).length) out.thumbnail = t;
  }

  return out;
}
