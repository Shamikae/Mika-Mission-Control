#!/usr/bin/env node
// scripts/validate-render-spec.mjs
//
// Executable validation for the Universal Render Specification (URS).
// Follows this project's established convention (no jest/vitest configured) of
// running real code against real fs-backed data — no mocking.
//
// Unlike the adapter validators, URS is a PURE transform, so this needs no dev
// server, no credentials and no network: it reads the real Content Package and
// workforce run produced by the M0 proof-of-loop and exercises buildRenderSpec
// directly. Deterministic and side-effect free — nothing is written.
//
// Run: node scripts/validate-render-spec.mjs

import fs from 'fs';
import path from 'path';
import { buildRenderSpec } from '../lib/production/renderSpec/buildRenderSpec.js';
import { normalizeRenderIntent, validateRenderSpec } from '../lib/production/renderSpec/renderSpecSchema.js';

const ROOT = process.cwd();
const REAL_PACKAGE = 'pack-1785960819732-4ed2d0.json';
const LEGACY_PACKAGE = 'pack-openart-video-test1-1785944062.json';

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, ok: !!condition, detail });
  console.log(`${condition ? 'PASS' : 'FAIL'} — ${name}${detail && !condition ? ` (${detail})` : ''}`);
}

function readPackage(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'content-packages', file), 'utf8'));
}

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`);
}

// ── 1. New package with full renderIntent ──────────────────────────────────
section('New package with full renderIntent');

const pkg = readPackage(REAL_PACKAGE);
check('fixture package carries renderIntent', !!pkg.renderIntent);

const { ok, spec, validation } = buildRenderSpec(pkg, { mode: 'faceless_social' });
check('URS builds and validates', ok && validation.valid, JSON.stringify(validation.errors));
check('no validation errors', validation.errors.length === 0, JSON.stringify(validation.errors));
check('renderIntentSource.present is true', spec.renderIntentSource.present === true);
check('renderIntentSource carries runId', typeof spec.renderIntentSource.runId === 'string' && spec.renderIntentSource.runId.startsWith('wfr-'));
check('scene count is 7', spec.scenes.length === 7, `got ${spec.scenes.length}`);

// Preserved render-intent fields must be populated from the package block.
const preserved = [
  ['scenes[0].camera', spec.scenes[0].camera],
  ['scenes[0].motion', spec.scenes[0].motion],
  ['scenes[0].transitionOut', spec.scenes[0].transitionOut],
  ['scenes[0].visual.generationPrompt', spec.scenes[0].visual.generationPrompt],
  ['scenes[0].visual.negativePrompt', spec.scenes[0].visual.negativePrompt],
  ['intent.pacing', spec.intent.pacing],
  ['visualIdentity.typography', spec.visualIdentity.typography],
  ['visualIdentity.visualStyle', spec.visualIdentity.visualStyle],
  ['visualIdentity.compositionBrief', spec.visualIdentity.compositionBrief],
  ['captions.post.firstComment', spec.captions.post.firstComment],
];
for (const [label, value] of preserved) {
  check(`${label} populated`, value != null && value !== '', 'null');
}
check('scenes[0].visual.assetKind is the verbatim upstream term', spec.scenes[0].visual.assetKind === 'video', spec.scenes[0].visual.assetKind);
check('every scene carries camera direction', spec.scenes.every(s => !!s.camera));
check('every scene carries a generation prompt', spec.scenes.every(s => !!s.visual.generationPrompt));
check('transitionVocabulary populated', spec.visualIdentity.transitionVocabulary.length === 4, String(spec.visualIdentity.transitionVocabulary.length));
check('motionDirections populated', spec.visualIdentity.motionDirections.length === 7, String(spec.visualIdentity.motionDirections.length));
check('continuityNotes populated', spec.visualIdentity.continuityNotes.length === 2, String(spec.visualIdentity.continuityNotes.length));
check('caption alternates populated', spec.captions.post.alternates.length === 3, String(spec.captions.post.alternates.length));
check('platformVariants populated', Object.keys(spec.captions.post.platformVariants).length === 6, String(Object.keys(spec.captions.post.platformVariants).length));

// ── 2. Derived values preserved (must not regress) ─────────────────────────
section('Derived values preserved');

check('orientation derived', spec.output.orientation === 'portrait', String(spec.output.orientation));
check('resolution parsed to numbers', spec.output.resolution?.width === 1080 && spec.output.resolution?.height === 1920);
check('target duration range parsed', spec.output.targetDuration.minSeconds === 35 && spec.output.targetDuration.maxSeconds === 45);
check('absolute timeline contiguous', spec.scenes[0].startSeconds === 0 && spec.scenes[6].endSeconds === 45);
check('timeline has no gaps', spec.scenes.every((s, i, a) => i === 0 || s.startSeconds === a[i - 1].endSeconds));
check('withinRequestedRange true', spec.timing.withinRequestedRange === true);
check('timing.source is scene_durations', spec.timing.source === 'scene_durations', spec.timing.source);
check('declaredTotalSeconds matches derived total', spec.timing.declaredTotalSeconds === spec.timing.totalDurationSeconds,
  `${spec.timing.declaredTotalSeconds} vs ${spec.timing.totalDurationSeconds}`);

// ── 3. visualBrief and imagePrompt remain distinct ─────────────────────────
section('visualBrief / imagePrompt distinctness');

const runFile = fs.readdirSync(path.join(ROOT, 'data', 'content-workforce-runs'))[0];
const run = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'content-workforce-runs', runFile), 'utf8'));
const thumbStage = run.stages.thumbnail.result.output;

check('stage visualBrief differs from stage imagePrompt', thumbStage.visualBrief !== thumbStage.imagePrompt);
check('URS artBrief equals the stage visualBrief', spec.visualIdentity.thumbnail.artBrief === thumbStage.visualBrief,
  String(spec.visualIdentity.thumbnail.artBrief));
check('URS thumbnail.generationPrompt equals the stage imagePrompt', spec.visualIdentity.thumbnail.generationPrompt === thumbStage.imagePrompt);
check('artBrief and generationPrompt are NOT collapsed',
  spec.visualIdentity.thumbnail.artBrief !== spec.visualIdentity.thumbnail.generationPrompt);
check('thumbnail negativePrompt preserved', spec.visualIdentity.thumbnail.negativePrompt === thumbStage.negativePrompt);

// ── 4. No information loss from preserved render fields ────────────────────
section('No information loss from preserved render fields');

const specBlob = JSON.stringify(spec);
const intentBlob = JSON.stringify(pkg.renderIntent);
function leafStrings(node, out = []) {
  if (typeof node === 'string') { if (node.trim().length >= 4) out.push(node.trim()); return out; }
  if (Array.isArray(node)) { node.forEach(v => leafStrings(v, out)); return out; }
  if (node && typeof node === 'object') { Object.values(node).forEach(v => leafStrings(v, out)); }
  return out;
}
// Values the URS deliberately does not carry: run provenance + review governance.
const EXCLUDED = new Set([
  ...leafStrings(pkg.renderIntent?.reviewSignal || {}),
  pkg.renderIntent?.sourceRunId,
  pkg.renderIntent?.capturedAt,
  ...(pkg.renderIntent?.direction?.scenes || []).map(s => s.providerHint).filter(Boolean),
].filter(Boolean));

const intentValues = [...new Set(leafStrings(pkg.renderIntent))].filter(v => !EXCLUDED.has(v));
const lost = intentValues.filter(v => !specBlob.includes(v.slice(0, 60)));
check(`all ${intentValues.length} render-intent values reach the URS`, lost.length === 0, lost.slice(0, 3).join(' | '));

// ── 5. Provider neutrality ─────────────────────────────────────────────────
section('Provider neutrality');

const PROVIDER_TOKENS = ['heygen', 'hyperframes', 'openart', 'higgsfield', 'runway', 'kling', 'veo', 'flux', 'mcp', 'npx', 'apiKey', 'compositionId', 'providerHint'];
function keysOf(node, out = []) {
  if (Array.isArray(node)) { node.forEach(v => keysOf(v, out)); return out; }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) { out.push(k); keysOf(v, out); }
  }
  return out;
}
const specKeys = [...new Set(keysOf(spec))];
const keyLeaks = specKeys.filter(k => PROVIDER_TOKENS.some(t => k.toLowerCase().includes(t.toLowerCase())));
check('no provider-specific KEY anywhere in the URS', keyLeaks.length === 0, keyLeaks.join(','));
check('providerHint (advisory upstream field) never reaches the URS', !specKeys.includes('providerHint'));

// Whitelist normalization must drop an injected provider key.
const poisoned = JSON.parse(JSON.stringify(pkg));
poisoned.renderIntent.generation.hyperframes = { compositionId: 'evil-composition' };
poisoned.renderIntent.mcpEndpoint = 'https://example.invalid';
poisoned.renderIntent.direction.scenes[0].openartModel = 'flux-pro';
const poisonedSpec = buildRenderSpec(poisoned, {}).spec;
const poisonedKeys = [...new Set(keysOf(poisonedSpec))];
check('injected provider keys are stripped by normalization',
  !poisonedKeys.some(k => ['hyperframes', 'compositionId', 'mcpEndpoint', 'openartModel'].includes(k)),
  poisonedKeys.filter(k => ['hyperframes', 'compositionId', 'mcpEndpoint', 'openartModel'].includes(k)).join(','));
check('injected provider VALUES do not leak', !JSON.stringify(poisonedSpec).includes('evil-composition'));

// ── 6. Music intent stays null when not produced ───────────────────────────
section('Music intent honesty');

check('audio.music.moodHint is null', spec.audio.music.moodHint === null);
check('audio.music.required is false', spec.audio.music.required === false);
check('completeness names music as the only gap',
  spec.completeness.missing.length === 1 && spec.completeness.missing[0] === 'audio.music intent',
  JSON.stringify(spec.completeness.missing));
check('completeness score is 97', spec.completeness.score === 97, String(spec.completeness.score));

// ── 7. Legacy package without renderIntent ─────────────────────────────────
section('Legacy package (no renderIntent)');

const legacy = readPackage(LEGACY_PACKAGE);
check('fixture legacy package has NO renderIntent', !legacy.renderIntent);

const legacyResult = buildRenderSpec(legacy, {});
check('legacy URS still builds and validates', legacyResult.ok && legacyResult.validation.valid, JSON.stringify(legacyResult.validation.errors));
check('legacy renderIntentSource.present is false', legacyResult.spec.renderIntentSource.present === false);
check('legacy renderIntentSource.runId is null', legacyResult.spec.renderIntentSource.runId === null);
check('legacy render-intent fields stay null (not fabricated)',
  legacyResult.spec.scenes.every(s => s.camera === null && s.motion === null && s.transitionOut === null
    && s.visual.generationPrompt === null && s.visual.negativePrompt === null));
check('legacy visualIdentity fields stay null', legacyResult.spec.visualIdentity.typography === null && legacyResult.spec.visualIdentity.visualStyle === null);
check('legacy assetKind falls back to unspecified', legacyResult.spec.scenes.every(s => s.visual.assetKind === 'unspecified'));
check('legacy still derives orientation', !!legacyResult.spec.output.orientation);
check('legacy still derives absolute timeline', legacyResult.spec.scenes[0]?.startSeconds === 0);
check('legacy presenter section is empty, not absent', legacyResult.spec.presenter && legacyResult.spec.presenter.direction === null);

// ── 8. Malformed renderIntent sanitization ─────────────────────────────────
section('Malformed renderIntent sanitization');

const malformedCases = [
  ['null', null],
  ['a string', 'not-an-object'],
  ['an array', [1, 2, 3]],
  ['a number', 42],
  ['empty object', {}],
  ['wrong-typed sections', { direction: 'nope', generation: 7, thumbnailDirection: [], captionVariants: null }],
  ['scenes not an array', { direction: { scenes: 'nope', pacing: 12 } }],
  ['scene entries not objects', { direction: { scenes: ['a', null, 3] } }],
  ['imagePrompts wrong type', { generation: { imageGeneration: { prompts: 'nope' } } }],
  ['deeply wrong types', { direction: { pacing: {}, continuityNotes: 'x', totalDurationSeconds: 'ten' } }],
];

let malformedPass = 0;
for (const [label, bad] of malformedCases) {
  const p = { ...pkg, renderIntent: bad };
  let built;
  try { built = buildRenderSpec(p, {}); } catch (e) {
    check(`malformed (${label}) does not throw`, false, e.message);
    continue;
  }
  const structurallyValid = built.ok && built.validation.valid;
  // NB: typeof null === 'object', so check explicitly for null-or-string.
  const pacing = built.spec?.intent?.pacing;
  const noJunk = !!built.spec && (pacing === null || typeof pacing === 'string');
  if (structurallyValid && noJunk) malformedPass++;
  check(`malformed (${label}) degrades safely`, structurallyValid && noJunk,
    JSON.stringify(built.validation?.errors || []));
}
check(`all ${malformedCases.length} malformed shapes handled`, malformedPass === malformedCases.length, `${malformedPass}/${malformedCases.length}`);

// normalizeRenderIntent contract directly
check('normalizeRenderIntent(null) returns null', normalizeRenderIntent(null) === null);
check('normalizeRenderIntent("x") returns null', normalizeRenderIntent('x') === null);
check('normalizeRenderIntent({}) returns a fully-shaped object',
  (() => { const n = normalizeRenderIntent({}); return n && n.direction && Array.isArray(n.direction.scenes) && Array.isArray(n.imagePrompts); })());

// ── 9. Purity ──────────────────────────────────────────────────────────────
section('Purity');

const before = JSON.stringify(pkg);
buildRenderSpec(pkg, { mode: 'faceless_social' });
check('buildRenderSpec does not mutate the package', JSON.stringify(pkg) === before);
const a = buildRenderSpec(pkg, {}).spec;
const b = buildRenderSpec(pkg, {}).spec;
delete a.createdAt; delete b.createdAt;
check('buildRenderSpec is deterministic', JSON.stringify(a) === JSON.stringify(b));

// ── Summary ────────────────────────────────────────────────────────────────
const passed = results.filter(r => r.ok).length;
const failed = results.length - passed;
console.log(`\n${'═'.repeat(64)}`);
console.log(`URS validation: ${passed}/${results.length} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  results.filter(r => !r.ok).forEach(r => console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ''}`));
}
process.exit(failed ? 1 : 0);
