#!/usr/bin/env node
// scripts/validate-asset-generation-m1.mjs
//
// Executable validation for the Asset Generation M1 seam. Real code, real
// filesystem, no mocking, no dev server, no spend — the paid generation is a
// separate gated step and is never triggered here.
//
// Run: node scripts/validate-asset-generation-m1.mjs

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { buildRenderSpec } from '../lib/production/renderSpec/buildRenderSpec.js';
import { translateUrsToHyperFrames, TEMPLATE_VERSION } from '../lib/production/renderSpec/translators/hyperframesTranslator.js';
import { HYPERFRAMES_ROOT } from '../lib/hyperframes/hyperframesSecurity.js';
import { planSceneAsset, buildPackageAssetEntry } from '../lib/production/assets/assetResolver.js';
import { buildAssetRequest, validateBindingShape, buildProviderInputFromBinding, buildAssetJobMetadata, validateAssetRecord, isAllowedAssetMime } from '../lib/production/assets/assetRules.js';
import { isValidCapability, capabilityForSceneAssetKind, ASSET_CAPABILITY_IDS } from '../lib/production/assets/assetCapabilities.js';
import { recommendBinding, POLICY_VERSION } from '../lib/diamond/recommendBinding.js';
import { saveAsset, generateAssetId, assetBinaryPath, getAsset, ASSET_LIBRARY_DIR, ASSET_RECORD_DIR } from '../lib/production/assets/assetStore.js';

const ROOT = process.cwd();
const REAL_PACKAGE = 'pack-1785960819732-4ed2d0.json';
const ASSETS_DIR = path.join(ROOT, 'lib/production/assets');

const results = [];
const cleanup = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${detail && !cond ? ` (${detail})` : ''}`);
}
function section(t) { console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 52 - t.length))}`); }
function readPackage(f) { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'content-packages', f), 'utf8')); }
function stripComments(s) { return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); }

const PRE_EXISTING_COMPS = new Set(fs.readdirSync(HYPERFRAMES_ROOT, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name));

// A tiny real PNG so the composition path is proven without spending anything.
const TEST_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082',
  'hex',
);

try {
  // ── 1. Provider neutrality — the load-bearing invariant ──────────────────
  section('Provider neutrality (F3)');

  const PROVIDER_TOKENS = ['higgsfield', 'openart', 'heygen', 'hyperframes', 'kling', 'veo', 'flux', 'seedream', 'comfyui', 'mcp'];
  const leaks = [];
  for (const f of fs.readdirSync(ASSETS_DIR).filter(f => f.endsWith('.js'))) {
    const code = stripComments(fs.readFileSync(path.join(ASSETS_DIR, f), 'utf8'));
    const hit = PROVIDER_TOKENS.filter(t => new RegExp(t, 'i').test(code));
    if (hit.length) leaks.push(`${f}: ${hit.join(',')}`);
  }
  check('no provider name in Asset Generation executable code', leaks.length === 0, leaks.join(' | '));

  const rawLeaks = [];
  for (const f of fs.readdirSync(ASSETS_DIR).filter(f => f.endsWith('.js'))) {
    const raw = fs.readFileSync(path.join(ASSETS_DIR, f), 'utf8');
    const hit = PROVIDER_TOKENS.filter(t => new RegExp(t, 'i').test(raw));
    if (hit.length) rawLeaks.push(`${f}: ${hit.join(',')}`);
  }
  check('no provider name even in Asset Generation comments', rawLeaks.length === 0, rawLeaks.join(' | '));

  const allAssetSrc = fs.readdirSync(ASSETS_DIR).filter(f => f.endsWith('.js'))
    .map(f => fs.readFileSync(path.join(ASSETS_DIR, f), 'utf8')).join('\n');
  check('Asset Generation imports no provider module', !/from ['"].*adapters?\//.test(allAssetSrc));
  check('Asset Generation never uses the legacy dispatch path (F1)', !/executeDispatch/.test(stripComments(allAssetSrc)));
  check('Asset Generation reads no provider catalog', !/models_explore|model_list|providerCatalog/i.test(allAssetSrc));
  check('policy stub is the ONLY place naming a provider',
    /higgsfield/i.test(fs.readFileSync(path.join(ROOT, 'lib/diamond/recommendBinding.js'), 'utf8')));

  // ── 2. Capability vocabulary (F5) ────────────────────────────────────────
  section('Capability vocabulary');

  check('exactly one capability in M1', ASSET_CAPABILITY_IDS.length === 1 && ASSET_CAPABILITY_IDS[0] === 'background_plate');
  check('unknown capability rejected', !isValidCapability('cinematic_broll') && !isValidCapability('kling_v2'));
  const mappedVideo = capabilityForSceneAssetKind('video');
  check('motion kind resolves to a still plate', mappedVideo.capability === 'background_plate');
  check('the downgrade is reported, not silent', mappedVideo.degraded === true && !!mappedVideo.reason);
  check('unrecognised kind resolves to nothing', capabilityForSceneAssetKind('hologram').capability === null);

  // ── 3. Request building from real URS ────────────────────────────────────
  section('Asset request from real URS');

  const pkg = readPackage(REAL_PACKAGE);
  const { spec } = buildRenderSpec(pkg, { mode: 'faceless_social' });
  check('real package builds a URS', !!spec && spec.ursVersion === 1);

  const req = buildAssetRequest(spec, 0, { capability: 'background_plate' });
  check('request builds for scene 0', req.ok, req.error);
  check('prompt comes from the URS generationPrompt', req.request.prompt === spec.scenes[0].visual.generationPrompt);
  check('negative prompt carried', req.request.negativePrompt === spec.scenes[0].visual.negativePrompt);
  check('aspect ratio carried from URS output', req.request.aspectRatio === '9:16');
  check('exactly one output requested', req.request.outputCount === 1);
  check('scene attribution retained', req.request.sourceSceneId === 0 && req.request.sourcePackageId === pkg.id);
  check('request for a nonexistent scene is refused', buildAssetRequest(spec, 99, { capability: 'background_plate' }).ok === false);
  check('request with unknown capability is refused', buildAssetRequest(spec, 0, { capability: 'nope' }).ok === false);

  // ── 4. Opaque binding (F4) ───────────────────────────────────────────────
  section('Opaque provider binding');

  const planned = planSceneAsset(spec, 0, { capability: 'background_plate', modelOverride: 'validator-model' });
  check('planning succeeds with an explicit model', planned.ok, planned.error);
  check('binding shape is valid', validateBindingShape(planned.binding).valid);
  check('binding carries a policy version', planned.binding.policyVersion === POLICY_VERSION);
  check('binding carries an auditable rationale', typeof planned.binding.rationale === 'string' && planned.binding.rationale.length > 0);
  // M3 gave the stub policy a DEFAULT model (verified present in the live
  // catalog) because a planner needs a usable binding for every eligible miss.
  // The invariant that still matters: the model is never empty, and an unknown
  // capability is still refused rather than guessed.
  const defaultBinding = recommendBinding({ capability: 'background_plate' });
  check('policy returns a usable default model', defaultBinding.ok === true && typeof defaultBinding.binding.model === 'string' && defaultBinding.binding.model.length > 0);
  check('an operator override still wins over the default',
    recommendBinding({ capability: 'background_plate' }, { modelOverride: 'operator-choice' }).binding.model === 'operator-choice');
  check('policy refuses an unknown capability', recommendBinding({ capability: 'nope' }, { modelOverride: 'm' }).ok === false);
  check('binding shape validation rejects a missing providerId', !validateBindingShape({ model: 'x' }).valid);

  const providerInput = buildProviderInputFromBinding(planned.request, planned.binding);
  check('providerInput carries the prompt', providerInput.prompt === planned.request.prompt);
  check('providerInput carries the model verbatim from the binding', providerInput.model === 'validator-model');
  check('binding params are forwarded uninterpreted', providerInput.mediaType === 'image');
  check('providerInput requests exactly one output', providerInput.outputCount === 1);

  const meta = buildAssetJobMetadata(planned.request);
  check('job metadata attributes the division', meta.division === 'asset-generation');
  check('job metadata attributes the capability', meta.capability === 'background_plate');
  check('job metadata carries the scene', meta.sceneId === 0);

  // ── 5. Asset record + storage (F6, F7) ───────────────────────────────────
  section('Immutable asset record and storage');

  const assetId = generateAssetId();
  const saved = saveAsset({
    assetId,
    buffer: TEST_PNG,
    mimeType: 'image/png',
    record: {
      schemaVersion: 1, capability: 'background_plate', brandId: 'ValidatorBrand',
      sourceUrsId: spec.specId, sourcePackageId: pkg.id, sourceSceneId: 0,
      width: 1080, height: 1920,
      provenance: { productionJobId: 'pr-validator', ledgerEntryIds: [], providerJobId: null, promptHash: 'a'.repeat(64), generatedAt: new Date().toISOString(), actor: 'validator' },
      cost: { estimated: null, actual: null, currency: 'USD', confirmed: false },
      lineage: { derivedFromAssetId: null },
    },
  });
  if (saved.ok) cleanup.push(() => {
    fs.rmSync(path.join(ASSET_RECORD_DIR, `${assetId}.json`), { force: true });
    fs.rmSync(path.join(ASSET_LIBRARY_DIR, 'ValidatorBrand'), { recursive: true, force: true });
  });
  check('asset saves', saved.ok, saved.error || JSON.stringify(saved.errors));
  check('contentHash is a sha256 of the bytes', saved.record.contentHash === crypto.createHash('sha256').update(TEST_PNG).digest('hex'));
  check('storagePath is project-relative', !path.isAbsolute(saved.record.storagePath) && !saved.record.storagePath.includes('..'));
  check('asset is stored OUTSIDE production-artifacts', !saved.record.storagePath.startsWith('production-artifacts'));
  check('asset is stored in the asset library', saved.record.storagePath.startsWith('assets-library'));
  check('record contains no absolute path', !/\/Users\//.test(JSON.stringify(saved.record)));
  check('record contains no remote provider URL', !/https?:\/\//.test(JSON.stringify(saved.record)));
  check('record contains no raw prompt', !JSON.stringify(saved.record).includes(planned.request.prompt.slice(0, 40)));
  check('prompt is referenced by hash', /^[0-9a-f]{64}$/.test(saved.record.provenance.promptHash));

  const rewrite = saveAsset({ assetId, buffer: TEST_PNG, mimeType: 'image/png', record: { ...saved.record, capability: 'background_plate' } });
  check('re-saving the same assetId is refused (immutable)', rewrite.ok === false && /immutable/i.test(rewrite.error));
  check('asset is readable back', getAsset(assetId)?.assetId === assetId);

  check('traversal assetId refused', (() => { try { assetBinaryPath('../evil', { brandId: 'b', capability: 'c', mimeType: 'image/png' }); return false; } catch { return true; } })());
  check('disallowed mime refused', (() => { try { assetBinaryPath(assetId, { brandId: 'b', capability: 'c', mimeType: 'video/mp4' }); return false; } catch { return true; } })());
  check('video mime not in the asset allowlist', !isAllowedAssetMime('video/mp4') && isAllowedAssetMime('image/png'));
  check('record validation rejects an absolute storagePath',
    !validateAssetRecord({ ...saved.record, storagePath: '/Users/x/y.png' }).valid);
  check('record validation rejects a bad contentHash',
    !validateAssetRecord({ ...saved.record, contentHash: 'nope' }).valid);

  // ── 6. URS enrichment (Part F) ───────────────────────────────────────────
  section('URS enrichment');

  const entry = buildPackageAssetEntry(saved.record);
  check('package entry carries no provider provenance',
    !('providerId' in entry) && !('model' in entry) && !/higgsfield|openart/i.test(JSON.stringify(entry)));

  const enrichedPkg = { ...pkg, assets: [entry] };
  const enriched = buildRenderSpec(enrichedPkg, { mode: 'faceless_social' });
  check('enriched URS still validates', enriched.ok, JSON.stringify(enriched.validation.errors));
  check('URS assets[] has exactly one entry', enriched.spec.assets.length === 1);
  check('scene 0 has an assetRef', enriched.spec.scenes[0].assetRef?.assetId === assetId);
  check('assetRef is opaque (id + capability only)',
    Object.keys(enriched.spec.scenes[0].assetRef).sort().join(',') === 'assetId,capability');
  check('other six scenes have no assetRef', enriched.spec.scenes.slice(1).every(s => s.assetRef === null));
  check('URS stays provider-neutral', !/higgsfield|openart|heygen|mcp/i.test(JSON.stringify(enriched.spec)));
  // Explicitly strip assets rather than assuming the live package has none —
  // once a real asset has been ingested, the fixture package legitimately
  // carries one.
  const { assets: _ignored, ...pkgWithoutAssets } = pkg;
  check('a package with no resolved assets yields no assetRef',
    buildRenderSpec(pkgWithoutAssets, { mode: 'faceless_social' }).spec.scenes[0].assetRef === null);

  // ── 7. Translator + template (Part F) ────────────────────────────────────
  section('Translator and template');

  check('template version incremented to 4', TEMPLATE_VERSION === 4, String(TEMPLATE_VERSION));

  const { assets: _drop, ...pkgNoAssets } = pkg;
  const silent = translateUrsToHyperFrames(buildRenderSpec(pkgNoAssets, { mode: 'faceless_social' }).spec, { narration: null });
  if (silent.ok && !PRE_EXISTING_COMPS.has(silent.compositionId)) cleanup.push(() => fs.rmSync(path.join(HYPERFRAMES_ROOT, silent.compositionId), { recursive: true, force: true }));
  const withImage = translateUrsToHyperFrames(enriched.spec, { narration: null });
  if (withImage.ok && !PRE_EXISTING_COMPS.has(withImage.compositionId)) cleanup.push(() => fs.rmSync(path.join(HYPERFRAMES_ROOT, withImage.compositionId), { recursive: true, force: true }));

  check('composition with an image translates', withImage.ok, withImage.error);
  check('asset presence changes the composition hash', withImage.compositionId !== silent.compositionId);

  // Two DIFFERENT images must not collide: the filename is positional, so
  // identity has to come from the assetId/contentHash carried in render-data.
  const otherEntry = { ...entry, assetId: 'ast-different-1', contentHash: 'b'.repeat(64) };
  const otherSpec = buildRenderSpec({ ...pkg, assets: [otherEntry] }, { mode: 'faceless_social' }).spec;
  const otherComp = translateUrsToHyperFrames(otherSpec, { narration: null, dryRun: true });
  check('a DIFFERENT asset yields a different composition hash', otherComp.compositionId !== withImage.compositionId);
  check('translation is deterministic', translateUrsToHyperFrames(enriched.spec, { narration: null, dryRun: true }).compositionId === withImage.compositionId);

  const compDir = path.join(HYPERFRAMES_ROOT, withImage.compositionId);
  const html = fs.readFileSync(path.join(compDir, 'index.html'), 'utf8');
  const rd = JSON.parse(fs.readFileSync(path.join(compDir, 'render-data.json'), 'utf8'));

  check('image copied into the composition', fs.existsSync(path.join(compDir, 'assets', 'scene-0.png')));
  check('scene 0 has an imageFile', rd.scenes[0].imageFile === 'scene-0.png');
  check('render-data carries the asset identity', rd.scenes[0].imageAssetId === assetId && /^[0-9a-f]{64}$/.test(rd.scenes[0].imageContentHash));
  check('other six scenes keep placeholders', rd.scenes.slice(1).every(s => s.imageFile === null));
  check('only one image asset copied', fs.readdirSync(path.join(compDir, 'assets')).filter(f => /^scene-/.test(f)).length === 1);
  check('template exposes a scene-image layer', html.includes('class="scene-image"'));
  check('image filename is allowlist-validated in the bootstrap', /\^scene-\\d\{1,2\}\\\.\(png\|jpg\|jpeg\|webp\)\$/.test(html));
  check('no absolute path in emitted HTML', !/\/Users\//.test(html));
  check('composition stays provider-neutral', !/higgsfield|openart|heygen/i.test(html));
  check('no unsubstituted placeholders', !['__TOTAL_DURATION__', '__SCENES_MARKUP__', '__AUDIO_MARKUP__', '__RENDER_DATA__'].some(t => html.includes(t)));
  check('bootstrap still uses textContent for copy', html.includes('.textContent =') && !html.includes('.innerHTML'));

  // Narration and timing must be untouched by this milestone.
  check('scene timings unchanged', rd.scenes.map(s => s.durationSeconds).join(',') === enriched.spec.scenes.map(s => s.durationSeconds).join(','));
  check('total duration unchanged at 45s', rd.totalDurationSeconds === 45);
  check('music still absent', rd.music.moodHint === null && rd.music.fabricated === false);
  check('narration slot preserved', 'narration' in rd);

  // ── 8. Translator purity ─────────────────────────────────────────────────
  section('Translator purity');

  const translatorSrc = fs.readFileSync(path.join(ROOT, 'lib/production/renderSpec/translators/hyperframesTranslator.js'), 'utf8');
  const translatorCode = stripComments(translatorSrc);
  check('translator never imports Asset Generation', !/assets\/assetResolver|recommendBinding/.test(translatorCode));
  check('translator never generates', !/generateAsset|planSceneAsset|createAssetJob/.test(translatorCode));
  check('translator spawns no process', !/spawn|execFile|child_process/.test(translatorCode));
  const before = JSON.stringify(enriched.spec);
  translateUrsToHyperFrames(enriched.spec, { narration: null, dryRun: true });
  check('translator does not mutate the URS', JSON.stringify(enriched.spec) === before);
} finally {
  for (const fn of cleanup.reverse()) { try { fn(); } catch { /* ignore */ } }
  for (const n of fs.readdirSync(HYPERFRAMES_ROOT)) {
    if (n.startsWith('.tmp-')) { try { fs.rmSync(path.join(HYPERFRAMES_ROOT, n), { recursive: true, force: true }); } catch { /* ignore */ } }
  }
  console.log(`\ncleaned up ${cleanup.length} validator fixture(s)`);
}

const passed = results.filter(r => r.ok).length;
const failed = results.length - passed;
console.log('═'.repeat(64));
console.log(`Asset Generation M1 validation: ${passed}/${results.length} passed, ${failed} failed`);
if (failed) results.filter(r => !r.ok).forEach(r => console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ''}`));
process.exit(failed ? 1 : 0);
