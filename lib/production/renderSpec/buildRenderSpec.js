// lib/production/renderSpec/buildRenderSpec.js
// Pure functions — no I/O, no fs, no network. Safe on both server and client.
//
// The ONE transform from a Content Package into a Universal Render
// Specification. Additive by construction: it READS a package and returns a
// new object. It never mutates the package, never writes to a store, and is
// never required by any existing code path — Content Packages, Production
// Plans, the Execution Engine, the Provider Registry, existing adapters and
// validators all keep working untouched whether or not this is ever called.
//
// Provider-neutrality is enforced by omission: this file imports nothing from
// any adapter and contains no provider name. It reuses the Production
// Router's existing platform/mode vocabulary (buildOutputSpec, PRODUCTION_MODE
// ids) rather than inventing a second one.
//
// ── Directorial intent (resolved in P0.5) ─────────────────────────────────
// Packaging previously carried only the WRITTEN content and dropped the
// DIRECTORIAL content — per-scene camera/motion/transition, pacing, visual
// style, per-scene image and negative prompts, typography, transition
// vocabulary and thumbnail art direction. P0.5 preserves all of it on the
// package as an additive `renderIntent` block (lib/content/renderIntentSchema.js),
// and this transform reads it to populate the corresponding URS fields.
//
// Every read of `pkg.renderIntent` is null-safe. A package created before
// P0.5, or by any path other than the Content Workforce, produces exactly the
// spec it produced previously — those fields simply stay null and are reported
// through `completeness.missing`. `renderIntentSource.present` distinguishes
// "never produced upstream" from "produced but not preserved".

import { buildOutputSpec } from '../productionRules.js';
import {
  URS_VERSION, URS_WORDS_PER_MINUTE, parseResolution, parseDurationHint,
  orientationFor, scoreCompleteness, validateRenderSpec, normalizeRenderIntent,
} from './renderSpecSchema.js';

function str(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function num(v) {
  return Number.isFinite(v) ? v : null;
}

/**
 * Lays scenes on an absolute timeline. Packages carry per-scene
 * durationSeconds but no start/end — every timeline renderer needs absolute
 * offsets, so they are accumulated here once rather than in each adapter.
 * A scene with no duration leaves the running clock untouched and reports
 * null offsets rather than guessing.
 */
function withTimeline(scenes, renderIntent, resolvedAssets) {
  let clock = 0;
  let contiguous = true;

  // Directorial and generation detail preserved by P0.5, indexed for lookup.
  // Absent on packages created before renderIntent existed, or by any other
  // path — every access below is null-safe and simply yields null.
  const directionByIndex = new Map(
    (renderIntent?.direction?.scenes || []).map(sc => [sc.index, sc]),
  );
  const imagePromptByIndex = new Map(
    (renderIntent?.imagePrompts || []).map(p => [p.sceneIndex, p]),
  );
  // Resolved assets, keyed by scene. Provider and model are deliberately NOT
  // carried into URS — provenance stays on the asset record so the render
  // contract remains provider-neutral.
  const assetByScene = new Map(
    (resolvedAssets || []).filter(a => Number.isFinite(a?.sceneIndex)).map(a => [a.sceneIndex, a]),
  );

  return scenes.map((scene, i) => {
    const duration = num(scene.durationSeconds);
    const startSeconds = duration != null && contiguous ? clock : null;
    if (duration != null && contiguous) clock += duration;
    else contiguous = false;

    const direction = directionByIndex.get(i) || null;
    const imagePrompt = imagePromptByIndex.get(i) || null;

    return {
      index: i,
      // The package's own 1-based ordering is preserved alongside the 0-based
      // array index so neither convention has to be re-derived downstream.
      order: num(scene.order) ?? i + 1,
      startSeconds,
      endSeconds: startSeconds != null && duration != null ? startSeconds + duration : null,
      durationSeconds: duration,
      visual: {
        description: str(scene.visual),
        // The Prompt stage's dedicated generation prompt is a DIFFERENT artifact
        // from the storyboard's human-readable description — both are kept.
        generationPrompt: imagePrompt?.prompt || null,
        negativePrompt: imagePrompt?.negativePrompt || null,
        // Verbatim upstream term — never coerced into URS_SCENE_ASSET_KINDS.
        assetKind: direction?.assetType || 'unspecified',
      },
      narration: str(scene.voiceover),
      onScreenText: str(scene.onScreenText),
      // Opaque reference — a consumer resolves it through assets[], never by
      // knowing who generated it.
      assetRef: assetByScene.has(i)
        ? { assetId: assetByScene.get(i).assetId, capability: assetByScene.get(i).capability }
        : null,
      camera: direction?.camera || null,
      motion: direction?.motion || null,
      transitionOut: direction?.transition || null,
    };
  });
}

/**
 * @param {object} pkg — a Content Package (lib/content/contentPackageSchema.js shape)
 * @param {object} [options]
 * @param {string} [options.mode] — a Production Router mode id, when a plan has already
 *        selected one. Advisory creative framing only; URS never resolves a provider.
 * @param {string} [options.specId] — caller-supplied id (defaults to a package-derived one)
 * @returns {{ ok: boolean, spec: object|null, validation: object, error?: string }}
 */
export function buildRenderSpec(pkg, { mode = null, specId = null } = {}) {
  if (!pkg || typeof pkg !== 'object') {
    return { ok: false, spec: null, validation: { valid: false, errors: ['A Content Package is required.'], warnings: [] }, error: 'A Content Package is required.' };
  }

  // Reuse the Router's platform→spec table rather than duplicating it.
  const output = buildOutputSpec(pkg);
  const resolution = parseResolution(output.resolution);
  const duration = parseDurationHint(pkg.videoDuration);

  // Present only on packages built by the Content Workforce after P0.5.
  // Normalized through a strict whitelist: defensive against a malformed or
  // hand-edited stored block, and the reason no unknown (e.g. provider-shaped)
  // key can structurally reach a URS.
  const renderIntent = normalizeRenderIntent(pkg.renderIntent);

  const rawScenes = Array.isArray(pkg.scenes) ? pkg.scenes : [];
  // Additive: present only on packages that have had assets resolved.
  const resolvedAssets = Array.isArray(pkg.assets) ? pkg.assets : [];

  const scenes = withTimeline(rawScenes, renderIntent, resolvedAssets);

  const scriptFull = str(pkg.script?.fullText);
  const wordCount = scriptFull ? scriptFull.split(/\s+/).length : 0;
  const estimatedNarrationSeconds = wordCount ? Math.round((wordCount / URS_WORDS_PER_MINUTE) * 60) : null;

  const sceneDurationTotal = scenes.reduce((sum, s) => sum + (s.durationSeconds || 0), 0) || null;
  const fullyTimed = scenes.length > 0 && scenes.every(s => s.durationSeconds != null);

  // Honest precedence: authored scene durations beat a narration estimate,
  // which beats the operator's free-text request, which beats nothing.
  let totalDurationSeconds = sceneDurationTotal;
  let timingSource = sceneDurationTotal ? 'scene_durations' : null;
  if (totalDurationSeconds == null && estimatedNarrationSeconds != null) {
    totalDurationSeconds = estimatedNarrationSeconds;
    timingSource = 'narration_estimate';
  }
  if (totalDurationSeconds == null && duration.maxSeconds != null) {
    totalDurationSeconds = duration.maxSeconds;
    timingSource = 'requested_duration';
  }
  if (timingSource == null) timingSource = 'unknown';

  const captionSegments = scenes
    .filter(s => s.onScreenText)
    .map(s => ({ sceneIndex: s.index, text: s.onScreenText, startSeconds: s.startSeconds, endSeconds: s.endSeconds }));

  const thumb = pkg.thumbnail || {};
  const thumbnailReady = thumb.status === 'completed' && !!thumb.artifactUrl;

  const assets = resolvedAssets.map(a => ({
    role: a.capability || 'scene_visual',
    kind: 'generated_image',
    assetId: a.assetId,
    sceneIndex: a.sceneIndex,
    // Project-relative local path. No remote provider URL ever appears here.
    storagePath: a.storagePath,
    mimeType: a.mimeType,
    width: a.width ?? null,
    height: a.height ?? null,
    contentHash: a.contentHash || null,
  }));
  if (thumbnailReady) {
    assets.push({
      role: 'thumbnail',
      kind: 'generated_image',
      assetId: thumb.artifactId || null,
      url: thumb.artifactUrl || null,
      mimeType: null,
    });
  }

  const spec = {
    ursVersion: URS_VERSION,
    specId: specId || `urs-${pkg.id}`,
    createdAt: new Date().toISOString(),

    // Traceability back to the exact package revision this was derived from,
    // so a stale spec is detectable the same way a stale plan already is.
    source: {
      kind: 'content_package',
      packageId: pkg.id || null,
      packageUpdatedAt: pkg.metadata?.updatedAt || null,
      brand: str(pkg.brand),
    },

    // WHY this video exists. Creative framing a renderer can condition on.
    intent: {
      mode,
      goal: str(pkg.goal),
      topic: str(pkg.topic),
      audience: str(pkg.audience),
      tone: str(pkg.tone),
      offer: str(pkg.offer),
      pacing: renderIntent?.direction?.pacing || null,
      hook: str(pkg.hooks?.[0]?.text),
      hookAngle: str(pkg.hooks?.[0]?.angle),
      alternateHooks: (Array.isArray(pkg.hooks) ? pkg.hooks.slice(1) : [])
        .map(h => ({ text: str(h?.text), angle: str(h?.angle) }))
        .filter(h => h.text),
    },

    // WHAT FILE must come out the other end.
    output: {
      platform: str(output.platform),
      aspectRatio: str(output.aspectRatio),
      resolution: resolution ? { ...resolution, label: output.resolution } : null,
      orientation: resolution ? orientationFor(resolution.width, resolution.height) : null,
      frameRate: num(output.frameRate),
      fileFormat: str(output.fileFormat),
      captionBurnIn: output.captionBurnIn === true,
      safeAreaNotes: str(output.safeAreaNotes),
      targetDuration: duration,
    },

    // The words.
    narrative: {
      script: {
        opening: str(pkg.script?.opening),
        body: str(pkg.script?.body),
        cta: str(pkg.script?.cta),
        fullText: scriptFull,
      },
      cta: str(pkg.cta),
      wordCount,
      estimatedNarrationSeconds,
    },

    // The shot list, on an absolute timeline.
    scenes,

    timing: {
      totalDurationSeconds,
      source: timingSource,
      sceneCount: scenes.length,
      fullyTimed,
      // What the storyboard itself declared, kept separate from the derived
      // total above so a mismatch is visible rather than silently reconciled.
      declaredTotalSeconds: renderIntent?.direction?.declaredTotalSeconds ?? null,
      withinRequestedRange:
        totalDurationSeconds != null && duration.minSeconds != null && duration.maxSeconds != null
          ? totalDurationSeconds >= duration.minSeconds && totalDurationSeconds <= duration.maxSeconds
          : null,
    },

    audio: {
      narration: {
        required: !!scriptFull || scenes.some(s => s.narration),
        source: scenes.some(s => s.narration) ? 'scene_narration' : scriptFull ? 'script' : 'none',
        text: scriptFull,
        voiceHint: null, // no voice model is expressed in a package
      },
      music: {
        // No workforce stage expresses music intent — honestly absent, not
        // inferred. This is the one render dimension nothing upstream produces.
        required: false,
        moodHint: null,
      },
    },

    // On-screen text vs. the platform post copy — different surfaces, kept apart.
    captions: {
      burnIn: output.captionBurnIn === true,
      segments: captionSegments,
      post: {
        caption: str(pkg.caption),
        hashtags: Array.isArray(pkg.hashtags) ? pkg.hashtags : [],
        keywords: Array.isArray(pkg.keywords) ? pkg.keywords : [],
        firstComment: renderIntent?.captions?.firstComment || null,
        alternates: renderIntent?.captions?.alternates || [],
        platformVariants: renderIntent?.captions?.platformVariants || {},
        complianceNotes: renderIntent?.captions?.complianceNotes || [],
      },
    },

    visualIdentity: {
      typography: renderIntent?.composition?.typography || null,
      visualStyle: renderIntent?.direction?.visualStyle || null,
      continuityNotes: renderIntent?.direction?.continuityNotes || [],
      transitionVocabulary: renderIntent?.composition?.transitions || [],
      compositionBrief: renderIntent?.composition?.brief || null,
      motionDirections: renderIntent?.composition?.motionDirections || [],
      palette: [],
      styleKeywords: [],
      thumbnail: {
        headline: str(thumb.headline),
        // NOTE: the package's visualBrief slot holds whatever
        // packageFromWorkforceRun wrote there (imagePrompt wins when present).
        // The Thumbnail stage's true brief is carried separately below, so the
        // two artifacts stay distinct rather than collapsing into one slot.
        visualBrief: str(thumb.visualBrief),
        artBrief: renderIntent?.thumbnail?.visualBrief || null,
        generationPrompt: renderIntent?.thumbnail?.generationPrompt || null,
        negativePrompt: renderIntent?.thumbnail?.negativePrompt || null,
        exclusions: renderIntent?.thumbnail?.exclusions || [],
        alternateHeadlines: renderIntent?.thumbnail?.alternateHeadlines || [],
        subject: renderIntent?.thumbnail?.subject || null,
        background: renderIntent?.thumbnail?.background || null,
        composition: renderIntent?.thumbnail?.composition || null,
        compositionAlternate: renderIntent?.thumbnail?.compositionAlternate || null,
        generationPromptAlternate: renderIntent?.thumbnail?.generationPromptAlternate || null,
        emotion: renderIntent?.thumbnail?.emotion || null,
        contrastStrategy: renderIntent?.thumbnail?.contrastStrategy || null,
        brandElements: renderIntent?.thumbnail?.brandElements || [],
        safeAreaNotes: renderIntent?.thumbnail?.safeAreaNotes || [],
        assetId: thumbnailReady ? thumb.artifactId || null : null,
        assetUrl: thumbnailReady ? thumb.artifactUrl || null : null,
        status: str(thumb.status) || 'not_requested',
      },
    },

    // On-camera presentation intent. Provider-neutral by name: it describes a
    // presenter, not any particular avatar product. Null/empty for faceless work.
    presenter: {
      applicable: renderIntent?.presenter?.applicable ?? null,
      direction: renderIntent?.presenter?.direction || null,
      voiceDirection: renderIntent?.presenter?.voiceDirection || null,
      sceneInstructions: renderIntent?.presenter?.sceneInstructions || [],
      constraints: renderIntent?.presenter?.constraints || [],
    },

    assets,

    // Provenance of the directorial layer, so a consumer can tell whether a
    // null field means "not produced" or "produced before P0.5 and lost".
    renderIntentSource: renderIntent
      ? { present: true, schemaVersion: renderIntent.schemaVersion, runId: renderIntent.sourceRunId }
      : { present: false, schemaVersion: null, runId: null },

    completeness: { score: 0, missing: [], warnings: [] },
  };

  spec.completeness = scoreCompleteness(spec);
  const validation = validateRenderSpec(spec);

  return { ok: validation.valid, spec, validation };
}

export default buildRenderSpec;
