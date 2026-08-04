// lib/creative-director/workforce/stages/captionStage.js
// Stage 6 — Caption Writer. Consumes the complete creative context.
// Platform char limits mirror lib/publishing/publishingRules.js's
// PLATFORM_CATALOG.captionMaxChars exactly, so a caption written here is
// already Publishing Router-compatible — never auto-publishes anything.

const MAX = { caption: 2200, cta: 300, hashtag: 40, keyword: 60, comment: 500 };

// Same numbers as PLATFORM_CATALOG in lib/publishing/publishingRules.js.
const PLATFORM_VARIANT_LIMITS = {
  tiktok: 2200, instagram: 2200, youtubeShorts: 5000, linkedin: 3000, pinterest: 500, x: 280,
};

function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
function strArray(v, max, cap) {
  if (!Array.isArray(v)) return [];
  return v.filter(x => typeof x === 'string' && x.trim()).map(x => str(x, max)).slice(0, cap);
}
function sanitizeHashtags(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const t of raw) {
    if (typeof t !== 'string' || !t.trim()) continue;
    const clean = t.trim().replace(/^#/, '').slice(0, MAX.hashtag).toLowerCase();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= 30) break;
  }
  return out;
}

function platformKeyFor(platform) {
  const p = (platform || '').toLowerCase();
  if (/tiktok/.test(p)) return 'tiktok';
  if (/instagram/.test(p)) return 'instagram';
  if (/youtube/.test(p)) return 'youtubeShorts';
  if (/linkedin/.test(p)) return 'linkedin';
  if (/pinterest/.test(p)) return 'pinterest';
  if (/twitter|\bx\b/.test(p)) return 'x';
  return null;
}

export function parseCaptionOutput(raw, { requestPlatform } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, errors: ['Model output was not a JSON object.'], data: null };
  }
  const errors = [];
  const primaryCaption = str(raw.primaryCaption, MAX.caption);
  if (!primaryCaption) errors.push('primaryCaption is required.');

  const variantsRaw = raw.platformVariants && typeof raw.platformVariants === 'object' ? raw.platformVariants : {};
  const platformVariants = {};
  for (const key of Object.keys(PLATFORM_VARIANT_LIMITS)) {
    platformVariants[key] = str(variantsRaw[key], PLATFORM_VARIANT_LIMITS[key]);
  }

  const requestKey = platformKeyFor(requestPlatform);
  const warnings = [];
  if (requestKey && !platformVariants[requestKey]) {
    // Fall back to the primary caption for the requested platform if the
    // model omitted that specific variant, rather than failing the stage.
    platformVariants[requestKey] = primaryCaption.slice(0, PLATFORM_VARIANT_LIMITS[requestKey]);
    warnings.push(`Model omitted the platformVariants.${requestKey} entry for the requested platform — used primaryCaption as a fallback.`);
  }

  if (errors.length) return { valid: false, errors, data: null };

  return {
    valid: true,
    errors: [],
    warnings,
    data: {
      primaryCaption,
      alternateCaptions: strArray(raw.alternateCaptions, MAX.caption, 3),
      cta: str(raw.cta, MAX.cta),
      hashtags: sanitizeHashtags(raw.hashtags),
      keywords: strArray(raw.keywords, MAX.keyword, 10),
      firstComment: str(raw.firstComment, MAX.comment),
      platformVariants,
      complianceNotes: strArray(raw.complianceNotes, 300, 6),
    },
  };
}

export const SYSTEM_PROMPT = `You are MIKA AGENTIC OS™ Content Workforce — Caption Writer.

You write the social caption package for one short-form video, using the complete creative context (research, script, storyboard, prompts, thumbnail plan). You NEVER publish anything — you only write copy.

Return ONLY valid JSON (no markdown fences, no preamble) matching EXACTLY this shape:
{
  "primaryCaption": "...",
  "alternateCaptions": ["..."],
  "cta": "...",
  "hashtags": ["... no # symbol, no duplicates"],
  "keywords": ["..."],
  "firstComment": "...",
  "platformVariants": { "tiktok": "...", "instagram": "...", "youtubeShorts": "...", "linkedin": "...", "pinterest": "...", "x": "..." },
  "complianceNotes": ["..."]
}

Rules:
- Respect these exact character limits per platform variant: tiktok 2200, instagram 2200, youtubeShorts 5000, linkedin 3000, pinterest 500, x 280.
- hashtags: 5-15 tags, no "#" symbol, no duplicates.
- The platformVariants entry matching the request's actual platform must be filled in and must match the tone/CTA of primaryCaption.
- Fill in all six platformVariants even if the request platform is only one of them — this is a governed multi-platform caption package.`;

export function buildUserMessage(context) {
  const research = context.research;
  const script = context.script;
  const storyboard = context.storyboard;
  const thumbnail = context.thumbnail;
  const r = context.request;
  const lines = [
    `Platform (primary target): ${r.platform}`,
    `Desired CTA: ${r.cta || 'n/a'}`,
    '',
    `Script fullText: ${script?.fullText || ''}`,
    `Selected hook: ${script?.selectedHook || ''}`,
    `Recommended angle: ${research?.recommendedAngle || ''}`,
    `Visual style: ${storyboard?.visualStyle || ''}`,
    `Thumbnail headline: ${thumbnail?.headline || ''}`,
  ];
  return lines.join('\n');
}

export function summarizeInput(context) {
  return { platform: context.request?.platform || null };
}

export function validateContext(context) {
  return !!context.research && !!context.script && !!context.storyboard && !!context.prompts && !!context.thumbnail;
}

export const captionStageDef = {
  id: 'caption',
  displayName: 'Caption Writer',
  systemPrompt: SYSTEM_PROMPT,
  buildUserMessage,
  summarizeInput,
  parseOutput: (raw) => parseCaptionOutput(raw, { requestPlatform: undefined }),
  validateContext,
  temperature: 0.65,
};

// Caption's parseOutput needs the request platform at call time, which the
// generic worker contract does not pass through — so the engine binds it
// via bindCaptionParser(requestPlatform) before constructing this stage's
// worker for a specific run. See workforceEngine.js.
export function bindCaptionParser(requestPlatform) {
  return (raw) => parseCaptionOutput(raw, { requestPlatform });
}
