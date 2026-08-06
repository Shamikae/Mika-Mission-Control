#!/usr/bin/env node
// scripts/validate-hyperframes-narration.mjs
//
// Executable validation for URS narration → local audio → generated
// HyperFrames composition. Project convention: real code, real filesystem,
// no mocking. Needs no dev server, no credential, no network — narration is
// synthesized locally at zero cost.
//
// Run: node scripts/validate-hyperframes-narration.mjs

import fs from 'fs';
import path from 'path';
import { buildRenderSpec } from '../lib/production/renderSpec/buildRenderSpec.js';
import { translateUrsToHyperFrames } from '../lib/production/renderSpec/translators/hyperframesTranslator.js';
import { HYPERFRAMES_ROOT } from '../lib/hyperframes/hyperframesSecurity.js';
import { getHyperFramesComposition } from '../lib/hyperframes/hyperframesCompositionStore.js';
import { validateHyperFramesProviderInputSync } from '../lib/production/execution/adapters/hyperframes.adapter.js';
import {
  extractNarrationFromSpec, sanitizeNarrationText, classifyTimingFit, estimateNarrationCost,
  isValidVoiceId, isValidSpeed, VOICE_ALLOWLIST, DEFAULT_VOICE_ID, DEFAULT_SPEED,
  MAX_NARRATION_CHARS, isAllowedNarrationMime, NARRATION_MIME, MAX_SPEED,
} from '../lib/production/audio/narrationRules.js';
import { generateNarration, narrationIdFor, copyNarrationIntoComposition } from '../lib/production/audio/narrationService.js';
import { getNarrationRecord, isValidAudioId, resolveNarrationAudioPath, narrationAssetExists } from '../lib/production/audio/narrationStore.js';

const ROOT = process.cwd();
const REAL_PACKAGE = 'pack-1785960819732-4ed2d0.json';
const LEGACY_PACKAGE = 'pack-openart-video-test1-1785944062.json';

const results = [];
const created = new Set();
function check(name, condition, detail = '') {
  results.push({ name, ok: !!condition, detail });
  console.log(`${condition ? 'PASS' : 'FAIL'} — ${name}${detail && !condition ? ` (${detail})` : ''}`);
}
function section(t) { console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 54 - t.length))}`); }
function readPackage(f) { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'content-packages', f), 'utf8')); }
function specFor(f, mode = 'faceless_social') { return buildRenderSpec(readPackage(f), { mode }).spec; }
function compDir(id) { return path.join(HYPERFRAMES_ROOT, id); }

const PRE_EXISTING = new Set(fs.readdirSync(HYPERFRAMES_ROOT, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name));
function track(id) { if (id && !PRE_EXISTING.has(id)) created.add(id); return id; }

const HAND_AUTHORED = [...PRE_EXISTING].filter(n => !n.startsWith('generated-') && n !== 'templates');
const handSnapshot = new Map(HAND_AUTHORED.map(n => {
  const idx = path.join(HYPERFRAMES_ROOT, n, 'index.html');
  return [n, fs.existsSync(idx) ? `${fs.statSync(idx).mtimeMs}:${fs.statSync(idx).size}` : 'absent'];
}));

try {
  // ── 1. Extraction ────────────────────────────────────────────────────────
  section('Narration extraction from URS');

  const spec = specFor(REAL_PACKAGE);
  const extracted = extractNarrationFromSpec(spec);
  check('narration extracted from the real package', !!extracted.text);
  check('prefers the full script over per-scene concatenation', extracted.source === 'audio.narration.text', extracted.source);
  check('extracted text is non-trivial', extracted.text.length > 100, String(extracted.text.length));

  const noNarration = specFor(REAL_PACKAGE);
  noNarration.audio.narration.text = null;
  noNarration.scenes.forEach(s => { s.narration = null; });
  check('empty narration yields an explicit "none" source', extractNarrationFromSpec(noNarration).source === 'none');
  check('empty narration yields empty text', extractNarrationFromSpec(noNarration).text === '');

  const sceneOnly = specFor(REAL_PACKAGE);
  sceneOnly.audio.narration.text = null;
  check('falls back to per-scene narration', extractNarrationFromSpec(sceneOnly).source === 'scenes[].narration');

  // ── 2. Sanitization + limits ────────────────────────────────────────────
  section('Text sanitization and limits');

  check('control characters stripped', !/[\u0000-\u001f]/.test(sanitizeNarrationText('a\u0000b\u001fc')));
  check('whitespace collapsed', sanitizeNarrationText('a   b\n\nc') === 'a b c');
  check('non-string returns empty', sanitizeNarrationText(null) === '' && sanitizeNarrationText(42) === '');
  check('length clamped', sanitizeNarrationText('x'.repeat(MAX_NARRATION_CHARS + 500)).length === MAX_NARRATION_CHARS);
  check('shell metacharacters are preserved as TEXT, not stripped (passed via file, never argv)',
    sanitizeNarrationText('say $(whoami) `id` && rm -rf /') === 'say $(whoami) `id` && rm -rf /');

  // ── 3. Voice + speed governance ─────────────────────────────────────────
  section('Voice and speed governance');

  check('voice allowlist is non-empty', VOICE_ALLOWLIST.length > 0);
  check('default voice is allowlisted', isValidVoiceId(DEFAULT_VOICE_ID));
  check('unknown voice rejected', !isValidVoiceId('Zarvox') && !isValidVoiceId('../../etc/passwd'));
  check('speed bounds enforced', isValidSpeed(1.0) && !isValidSpeed(3) && !isValidSpeed(0.1) && !isValidSpeed(NaN));
  check('speed above intelligibility limit rejected', !isValidSpeed(MAX_SPEED + 0.01));

  const badVoice = await generateNarration({ text: 'hello there', voiceId: 'NotARealVoice' });
  check('service refuses a non-allowlisted voice', badVoice.ok === false && /allowlist/i.test(badVoice.error));
  const badSpeed = await generateNarration({ text: 'hello there', voiceId: DEFAULT_VOICE_ID, speed: 9 });
  check('service refuses an out-of-range speed', badSpeed.ok === false);
  const noText = await generateNarration({ text: '   ' });
  check('service refuses empty narration text', noText.ok === false && /no narration text/i.test(noText.error));

  // ── 4. Cost governance ──────────────────────────────────────────────────
  section('Cost governance');

  const cost = estimateNarrationCost({ characterCount: 778 });
  check('cost is a CONFIRMED zero, not provisional', cost.amountUsd === 0 && cost.estimateType === 'confirmed_local');
  check('cost requires no approval', cost.approvalRequired === false);
  check('cost tier is free', cost.costTier === 'free');
  check('cost names the provider and model', !!cost.provider && !!cost.model);
  check('cost is never fabricated as non-zero for a local provider', cost.amountUsd === 0);

  // ── 5. Generation, determinism, storage safety ──────────────────────────
  section('Generation and deterministic reuse');

  const gen1 = await generateNarration({
    packageId: spec.source.packageId, renderSpecId: spec.specId, text: extracted.text,
  });
  check('narration generated', gen1.ok, gen1.error);
  const rec = gen1.record;
  check('audioId is a safe identifier', isValidAudioId(rec.audioId), rec.audioId);
  check('record carries a real measured duration', Number.isFinite(rec.durationSeconds) && rec.durationSeconds > 0);
  check('record carries provider and model provenance', rec.provider === 'macos-say' && !!rec.model);
  check('record MIME is allowlisted', isAllowedNarrationMime(rec.mimeType) && rec.mimeType === NARRATION_MIME);
  check('audio file exists and is non-empty', narrationAssetExists(rec.audioId) && rec.sizeBytes > 0);
  check('actual cost is a confirmed zero', rec.actualCost.amountUsd === 0 && rec.actualCost.confirmed === true);

  const gen2 = await generateNarration({ packageId: spec.source.packageId, renderSpecId: spec.specId, text: extracted.text });
  check('identical input reuses the same asset (idempotent)', gen2.ok && gen2.reused === true && gen2.record.audioId === rec.audioId);
  check('audioId is deterministic', narrationIdFor({ text: extracted.text, voiceId: DEFAULT_VOICE_ID, speed: DEFAULT_SPEED }) === rec.audioId);
  check('a different voice yields a different audioId',
    narrationIdFor({ text: extracted.text, voiceId: 'Daniel', speed: DEFAULT_SPEED }) !== rec.audioId);

  // ── 6. No secrets / no arbitrary paths ──────────────────────────────────
  section('Secret and path safety');

  const recBlob = JSON.stringify(rec);
  check('record contains no absolute path', !recBlob.includes(ROOT) && !recBlob.includes('/Users/'));
  check('localPathInternal is project-relative', !path.isAbsolute(rec.localPathInternal));
  const envRaw = fs.existsSync(path.join(ROOT, '.env.local')) ? fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8') : '';
  const secretValues = envRaw.split('\n').map(l => l.split('=').slice(1).join('=').trim()).filter(v => v.length > 20);
  check('record leaks no environment secret', !secretValues.some(v => recBlob.includes(v)));

  for (const bad of ['../escape', 'a/b', 'a\\b', '', 'x'.repeat(200), '.hidden']) {
    check(`store rejects unsafe audio id ${JSON.stringify(bad)}`, !isValidAudioId(bad));
  }
  let traversalRejected = false;
  try { resolveNarrationAudioPath(rec.audioId, '../../../etc/passwd'); } catch { traversalRejected = true; }
  check('store rejects a traversal filename', traversalRejected);
  let absRejected = false;
  try { resolveNarrationAudioPath(rec.audioId, '/etc/passwd'); } catch { absRejected = true; }
  check('store rejects an absolute filename', absRejected);
  const relDest = copyNarrationIntoComposition(rec.audioId, 'not-absolute');
  check('copy refuses a non-absolute destination', relDest.ok === false);

  // ── 7. Timing behavior ──────────────────────────────────────────────────
  section('Timing behavior');

  const timeline = spec.timing.totalDurationSeconds;
  const fit = classifyTimingFit({ audioDurationSeconds: rec.durationSeconds, timelineDurationSeconds: timeline });
  check('real narration classified against the real timeline', ['shorter', 'exact', 'adjustable'].includes(fit.fit), fit.fit);
  check('timing fit is non-blocking for the real package', fit.blocking === false);
  check('variance reported numerically', Number.isFinite(fit.varianceSeconds));

  check('shorter audio preserves scene timing (non-blocking)',
    classifyTimingFit({ audioDurationSeconds: 30, timelineDurationSeconds: 45 }).fit === 'shorter');
  check('near-equal audio classified exact',
    classifyTimingFit({ audioDurationSeconds: 45.2, timelineDurationSeconds: 45 }).fit === 'exact');
  const adjustable = classifyTimingFit({ audioDurationSeconds: 48, timelineDurationSeconds: 45 });
  check('slight overrun is adjustable within the speed limit', adjustable.fit === 'adjustable' && adjustable.requiredSpeed <= MAX_SPEED);
  const tooLong = classifyTimingFit({ audioDurationSeconds: 70, timelineDurationSeconds: 45 });
  check('material overrun BLOCKS instead of truncating', tooLong.fit === 'too_long' && tooLong.blocking === true);
  check('block message names revision, never truncation', /revised/i.test(tooLong.warnings.join(' ')) && !/truncat(e|ing)\b(?!.*never)/i.test(tooLong.warnings.join(' ')));
  check('unknown durations degrade safely', classifyTimingFit({ audioDurationSeconds: null, timelineDurationSeconds: 45 }).fit === 'unknown');

  // ── 8. Composition integration ──────────────────────────────────────────
  section('Composition integration');

  const narration = { ...rec, timingFit: fit.fit };
  const withAudio = translateUrsToHyperFrames(spec, { narration });
  track(withAudio.compositionId);
  check('composition generated with narration', withAudio.ok, withAudio.error);

  const rawHtml = fs.readFileSync(path.join(compDir(withAudio.compositionId), 'index.html'), 'utf8');
  // Structural counts must ignore HTML comments — documentation legitimately
  // discusses the markup it generates.
  const stripComments = h => h.replace(/<!--[\s\S]*?-->/g, '');
  const html = stripComments(rawHtml);
  const renderData = JSON.parse(fs.readFileSync(path.join(compDir(withAudio.compositionId), 'render-data.json'), 'utf8'));

  check('audio asset copied into the composition', fs.existsSync(path.join(compDir(withAudio.compositionId), 'assets', 'narration.wav')));
  check('exactly one <audio> element', (html.match(/<audio/g) || []).length === 1);
  check('audio src is the fixed local constant', html.includes('src="assets/narration.wav"'));
  check('audio starts at timeline zero', /<audio[\s\S]*?data-start="0"/.test(html));
  check('audio duration matches measured audio', html.includes(`data-duration="${rec.durationSeconds}"`));
  check('composition never calls play/pause/seek (HyperFrames owns playback)',
    !/\.play\(\)|\.pause\(\)|currentTime\s*=/.test(html));
  check('no base64 audio in render-data.json', !/base64|data:audio/i.test(JSON.stringify(renderData)));
  check('render-data narration is metadata only', !!renderData.narration && renderData.narration.src === 'assets/narration.wav');
  check('render-data narration carries provenance', renderData.narration.voiceId === rec.voiceId && renderData.narration.provider === rec.provider);
  check('no raw model text in executable JS (still one JSON island)',
    (html.match(/<script type="application\/json" id="hf-render-data">/g) || []).length === 1);
  check('no unsubstituted placeholders', !['__TOTAL_DURATION__', '__SCENES_MARKUP__', '__AUDIO_MARKUP__', '__RENDER_DATA__'].some(t => html.includes(t)));

  // ── 9. Music absence ────────────────────────────────────────────────────
  section('Music absence');

  check('music remains not required', renderData.music.required === false);
  check('music mood hint remains null', renderData.music.moodHint === null);
  check('music never fabricated', renderData.music.fabricated === false);
  check('exactly one audio track total', (html.match(/<audio/g) || []).length === 1);

  // ── 10. Report honesty ──────────────────────────────────────────────────
  section('Translation report honesty');

  check('narration reported as CONSUMED with audio', withAudio.report.consumedFields.includes('scenes[].narration'));
  check('audio.narration.text reported as consumed', withAudio.report.consumedFields.includes('audio.narration.text'));
  check('narration no longer listed as degraded', !withAudio.report.degradedFields.includes('scenes[].narration'));
  check('narration no longer listed as ignored', !withAudio.report.ignoredFields.includes('audio.narration.text'));
  check('manifest records narration provenance', (() => {
    const m = JSON.parse(fs.readFileSync(path.join(compDir(withAudio.compositionId), 'manifest.json'), 'utf8'));
    return m.narration?.audioId === rec.audioId && m.narration.voiceId === rec.voiceId;
  })());

  const silent = translateUrsToHyperFrames(spec, { narration: null });
  track(silent.compositionId);
  check('without audio, narration is reported as DEGRADED (honest)', silent.report.degradedFields.includes('scenes[].narration'));
  check('silent composition emits no audio element', !stripComments(fs.readFileSync(path.join(compDir(silent.compositionId), 'index.html'), 'utf8')).includes('<audio'));
  check('narrated completeness exceeds silent completeness', withAudio.report.completeness > silent.report.completeness,
    `${withAudio.report.completeness} vs ${silent.report.completeness}`);

  // ── 11. Versioning + isolation ──────────────────────────────────────────
  section('Template version, hashing, isolation');

  const tpl = JSON.parse(fs.readFileSync(path.join(HYPERFRAMES_ROOT, 'templates', 'faceless-short', 'template.json'), 'utf8'));
  check('template version incremented to 3', tpl.templateVersion === 3, String(tpl.templateVersion));
  check('template declares the audio contract', !!tpl.audio?.narration && tpl.audio.music === null);
  check('narration changes the deterministic composition id', withAudio.compositionId !== silent.compositionId);
  check('narrated composition id is stable across calls',
    translateUrsToHyperFrames(spec, { narration, dryRun: true }).compositionId === withAudio.compositionId);

  let untouched = true;
  for (const [n, sig] of handSnapshot.entries()) {
    const idx = path.join(HYPERFRAMES_ROOT, n, 'index.html');
    const now = fs.existsSync(idx) ? `${fs.statSync(idx).mtimeMs}:${fs.statSync(idx).size}` : 'absent';
    if (now !== sig) { untouched = false; break; }
  }
  check(`all ${handSnapshot.size} hand-authored compositions untouched`, untouched);

  // ── 12. Downstream contracts unchanged ──────────────────────────────────
  section('Downstream contracts unchanged');

  const discovered = await getHyperFramesComposition(withAudio.compositionId);
  check('narrated composition discoverable by the existing store', !!discovered && discovered.hasIndexHtml);
  const adapterOk = validateHyperFramesProviderInputSync({
    job: { selectedMode: 'faceless_social', providerInput: { compositionId: withAudio.compositionId, quality: 'standard' } },
    compositionExists: true,
  });
  check('existing HyperFrames adapter accepts the narrated composition', adapterOk.valid === true, JSON.stringify(adapterOk.errors));

  const adapterSrc = fs.readFileSync(path.join(ROOT, 'lib/production/execution/adapters/hyperframes.adapter.js'), 'utf8');
  check('HyperFrames adapter has no narration coupling', !/narration|narrationService/i.test(adapterSrc));
  const engineSrc = fs.readFileSync(path.join(ROOT, 'lib/production/execution/executionEngine.js'), 'utf8');
  check('Execution Engine has no narration coupling', !/narration/i.test(engineSrc));
  const runnerSrc = fs.readFileSync(path.join(ROOT, 'lib/hyperframes/hyperframesRunner.js'), 'utf8');
  check('standalone hyperframes-local runner unchanged by narration', !/narration/i.test(runnerSrc));

  const svcSrc = fs.readFileSync(path.join(ROOT, 'lib/production/audio/narrationService.js'), 'utf8');
  const svcCode = svcSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('narration service never uses a shell', !/\bexec\(|execSync|shell\s*:\s*true/.test(svcCode));
  check('narration service touches no remote provider', !/heygen|higgsfield|openart|openrouter/i.test(svcCode));

  // ── 13. Legacy package ──────────────────────────────────────────────────
  section('Legacy package');

  const legacySpec = specFor(LEGACY_PACKAGE);
  const legacyExtract = extractNarrationFromSpec(legacySpec);
  check('legacy package narration handled without fabrication', typeof legacyExtract.text === 'string');
  const legacyTranslated = translateUrsToHyperFrames(legacySpec, { narration: null });
  track(legacyTranslated.compositionId);
  check('legacy package still translates silently', legacyTranslated.ok);
  check('legacy composition has no audio element',
    !stripComments(fs.readFileSync(path.join(compDir(legacyTranslated.compositionId), 'index.html'), 'utf8')).includes('<audio'));
} finally {
  for (const id of created) {
    if (PRE_EXISTING.has(id)) continue;
    try { fs.rmSync(compDir(id), { recursive: true, force: true }); } catch { /* ignore */ }
  }
  for (const n of fs.readdirSync(HYPERFRAMES_ROOT)) {
    if (n.startsWith('.tmp-')) { try { fs.rmSync(path.join(HYPERFRAMES_ROOT, n), { recursive: true, force: true }); } catch { /* ignore */ } }
  }
  console.log(`\ncleaned up ${created.size} generated composition(s)`);
}

const passed = results.filter(r => r.ok).length;
const failed = results.length - passed;
console.log('═'.repeat(64));
console.log(`Narration validation: ${passed}/${results.length} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  results.filter(r => !r.ok).forEach(r => console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ''}`));
}
process.exit(failed ? 1 : 0);
