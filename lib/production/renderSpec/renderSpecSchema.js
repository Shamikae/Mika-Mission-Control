// lib/production/renderSpec/renderSpecSchema.js
// Pure functions — no I/O, no fs, no network. Safe to import from both server
// routes and the browser bundle (same convention as productionRules.js,
// publishingRules.js, contentPipelineRules.js).
//
// ── Universal Render Specification (URS) ──────────────────────────────────
//
// THE contract every rendering provider consumes. A Content Package describes
// what the content MEANS (semantic creative intent). A provider API needs to
// know what to RENDER (technical instruction). URS is the single intermediate
// representation between them:
//
//     Content Package ──buildRenderSpec()──▶ URS ──provider adapter──▶ provider payload
//
// INVARIANT — URS is provider-independent. It must never contain a provider
// name, a provider parameter, an MCP concept, a CLI concept, a model id, an
// API shape, or a credential. If a field only makes sense for one provider it
// does not belong here; it belongs in that provider's adapter, which is the
// ONLY place allowed to know a provider exists. Adapters are translators FROM
// this object; URS never learns which one was selected.
//
// Nullable fields are deliberate. URS models the full space of creative intent
// a renderer may need, and reports honestly (via `completeness`) when a source
// could not supply something. A null field means "not specified" — never a
// fabricated default, and never a silent zero.

export const URS_VERSION = 1;

// Reuses the Production Router's existing mode vocabulary rather than
// inventing a parallel one — see PRODUCTION_MODES in productionRules.js.
export const URS_ASSET_ROLES = ['thumbnail', 'reference_image', 'product_image', 'brand_logo', 'background_audio', 'voice_sample'];

// A SUGGESTED vocabulary, not an enforced enum. validateRenderSpec() does not
// constrain assetKind: an upstream stage's own word (e.g. the storyboard's
// "video") passes through verbatim rather than being coerced into the nearest
// member, because coercion is interpretation and would lose the original term.
export const URS_SCENE_ASSET_KINDS = ['generated_video', 'generated_image', 'stock', 'motion_graphic', 'live_action', 'unspecified'];

// How `timing.totalDurationSeconds` was arrived at. A renderer that must hit
// an exact runtime needs to know whether the number is authored or inferred.
export const URS_TIMING_SOURCES = ['scene_durations', 'narration_estimate', 'requested_duration', 'unknown'];

export const URS_NARRATION_SOURCES = ['script', 'scene_narration', 'none'];

/** Words per minute used to estimate narration runtime — matches buildVoiceoverScriptSummary()'s existing 150wpm assumption. */
export const URS_WORDS_PER_MINUTE = 150;

/**
 * Parses a resolution string ("1080x1920") into structured pixels. Providers
 * overwhelmingly want width/height as numbers; the original string is kept
 * alongside so nothing is lost.
 * @returns {{ width: number, height: number }|null}
 */
export function parseResolution(resolution) {
  if (typeof resolution !== 'string') return null;
  const m = resolution.trim().match(/^(\d{2,5})\s*[x×]\s*(\d{2,5})$/i);
  if (!m) return null;
  return { width: Number(m[1]), height: Number(m[2]) };
}

/**
 * Parses a free-text duration ("35-45 seconds", "30s", "about a minute") into
 * a bounded range. Content Packages carry `videoDuration` as operator-typed
 * free text, so this never throws — it degrades to nulls and lets
 * `completeness` report the gap.
 * @returns {{ minSeconds: number|null, maxSeconds: number|null, label: string|null }}
 */
export function parseDurationHint(raw) {
  const label = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  if (!label) return { minSeconds: null, maxSeconds: null, label: null };

  const minutes = /\bminute/i.test(label);
  const nums = (label.match(/\d+(?:\.\d+)?/g) || []).map(Number).filter(n => Number.isFinite(n));
  if (!nums.length) return { minSeconds: null, maxSeconds: null, label };

  const scale = minutes ? 60 : 1;
  const scaled = nums.map(n => Math.round(n * scale));
  return {
    minSeconds: Math.min(...scaled),
    maxSeconds: Math.max(...scaled),
    label,
  };
}

/** Orientation is derived, never stored twice — renderers branch on it constantly. */
export function orientationFor(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || !width || !height) return null;
  if (width > height) return 'landscape';
  if (height > width) return 'portrait';
  return 'square';
}

// ── Render-intent normalization (read side) ───────────────────────────────

function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

function s(v, max = 2000) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function sList(v, max = 300, cap = 40) {
  if (!Array.isArray(v)) return [];
  return v.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim().slice(0, max)).slice(0, cap);
}

function n(v) { return Number.isFinite(v) ? v : null; }

/**
 * Normalizes a persisted `package.renderIntent` block into the flat, canonical
 * shape this module consumes. Serves three purposes at once:
 *
 * 1. DEFENSIVE. A persisted block can be hand-edited, truncated, or written by
 *    an older/newer schema version. Every field is re-coerced here, so a
 *    malformed block degrades to nulls instead of propagating junk (or a
 *    thrown error) into a render spec.
 *
 * 2. NEUTRALITY GUARANTEE. This is a strict WHITELIST — only the fields named
 *    below are ever read. An unknown key in the stored block (including a
 *    provider-specific one added upstream later) can never reach a URS,
 *    because nothing copies it. Provider neutrality is therefore structural,
 *    not a convention someone has to remember.
 *
 * 3. NORMALIZATION, NOT DUPLICATION. The stored block groups fields by their
 *    originating stage and keeps upstream naming; URS groups them by render
 *    concern. `generation.presenter`/`generation.composition` flatten to
 *    `presenter`/`composition`, image prompts flatten to a scene-indexed list.
 *    The renderIntent object is never spliced into a spec wholesale.
 *
 * @returns {object|null} canonical shape, or null when unusable
 */
export function normalizeRenderIntent(raw) {
  if (!isObj(raw)) return null;

  const direction = isObj(raw.direction) ? raw.direction : null;
  const generation = isObj(raw.generation) ? raw.generation : null;
  const composition = generation && isObj(generation.composition) ? generation.composition : null;
  const presenter = generation && isObj(generation.presenter) ? generation.presenter : null;
  const imageGen = generation && isObj(generation.imageGeneration) ? generation.imageGeneration : null;
  const thumbPrompt = generation && isObj(generation.thumbnailPrompt) ? generation.thumbnailPrompt : null;
  const thumbDir = isObj(raw.thumbnailDirection) ? raw.thumbnailDirection : null;
  const captions = isObj(raw.captionVariants) ? raw.captionVariants : null;

  return {
    schemaVersion: n(raw.schemaVersion),
    sourceRunId: s(raw.sourceRunId, 120),

    direction: {
      pacing: s(direction?.pacing, 200),
      visualStyle: s(direction?.visualStyle, 1000),
      continuityNotes: sList(direction?.continuityNotes),
      declaredTotalSeconds: n(direction?.totalDurationSeconds),
      scenes: Array.isArray(direction?.scenes)
        ? direction.scenes
            .filter(isObj)
            .map((sc, i) => ({
              index: n(sc.index) ?? i,
              camera: s(sc.camera, 500),
              motion: s(sc.motion, 500),
              transition: s(sc.transition, 200),
              assetType: s(sc.assetType, 200),
            }))
            .slice(0, 40)
        : [],
    },

    composition: {
      brief: s(composition?.compositionBrief, 1000),
      typography: s(composition?.typography, 500),
      transitions: sList(composition?.transitions, 200),
      motionDirections: sList(composition?.animationDirections),
    },

    presenter: {
      applicable: typeof presenter?.applicable === 'boolean' ? presenter.applicable : null,
      direction: s(presenter?.avatarDirection, 1000),
      voiceDirection: s(presenter?.voiceDirection, 1000),
      sceneInstructions: sList(presenter?.sceneInstructions),
      constraints: sList(presenter?.constraints),
    },

    imagePrompts: Array.isArray(imageGen?.prompts)
      ? imageGen.prompts
          .filter(isObj)
          .map((p, i) => ({
            sceneIndex: n(p.sceneIndex) ?? i,
            prompt: s(p.prompt),
            negativePrompt: s(p.negativePrompt),
          }))
          .slice(0, 40)
      : [],

    // TWO stages independently produce thumbnail direction — the Thumbnail
    // Designer and the Prompt Generation stage — and their values genuinely
    // differ. Neither is authoritative, so neither is privileged or dropped:
    // the Designer's are the primary fields, the Prompt stage's are carried
    // alongside as `*Alternate`. Collapsing them with `a || b` would silently
    // destroy one stage's work, which is exactly the class of loss P0.5 fixed.
    thumbnail: {
      // A human-readable brief and a model prompt are different artifacts and
      // must never collapse into one slot.
      visualBrief: s(thumbDir?.visualBrief, 1000),
      alternateHeadlines: [
        ...sList(thumbDir?.alternateHeadlines, 200),
        ...(s(thumbPrompt?.headline, 200) ? [s(thumbPrompt.headline, 200)] : []),
      ].filter((v, i, a) => a.indexOf(v) === i).slice(0, 40),
      subject: s(thumbDir?.subject, 1000),
      background: s(thumbDir?.background, 1000),
      composition: s(thumbDir?.composition, 1000),
      compositionAlternate: s(thumbPrompt?.composition, 1000),
      emotion: s(thumbDir?.emotion, 200),
      contrastStrategy: s(thumbDir?.contrastStrategy, 1000),
      brandElements: sList(thumbDir?.brandElements, 200),
      generationPrompt: s(thumbDir?.imagePrompt),
      generationPromptAlternate: s(thumbPrompt?.imagePrompt),
      negativePrompt: s(thumbDir?.negativePrompt),
      exclusions: sList(thumbPrompt?.exclusions),
      safeAreaNotes: sList(thumbDir?.platformSafeAreaNotes),
    },

    captions: {
      alternates: sList(captions?.alternateCaptions, 2200, 20),
      firstComment: s(captions?.firstComment, 1000),
      platformVariants: isObj(captions?.platformVariants)
        ? Object.fromEntries(
            Object.entries(captions.platformVariants)
              .filter(([, v]) => typeof v === 'string' && v.trim())
              .slice(0, 20)
              .map(([k, v]) => [String(k).slice(0, 40), v.trim().slice(0, 2200)]),
          )
        : {},
      complianceNotes: sList(captions?.complianceNotes),
    },
  };
}

// ── Validation ────────────────────────────────────────────────────────────

/**
 * Structural validation of a URS object. Deliberately checks SHAPE and
 * internal consistency, not creative quality — a spec can be structurally
 * valid and still be missing things a given provider needs. Per-provider
 * requirements are enforced by that provider's adapter (validateInput), which
 * is where provider knowledge is allowed to live.
 *
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateRenderSpec(spec) {
  const errors = [];
  const warnings = [];

  if (!isObj(spec)) return { valid: false, errors: ['URS must be an object.'], warnings };
  if (spec.ursVersion !== URS_VERSION) errors.push(`ursVersion must be ${URS_VERSION} (received: ${spec.ursVersion}).`);
  if (!spec.specId || typeof spec.specId !== 'string') errors.push('specId is required.');

  for (const section of ['source', 'intent', 'output', 'narrative', 'timing', 'audio', 'captions', 'visualIdentity', 'completeness']) {
    if (!isObj(spec[section])) errors.push(`${section} section is required and must be an object.`);
  }
  if (!Array.isArray(spec.scenes)) errors.push('scenes must be an array.');
  if (!Array.isArray(spec.assets)) errors.push('assets must be an array.');

  if (isObj(spec.output)) {
    const { resolution } = spec.output;
    if (resolution && (!Number.isFinite(resolution.width) || !Number.isFinite(resolution.height))) {
      errors.push('output.resolution must carry numeric width and height when present.');
    }
    if (spec.output.frameRate != null && !Number.isFinite(spec.output.frameRate)) {
      errors.push('output.frameRate must be a number when present.');
    }
  }

  if (Array.isArray(spec.scenes)) {
    spec.scenes.forEach((scene, i) => {
      if (!isObj(scene)) { errors.push(`scenes[${i}] must be an object.`); return; }
      if (!Number.isFinite(scene.index)) errors.push(`scenes[${i}].index must be a number.`);
      if (!isObj(scene.visual)) errors.push(`scenes[${i}].visual must be an object.`);
      if (scene.durationSeconds != null && !(Number.isFinite(scene.durationSeconds) && scene.durationSeconds > 0)) {
        errors.push(`scenes[${i}].durationSeconds must be a positive number when present.`);
      }
      if (scene.startSeconds != null && scene.endSeconds != null && scene.endSeconds <= scene.startSeconds) {
        errors.push(`scenes[${i}] endSeconds must be greater than startSeconds.`);
      }
    });

    // A renderer that lays scenes on a timeline needs contiguous indices.
    const indices = spec.scenes.map(s => s?.index).filter(Number.isFinite);
    const expected = indices.map((_, i) => i);
    if (indices.length && indices.join(',') !== expected.join(',')) {
      warnings.push('scenes are not indexed contiguously from 0 — timeline placement may be ambiguous.');
    }
  }

  if (isObj(spec.timing) && spec.timing.source && !URS_TIMING_SOURCES.includes(spec.timing.source)) {
    errors.push(`timing.source must be one of: ${URS_TIMING_SOURCES.join(', ')}.`);
  }

  if (isObj(spec.narrative) && !spec.narrative.script?.fullText) {
    warnings.push('narrative.script.fullText is empty — most providers require narration or on-screen copy to render anything meaningful.');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Scores how much of the render surface a spec actually describes, and names
 * what is missing. This is NOT provider readiness (the Production Router
 * already computes that against a package) — it is "how much rendering intent
 * did we manage to carry across", which is what tells you whether a richer
 * upstream source would improve output.
 *
 * @returns {{ score: number, missing: string[], warnings: string[] }}
 */
export function scoreCompleteness(spec) {
  const missing = [];
  const warnings = [];

  const checks = [
    ['narrative.script.fullText', !!spec?.narrative?.script?.fullText, 25],
    ['scenes', Array.isArray(spec?.scenes) && spec.scenes.length > 0, 20],
    ['scene visual descriptions', (spec?.scenes || []).some(s => s?.visual?.description), 15],
    ['timing.totalDurationSeconds', Number.isFinite(spec?.timing?.totalDurationSeconds), 10],
    ['output.resolution', !!spec?.output?.resolution, 10],
    ['captions.post.caption', !!spec?.captions?.post?.caption, 5],
    ['scene motion/camera direction', (spec?.scenes || []).some(s => s?.motion || s?.camera), 5],
    ['visualIdentity.typography or visualStyle', !!(spec?.visualIdentity?.typography || spec?.visualIdentity?.visualStyle), 5],
    ['audio.music intent', !!spec?.audio?.music?.moodHint, 3],
    ['visual negative prompts', (spec?.scenes || []).some(s => s?.visual?.negativePrompt), 2],
  ];

  let score = 0;
  for (const [label, present, weight] of checks) {
    if (present) score += weight;
    else missing.push(label);
  }

  if (!(spec?.scenes || []).some(s => Number.isFinite(s?.durationSeconds))) {
    warnings.push('No scene carries an explicit duration — a renderer must infer pacing.');
  }

  return { score, missing, warnings };
}
