// lib/production/renderSpec/translators/hyperframesTranslator.js
// SERVER-SIDE ONLY (touches the filesystem).
//
// ── URS → HyperFrames composition (v1, faceless vertical short-form) ──────
//
// The ONE deterministic translator from a Universal Render Specification into
// a runnable local HyperFrames composition. This closes the gap M0 found: the
// HyperFrames adapter requires a pre-authored `compositionId`, and nothing
// could produce one from workforce output.
//
// It is a TRANSLATOR, not a render engine. It writes a composition directory
// and returns a normal compositionId; every downstream step (validate →
// approval → enqueue → submit → poll → localBuffer ingestion) is the existing,
// unmodified governed flow. It never renders, never spawns the CLI, never
// touches the standalone hyperframes-local Studio flow, and never creates a
// Production Job.
//
// ── Namespace: why flat, not nested ──────────────────────────────────────
// A nested `tools/hyperframes/generated/<id>/` layout is NOT usable here:
// hyperframesSecurity.js requires a composition id to match
// /^[a-zA-Z0-9_-]{1,100}$/ (no path separators) AND resolve to a DIRECT child
// of tools/hyperframes/. A nested directory could never be returned as a
// working compositionId, which is a hard requirement of this milestone.
// The namespace is therefore expressed as a RESERVED ID PREFIX —
// `generated-…` — which is flat, adapter-compatible, and leaves the existing
// security choke point completely untouched. Hand-authored compositions never
// carry that prefix, and we additionally refuse to write over any directory
// that does not already carry our own manifest marker.
//
// ── Security model ───────────────────────────────────────────────────────
// Model/user text NEVER reaches an executable position:
//   • numbers  → validated with Number.isFinite, clamped, then written into
//                markup attributes. No string path at all.
//   • text     → serialized into ONE JSON island, escaped so it cannot close
//                the <script> tag, then written to the DOM via textContent.
//   • styling  → mapped through closed allowlists into fixed CSS class names.
//                A model's font/colour words never become CSS.
//   • motion   → mapped to keys of a fixed preset table in the template.
// No source code is ever generated from prompt text, and nothing is eval'd.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { HYPERFRAMES_ROOT, isValidCompositionId } from '../../../hyperframes/hyperframesSecurity.js';
import { copyNarrationIntoComposition } from '../../audio/narrationService.js';
import { NARRATION_FILENAME } from '../../audio/narrationRules.js';

export const TRANSLATOR_ID = 'urs-hyperframes-faceless-short';
export const TRANSLATOR_VERSION = 1;
export const TEMPLATE_VERSION = 3;
export const GENERATED_PREFIX = 'generated-';
export const MANIFEST_GENERATOR = 'mika-urs-hyperframes-translator';

const TEMPLATE_DIR = path.join(HYPERFRAMES_ROOT, 'templates', 'faceless-short');
const MAX_SCENES = 30;
const MIN_TOTAL_SECONDS = 5;
const MAX_TOTAL_SECONDS = 90;

// ── Closed vocabularies ──────────────────────────────────────────────────
// Every mapping below is total: an unrecognised input yields a documented
// safe default AND a warning. Nothing is ever silently dropped, and the
// original value is always retained in the manifest.

const TRANSITION_ALLOWLIST = ['cut', 'fade'];

function mapTransition(raw) {
  if (raw == null) return { value: 'cut', degraded: false };
  const t = String(raw).toLowerCase();
  if (/fade|dissolve|cross/.test(t)) return { value: 'fade', degraded: false };
  if (/\bcut\b|hard/.test(t)) return { value: 'cut', degraded: false };
  // slide/zoom/wipe/etc are real transitions the template does not implement
  // in v1 — degrade to a cut rather than approximate them badly.
  return { value: 'cut', degraded: true };
}

const MOTION_PRESETS = ['still', 'zoomIn', 'zoomOut', 'pushIn', 'panLeft', 'panRight', 'riseUp'];

function mapMotion(camera, motion) {
  const t = `${camera || ''} ${motion || ''}`.toLowerCase();
  if (!t.trim()) return { value: 'still', degraded: false, reason: 'no camera/motion supplied' };
  if (/zoom out|pull out|pull back|widen/.test(t)) return { value: 'zoomOut', degraded: false };
  if (/zoom in|push in|close[- ]?up|closer/.test(t)) return { value: 'zoomIn', degraded: false };
  if (/pan left|slide left|track left/.test(t)) return { value: 'panLeft', degraded: false };
  if (/pan|track|sweep|slide/.test(t)) return { value: 'panRight', degraded: false };
  if (/rise|lift|up|reveal/.test(t)) return { value: 'riseUp', degraded: false };
  if (/static|hold|locked|still|fixed/.test(t)) return { value: 'still', degraded: false };
  return { value: 'still', degraded: true, reason: 'unrecognised camera/motion vocabulary' };
}

// URS deliberately passes an upstream stage's own asset word through verbatim
// (e.g. the storyboard's "video"). Mapping it is the translator's job.
const ASSET_KIND_MAP = {
  video: 'generated_video',
  generated_video: 'generated_video',
  image: 'generated_image',
  generated_image: 'generated_image',
  photo: 'generated_image',
  graphic: 'motion_graphic',
  motion_graphic: 'motion_graphic',
  animation: 'motion_graphic',
  stock: 'stock',
  live_action: 'live_action',
  unspecified: 'unspecified',
};

function mapAssetKind(raw) {
  const key = String(raw || 'unspecified').toLowerCase().trim().replace(/[\s-]+/g, '_');
  const mapped = ASSET_KIND_MAP[key];
  if (mapped) return { value: mapped, degraded: false };
  return { value: 'unspecified', degraded: true };
}

function mapTypography(typography) {
  const t = String(typography || '').toLowerCase();
  const fontClass = /mono/.test(t) ? 'font-mono' : /serif/.test(t) && !/sans/.test(t) ? 'font-serif' : 'font-sans';
  const weightClass = /bold|heavy|black/.test(t) ? 'weight-bold' : /light|regular|thin/.test(t) ? 'weight-regular' : 'weight-medium';
  const alignClass = /left[- ]align|align left|left$/.test(t) ? 'align-left' : 'align-center';
  return { fontClass, weightClass, alignClass, recognised: !!t.trim() };
}

const TONE_TOKENS = ['tone-dark', 'tone-bright', 'tone-minimal'];

function mapVisualStyle(visualStyle) {
  const t = String(visualStyle || '').toLowerCase();
  const toneClasses = [];
  if (/bright|light|airy|vibrant|clean/.test(t)) toneClasses.push('tone-bright');
  else toneClasses.push('tone-dark');
  if (/minimal|simple|clean|flat/.test(t)) toneClasses.push('tone-minimal');
  return { toneClasses, recognised: !!t.trim() };
}

// ── Escaping ─────────────────────────────────────────────────────────────

/**
 * Serializes data for a <script type="application/json"> island. Escaping the
 * four dangerous characters makes it structurally impossible for any string
 * in the data to close the script tag or introduce a line terminator that
 * some parsers treat specially. The result is still valid JSON.
 */
function toJsonIsland(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function finite(v, fallback = null) {
  return Number.isFinite(v) ? v : fallback;
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

// ── Core translation ─────────────────────────────────────────────────────

/**
 * Pure part of the translator: URS → { data, markup, report, hash }.
 * No filesystem access, so it is directly unit-testable and deterministic.
 */
export function planTranslation(spec, { narration = null } = {}) {
  const consumedFields = [];
  const degradedFields = [];
  const ignoredFields = [];
  const warnings = [];

  const consume = f => consumedFields.push(f);
  const degrade = (f, note) => { degradedFields.push(f); if (note) warnings.push(note); };
  const ignore = f => ignoredFields.push(f);

  // ── Output geometry ────────────────────────────────────────────────────
  const width = finite(spec?.output?.resolution?.width, 1080);
  const height = finite(spec?.output?.resolution?.height, 1920);
  consume('output.resolution');
  consume('output.aspectRatio');
  consume('output.orientation');
  if (width !== 1080 || height !== 1920) {
    degrade('output.resolution', `Template renders 1080x1920; URS asked for ${width}x${height}. Rendering at 1080x1920.`);
  }
  if (spec?.output?.frameRate && spec.output.frameRate !== 30) {
    degrade('output.frameRate', `Template renders at 30fps; URS asked for ${spec.output.frameRate}fps.`);
  } else {
    consume('output.frameRate');
  }

  // ── Scenes / timeline ──────────────────────────────────────────────────
  const rawScenes = Array.isArray(spec?.scenes) ? spec.scenes : [];
  if (!rawScenes.length) {
    return { ok: false, error: 'URS contains no scenes — nothing to render.', report: null };
  }
  const usable = rawScenes.slice(0, MAX_SCENES);
  if (rawScenes.length > MAX_SCENES) {
    degrade('scenes', `URS has ${rawScenes.length} scenes; template supports ${MAX_SCENES}. Extra scenes dropped.`);
  }

  let clock = 0;
  const scenes = usable.map((sc, i) => {
    const declaredStart = finite(sc.startSeconds);
    const declaredDur = finite(sc.durationSeconds);
    // Trust an explicit contiguous timeline; otherwise lay scenes end to end.
    const startSeconds = declaredStart != null ? declaredStart : clock;
    const durationSeconds = declaredDur != null && declaredDur > 0 ? declaredDur : 3;
    if (declaredDur == null) {
      degrade(`scenes[${i}].durationSeconds`, `Scene ${i} had no duration; defaulted to 3s.`);
    }
    clock = startSeconds + durationSeconds;

    const motion = mapMotion(sc.camera, sc.motion);
    if (motion.degraded) degrade(`scenes[${i}].camera/motion`, `Scene ${i}: ${motion.reason} — fell back to "still".`);

    const transitionOut = mapTransition(sc.transitionOut);
    if (transitionOut.degraded) degrade(`scenes[${i}].transitionOut`, `Scene ${i}: transition "${sc.transitionOut}" is not in the v1 allowlist (${TRANSITION_ALLOWLIST.join(', ')}) — used "cut".`);

    const assetKind = mapAssetKind(sc.visual?.assetKind);
    if (assetKind.degraded) degrade(`scenes[${i}].visual.assetKind`, `Scene ${i}: unknown assetKind "${sc.visual?.assetKind}" — treated as "unspecified".`);

    return {
      index: i,
      startSeconds: round2(startSeconds),
      durationSeconds: round2(durationSeconds),
      onScreenText: sc.onScreenText || '',
      // Narration is preserved as data for a future voice track; the v1
      // template shows the caption line rather than speaking it.
      narration: sc.narration || '',
      caption: sc.onScreenText || '',
      motionPreset: motion.value,
      transitionIn: i === 0 ? 'fade' : 'cut',
      transitionOut: transitionOut.value,
      assetKind: assetKind.value,
      // Carried as METADATA for a future asset-generation pass. v1 renders a
      // background placeholder; it never silently pretends a visual exists.
      visualDescription: sc.visual?.description || '',
      generationPrompt: sc.visual?.generationPrompt || '',
      negativePrompt: sc.visual?.negativePrompt || '',
      backgroundAssetUrl: null,
    };
  });

  consume('scenes[].startSeconds');
  consume('scenes[].durationSeconds');
  consume('scenes[].onScreenText');
  consume('scenes[].narration');
  consume('scenes[].camera');
  consume('scenes[].motion');
  consume('scenes[].transitionOut');
  consume('scenes[].visual.assetKind');
  consume('scenes[].visual.description');
  consume('scenes[].visual.generationPrompt');

  if (scenes.some(s => s.negativePrompt)) {
    // No asset is generated in v1, so a negative prompt has nothing to act on.
    degrade('scenes[].visual.negativePrompt', 'negativePrompt is carried as metadata only — v1 generates no background assets, so it is unused.');
  }
  if (scenes.some(s => s.visualDescription || s.generationPrompt)) {
    warnings.push('Scene visuals render as styled placeholders in v1 — visual descriptions and generation prompts are preserved as metadata, not turned into imagery.');
  }
  // Narration is CONSUMED when a real synthesized track is attached, and only
  // degraded when there is text but no audio. P3 moved this from the second
  // case to the first.
  if (scenes.some(s => s.narration) || spec?.audio?.narration?.text) {
    if (narration?.audioId) consume('scenes[].narration');
    else degrade('scenes[].narration', 'Narration text is preserved as data but no audio track was generated for this composition.');
  }

  const totalDurationSeconds = round2(scenes.reduce((m, s) => Math.max(m, s.startSeconds + s.durationSeconds), 0));
  if (totalDurationSeconds < MIN_TOTAL_SECONDS || totalDurationSeconds > MAX_TOTAL_SECONDS) {
    warnings.push(`Total duration ${totalDurationSeconds}s is outside the v1 comfort range (${MIN_TOTAL_SECONDS}-${MAX_TOTAL_SECONDS}s).`);
  }
  consume('timing.totalDurationSeconds');

  // ── Captions ───────────────────────────────────────────────────────────
  const captionSegments = Array.isArray(spec?.captions?.segments) ? spec.captions.segments : [];
  if (captionSegments.length) consume('captions.segments');
  if (spec?.captions?.burnIn) consume('captions.burnIn');

  // ── Typography / visual style ──────────────────────────────────────────
  const typography = mapTypography(spec?.visualIdentity?.typography);
  if (typography.recognised) consume('visualIdentity.typography');
  else if (spec?.visualIdentity?.typography) degrade('visualIdentity.typography', 'Typography string not recognised — used default sans/medium/center.');

  const style = mapVisualStyle(spec?.visualIdentity?.visualStyle);
  if (style.recognised) consume('visualIdentity.visualStyle');

  // ── Explicitly ignored (honest, never silent) ──────────────────────────
  const ignoreIf = (present, field, note) => {
    if (present) { ignore(field); if (note) warnings.push(note); }
  };
  if (narration?.audioId) consume('audio.narration.text');
  else ignoreIf(!!spec?.audio?.narration?.text, 'audio.narration.text', 'Narration audio was not generated for this composition.');
  ignoreIf(spec?.audio?.music?.moodHint != null, 'audio.music.moodHint', 'Music intent present but unused.');
  ignoreIf((spec?.visualIdentity?.motionDirections || []).length > 0, 'visualIdentity.motionDirections', 'Per-scene motion directions are not individually choreographed in v1.');
  ignoreIf((spec?.visualIdentity?.transitionVocabulary || []).length > 0, 'visualIdentity.transitionVocabulary');
  ignoreIf((spec?.visualIdentity?.continuityNotes || []).length > 0, 'visualIdentity.continuityNotes');
  ignoreIf(!!spec?.visualIdentity?.compositionBrief, 'visualIdentity.compositionBrief');
  ignoreIf(!!spec?.visualIdentity?.thumbnail?.generationPrompt, 'visualIdentity.thumbnail', 'Thumbnail art direction is manifest metadata — it is not placed on the video timeline.');
  ignoreIf(!!spec?.presenter?.direction, 'presenter', 'Presenter direction is out of scope for faceless v1.');
  ignoreIf(!!spec?.captions?.post?.caption, 'captions.post', 'Platform post copy belongs to Publishing, not the render.');
  ignoreIf((spec?.intent?.alternateHooks || []).length > 0, 'intent.alternateHooks');
  ignoreIf(!!spec?.narrative?.script?.fullText, 'narrative.script.fullText', 'Full script is represented per-scene; the monolithic text is not rendered.');

  // NEVER fabricate music. Recorded as an explicit absence, not an omission.
  const music = { required: false, moodHint: null, fabricated: false };

  const data = {
    templateId: 'faceless-short',
    templateVersion: TEMPLATE_VERSION,
    translatorVersion: TRANSLATOR_VERSION,
    width: 1080,
    height: 1920,
    frameRate: 30,
    totalDurationSeconds,
    style: {
      fontClass: typography.fontClass,
      weightClass: typography.weightClass,
      alignClass: typography.alignClass,
      toneClasses: style.toneClasses,
    },
    scenes,
    // One narration track, or an explicit absence. Metadata only — the audio
    // itself is a separate file copied into the composition's assets/ dir, so
    // no base64 ever enters render-data.json.
    narration: narration ? {
      audioId: narration.audioId,
      // Fixed constant — the src is NEVER taken from the caller.
      src: `assets/${NARRATION_FILENAME}`,
      mimeType: narration.mimeType,
      durationSeconds: narration.durationSeconds,
      voiceId: narration.voiceId,
      speed: narration.speed,
      provider: narration.provider,
      model: narration.model,
      startSeconds: 0,
      timingFit: narration.timingFit || null,
    } : null,
    music,
  };

  const totalConsidered = consumedFields.length + degradedFields.length + ignoredFields.length;
  const report = {
    consumedFields: [...new Set(consumedFields)],
    degradedFields: [...new Set(degradedFields)],
    ignoredFields: [...new Set(ignoredFields)],
    warnings,
    completeness: totalConsidered
      ? Math.round((consumedFields.length / totalConsidered) * 100)
      : 0,
  };

  return { ok: true, data, report, totalDurationSeconds };
}

// ── Markup emission (numbers only — no text ever enters here) ────────────

function buildScenesMarkup(scenes) {
  return scenes.map((s) => {
    const i = Number(s.index);
    const start = Number(s.startSeconds);
    const dur = Number(s.durationSeconds);
    if (!Number.isFinite(i) || !Number.isFinite(start) || !Number.isFinite(dur)) {
      throw new Error('Refusing to emit markup for a scene with non-numeric timing.');
    }
    return [
      `      <div id="scene-${i}" class="scene clip" data-start="${start}" data-duration="${dur}" data-track-index="1">`,
      '        <div class="scene-bg"><div class="placeholder"></div></div>',
      '        <div class="scene-inner"><div class="headline"></div></div>',
      '      </div>',
      `      <div id="caption-${i}" class="caption clip" data-start="${start}" data-duration="${dur}" data-track-index="2"></div>`,
    ].join('\n');
  }).join('\n');
}

/**
 * Emits the single narration <audio> element. The `src` is the LITERAL
 * constant "assets/narration.wav" — never a caller-supplied path — and the
 * only varying values are validated numbers. Empty string when there is no
 * narration, so a silent composition is byte-identical to the pre-P3 shape
 * apart from the placeholder line.
 */
function buildAudioMarkup(narration) {
  if (!narration || !narration.audioId) return '';
  const dur = Number(narration.durationSeconds);
  if (!Number.isFinite(dur) || dur <= 0) return '';
  return [
    '      <audio id="narration" src="assets/narration.wav"',
    `           data-start="0" data-duration="${Math.round(dur * 100) / 100}"`,
    '           data-track-index="10" data-volume="1"></audio>',
  ].join('\n');
}

function contentHashOf(data, templateSource) {
  // Deterministic: canonical JSON of the render data + the exact template
  // bytes + translator version. `generatedAt` is deliberately excluded so the
  // same URS always yields the same id.
  const h = crypto.createHash('sha256');
  h.update(JSON.stringify(data));
  h.update(' ');
  h.update(templateSource);
  h.update(' ');
  h.update(`${TRANSLATOR_ID}@${TRANSLATOR_VERSION}`);
  return h.digest('hex');
}

function safeIdFragment(value, max = 40) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, max);
}

/** True when the directory is one of ours (carries our manifest marker). */
function isGeneratedDir(dir) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8'));
    return manifest?.generator === MANIFEST_GENERATOR;
  } catch { return false; }
}

/**
 * Translates a URS into a HyperFrames composition on disk.
 *
 * @param {object} spec — a valid URS
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun] — plan and hash only; write nothing
 * @returns {{ ok, compositionId?, created?, reused?, report?, manifest?, error? }}
 */
export function translateUrsToHyperFrames(spec, { dryRun = false, narration = null } = {}) {
  if (!spec || typeof spec !== 'object') {
    return { ok: false, error: 'A Universal Render Specification is required.' };
  }
  if (spec.ursVersion !== 1) {
    return { ok: false, error: `Unsupported ursVersion "${spec.ursVersion}" — this translator handles ursVersion 1.` };
  }

  const templatePath = path.join(TEMPLATE_DIR, 'index.html');
  let templateSource;
  try { templateSource = fs.readFileSync(templatePath, 'utf-8'); } catch {
    return { ok: false, error: 'HyperFrames faceless-short template is missing.' };
  }

  const planned = planTranslation(spec, { narration });
  if (!planned.ok) return { ok: false, error: planned.error, report: planned.report };

  const { data, report, totalDurationSeconds } = planned;
  const contentHash = contentHashOf(data, templateSource);

  const packageId = spec?.source?.packageId || spec?.specId || 'urs';
  const compositionId = `${GENERATED_PREFIX}${safeIdFragment(packageId)}-${contentHash.slice(0, 12)}`;
  if (!isValidCompositionId(compositionId)) {
    return { ok: false, error: 'Derived composition id failed HyperFrames id validation.' };
  }

  const manifest = {
    generator: MANIFEST_GENERATOR,
    translatorId: TRANSLATOR_ID,
    translatorVersion: TRANSLATOR_VERSION,
    templateId: 'faceless-short',
    templateVersion: TEMPLATE_VERSION,
    ursVersion: spec.ursVersion,
    renderSpecId: spec.specId || null,
    packageId: spec?.source?.packageId || null,
    workforceRunId: spec?.renderIntentSource?.runId || null,
    contentHash,
    compositionId,
    generatedAt: new Date().toISOString(),
    totalDurationSeconds,
    sceneCount: data.scenes.length,
    narration: narration ? {
      audioId: narration.audioId,
      voiceId: narration.voiceId,
      speed: narration.speed,
      provider: narration.provider,
      model: narration.model,
      durationSeconds: narration.durationSeconds,
      characterCount: narration.characterCount ?? null,
      timingFit: narration.timingFit || null,
    } : null,
    report,
    // Original upstream values retained verbatim, so a degraded mapping can
    // always be traced back to what the workforce actually said.
    originalValues: {
      scenes: (spec.scenes || []).slice(0, MAX_SCENES).map(s => ({
        index: s.index,
        camera: s.camera ?? null,
        motion: s.motion ?? null,
        transitionOut: s.transitionOut ?? null,
        assetKind: s.visual?.assetKind ?? null,
        negativePrompt: s.visual?.negativePrompt ?? null,
      })),
      typography: spec?.visualIdentity?.typography ?? null,
      visualStyle: spec?.visualIdentity?.visualStyle ?? null,
      transitionVocabulary: spec?.visualIdentity?.transitionVocabulary ?? [],
      thumbnail: spec?.visualIdentity?.thumbnail ?? null,
    },
  };

  if (dryRun) return { ok: true, compositionId, created: false, reused: false, report, manifest, dryRun: true };

  const targetDir = path.join(HYPERFRAMES_ROOT, compositionId);

  // ── Idempotency ────────────────────────────────────────────────────────
  if (fs.existsSync(targetDir)) {
    if (!isGeneratedDir(targetDir)) {
      return { ok: false, error: `Refusing to write over "${compositionId}" — it is not a translator-generated composition.` };
    }
    let existing = null;
    try { existing = JSON.parse(fs.readFileSync(path.join(targetDir, 'manifest.json'), 'utf-8')); } catch { /* rewrite below */ }
    if (existing?.contentHash === contentHash && fs.existsSync(path.join(targetDir, 'index.html'))) {
      return { ok: true, compositionId, created: false, reused: true, report, manifest: existing };
    }
  }

  const html = templateSource
    .replace('__TOTAL_DURATION__', String(totalDurationSeconds))
    .replace('__SCENES_MARKUP__', buildScenesMarkup(data.scenes))
    .replace('__AUDIO_MARKUP__', buildAudioMarkup(narration))
    .replace('__RENDER_DATA__', toJsonIsland(data));

  // Belt-and-braces: no placeholder may survive into the emitted file.
  for (const token of ['__TOTAL_DURATION__', '__SCENES_MARKUP__', '__AUDIO_MARKUP__', '__RENDER_DATA__']) {
    if (html.includes(token)) return { ok: false, error: `Template placeholder ${token} was not substituted.` };
  }

  // ── Atomic write ───────────────────────────────────────────────────────
  // Staged in a dot-prefixed sibling, which the composition store ignores (a
  // leading dot fails SAFE_COMPOSITION_ID_RE), then renamed into place.
  const stagingDir = path.join(HYPERFRAMES_ROOT, `.tmp-${compositionId}-${crypto.randomBytes(4).toString('hex')}`);
  try {
    fs.mkdirSync(stagingDir, { recursive: true });
    fs.writeFileSync(path.join(stagingDir, 'index.html'), html, 'utf-8');
    fs.writeFileSync(path.join(stagingDir, 'render-data.json'), JSON.stringify(data, null, 2), 'utf-8');
    fs.writeFileSync(path.join(stagingDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
    fs.writeFileSync(path.join(stagingDir, 'meta.json'), JSON.stringify({
      name: `Generated — ${manifest.packageId || compositionId}`,
      generated: true,
    }, null, 2), 'utf-8');

    // Narration audio is COPIED as a file into the staged composition — never
    // inlined as base64 into render-data.json. Copied while still staged so
    // the atomic rename publishes the composition and its asset together.
    if (narration?.audioId) {
      const copied = copyNarrationIntoComposition(narration.audioId, stagingDir);
      if (!copied.ok) throw new Error(copied.error);
    }

    if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
    fs.renameSync(stagingDir, targetDir);
  } catch (err) {
    try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch { /* ignore */ }
    return { ok: false, error: `Failed to write generated composition: ${err.message}` };
  }

  return { ok: true, compositionId, created: true, reused: false, report, manifest };
}

export const __testing = {
  mapTransition, mapMotion, mapAssetKind, mapTypography, mapVisualStyle,
  toJsonIsland, buildScenesMarkup, TRANSITION_ALLOWLIST, MOTION_PRESETS, TONE_TOKENS,
};
