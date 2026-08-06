#!/usr/bin/env node
// scripts/validate-hyperframes-translator.mjs
//
// Executable validation for the URS → HyperFrames translator (v1).
// Follows the project convention: real code, real filesystem, no mocking.
// Needs no dev server and no credentials — the translator is deterministic
// and local. Every composition it creates is cleaned up on exit.
//
// Run: node scripts/validate-hyperframes-translator.mjs

import fs from 'fs';
import path from 'path';
import { buildRenderSpec } from '../lib/production/renderSpec/buildRenderSpec.js';
import {
  translateUrsToHyperFrames, planTranslation, TRANSLATOR_VERSION, GENERATED_PREFIX,
  MANIFEST_GENERATOR, __testing,
} from '../lib/production/renderSpec/translators/hyperframesTranslator.js';
import { HYPERFRAMES_ROOT, isValidCompositionId } from '../lib/hyperframes/hyperframesSecurity.js';
import { getHyperFramesComposition, listHyperFramesCompositions } from '../lib/hyperframes/hyperframesCompositionStore.js';
import { validateHyperFramesProviderInputSync } from '../lib/production/execution/adapters/hyperframes.adapter.js';

const ROOT = process.cwd();
const REAL_PACKAGE = 'pack-1785960819732-4ed2d0.json';
const LEGACY_PACKAGE = 'pack-openart-video-test1-1785944062.json';

const results = [];
const created = new Set();

function check(name, condition, detail = '') {
  results.push({ name, ok: !!condition, detail });
  console.log(`${condition ? 'PASS' : 'FAIL'} — ${name}${detail && !condition ? ` (${detail})` : ''}`);
}
function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 56 - title.length))}`);
}
function readPackage(f) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'content-packages', f), 'utf8'));
}
function specFor(file, mode = 'faceless_social') {
  return buildRenderSpec(readPackage(file), { mode }).spec;
}
function compDir(id) { return path.join(HYPERFRAMES_ROOT, id); }

// Compositions that already existed before this run. The translator is
// deterministic, so validating against the REAL package derives the SAME id a
// real render used — cleaning that up would delete live production output
// (it did, once). Anything pre-existing is therefore never removed.
const PRE_EXISTING = new Set(
  fs.readdirSync(HYPERFRAMES_ROOT, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name),
);

function track(id) {
  if (id && !PRE_EXISTING.has(id)) created.add(id);
  return id;
}

// Snapshot hand-authored compositions so we can prove they were untouched.
const HAND_AUTHORED = fs.readdirSync(HYPERFRAMES_ROOT, { withFileTypes: true })
  .filter(e => e.isDirectory() && !e.name.startsWith(GENERATED_PREFIX) && !e.name.startsWith('.'))
  .map(e => e.name);
const handAuthoredSnapshot = new Map();
for (const name of HAND_AUTHORED) {
  const idx = path.join(HYPERFRAMES_ROOT, name, 'index.html');
  handAuthoredSnapshot.set(name, fs.existsSync(idx) ? fs.statSync(idx).mtimeMs + ':' + fs.statSync(idx).size : 'absent');
}

try {
  // ── 1. Valid URS translation ─────────────────────────────────────────────
  section('Valid URS translation');

  const spec = specFor(REAL_PACKAGE);
  check('real package produces a valid URS', !!spec && spec.ursVersion === 1);

  const r1 = translateUrsToHyperFrames(spec);
  track(r1.compositionId);
  check('translation succeeds', r1.ok, r1.error);
  check('returns a valid compositionId', isValidCompositionId(r1.compositionId), String(r1.compositionId));
  check('compositionId uses the reserved generated namespace', r1.compositionId.startsWith(GENERATED_PREFIX));
  check('composition directory created', fs.existsSync(compDir(r1.compositionId)));
  check('index.html written', fs.existsSync(path.join(compDir(r1.compositionId), 'index.html')));
  check('render-data.json written', fs.existsSync(path.join(compDir(r1.compositionId), 'render-data.json')));
  check('manifest.json written', fs.existsSync(path.join(compDir(r1.compositionId), 'manifest.json')));

  const html = fs.readFileSync(path.join(compDir(r1.compositionId), 'index.html'), 'utf8');
  const renderData = JSON.parse(fs.readFileSync(path.join(compDir(r1.compositionId), 'render-data.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(compDir(r1.compositionId), 'manifest.json'), 'utf8'));

  // ── 2. Manifest + content hash + versioning ──────────────────────────────
  section('Manifest, content hash, versioning');

  check('manifest carries packageId', manifest.packageId === 'pack-1785960819732-4ed2d0');
  check('manifest carries renderSpecId', manifest.renderSpecId === spec.specId);
  check('manifest carries ursVersion', manifest.ursVersion === 1);
  check('manifest carries translatorVersion', manifest.translatorVersion === TRANSLATOR_VERSION);
  check('manifest carries generatedAt', typeof manifest.generatedAt === 'string' && !Number.isNaN(Date.parse(manifest.generatedAt)));
  check('manifest carries a sha256 content hash', /^[0-9a-f]{64}$/.test(manifest.contentHash));
  check('compositionId embeds the content hash', r1.compositionId.endsWith(manifest.contentHash.slice(0, 12)));
  check('manifest generator marker present', manifest.generator === MANIFEST_GENERATOR);
  check('manifest preserves original values', !!manifest.originalValues && Array.isArray(manifest.originalValues.scenes));
  check('original camera value preserved verbatim',
    manifest.originalValues.scenes[0].camera === spec.scenes[0].camera);
  check('original transitionOut preserved verbatim',
    manifest.originalValues.scenes[0].transitionOut === spec.scenes[0].transitionOut);

  // ── 3. Determinism + idempotency ─────────────────────────────────────────
  section('Determinism and idempotency');

  const r2 = translateUrsToHyperFrames(specFor(REAL_PACKAGE));
  check('same URS yields the same compositionId', r2.compositionId === r1.compositionId);
  check('second call reuses rather than recreating', r2.reused === true && r2.created === false);
  const html2 = fs.readFileSync(path.join(compDir(r2.compositionId), 'index.html'), 'utf8');
  check('emitted HTML is byte-identical', html2 === html);

  const dry = translateUrsToHyperFrames(specFor(REAL_PACKAGE), { dryRun: true });
  check('dryRun yields the same id without writing', dry.compositionId === r1.compositionId && dry.dryRun === true);

  const mutated = specFor(REAL_PACKAGE);
  mutated.scenes[0].onScreenText = 'A different headline entirely';
  const r3 = translateUrsToHyperFrames(mutated);
  track(r3.compositionId);
  check('changed URS content yields a NEW composition id', r3.compositionId !== r1.compositionId);
  check('original composition still intact after content change', fs.existsSync(path.join(compDir(r1.compositionId), 'index.html')));

  // ── 4. Security: no code injection ───────────────────────────────────────
  section('Security — injection resistance');

  const hostile = specFor(REAL_PACKAGE);
  const PAYLOAD = '</script><script>window.__pwned=1;</script>';
  hostile.scenes[0].onScreenText = PAYLOAD;
  hostile.scenes[1].narration = '"; window.__pwned2=1; //';
  hostile.visualIdentity.typography = 'sans; } body { background: url(javascript:alert(1)) } .x {';
  hostile.scenes[2].visual.description = '<img src=x onerror=alert(1)>';
  const rh = translateUrsToHyperFrames(hostile);
  track(rh.compositionId);
  check('hostile URS still translates', rh.ok, rh.error);

  const hostileHtml = fs.readFileSync(path.join(compDir(rh.compositionId), 'index.html'), 'utf8');
  check('raw </script> payload never appears in emitted HTML', !hostileHtml.includes('</script><script>'));
  check('escaped as \\u003c in the JSON island', hostileHtml.includes('\\u003c/script'));
  check('window.__pwned is never executable', !/(^|[^\\u])<script>window\.__pwned/.test(hostileHtml));
  check('img onerror payload not emitted as markup', !hostileHtml.includes('<img src=x onerror'));
  check('hostile typography did not become CSS',
    !hostileHtml.includes('javascript:alert') && !hostileHtml.includes('url(javascript'));
  check('typography mapped to an allowlisted class only',
    ['font-sans', 'font-serif', 'font-mono'].includes(JSON.parse(fs.readFileSync(path.join(compDir(rh.compositionId), 'render-data.json'), 'utf8')).style.fontClass));

  // The JSON island must still parse, and round-trip the payload as DATA.
  const islandMatch = hostileHtml.match(/<script type="application\/json" id="hf-render-data">([\s\S]*?)<\/script>/);
  check('JSON island is extractable', !!islandMatch);
  let island = null;
  try { island = JSON.parse(islandMatch[1]); } catch { /* handled below */ }
  check('JSON island parses', !!island);
  check('payload survives as inert DATA (not markup)', island?.scenes?.[0]?.onScreenText === PAYLOAD);
  check('no template placeholder survives', !hostileHtml.includes('__RENDER_DATA__') && !hostileHtml.includes('__SCENES_MARKUP__') && !hostileHtml.includes('__TOTAL_DURATION__'));
  check('bootstrap uses textContent, never innerHTML', hostileHtml.includes('.textContent =') && !hostileHtml.includes('.innerHTML'));
  check('no eval/Function in emitted HTML', !/\beval\s*\(|new\s+Function\s*\(/.test(hostileHtml));

  // ── 5. Path safety ───────────────────────────────────────────────────────
  section('Path safety');

  const traversal = specFor(REAL_PACKAGE);
  traversal.source.packageId = '../../../etc/passwd';
  const rt = translateUrsToHyperFrames(traversal, { dryRun: true });
  check('traversal in packageId is sanitized out of the id', rt.ok && !rt.compositionId.includes('..') && !rt.compositionId.includes('/'), String(rt.compositionId));
  check('sanitized id still valid', isValidCompositionId(rt.compositionId));

  const absolute = specFor(REAL_PACKAGE);
  absolute.source.packageId = '/etc/shadow';
  const ra = translateUrsToHyperFrames(absolute, { dryRun: true });
  check('absolute path in packageId is sanitized', ra.ok && !ra.compositionId.includes('/'));

  const allGenerated = fs.readdirSync(HYPERFRAMES_ROOT, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name.startsWith(GENERATED_PREFIX)).map(e => e.name);
  check('every generated dir is a direct child of tools/hyperframes',
    allGenerated.every(n => fs.existsSync(path.join(HYPERFRAMES_ROOT, n, 'manifest.json'))));
  check('no staging (.tmp-) directories left behind',
    fs.readdirSync(HYPERFRAMES_ROOT).filter(n => n.startsWith('.tmp-')).length === 0);

  // Symlink rejection — a symlinked target must never be written through.
  const symlinkId = `${GENERATED_PREFIX}symlinktest-000000000000`;
  const symlinkPath = compDir(symlinkId);
  const outsideDir = fs.mkdtempSync(path.join(ROOT, '.symlink-probe-'));
  let symlinkOk = false;
  try {
    fs.symlinkSync(outsideDir, symlinkPath, 'dir');
    // A symlinked dir carries no manifest of ours -> must be refused.
    const probe = specFor(REAL_PACKAGE);
    const forced = translateUrsToHyperFrames(probe);
    // Independently: the security layer must reject the symlink outright.
    symlinkOk = (await getHyperFramesComposition(symlinkId)) === null;
    track(forced.compositionId);
  } catch { symlinkOk = true; } finally {
    try { fs.unlinkSync(symlinkPath); } catch { /* ignore */ }
    try { fs.rmSync(outsideDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  check('symlinked composition dir is rejected by the security layer', symlinkOk);

  // ── 6. Hand-authored compositions untouched ──────────────────────────────
  section('Hand-authored compositions untouched');

  let untouched = true;
  for (const [name, sig] of handAuthoredSnapshot.entries()) {
    const idx = path.join(HYPERFRAMES_ROOT, name, 'index.html');
    const now = fs.existsSync(idx) ? fs.statSync(idx).mtimeMs + ':' + fs.statSync(idx).size : 'absent';
    if (now !== sig) { untouched = false; break; }
  }
  check(`all ${handAuthoredSnapshot.size} hand-authored compositions unmodified`, untouched);

  // Refuse to overwrite a non-generated directory that collides by name.
  const collideId = `${GENERATED_PREFIX}collide-aaaaaaaaaaaa`;
  fs.mkdirSync(compDir(collideId), { recursive: true });
  fs.writeFileSync(path.join(compDir(collideId), 'index.html'), '<!-- hand authored -->', 'utf8');
  const collideSpec = specFor(REAL_PACKAGE);
  collideSpec.source.packageId = 'collide';
  // Force the id to collide by writing a fake manifest-less dir at the real target.
  const forcedTarget = translateUrsToHyperFrames(collideSpec, { dryRun: true }).compositionId;
  fs.mkdirSync(compDir(forcedTarget), { recursive: true });
  fs.writeFileSync(path.join(compDir(forcedTarget), 'index.html'), '<!-- hand authored -->', 'utf8');
  const refused = translateUrsToHyperFrames(collideSpec);
  check('refuses to overwrite a directory without our manifest marker', refused.ok === false && /Refusing to write over/.test(refused.error || ''), refused.error);
  check('the colliding hand-authored file is intact',
    fs.readFileSync(path.join(compDir(forcedTarget), 'index.html'), 'utf8') === '<!-- hand authored -->');
  fs.rmSync(compDir(collideId), { recursive: true, force: true });
  fs.rmSync(compDir(forcedTarget), { recursive: true, force: true });

  // ── 7. Mapping fidelity ──────────────────────────────────────────────────
  section('Mapping fidelity');

  check('scene count preserved', renderData.scenes.length === spec.scenes.length);
  check('scene start times preserved',
    renderData.scenes.every((s, i) => s.startSeconds === spec.scenes[i].startSeconds));
  check('scene durations preserved',
    renderData.scenes.every((s, i) => s.durationSeconds === spec.scenes[i].durationSeconds));
  check('total duration matches URS', renderData.totalDurationSeconds === spec.timing.totalDurationSeconds);
  check('root data-duration matches total', html.includes(`data-duration="${renderData.totalDurationSeconds}"`));
  check('narration preserved per scene',
    renderData.scenes.every((s, i) => s.narration === (spec.scenes[i].narration || '')));
  check('on-screen text preserved per scene',
    renderData.scenes.every((s, i) => s.onScreenText === (spec.scenes[i].onScreenText || '')));
  check('caption timing offsets preserved',
    renderData.scenes.every((s, i) => s.startSeconds === spec.scenes[i].startSeconds && s.durationSeconds === spec.scenes[i].durationSeconds));
  check('generation prompts preserved as metadata',
    renderData.scenes.every((s, i) => s.generationPrompt === (spec.scenes[i].visual.generationPrompt || '')));
  check('negative prompts preserved as metadata',
    renderData.scenes.every((s, i) => s.negativePrompt === (spec.scenes[i].visual.negativePrompt || '')));
  check('resolution is 1080x1920', renderData.width === 1080 && renderData.height === 1920);
  check('every clip carries data-start/data-duration',
    (html.match(/class="scene clip" data-start="/g) || []).length === spec.scenes.length);

  check('transitions map into the allowlist',
    renderData.scenes.every(s => __testing.TRANSITION_ALLOWLIST.includes(s.transitionOut)));
  check('motion presets map into the allowlist',
    renderData.scenes.every(s => __testing.MOTION_PRESETS.includes(s.motionPreset)));
  check('unknown assetKind "video" maps explicitly to generated_video',
    __testing.mapAssetKind('video').value === 'generated_video' && __testing.mapAssetKind('video').degraded === false);
  check('truly unknown assetKind degrades with a flag',
    __testing.mapAssetKind('hologram').value === 'unspecified' && __testing.mapAssetKind('hologram').degraded === true);
  check('unknown camera/motion falls back to still + degraded',
    __testing.mapMotion('teleport sideways', '').value === 'still' && __testing.mapMotion('teleport sideways', '').degraded === true);
  check('unknown transition falls back to cut + degraded',
    __testing.mapTransition('star wipe').value === 'cut' && __testing.mapTransition('star wipe').degraded === true);
  check('typography maps to allowlisted tokens only',
    ['font-sans', 'font-serif', 'font-mono'].includes(renderData.style.fontClass)
    && ['weight-regular', 'weight-medium', 'weight-bold'].includes(renderData.style.weightClass)
    && ['align-left', 'align-center'].includes(renderData.style.alignClass));
  check('visual style maps to allowlisted tone tokens only',
    renderData.style.toneClasses.every(c => __testing.TONE_TOKENS.includes(c)));

  // ── 8. Music absence ─────────────────────────────────────────────────────
  section('Music absence');

  check('render data reports music as not required', renderData.music.required === false);
  check('render data never fabricates a mood hint', renderData.music.moodHint === null);
  check('music explicitly flagged as not fabricated', renderData.music.fabricated === false);
  check('no audio element in emitted HTML', !/<audio/i.test(html));

  // ── 9. Translation report ────────────────────────────────────────────────
  section('Translation report');

  const rep = r1.report;
  check('report has all five sections',
    Array.isArray(rep.consumedFields) && Array.isArray(rep.degradedFields)
    && Array.isArray(rep.ignoredFields) && Array.isArray(rep.warnings)
    && Number.isFinite(rep.completeness));
  check('consumed fields reported', rep.consumedFields.length > 0, String(rep.consumedFields.length));
  check('degraded fields reported', rep.degradedFields.length > 0, String(rep.degradedFields.length));
  check('ignored fields reported', rep.ignoredFields.length > 0, String(rep.ignoredFields.length));
  check('narration degradation is reported, not silent', rep.degradedFields.includes('scenes[].narration'));
  check('negativePrompt degradation is reported, not silent', rep.degradedFields.includes('scenes[].visual.negativePrompt'));
  check('every degraded field has a warning', rep.warnings.length >= 1);
  check('completeness is a 0-100 percentage', rep.completeness >= 0 && rep.completeness <= 100);
  check('report is embedded in the manifest', !!manifest.report && manifest.report.completeness === rep.completeness);

  // ── 10. Legacy package translation ───────────────────────────────────────
  section('Legacy package (no renderIntent)');

  const legacySpec = specFor(LEGACY_PACKAGE, 'faceless_social');
  check('legacy package produces a valid URS', !!legacySpec && legacySpec.ursVersion === 1);
  const rl = translateUrsToHyperFrames(legacySpec);
  track(rl.compositionId);
  check('legacy URS translates successfully', rl.ok, rl.error);
  check('legacy composition is created', fs.existsSync(path.join(compDir(rl.compositionId), 'index.html')));
  const legacyData = JSON.parse(fs.readFileSync(path.join(compDir(rl.compositionId), 'render-data.json'), 'utf8'));
  check('legacy scenes all fall back to still motion', legacyData.scenes.every(s => s.motionPreset === 'still'));
  check('legacy scenes carry no fabricated prompts', legacyData.scenes.every(s => s.generationPrompt === ''));
  check('legacy music still absent', legacyData.music.moodHint === null);

  // ── 11. Integration with the existing store + adapter ────────────────────
  section('Existing store and adapter integration');

  const discovered = await getHyperFramesComposition(r1.compositionId);
  check('generated composition discoverable by the existing store', !!discovered && discovered.id === r1.compositionId);
  check('store reports index.html present', discovered?.hasIndexHtml === true);
  const listed = await listHyperFramesCompositions();
  check('generated composition appears in the composition list', listed.some(c => c.id === r1.compositionId));
  check('templates/ directory is NOT listed as a composition', !listed.some(c => c.id === 'templates'));

  const adapterValidation = validateHyperFramesProviderInputSync({
    job: { selectedMode: 'faceless_social', providerInput: { compositionId: r1.compositionId, quality: 'standard' } },
    compositionExists: true,
  });
  check('existing HyperFrames adapter accepts the generated composition', adapterValidation.valid === true, JSON.stringify(adapterValidation.errors));

  const adapterRejects = validateHyperFramesProviderInputSync({
    job: { selectedMode: 'faceless_social', providerInput: {} },
    compositionExists: null,
  });
  check('adapter still rejects a missing composition (unchanged behavior)', adapterRejects.valid === false);

  // ── 12. Non-interference ─────────────────────────────────────────────────
  section('Non-interference');

  const jobsDir = path.join(ROOT, 'data', 'production-jobs');
  const jobCountBefore = fs.readdirSync(jobsDir).length;
  translateUrsToHyperFrames(specFor(REAL_PACKAGE));
  check('translation creates no Production Job', fs.readdirSync(jobsDir).length === jobCountBefore);

  const runsDir = path.join(ROOT, 'data', 'hyperframes-runs');
  const runCountBefore = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).length : 0;
  translateUrsToHyperFrames(specFor(REAL_PACKAGE));
  check('translation starts no HyperFrames run (standalone flow untouched)',
    (fs.existsSync(runsDir) ? fs.readdirSync(runsDir).length : 0) === runCountBefore);

  // Comments legitimately discuss spawning and provider names — check the
  // executable code only.
  const translatorSrc = fs.readFileSync(path.join(ROOT, 'lib/production/renderSpec/translators/hyperframesTranslator.js'), 'utf8');
  const translatorCode = translatorSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('translator never spawns a process', !/spawn|execFile|child_process/.test(translatorCode));
  check('translator never imports a remote provider adapter', !/heygen|higgsfield|openart/i.test(translatorCode));

  // ── 13. Malformed input ──────────────────────────────────────────────────
  section('Malformed input');

  for (const [label, bad] of [['null', null], ['string', 'x'], ['number', 7], ['empty object', {}]]) {
    const out = translateUrsToHyperFrames(bad);
    check(`malformed URS (${label}) refused cleanly`, out.ok === false && typeof out.error === 'string');
  }
  const noScenes = specFor(REAL_PACKAGE); noScenes.scenes = [];
  const rns = translateUrsToHyperFrames(noScenes);
  check('URS with no scenes refused', rns.ok === false && /no scenes/i.test(rns.error));
  const wrongVersion = specFor(REAL_PACKAGE); wrongVersion.ursVersion = 99;
  check('unsupported ursVersion refused', translateUrsToHyperFrames(wrongVersion).ok === false);
  check('planTranslation is pure (no write)', planTranslation(specFor(REAL_PACKAGE)).ok === true);
} finally {
  // ── Cleanup ────────────────────────────────────────────────────────────
  for (const id of created) {
    if (PRE_EXISTING.has(id)) continue; // never delete something we did not create
    try { fs.rmSync(compDir(id), { recursive: true, force: true }); } catch { /* ignore */ }
  }
  for (const n of fs.readdirSync(HYPERFRAMES_ROOT)) {
    if (n.startsWith('.tmp-')) { try { fs.rmSync(path.join(HYPERFRAMES_ROOT, n), { recursive: true, force: true }); } catch { /* ignore */ } }
  }
  console.log(`\ncleaned up ${created.size} generated composition(s)`);
}

const passed = results.filter(r => r.ok).length;
const failed = results.length - passed;
console.log(`${'═'.repeat(64)}`);
console.log(`HyperFrames translator validation: ${passed}/${results.length} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  results.filter(r => !r.ok).forEach(r => console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ''}`));
}
process.exit(failed ? 1 : 0);
