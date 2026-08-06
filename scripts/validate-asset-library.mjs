#!/usr/bin/env node
// scripts/validate-asset-library.mjs
//
// Executable validation for the Asset Library + cache (M2). Real code, real
// filesystem, no mocking, no dev server, no spend.
//
// Run: node scripts/validate-asset-library.mjs

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  computeSemanticFingerprint, fingerprintSubject, normalizePromptText, normalizeBrandId,
  FINGERPRINT_EXCLUDED_FIELDS, FINGERPRINT_SCHEMA_VERSION,
} from '../lib/production/assets/assetFingerprint.js';
import {
  lookupAsset, fingerprintForRequest, checkAssetEligibility, selectVariant,
  ensureAssetIndexed, CACHE_STATUSES, REUSE_BLOCKING_STATES,
} from '../lib/production/assets/assetCache.js';
import {
  indexAsset, getAssetIndexEntry, findAssetIdsByFingerprint, recordAssetUsage,
  listAssetUsage, usageCountFor, ASSET_INDEX_DIR, ASSET_USAGE_DIR, generateUsageId,
} from '../lib/production/assets/assetLibraryStore.js';
import { saveAsset, generateAssetId, getAsset, ASSET_RECORD_DIR, ASSET_LIBRARY_DIR } from '../lib/production/assets/assetStore.js';
import { LEDGER_EVENTS, OUTCOME_STATUSES } from '../lib/ledger/ledgerRules.js';

const ROOT = process.cwd();
const results = [];
const cleanup = [];
function check(n, c, d = '') { results.push({ n, ok: !!c, d }); console.log(`${c ? 'PASS' : 'FAIL'} — ${n}${d && !c ? ` (${d})` : ''}`); }
function section(t) { console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 52 - t.length))}`); }
const H = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082', 'hex');

const REQ = {
  capability: 'background_plate', brandId: 'Test Brand', prompt: 'A cluttered desk',
  negativePrompt: 'No people', aspectRatio: '9:16', width: 1080, height: 1920, outputCount: 1,
};

function makeAsset({ brandId = 'Test Brand', capability = 'background_plate', policy = null, buffer = PNG } = {}) {
  const assetId = generateAssetId();
  const r = saveAsset({
    assetId, buffer, mimeType: 'image/png',
    record: {
      schemaVersion: 1, capability, brandId, sourceUrsId: 'urs-t', sourcePackageId: 'pack-t', sourceSceneId: 0,
      width: 1080, height: 1920,
      provenance: { productionJobId: 'pr-t', ledgerEntryIds: [], providerJobId: null, promptHash: 'a'.repeat(64), generatedAt: new Date().toISOString(), actor: 'validator' },
      cost: { estimated: null, actual: null, currency: 'USD', confirmed: false },
      lineage: { derivedFromAssetId: null },
      ...(policy ? { policy } : {}),
    },
  });
  if (r.ok) cleanup.push(() => {
    fs.rmSync(path.join(ASSET_RECORD_DIR, `${assetId}.json`), { force: true });
    fs.rmSync(path.join(ASSET_INDEX_DIR, `${assetId}.json`), { force: true });
    fs.rmSync(path.join(ASSET_LIBRARY_DIR, brandId.replace(/[^a-zA-Z0-9_-]/g, '')), { recursive: true, force: true });
  });
  return r;
}

try {
  // ── Fingerprint determinism + normalization ──────────────────────────────
  section('Fingerprint determinism and normalization');

  const base = computeSemanticFingerprint(REQ, H);
  check('fingerprint is a sha256 hex digest', /^[0-9a-f]{64}$/.test(base));
  check('fingerprint is deterministic', computeSemanticFingerprint(REQ, H) === base);
  check('key order does not affect the fingerprint',
    computeSemanticFingerprint({ outputCount: 1, height: 1920, width: 1080, aspectRatio: '9:16', negativePrompt: 'No people', prompt: 'A cluttered desk', brandId: 'Test Brand', capability: 'background_plate' }, H) === base);
  check('whitespace is normalized', computeSemanticFingerprint({ ...REQ, prompt: '  A   cluttered    desk  ' }, H) === base);
  check('case is folded (same picture, same request)', computeSemanticFingerprint({ ...REQ, prompt: 'A CLUTTERED DESK' }, H) === base);
  check('brand casing/spacing normalized', computeSemanticFingerprint({ ...REQ, brandId: '  test   BRAND ' }, H) === base);
  check('punctuation is PRESERVED (meaningful in prompts)', computeSemanticFingerprint({ ...REQ, prompt: 'A cluttered, desk' }, H) !== base);
  check('negativePrompt is INCLUDED', computeSemanticFingerprint({ ...REQ, negativePrompt: 'blurry' }, H) !== base);
  check('missing negativePrompt differs from present', computeSemanticFingerprint({ ...REQ, negativePrompt: null }, H) !== base);
  check('different prompt does not match', computeSemanticFingerprint({ ...REQ, prompt: 'A tidy desk' }, H) !== base);
  check('different brand does not match', computeSemanticFingerprint({ ...REQ, brandId: 'Other' }, H) !== base);
  check('different aspect ratio does not match', computeSemanticFingerprint({ ...REQ, aspectRatio: '16:9' }, H) !== base);
  check('different dimensions do not match', computeSemanticFingerprint({ ...REQ, width: 720 }, H) !== base);
  check('different capability does not match', computeSemanticFingerprint({ ...REQ, capability: 'product_still' }, H) !== base);
  check('different outputCount does not match', computeSemanticFingerprint({ ...REQ, outputCount: 2 }, H) !== base);
  check('consistencyGroupId is included', computeSemanticFingerprint({ ...REQ, consistencyGroupId: 'grp-1' }, H) !== base);
  check('duration is included when applicable', computeSemanticFingerprint({ ...REQ, durationSeconds: 6 }, H) !== base);

  // ── Exclusions — the load-bearing property ───────────────────────────────
  section('Fingerprint exclusions');

  for (const field of FINGERPRINT_EXCLUDED_FIELDS) {
    check(`"${field}" does NOT affect the fingerprint`,
      computeSemanticFingerprint({ ...REQ, [field]: `value-${field}` }, H) === base);
  }
  check('same request across DIFFERENT providers fingerprints identically',
    computeSemanticFingerprint({ ...REQ, providerId: 'provider-a', model: 'model-a' }, H)
    === computeSemanticFingerprint({ ...REQ, providerId: 'provider-b', model: 'model-b' }, H));
  check('subject exposes exactly the included fields',
    Object.keys(fingerprintSubject(REQ)).sort().join(',')
    === 'aspectRatio,brandId,capability,consistencyGroupId,durationSeconds,height,negativePrompt,outputCount,plannerVersion,prompt,v,width');
  check('subject carries no excluded field',
    !FINGERPRINT_EXCLUDED_FIELDS.some(f => f in fingerprintSubject({ ...REQ, [f]: 'x' })));
  check('normalizePromptText handles non-strings', normalizePromptText(null) === '' && normalizePromptText(42) === '');
  check('normalizeBrandId handles non-strings', normalizeBrandId(undefined) === '');

  // ── Index (append-only sidecar) ──────────────────────────────────────────
  section('Fingerprint index');

  const a1 = makeAsset();
  check('asset saved', a1.ok, a1.error);
  const recordBefore = fs.readFileSync(path.join(ASSET_RECORD_DIR, `${a1.record.assetId}.json`), 'utf8');

  const idx = ensureAssetIndexed(a1.record, REQ);
  check('asset indexed', idx.ok, idx.error);
  check('index entry readable', getAssetIndexEntry(a1.record.assetId)?.semanticFingerprint === base);
  check('IMMUTABLE record unchanged by indexing',
    fs.readFileSync(path.join(ASSET_RECORD_DIR, `${a1.record.assetId}.json`), 'utf8') === recordBefore);
  check('re-indexing is idempotent, never rewrites', ensureAssetIndexed(a1.record, REQ).alreadyIndexed === true);
  check('index rejects a bad fingerprint', indexAsset({ assetId: a1.record.assetId, semanticFingerprint: 'nope' }).ok === false);
  check('index rejects a traversal assetId', indexAsset({ assetId: '../evil', semanticFingerprint: base }).ok === false);
  check('lookup by fingerprint finds it', findAssetIdsByFingerprint(base).includes(a1.record.assetId));

  // ── Cache hit ────────────────────────────────────────────────────────────
  section('Cache hit');

  const hit = lookupAsset(REQ);
  check('status is a known cache status', CACHE_STATUSES.includes(hit.status));
  check('exact request hits', ['hit', 'ambiguous'].includes(hit.status), hit.status);
  check('selected asset is returned', !!hit.selectedAssetId);
  check('fingerprint reported', hit.semanticFingerprint === base);
  check('candidates preserved', Array.isArray(hit.candidateAssetIds) && hit.candidateAssetIds.length >= 1);
  check('reason is explanatory', typeof hit.reason === 'string' && hit.reason.length > 10);
  check('no savings fabricated without a known cost', hit.estimatedSavings === null);
  check('savings reported when a cost is supplied',
    lookupAsset(REQ, { estimatedCost: 0.12, currency: 'credits' }).estimatedSavings?.amount === 0.12);

  // ── Cache miss ───────────────────────────────────────────────────────────
  section('Cache miss');

  const miss = lookupAsset({ ...REQ, prompt: 'Something completely different' });
  check('different prompt misses', miss.status === 'miss');
  check('miss reports no selected asset', miss.selectedAssetId === null);
  check('miss fabricates no savings', miss.estimatedSavings === null);
  check('different brand misses (no cross-brand reuse)', lookupAsset({ ...REQ, brandId: 'Another Brand' }).status === 'miss');
  check('different aspect ratio misses', lookupAsset({ ...REQ, aspectRatio: '1:1' }).status === 'miss');

  // ── Stale / integrity ────────────────────────────────────────────────────
  section('Stale and integrity');

  const a2 = makeAsset({ brandId: 'Stale Brand' });
  const staleReq = { ...REQ, brandId: 'Stale Brand' };
  ensureAssetIndexed(a2.record, staleReq);
  check('indexed asset hits before tampering', lookupAsset(staleReq).status === 'hit');

  const binPath = path.resolve(ROOT, a2.record.storagePath);
  fs.writeFileSync(binPath, Buffer.concat([PNG, Buffer.from('corrupt')]));
  const corrupted = lookupAsset(staleReq);
  check('corrupt bytes yield STALE, never a hit', corrupted.status === 'stale', corrupted.status);
  check('stale reports the failing asset', corrupted.staleAssetIds.includes(a2.record.assetId));
  check('stale selects nothing', corrupted.selectedAssetId === null);

  fs.rmSync(binPath, { force: true });
  const missingFile = lookupAsset(staleReq);
  check('missing bytes yield STALE', missingFile.status === 'stale', missingFile.status);

  check('eligibility rejects a MIME outside the allowlist',
    checkAssetEligibility({ ...a1.record, mimeType: 'video/mp4' }, REQ).eligible === false);
  check('eligibility rejects a capability mismatch',
    checkAssetEligibility(a1.record, { ...REQ, capability: 'product_still' }).eligible === false);
  check('eligibility rejects a brand mismatch',
    checkAssetEligibility(a1.record, { ...REQ, brandId: 'Nope' }).eligible === false);

  // ── Policy exclusions ────────────────────────────────────────────────────
  section('Policy exclusions');

  for (const state of REUSE_BLOCKING_STATES) {
    check(`"${state}" asset is never reused`,
      checkAssetEligibility({ ...a1.record, policy: { state } }, REQ).eligible === false);
  }
  check('explicitly brand-rejected asset is excluded',
    checkAssetEligibility({ ...a1.record, policy: { brandApproved: false } }, REQ).eligible === false);
  check('absent policy means "not rejected", not "approved"',
    checkAssetEligibility({ ...a1.record, policy: undefined }, REQ).eligible === true);

  // ── Variants ─────────────────────────────────────────────────────────────
  section('Variant handling');

  const vBrand = 'Variant Brand';
  const vReq = { ...REQ, brandId: vBrand };
  const v1 = makeAsset({ brandId: vBrand, buffer: Buffer.concat([PNG, Buffer.from('1')]) });
  const v2 = makeAsset({ brandId: vBrand, buffer: Buffer.concat([PNG, Buffer.from('2')]) });
  ensureAssetIndexed(v1.record, vReq);
  ensureAssetIndexed(v2.record, vReq);

  const amb = lookupAsset(vReq);
  check('multiple matches report AMBIGUOUS, not a silent pick', amb.status === 'ambiguous', amb.status);
  check('all variants preserved', amb.variants.length === 2);
  check('exactly one variant marked selected', amb.variants.filter(v => v.selected).length === 1);
  check('selection is deterministic across calls', lookupAsset(vReq).selectedAssetId === amb.selectedAssetId);
  check('selection policy is explained', /deterministic/i.test(amb.reason));
  check('explicit selection wins over age',
    selectVariant([{ assetId: 'b', provenance: { generatedAt: '2020-01-01' } }, { assetId: 'a', policy: { selected: true }, provenance: { generatedAt: '2030-01-01' } }]).assetId === 'a');
  check('otherwise the OLDEST eligible asset wins',
    selectVariant([{ assetId: 'new', provenance: { generatedAt: '2030-01-01' } }, { assetId: 'old', provenance: { generatedAt: '2020-01-01' } }]).assetId === 'old');

  // ── Usage records (append-only) ──────────────────────────────────────────
  section('Usage records');

  const beforeUsage = fs.readFileSync(path.join(ASSET_RECORD_DIR, `${a1.record.assetId}.json`), 'utf8');
  const u1 = recordAssetUsage({ assetId: a1.record.assetId, packageId: 'pack-t', sceneId: 0, actor: { type: 'human', id: 'validator' } });
  const u2 = recordAssetUsage({ assetId: a1.record.assetId, packageId: 'pack-t', sceneId: 0, actor: { type: 'human', id: 'validator' } });
  if (u1.ok) cleanup.push(() => fs.rmSync(path.join(ASSET_USAGE_DIR, `${u1.record.usageId}.json`), { force: true }));
  if (u2.ok) cleanup.push(() => fs.rmSync(path.join(ASSET_USAGE_DIR, `${u2.record.usageId}.json`), { force: true }));

  check('usage records append', u1.ok && u2.ok);
  check('usage ids are unique', u1.record.usageId !== u2.record.usageId);
  check('usage carries actor attribution', u1.record.actor?.id === 'validator');
  check('IMMUTABLE record unchanged by usage',
    fs.readFileSync(path.join(ASSET_RECORD_DIR, `${a1.record.assetId}.json`), 'utf8') === beforeUsage);
  check('no mutable usageCount inside the asset record', !('usageCount' in getAsset(a1.record.assetId)));
  check('usage count is DERIVED from records', usageCountFor(a1.record.assetId) === 2);
  check('usage listing is chronological',
    listAssetUsage(a1.record.assetId).every((u, i, arr) => i === 0 || new Date(arr[i - 1].usedAt) <= new Date(u.usedAt)));
  check('usage rejects a bad assetId', recordAssetUsage({ assetId: '../evil' }).ok === false);

  // ── Ledger vocabulary ────────────────────────────────────────────────────
  section('Ledger cache vocabulary');

  check('cache_hit is a ledger event', LEDGER_EVENTS.includes('cache_hit'));
  check('cache_miss is a ledger event', LEDGER_EVENTS.includes('cache_miss'));
  check('cache outcomes are valid statuses', OUTCOME_STATUSES.includes('cache_hit') && OUTCOME_STATUSES.includes('cache_miss'));

  // ── Provider neutrality + no legacy path ─────────────────────────────────
  section('Provider neutrality');

  const DIR = path.join(ROOT, 'lib/production/assets');
  const TOKENS = ['higgsfield', 'openart', 'heygen', 'hyperframes', 'kling', 'veo', 'flux', 'seedream', 'comfyui', 'mcp'];
  const leaks = fs.readdirSync(DIR).filter(f => f.endsWith('.js')).filter(f => {
    const raw = fs.readFileSync(path.join(DIR, f), 'utf8');
    return TOKENS.some(t => new RegExp(t, 'i').test(raw));
  });
  check('no provider token anywhere in Asset Generation', leaks.length === 0, leaks.join(','));
  const all = fs.readdirSync(DIR).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(DIR, f), 'utf8')).join('\n');
  check('no executeDispatch reference', !/executeDispatch/.test(all));
  check('cache imports no provider module', !/from ['"].*adapters?\//.test(fs.readFileSync(path.join(DIR, 'assetCache.js'), 'utf8')));
  check('cache performs no network call', !/fetch\(|https?:\/\//.test(fs.readFileSync(path.join(DIR, 'assetCache.js'), 'utf8')));

  // ── Real M1 asset is cache-eligible ──────────────────────────────────────
  section('Real M1 asset');

  const realId = 'ast-1785995280379-9583c8e2';
  const real = getAsset(realId);
  if (real) {
    const realIdx = getAssetIndexEntry(realId);
    check('the real M1 asset is indexed', !!realIdx);
    check('its fingerprint is a sha256', /^[0-9a-f]{64}$/.test(realIdx?.semanticFingerprint || ''));
    check('its immutable record carries NO fingerprint (sidecar only)', !('semanticFingerprint' in real));
    check('it is byte-verified and eligible', checkAssetEligibility(real, {
      capability: real.capability, brandId: real.brandId,
    }).eligible === true);
  } else {
    console.log('SKIP — real M1 asset not present.');
  }
} finally {
  for (const fn of cleanup.reverse()) { try { fn(); } catch { /* ignore */ } }
  console.log(`\ncleaned up ${cleanup.length} fixture(s)`);
}

const passed = results.filter(r => r.ok).length;
const failed = results.length - passed;
console.log('═'.repeat(64));
console.log(`Asset Library validation: ${passed}/${results.length} passed, ${failed} failed`);
if (failed) results.filter(r => !r.ok).forEach(r => console.log(`  ✗ ${r.n}${r.d ? ` — ${r.d}` : ''}`));
process.exit(failed ? 1 : 0);
