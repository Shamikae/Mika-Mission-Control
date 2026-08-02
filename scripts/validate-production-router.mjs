#!/usr/bin/env node
// scripts/validate-production-router.mjs
//
// Executable validation for Production Router v1. Follows this project's
// established convention (no jest/vitest configured) of validating against
// the REAL running dev server and REAL file-backed persistence — no mocking.
//
// Setup fixtures (two isolated eligibility edge cases + one main package)
// are written directly to data/content-packages/*.json, matching the known,
// stable Content Package schema — this isolates Production Router's own
// logic from Content Pack Generator's live OpenRouter synthesis (already
// validated in an earlier milestone), while every Production Router
// endpoint itself is exercised over real HTTP against the real dev server
// with real fs-backed job persistence. Fixtures are cleaned up on exit.

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const BASE = 'http://localhost:3099';

function readEnvToken() {
  try {
    const raw = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8');
    const match = raw.match(/^MIKA_ADMIN_TOKEN=(.+)$/m);
    return match ? match[1].trim() : '';
  } catch { return ''; }
}
const TOKEN = readEnvToken();

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, ok: !!condition, detail });
  console.log(`${condition ? 'PASS' : 'FAIL'} — ${name}${detail && !condition ? ` (${detail})` : ''}`);
}

async function api(method, urlPath, body) {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Mika-Admin-Token': TOKEN },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON response, e.g. Next 404 page */ }
  return { status: res.status, json };
}

async function waitForServer(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/capabilities/registry`);
      if (res.ok || res.status === 405) return true;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PKG_DIR = path.join(ROOT, 'data', 'content-packages');
const JOB_DIR = path.join(ROOT, 'data', 'production-jobs');

function baseFixture(id, overrides = {}) {
  const now = new Date().toISOString();
  return {
    id,
    status: 'draft',
    brand: 'Test Brand',
    platform: 'TikTok',
    goal: 'Engagement',
    topic: 'test package',
    audience: '', offer: '', tone: '', videoDuration: '30-60s',
    hooks: [{ text: 'Test hook', angle: 'curiosity' }],
    script: { opening: '', body: '', cta: '', fullText: '' },
    scenes: [],
    caption: 'Test caption', cta: 'Shop now', hashtags: ['test'], keywords: ['test'],
    thumbnail: { headline: 'Test', visualBrief: '', artifactId: null, artifactUrl: null, status: 'not_requested', error: null },
    metadata: { workflowId: id, model: null, provider: 'test-fixture', createdAt: now, updatedAt: now, estimatedCost: null, actualCost: null, instructions: '' },
    ...overrides,
  };
}

function writeFixture(pkg) {
  fs.mkdirSync(PKG_DIR, { recursive: true });
  fs.writeFileSync(path.join(PKG_DIR, `${pkg.id}.json`), JSON.stringify(pkg, null, 2));
}
function readFixture(id) {
  return JSON.parse(fs.readFileSync(path.join(PKG_DIR, `${id}.json`), 'utf-8'));
}

const MAIN_ID = 'pack-test-pr-main';
const BLOCKED_ID = 'pack-test-pr-blocked';
const MISSING_ID = 'pack-test-pr-missing';
const BACKLINK_ID = 'pack-test-pr-backlink';

const createdJobIds = new Set();
const createdPackageIds = [MAIN_ID, BLOCKED_ID, MISSING_ID, BACKLINK_ID];

function cleanup() {
  for (const id of createdPackageIds) {
    try { fs.unlinkSync(path.join(PKG_DIR, `${id}.json`)); } catch { /* already gone */ }
  }
  for (const id of createdJobIds) {
    try { fs.unlinkSync(path.join(JOB_DIR, `${id}.json`)); } catch { /* already gone */ }
  }
}

async function main() {
  console.log(`Using admin token: ${TOKEN ? '(configured)' : '(NONE — mutations will 401/503)'}`);

  const up = await waitForServer();
  check('dev server reachable on :3099', up);
  if (!up) { console.log('Cannot continue without a running server.'); process.exitCode = 1; return; }

  // ── Fixture setup ────────────────────────────────────────────────────────

  writeFixture(baseFixture(MAIN_ID, {
    status: 'approved',
    topic: 'How to use our new product — a full demo video',
    script: { opening: 'Hey!', body: 'Here is how you use it.', cta: 'Grab yours today.', fullText: 'Hey! Here is how you use it. Grab yours today. This script is intentionally long enough to compute a plausible spoken-word duration estimate for readiness scoring purposes across several sentences.' },
    scenes: [
      { order: 1, durationSeconds: 5, visual: 'Product on a table', voiceover: 'Check this out', onScreenText: 'NEW' },
      { order: 2, durationSeconds: 4, visual: 'Close up of the product', voiceover: '', onScreenText: '' },
    ],
    thumbnail: { headline: 'Test', visualBrief: 'A bright, clean product shot on a white background', artifactId: null, artifactUrl: null, status: 'not_requested', error: null },
    pipeline: { stage: 'approved', enteredStageAt: new Date().toISOString(), history: [
      { stage: 'research', at: new Date().toISOString(), actor: 'system', note: null },
      { stage: 'review', at: new Date().toISOString(), actor: 'test', note: null },
      { stage: 'approved', at: new Date().toISOString(), actor: 'test', note: null },
    ] },
  }));

  writeFixture(baseFixture(BLOCKED_ID, {
    status: 'draft',
    script: { opening: '', body: '', cta: '', fullText: 'Irrelevant script text.' },
    scenes: [{ order: 1, durationSeconds: 5, visual: 'x', voiceover: '', onScreenText: '' }],
  }));

  writeFixture(baseFixture(MISSING_ID, {
    status: 'approved',
    script: { opening: '', body: '', cta: '', fullText: '' },
    scenes: [],
    pipeline: { stage: 'approved', enteredStageAt: new Date().toISOString(), history: [
      { stage: 'review', at: new Date().toISOString(), actor: 'test', note: null },
      { stage: 'approved', at: new Date().toISOString(), actor: 'test', note: null },
    ] },
  }));

  writeFixture(baseFixture(BACKLINK_ID, {
    status: 'approved',
    topic: 'Backlink sync test package',
    script: { opening: '', body: '', cta: '', fullText: 'A script long enough to be non-empty for eligibility and readiness checks in the backlink synchronization tests.' },
    scenes: [{ order: 1, durationSeconds: 5, visual: 'x', voiceover: 'y', onScreenText: 'z' }],
    thumbnail: { headline: 'Test', visualBrief: 'A clean product shot', artifactId: null, artifactUrl: null, status: 'not_requested', error: null },
    pipeline: { stage: 'approved', enteredStageAt: new Date().toISOString(), history: [
      { stage: 'review', at: new Date().toISOString(), actor: 'test', note: null },
      { stage: 'approved', at: new Date().toISOString(), actor: 'test', note: null },
    ] },
  }));

  // ── A. Package eligibility (happy path) ─────────────────────────────────

  let r = await api('POST', '/api/production/router/plan', { packageId: MAIN_ID });
  check('A: eligible package -> 201 + job created', r.status === 201 && r.json?.ok === true, JSON.stringify(r.json));
  check('A: eligible package -> eligibility.eligible=true, status != blocked', r.json?.job?.eligibility?.eligible === true && r.json?.job?.status !== 'blocked');
  if (r.json?.job?.id) createdJobIds.add(r.json.job.id);

  // ── B. Blocked unapproved package ───────────────────────────────────────

  r = await api('POST', '/api/production/router/plan', { packageId: BLOCKED_ID });
  check('B: unapproved package -> status=blocked', r.status === 201 && r.json?.job?.status === 'blocked');
  check('B: blocked reasons mention pipeline stage and status', /Pipeline stage/.test(r.json?.job?.eligibility?.reasons?.join(' ') || '') && /status must be/.test(r.json?.job?.eligibility?.reasons?.join(' ') || ''));
  if (r.json?.job?.id) createdJobIds.add(r.json.job.id);

  // ── C. Missing script/scenes ─────────────────────────────────────────────

  r = await api('POST', '/api/production/router/plan', { packageId: MISSING_ID });
  check('C: missing script/scenes -> status=blocked', r.status === 201 && r.json?.job?.status === 'blocked');
  const cReasons = r.json?.job?.eligibility?.reasons?.join(' ') || '';
  check('C: blocked reasons mention script.fullText and scene', /script\.fullText/.test(cReasons) && /scene/i.test(cReasons));
  if (r.json?.job?.id) createdJobIds.add(r.json.job.id);

  // ── D. Mode recommendation (deterministic keyword match) ────────────────

  r = await api('POST', '/api/production/router/plan', { packageId: MAIN_ID });
  const jobD = r.json?.job;
  if (jobD?.id) createdJobIds.add(jobD.id);
  check('D: mode recommendation -> product_demo', jobD?.recommendedMode === 'product_demo', jobD?.recommendedMode);
  check('D: modeReason labeled deterministic, not AI-based', /deterministic/i.test(jobD?.modeReason || ''));

  // ── E. Provider candidate ordering ───────────────────────────────────────

  check('E: providerCandidates non-empty and includes manual-export', Array.isArray(jobD?.providerCandidates) && jobD.providerCandidates.some(c => c.id === 'manual-export'));
  const scores = (jobD?.providerCandidates || []).map(c => c.score ?? -Infinity);
  const sortedDesc = scores.every((s, i) => i === 0 || scores[i - 1] >= s);
  check('E: providerCandidates ordered best->worst by score', sortedDesc);

  // ── F. Staged provider never treated as live/executable ─────────────────

  const higgsfieldCandidate = jobD?.providerCandidates?.find(c => c.id === 'higgsfield');
  check('F: higgsfield present, status=staged, executable=false', higgsfieldCandidate?.status === 'staged' && higgsfieldCandidate?.executable === false);
  check('F: unavailableReasons explains higgsfield', typeof jobD?.unavailableReasons?.higgsfield === 'string' && jobD.unavailableReasons.higgsfield.length > 0);

  // ── G. Manual-export fallback / never routes to unavailable as executable ─

  const recommended = jobD?.providerCandidates?.find(c => c.id === jobD.recommendedProvider);
  check('G: recommendedProvider is always status=active (executable)', recommended?.status === 'active');

  // ── H. Readiness scoring shape ────────────────────────────────────────────

  check('H: readiness.score is 0-100 number', Number.isFinite(jobD?.readiness?.score) && jobD.readiness.score >= 0 && jobD.readiness.score <= 100);
  check('H: readiness.ready matches missingRequired emptiness', jobD?.readiness?.ready === (jobD?.readiness?.missingRequired?.length === 0));

  // ── I. Missing required assets (productImage never exists in schema) ────

  check('I: product_demo mode reports productImage missing', jobD?.readiness?.missingRequired?.includes('productImage'));
  check('I: job status = needs_assets when required assets missing', jobD?.status === 'needs_assets');

  // ── J. Budget approval requirement ───────────────────────────────────────

  r = await api('POST', '/api/production/router/plan', { packageId: MAIN_ID, selectedMode: 'product_demo', selectedProvider: 'heygen' });
  if (r.json?.job?.id) createdJobIds.add(r.json.job.id);
  check('J: non-manual provider -> budget.approvalRequired=true', r.json?.job?.budget?.approvalRequired === true, JSON.stringify(r.json?.job?.budget));

  r = await api('POST', '/api/production/router/plan', { packageId: MAIN_ID, selectedMode: 'product_demo', selectedProvider: 'manual-export' });
  if (r.json?.job?.id) createdJobIds.add(r.json.job.id);
  check('J: manual-export -> budget.approvalRequired=false', r.json?.job?.budget?.approvalRequired === false, JSON.stringify(r.json?.job?.budget));

  // ── K. Stale package detection + refresh reconciliation ─────────────────

  r = await api('POST', '/api/production/router/plan', { packageId: MAIN_ID });
  const jobK = r.json?.job;
  if (jobK?.id) createdJobIds.add(jobK.id);

  const mutated = readFixture(MAIN_ID);
  mutated.topic = 'How to use our new product — an UPDATED demo video';
  mutated.metadata.updatedAt = new Date(Date.now() + 5000).toISOString();
  writeFixture(mutated);

  const pkgAfter = await api('GET', `/api/content/pack/${MAIN_ID}`);
  check('K: package updatedAt actually changed on disk', pkgAfter.json?.package?.metadata?.updatedAt !== jobK.packageUpdatedAt);

  const refreshed = await api('POST', `/api/production/jobs/${jobK.id}/refresh`);
  check('K: refresh -> 200 ok', refreshed.status === 200 && refreshed.json?.ok === true);
  check('K: refresh reconciles packageUpdatedAt to latest', refreshed.json?.job?.packageUpdatedAt === mutated.metadata.updatedAt);
  const kEvents = (refreshed.json?.job?.activityHistory || []).map(e => e.type);
  check('K: activity history logs package_stale_detected then plan_refreshed', kEvents.includes('package_stale_detected') && kEvents.includes('plan_refreshed'));

  // ── L. Approval transition (needs_approval -> ready, gated on readiness) ─

  r = await api('POST', '/api/production/router/plan', { packageId: MAIN_ID, selectedMode: 'cinematic_broll', selectedProvider: 'higgsfield' });
  const jobL = r.json?.job;
  if (jobL?.id) createdJobIds.add(jobL.id);
  check('L: cinematic_broll+higgsfield -> readiness.ready=true (sceneplan+visualBrief both available)', jobL?.readiness?.ready === true, JSON.stringify(jobL?.readiness));
  check('L: -> status=needs_approval (staged provider requires approval)', jobL?.status === 'needs_approval', jobL?.status);

  const approveBadState = await api('POST', `/api/production/jobs/${jobD.id}/approve`); // jobD is needs_assets, must reject
  check('L: approve rejects a job not in needs_approval (409)', approveBadState.status === 409);

  const approved = await api('POST', `/api/production/jobs/${jobL.id}/approve`);
  check('L: approve -> 200, status=ready, approval.approvedAt set', approved.status === 200 && approved.json?.job?.status === 'ready' && !!approved.json?.job?.approval?.approvedAt);
  check('L: activity history logs approved event', (approved.json?.job?.activityHistory || []).some(e => e.type === 'approved'));

  // ── M. Cancel transition ─────────────────────────────────────────────────

  const cancelled = await api('PATCH', `/api/production/jobs/${jobL.id}`, { cancel: true, note: 'validation cleanup' });
  check('M: PATCH cancel -> status=cancelled', cancelled.status === 200 && cancelled.json?.job?.status === 'cancelled');
  check('M: activity history logs cancelled event', (cancelled.json?.job?.activityHistory || []).some(e => e.type === 'cancelled'));

  // ── N. Invalid ID / path traversal rejection ─────────────────────────────

  const traversalGet = await api('GET', `/api/production/jobs/${encodeURIComponent('../../etc/passwd')}`);
  check('N: GET with path-traversal id -> 400, not 200/500', traversalGet.status === 400, `status=${traversalGet.status}`);

  const traversalPlan = await api('POST', '/api/production/router/plan', { packageId: '../../etc/passwd' });
  check('N: POST plan with path-traversal packageId -> 400', traversalPlan.status === 400);

  const notFound = await api('GET', '/api/production/jobs/pr-0000000000-abc123');
  check('N: GET well-formed but nonexistent id -> 404 (no crash)', notFound.status === 404);

  // ── O. No secrets in API responses ────────────────────────────────────────

  const blob = JSON.stringify([r.json, approved.json, refreshed.json, jobD]);
  const secretPatterns = [TOKEN, 'access_token', 'refresh_token', 'client_secret', ROOT];
  const leaked = secretPatterns.filter(p => p && blob.includes(p));
  check('O: no secrets/tokens/filesystem paths in API responses', leaked.length === 0, leaked.join(', '));

  // ── P. No package content duplication in job storage ────────────────────

  const jobFileRaw = fs.readFileSync(path.join(JOB_DIR, `${jobK.id}.json`), 'utf-8');
  const pkgNow = readFixture(MAIN_ID);
  const leaksScriptText = jobFileRaw.includes(pkgNow.script.fullText) && pkgNow.script.fullText.length > 20;
  const leaksSceneVisual = jobFileRaw.includes(pkgNow.scenes[0]?.visual || ' ');
  check('P: persisted job file does not contain script.fullText verbatim', !leaksScriptText);
  check('P: persisted job file does not contain scene visual text verbatim', !leaksSceneVisual);

  // ── Q. Runtime data gitignored ────────────────────────────────────────────

  const { execSync } = await import('child_process');
  let ignored = false;
  try {
    execSync(`git check-ignore -q "data/production-jobs/${jobK.id}.json"`, { cwd: ROOT });
    ignored = true;
  } catch { ignored = false; }
  check('Q: data/production-jobs/* is git-ignored', ignored);

  // ── R. List/filter sanity ─────────────────────────────────────────────────

  const listAll = await api('GET', '/api/production/jobs');
  check('R: GET /api/production/jobs -> ok, includes created jobs', listAll.status === 200 && listAll.json?.jobs?.some(j => j.id === jobK.id));

  const listFiltered = await api('GET', `/api/production/jobs?packageId=${MAIN_ID}&status=needs_assets`);
  check('R: filtered list only returns matching jobs', listFiltered.json?.jobs?.every(j => j.packageId === MAIN_ID && j.status === 'needs_assets'));

  // ── S. Job creation writes the package backlink ──────────────────────────

  const beforeS = readFixture(BACKLINK_ID);
  check('S: package has no production ref before any job exists', beforeS.production === undefined);

  r = await api('POST', '/api/production/router/plan', { packageId: BACKLINK_ID });
  const job1 = r.json?.job;
  if (job1?.id) createdJobIds.add(job1.id);

  const afterS = await api('GET', `/api/content/pack/${BACKLINK_ID}`);
  const prodS = afterS.json?.package?.production;
  check('S: package.production.latestJobId === newly created job id', prodS?.latestJobId === job1?.id);
  check('S: package.production mirrors job status/mode/provider', prodS?.status === job1?.status && prodS?.selectedMode === job1?.selectedMode && prodS?.selectedProvider === job1?.selectedProvider);
  check('S: package.production.updatedAt is a valid recent ISO timestamp', !!prodS?.updatedAt && !Number.isNaN(new Date(prodS.updatedAt).getTime()));

  // ── T. A newer job takes over the backlink ───────────────────────────────

  r = await api('POST', '/api/production/router/plan', { packageId: BACKLINK_ID, selectedMode: 'cinematic_broll', selectedProvider: 'higgsfield' });
  const job2 = r.json?.job;
  if (job2?.id) createdJobIds.add(job2.id);
  check('T: readiness passes for cinematic_broll (sceneplan+visualBrief available)', job2?.readiness?.ready === true);
  check('T: job2 -> needs_approval (staged provider)', job2?.status === 'needs_approval');

  const afterT = await api('GET', `/api/content/pack/${BACKLINK_ID}`);
  check('T: package.production.latestJobId now points to job2 (the newer job)', afterT.json?.package?.production?.latestJobId === job2?.id);

  // ── U. An older job can never overwrite a newer production reference ─────

  const patchOlder = await api('PATCH', `/api/production/jobs/${job1.id}`, { selectedMode: 'faceless_social' });
  check('U: PATCH on the OLDER job (job1) still succeeds', patchOlder.status === 200 && patchOlder.json?.ok === true);

  const afterU = await api('GET', `/api/content/pack/${BACKLINK_ID}`);
  check('U: package.production.latestJobId is STILL job2 (job1 did not clobber it)', afterU.json?.package?.production?.latestJobId === job2.id);
  check('U: package.production.selectedMode still reflects job2, not job1\'s new mode', afterU.json?.package?.production?.selectedMode === job2.selectedMode);

  // ── V. Approve / refresh / cancel synchronize the latest job's status ────

  const approvedJob2 = await api('POST', `/api/production/jobs/${job2.id}/approve`);
  check('V: approve job2 -> 200, status=ready', approvedJob2.status === 200 && approvedJob2.json?.job?.status === 'ready');
  let afterV = await api('GET', `/api/content/pack/${BACKLINK_ID}`);
  check('V: approve synchronizes package.production.status -> ready', afterV.json?.package?.production?.status === 'ready');

  const refreshedJob2 = await api('POST', `/api/production/jobs/${job2.id}/refresh`);
  check('V: refresh job2 -> 200 ok', refreshedJob2.status === 200 && refreshedJob2.json?.ok === true);
  afterV = await api('GET', `/api/content/pack/${BACKLINK_ID}`);
  check('V: refresh keeps package.production in sync with job2', afterV.json?.package?.production?.status === refreshedJob2.json?.job?.status);

  const cancelledJob2 = await api('PATCH', `/api/production/jobs/${job2.id}`, { cancel: true });
  check('V: cancel job2 -> 200, status=cancelled', cancelledJob2.status === 200 && cancelledJob2.json?.job?.status === 'cancelled');
  afterV = await api('GET', `/api/content/pack/${BACKLINK_ID}`);
  check('V: cancel synchronizes package.production.status -> cancelled', afterV.json?.package?.production?.status === 'cancelled');

  // ── W. Package content fields are never touched by production sync ──────

  const finalPkg = readFixture(BACKLINK_ID);
  check('W: script.fullText unchanged by all production sync operations', finalPkg.script.fullText === beforeS.script.fullText);
  check('W: scenes unchanged by all production sync operations', JSON.stringify(finalPkg.scenes) === JSON.stringify(beforeS.scenes));
  check('W: package status/pipeline stage unchanged by production sync', finalPkg.status === beforeS.status && finalPkg.pipeline.stage === beforeS.pipeline.stage);
  check('W: metadata.createdAt unchanged by production sync', finalPkg.metadata.createdAt === beforeS.metadata.createdAt);

  // ── X. A plan attempt that never persists a job never creates a backlink ─

  const ghostPlan = await api('POST', '/api/production/router/plan', { packageId: 'pack-does-not-exist-xyz' });
  check('X: plan against a nonexistent package -> 404, no job created', ghostPlan.status === 404 && ghostPlan.json?.ok === false);
  const jobsBeforeAfterGhost = await api('GET', '/api/production/jobs?packageId=pack-does-not-exist-xyz');
  check('X: no orphan job exists for the nonexistent package', (jobsBeforeAfterGhost.json?.jobs || []).length === 0);

  // ── Y. User edit APIs cannot forge production metadata ───────────────────

  const forgeAttempt = await api('PATCH', `/api/content/pack/${BACKLINK_ID}`, {
    edits: { production: { latestJobId: 'forged-job-id', status: 'completed', selectedMode: 'avatar_video', selectedProvider: 'manual-export', updatedAt: '2000-01-01T00:00:00.000Z' } },
  });
  check('Y: forged production edit request -> 200 (edit accepted but field ignored)', forgeAttempt.status === 200 && forgeAttempt.json?.ok === true);
  check('Y: package.production.latestJobId is unchanged by the forgery attempt', forgeAttempt.json?.package?.production?.latestJobId === job2.id);
  check('Y: package.production.status was not overwritten to "completed"', forgeAttempt.json?.package?.production?.status !== 'completed');

  // ── Z. No provider URLs or secrets are ever written into production ref ──

  const finalProd = forgeAttempt.json?.package?.production;
  const prodKeys = Object.keys(finalProd || {}).sort();
  check('Z: production object has exactly the 5 expected fields', JSON.stringify(prodKeys) === JSON.stringify(['latestJobId', 'selectedMode', 'selectedProvider', 'status', 'updatedAt']));
  const prodBlob = JSON.stringify(finalProd);
  check('Z: no URLs, tokens, or filesystem paths in production ref', !/https?:\/\//.test(prodBlob) && !prodBlob.includes(TOKEN) && !prodBlob.includes(ROOT));

  // ── Summary ────────────────────────────────────────────────────────────────

  cleanup();

  const failed = results.filter(r2 => !r2.ok);
  console.log('\n──────────────────────────────────────────');
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('FAILED:');
    failed.forEach(f => console.log(`  - ${f.name}${f.detail ? ` :: ${f.detail}` : ''}`));
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error('Validation script crashed:', err);
  cleanup();
  process.exitCode = 1;
});
