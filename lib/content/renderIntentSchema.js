// lib/content/renderIntentSchema.js
// Pure functions — no I/O, no fs, no network. Safe on both server and client
// (same convention as contentPackageSchema.js, productionRules.js).
//
// ── Render Intent ─────────────────────────────────────────────────────────
//
// An ADDITIVE block on the Content Package that preserves the render-relevant
// output the Content Workforce genuinely produces and which packaging
// previously discarded.
//
// The audit found createPackageFromWorkforceRun() carried the WRITTEN content
// (hooks, script, scene text, caption, hashtags) and dropped the DIRECTORIAL
// content: per-scene camera/motion/transition, pacing, visual style,
// continuity notes, per-scene image prompts and negative prompts, typography,
// transition vocabulary, and the full thumbnail art direction. That output was
// generated, paid for, and thrown away one function call before production.
//
// ── Design rules this file obeys ──────────────────────────────────────────
//
// 1. PRESERVE, NEVER REINTERPRET. Values are copied verbatim (length-clamped
//    for safety only). Nothing is renamed to a "nicer" vocabulary here —
//    renaming is interpretation, and interpretation belongs in the consumer
//    (buildRenderSpec maps these into provider-neutral URS names).
// 2. NO INVENTED DEFAULTS, NO INFERENCE. A field absent upstream stays null.
//    An absent array stays an empty array. Nothing is derived or guessed.
// 3. SINGLE SOURCE OF TRUTH. Only fields the package does not already carry
//    are stored. hooks/script/scenes.visual/caption/hashtags/keywords and
//    thumbnail.headline+visualBrief already live on the package and are
//    deliberately NOT duplicated here, so an operator edit cannot create two
//    disagreeing copies.
// 4. STRICTLY BACKWARD COMPATIBLE. `renderIntent` is a new optional top-level
//    key. Packages created by any other path simply do not have it, and every
//    existing reader ignores it. contentPackageSchema.js is untouched — this
//    block has its own sanitizer so no existing validator changes.

export const RENDER_INTENT_SCHEMA_VERSION = 1;

const MAX = {
  short: 200,
  line: 500,
  brief: 1000,
  prompt: 2000,
  listItem: 300,
  caption: 2200, // matches contentPackageSchema.js's caption clamp
};

const MAX_ITEMS = 40;

function str(v, max) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function strList(v, max = MAX.listItem) {
  if (!Array.isArray(v)) return [];
  return v
    .filter(x => typeof x === 'string' && x.trim())
    .map(x => x.trim().slice(0, max))
    .slice(0, MAX_ITEMS);
}

function num(v) {
  return Number.isFinite(v) ? v : null;
}

function bool(v) {
  return typeof v === 'boolean' ? v : null;
}

/** Per-scene directorial fields, keyed by the storyboard's own 0-based index. */
function sanitizeSceneDirection(scenes) {
  if (!Array.isArray(scenes)) return [];
  return scenes
    .filter(s => s && typeof s === 'object')
    .map((s, i) => ({
      index: Number.isFinite(s.index) ? s.index : i,
      camera: str(s.camera, MAX.line),
      motion: str(s.motion, MAX.line),
      transition: str(s.transition, MAX.short),
      assetType: str(s.assetType, MAX.short),
      // Advisory only — the storyboard model's own words. Never used to
      // select or constrain a provider; the Production Router owns that.
      providerHint: str(s.providerHint, MAX.short),
    }))
    .slice(0, MAX_ITEMS);
}

function sanitizeImagePrompts(prompts) {
  if (!Array.isArray(prompts)) return [];
  return prompts
    .filter(p => p && typeof p === 'object')
    .map((p, i) => ({
      sceneIndex: Number.isFinite(p.sceneIndex) ? p.sceneIndex : i,
      prompt: str(p.prompt, MAX.prompt),
      negativePrompt: str(p.negativePrompt, MAX.prompt),
      aspectRatio: str(p.aspectRatio, MAX.short),
    }))
    .slice(0, MAX_ITEMS);
}

/**
 * Extracts the render-relevant, previously-discarded output of a workforce
 * run into a persistable block.
 *
 * Stage outputs are read as EFFECTIVE output (raw model result merged with any
 * human override) so an operator edit is preserved, exactly as the rest of
 * packaging already does.
 *
 * Provider-named groups (`presenter`/`composition` originate from the Prompt
 * stage's heygen/hyperframes buckets) keep their upstream shape verbatim per
 * rule 1. That naming is an upstream property of the Prompt stage, not a
 * contract introduced here — and it never reaches the provider-neutral URS,
 * which maps these into neutral fields.
 *
 * @param {(stageId: string) => object|null} getStage — effective-output accessor
 * @param {object} [meta]
 * @returns {object|null} renderIntent block, or null when no stage supplied anything
 */
export function buildRenderIntent(getStage, { runId = null } = {}) {
  const storyboard = getStage('storyboard') || null;
  const prompts = getStage('prompts') || null;
  const thumbnail = getStage('thumbnail') || null;
  const caption = getStage('caption') || null;
  const review = getStage('review') || null;

  if (!storyboard && !prompts && !thumbnail && !caption && !review) return null;

  const block = {
    schemaVersion: RENDER_INTENT_SCHEMA_VERSION,
    sourceRunId: typeof runId === 'string' ? runId : null,
    capturedAt: new Date().toISOString(),

    // ── Direction (Storyboard) ────────────────────────────────────────────
    direction: storyboard ? {
      pacing: str(storyboard.pacing, MAX.short),
      visualStyle: str(storyboard.visualStyle, MAX.brief),
      continuityNotes: strList(storyboard.continuityNotes),
      totalDurationSeconds: num(storyboard.totalDurationSeconds),
      scenes: sanitizeSceneDirection(storyboard.scenes),
    } : null,

    // ── Generation prompts (Prompt Generation) ────────────────────────────
    generation: prompts ? {
      productionMode: str(prompts.productionMode, MAX.short),
      presenter: prompts.heygen ? {
        applicable: bool(prompts.heygen.applicable),
        avatarDirection: str(prompts.heygen.avatarDirection, MAX.brief),
        voiceDirection: str(prompts.heygen.voiceDirection, MAX.brief),
        sceneInstructions: strList(prompts.heygen.sceneInstructions),
        constraints: strList(prompts.heygen.constraints),
      } : null,
      composition: prompts.hyperframes ? {
        applicable: bool(prompts.hyperframes.applicable),
        compositionBrief: str(prompts.hyperframes.compositionBrief, MAX.brief),
        animationDirections: strList(prompts.hyperframes.animationDirections),
        typography: str(prompts.hyperframes.typography, MAX.line),
        transitions: strList(prompts.hyperframes.transitions, MAX.short),
        aspectRatio: str(prompts.hyperframes.aspectRatio, MAX.short),
      } : null,
      imageGeneration: prompts.imageGeneration ? {
        applicable: bool(prompts.imageGeneration.applicable),
        prompts: sanitizeImagePrompts(prompts.imageGeneration.prompts),
      } : null,
      thumbnailPrompt: prompts.thumbnail ? {
        imagePrompt: str(prompts.thumbnail.imagePrompt, MAX.prompt),
        headline: str(prompts.thumbnail.headline, MAX.short),
        composition: str(prompts.thumbnail.composition, MAX.brief),
        exclusions: strList(prompts.thumbnail.exclusions),
      } : null,
    } : null,

    // ── Thumbnail art direction (Thumbnail Designer) ──────────────────────
    // `headline` is omitted — the package carries it verbatim.
    // `visualBrief` IS kept: packageFromWorkforceRun maps
    // `imagePrompt || visualBrief` into the package's visualBrief slot, so
    // whenever an imagePrompt exists the stage's real visualBrief is
    // overwritten and would otherwise be lost. Both are distinct artifacts —
    // a human-readable brief and a generation prompt — so both are preserved.
    thumbnailDirection: thumbnail ? {
      visualBrief: str(thumbnail.visualBrief, MAX.brief),
      alternateHeadlines: strList(thumbnail.alternateHeadlines, MAX.short),
      subject: str(thumbnail.subject, MAX.brief),
      background: str(thumbnail.background, MAX.brief),
      composition: str(thumbnail.composition, MAX.brief),
      emotion: str(thumbnail.emotion, MAX.short),
      contrastStrategy: str(thumbnail.contrastStrategy, MAX.brief),
      brandElements: strList(thumbnail.brandElements, MAX.short),
      imagePrompt: str(thumbnail.imagePrompt, MAX.prompt),
      negativePrompt: str(thumbnail.negativePrompt, MAX.prompt),
      platformSafeAreaNotes: strList(thumbnail.platformSafeAreaNotes),
      score: num(thumbnail.score),
    } : null,

    // ── Caption variants (Caption Writer) ─────────────────────────────────
    // primaryCaption/cta/hashtags/keywords are omitted — already on the package.
    captionVariants: caption ? {
      alternateCaptions: strList(caption.alternateCaptions, MAX.caption),
      firstComment: str(caption.firstComment, MAX.brief),
      platformVariants: caption.platformVariants && typeof caption.platformVariants === 'object'
        ? Object.fromEntries(
            Object.entries(caption.platformVariants)
              .filter(([, v]) => typeof v === 'string' && v.trim())
              .slice(0, 20)
              .map(([k, v]) => [String(k).slice(0, 40), v.trim().slice(0, 2200)]),
          )
        : {},
      complianceNotes: strList(caption.complianceNotes),
    } : null,

    // ── Review signal ─────────────────────────────────────────────────────
    // Kept because productionReadiness/warnings describe render risk, and a
    // downstream renderer or operator benefits from knowing what was flagged.
    reviewSignal: review ? {
      verdict: str(review.verdict, MAX.short),
      overallScore: num(review.overallScore),
      productionReadiness: num(review.categoryScores?.productionReadiness),
      warnings: strList(review.warnings),
    } : null,
  };

  return block;
}

/**
 * Re-validates a persisted renderIntent block (e.g. after a store round-trip
 * or a hand edit). Structural only — never invents or backfills.
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateRenderIntent(block) {
  const errors = [];
  if (block == null) return { valid: true, errors }; // absent is legal — backward compatible
  if (typeof block !== 'object' || Array.isArray(block)) {
    return { valid: false, errors: ['renderIntent must be an object when present.'] };
  }
  if (block.schemaVersion !== RENDER_INTENT_SCHEMA_VERSION) {
    errors.push(`renderIntent.schemaVersion must be ${RENDER_INTENT_SCHEMA_VERSION}.`);
  }
  if (block.direction && !Array.isArray(block.direction.scenes)) {
    errors.push('renderIntent.direction.scenes must be an array when direction is present.');
  }
  if (block.generation?.imageGeneration && !Array.isArray(block.generation.imageGeneration.prompts)) {
    errors.push('renderIntent.generation.imageGeneration.prompts must be an array when present.');
  }
  return { valid: errors.length === 0, errors };
}
