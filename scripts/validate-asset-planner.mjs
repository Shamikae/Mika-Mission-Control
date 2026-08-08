#!/usr/bin/env node
// scripts/validate-asset-planner.mjs
//
// Executable validation for the seven-scene AssetPlanner (M3). Real code, real
// filesystem, no dev server, no spend — planning never generates.
//
// Run: node scripts/validate-asset-planner.mjs

import fs from 'fs';
import path from 'path';
import { buildRenderSpec } from '../lib/production/renderSpec/buildRenderSpec.js';
import {
  resolveSceneCapability, requestIdFor, summarizePlan, PLAN_CAPABILITIES,
  ASSET_PLANNER_VERSION,
} from '../lib/production/assets/assetPlanRules.js';
import { buildPlanRequests, resolvePlanRequests, buildPlan, planContentHash, refreshPlan } from '../lib/production/assets/assetPlanner.js';

const ROOT = process.cwd();
const REAL_PACKAGE = 'pack-1785960819732-4ed2d0.json';
const PLANNER_DIR = path.join(ROOT, 'lib/production/assets');

const results = [];
function check(n, c, d = '') { results.push({ n, ok: !!c, d }); console.log(`${c ? 'PASS' : 'FAIL'} — ${n}${d && !c ? ` (${d})` : ''}`); }
function section(t) { console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 52 - t.length))}`); }
function stripComments(s) { return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); }

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'content-packages', REAL_PACKAGE), 'utf8'));
const { spec } = buildRenderSpec(pkg, { mode: 'faceless_social' });

try {
  // ── Provider neutrality ──────────────────────────────────────────────────
  section('Planner provider neutrality');

  const TOKENS = ['higgsfield', 'openart', 'heygen', 'hyperframes', 'kling', 'veo', 'flux', 'seedream', 'comfyui', 'mcp'];
  const leaks = [];
  for (const f of fs.readdirSync(PLANNER_DIR).filter(x => x.endsWith('.js'))) {
    const raw = fs.readFileSync(path.join(PLANNER_DIR, f), 'utf8');
    const hit = TOKENS.filter(t => new RegExp(t, 'i').test(raw));
    if (hit.length) leaks.push(`${f}: ${hit.join(',')}`);
  }
  check('no provider token anywhere under lib/production/assets', leaks.length === 0, leaks.join(' | '));

  // "kie" is checked separately and with word boundaries: as a bare substring
  // it matches "cookie", which would make this a permanently noisy assertion.
  const kieLeaks = fs.readdirSync(PLANNER_DIR).filter(x => x.endsWith('.js'))
    .filter(f => /\bkie\b/i.test(fs.readFileSync(path.join(PLANNER_DIR, f), 'utf8')));
  check('no Kie provider token under lib/production/assets', kieLeaks.length === 0, kieLeaks.join(', '));

  const all = fs.readdirSync(PLANNER_DIR).filter(x => x.endsWith('.js')).map(f => fs.readFileSync(path.join(PLANNER_DIR, f), 'utf8')).join('\n');
  check('planner imports no provider module', !/from ['"].*adapters?\//.test(all));
  check('planner never uses the legacy dispatch path', !/executeDispatch/.test(stripComments(all)));
  check('planner never imports the execution engine', !/executionEngine/.test(stripComments(all)));
  const plannerSrc = fs.readFileSync(path.join(PLANNER_DIR, 'assetPlanner.js'), 'utf8');
  check('planner asks policy rather than routing itself', /recommendBinding/.test(plannerSrc));
  check('planner stores the binding whole (no cherry-picking)', /\{ \.\.\.decision\.binding \}/.test(plannerSrc));

  // ── Capability mapping ───────────────────────────────────────────────────
  section('Capability mapping');

  check('only the four v1 capabilities exist',
    PLAN_CAPABILITIES.join(',') === 'background_plate,cinematic_broll_still,product_still,placeholder');

  const textScene = { visual: { generationPrompt: 'A call-to-action graphic with bold text', assetKind: 'video' } };
  const textRes = resolveSceneCapability(textScene);
  check('a scene demanding legible text becomes a placeholder', textRes.capability === 'placeholder');
  check('text refusal is explained', /text/i.test(textRes.warnings[0] || ''));
  check('no text/logo generation is ever requested', textRes.reasons.includes('text_or_logo_required'));
  check('a logo request is also refused', resolveSceneCapability({ visual: { generationPrompt: 'Company logo on a wall' } }).capability === 'placeholder');

  const motionScene = { visual: { generationPrompt: 'An animation of icons moving through a funnel', assetKind: 'video' } };
  const motionRes = resolveSceneCapability(motionScene);
  check('a temporal-action scene stays a placeholder', motionRes.capability === 'placeholder');
  check('temporal refusal is explained', motionRes.reasons.includes('temporal_action_required'));

  const staticVideo = { visual: { generationPrompt: 'A cluttered desk in a modern office', assetKind: 'video' } };
  const staticRes = resolveSceneCapability(staticVideo);
  check('a static subject with camera movement degrades to a still', staticRes.capability === 'background_plate');
  check('the video→still degradation is reported, not silent',
    staticRes.warnings.some(w => /assetKind "video"/.test(w)) && staticRes.reasons.includes('video_kind_degraded_to_still'));
  check('an image-kind scene needs no degradation warning',
    resolveSceneCapability({ visual: { generationPrompt: 'A flowchart of arrows', assetKind: 'image' } }).warnings.length === 0);
  check('a product scene maps to product_still',
    resolveSceneCapability({ visual: { generationPrompt: 'A packshot on a seamless backdrop' } }).capability === 'product_still');
  check('a cinematic scene maps to cinematic_broll_still',
    resolveSceneCapability({ visual: { generationPrompt: 'A cinematic office at golden hour' } }).capability === 'cinematic_broll_still');
  check('a scene with no visual intent becomes a placeholder',
    resolveSceneCapability({ visual: {} }).capability === 'placeholder');

  // ── Seven-scene plan ─────────────────────────────────────────────────────
  section('Seven-scene plan');

  const { requests } = buildPlanRequests(spec, { brandId: spec.source?.brand });
  check('exactly seven requests', requests.length === 7, String(requests.length));
  check('one request per scene, in order', requests.every((r, i) => r.sceneIndex === i));
  check('no scene produces two requests', new Set(requests.map(r => r.sceneIndex)).size === 7);
  check('request ids are deterministic',
    requests.every(r => r.requestId === requestIdFor(spec.specId, r.sceneIndex, r.capability)));
  check('request ids are stable across rebuilds',
    buildPlanRequests(spec, { brandId: spec.source?.brand }).requests.map(r => r.requestId).join(',') === requests.map(r => r.requestId).join(','));
  check('creative intent is preserved verbatim',
    requests.every((r, i) => r.creativeIntent.generationPrompt === (spec.scenes[i].visual?.generationPrompt || null)));
  check('negativePrompt is preserved on the request',
    requests.every((r, i) => r.creativeIntent.negativePrompt === (spec.scenes[i].visual?.negativePrompt || null)));

  const resolved = resolvePlanRequests(requests);
  check('scene 0 resolves from cache', resolved[0].status === 'resolved_from_cache', resolved[0].status);
  check('scene 0 reuses the real M1 asset', resolved[0].assetId === 'ast-1785995280379-9583c8e2', String(resolved[0].assetId));
  check('a cache hit costs a confirmed zero', resolved[0].estimate.amount === 0 && resolved[0].estimate.confirmed === true);
  check('a cache hit needs no binding', resolved[0].binding === null);
  check('a cache hit creates no Production Job', resolved[0].productionJobId === null);

  const paid = resolved.filter(r => r.status === 'awaiting_generation');
  check('misses proceed to a binding', paid.length > 0 && paid.every(r => !!r.binding?.providerId));
  check('misses start with an honestly unknown price', paid.every(r => r.estimate.confirmed === false));
  check('unsupported fields are reported per request',
    paid.every(r => Array.isArray(r.droppedFields)) && paid.some(r => r.droppedFields.some(d => d.field === 'negativePrompt')));
  check('placeholders cost a confirmed zero',
    resolved.filter(r => r.status === 'placeholder').every(r => r.estimate.amount === 0 && r.estimate.confirmed === true));
  check('no request carries a Production Job at plan time', resolved.every(r => r.productionJobId === null));

  // ── Summary aggregation ──────────────────────────────────────────────────
  section('Summary aggregation');

  const priced = resolved.map(r => r.status === 'awaiting_generation'
    ? { ...r, estimate: { amount: 0.12, unit: 'provider_credits', providerCreditUnit: 'higgsfield-credits', estimateType: 'confirmed_provider', confirmed: true, isLowerBound: false } } : r);
  const sum = summarizePlan(priced);
  check('exact totals aggregate', sum.estimatedTotal === Math.round(paid.length * 0.12 * 10000) / 10000, String(sum.estimatedTotal));
  check('total is complete when every price is known', sum.totalIsIncomplete === false);
  check('no provisional requests when all confirmed', sum.provisionalRequests === 0);
  check('visual completeness counts cache hits and paid generations',
    sum.visualCompleteness === Math.round(((sum.cacheHits + sum.paidRequests) / 7) * 100));

  // Blank the price of the FIRST paid request, whichever scene that is. Pinning
  // this to a scene index made the suite depend on live Asset Library contents:
  // once that scene had a real cached asset it stopped being a paid request and
  // these assertions silently tested nothing.
  let blanked = false;
  const mixed = priced.map(r => {
    if (blanked || r.status !== 'awaiting_generation') return r;
    blanked = true;
    return { ...r, estimate: { amount: null, unit: 'provider_credits', providerCreditUnit: 'higgsfield-credits', estimateType: 'unknown', confirmed: false, isLowerBound: false } };
  });
  const mixedSum = summarizePlan(mixed);
  check('an unknown price marks the total incomplete', mixedSum.totalIsIncomplete === true);
  check('provisional requests propagate to the summary', mixedSum.provisionalRequests === 1);
  check('an unknown price is never treated as zero', mixedSum.estimatedTotal < sum.estimatedTotal);

  // ── Determinism ──────────────────────────────────────────────────────────
  section('Plan determinism');

  const p1 = buildPlan(spec, { packageId: pkg.id, brandId: spec.source?.brand, actor: 'validator' });
  const p2 = buildPlan(spec, { packageId: pkg.id, brandId: spec.source?.brand, actor: 'validator' });
  check('same URS yields the same content hash', p1.contentHash === p2.contentHash);
  check('plan ids differ (identity is the hash, not the id)', p1.planId !== p2.planId);
  check('plannerVersion is stamped', p1.plannerVersion === ASSET_PLANNER_VERSION);
  check('content hash is a sha256', /^[0-9a-f]{64}$/.test(p1.contentHash));

  const changedPrompt = JSON.parse(JSON.stringify(spec));
  changedPrompt.scenes[1].visual.generationPrompt = 'A completely different subject entirely';
  check('a changed prompt changes the content hash',
    buildPlan(changedPrompt, { packageId: pkg.id, brandId: spec.source?.brand, actor: 'validator' }).contentHash !== p1.contentHash);

  const withCeiling = buildPlan(spec, { packageId: pkg.id, brandId: spec.source?.brand, actor: 'validator', ceilings: { 'higgsfield-credits': 5 } });
  check('a changed ceiling changes the content hash', withCeiling.contentHash !== p1.contentHash);

  // ── Approval invalidation ────────────────────────────────────────────────
  section('Approval invalidation');

  const approvedPlan = {
    ...p1,
    status: 'approved',
    approval: { required: true, approvalRef: 'apr-x', approvedAt: new Date().toISOString(), approvedBy: 'validator', contentHashAtApproval: p1.contentHash },
  };
  const untouched = refreshPlan(approvedPlan);
  check('an unchanged approved plan stays approved', untouched.status === 'approved' && untouched.approval.approvalRef === 'apr-x');

  const mutated = refreshPlan({
    ...approvedPlan,
    requests: approvedPlan.requests.map((r, i) => i === 1 ? { ...r, capability: 'product_still' } : r),
  });
  check('modifying a plan invalidates its approval', mutated.status === 'invalidated');
  check('the approval reference is cleared on invalidation', mutated.approval.approvalRef === null);
  check('invalidation is recorded in activity history',
    mutated.activityHistory.some(e => e.type === 'asset_plan_invalidated'));

  // ── No dispatch ──────────────────────────────────────────────────────────
  section('No dispatch at plan time');

  check('planner exposes no dispatch function', !/export function dispatch|export async function dispatch/.test(plannerSrc));
  check('planner never submits', !/\.submit\(/.test(stripComments(plannerSrc)));
  check('no dispatch route exists yet', !fs.existsSync(path.join(ROOT, 'pages/api/production/assets/plans/[id]/dispatch.js')));
} finally {
  console.log('');
}

const passed = results.filter(r => r.ok).length;
const failed = results.length - passed;
console.log('═'.repeat(64));
console.log(`Asset planner validation: ${passed}/${results.length} passed, ${failed} failed`);
if (failed) results.filter(r => !r.ok).forEach(r => console.log(`  ✗ ${r.n}${r.d ? ` — ${r.d}` : ''}`));
process.exit(failed ? 1 : 0);
