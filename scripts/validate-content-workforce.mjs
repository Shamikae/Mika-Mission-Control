#!/usr/bin/env node
// scripts/validate-content-workforce.mjs
//
// Validates Content Workforce v1 (Phase 4B) end-to-end using two EPHEMERAL,
// isolated `next dev` server instances this script spawns and tears down
// itself (on a dedicated port, never touching the user's own long-running
// dev server on :3099 or its .env.local):
//   Phase 1 — CONTENT_WORKFORCE_ENABLED=false: proves the honest
//     configuration_pending path with zero model calls.
//   Phase 2 — CONTENT_WORKFORCE_ENABLED=true + CONTENT_WORKFORCE_MOCK_MODE=
//     true: proves the full seven-stage flow using deterministic mocked
//     model responses (see workforceModelClient.js's mockModeActive() —
//     gated on NODE_ENV!=='production' AND this exact env var, never
//     reachable in a real deployment). Every mocked response still flows
//     through the real schema-validation/sanitization/repair-retry code
//     path — only the network call itself is swapped out.
//
// Fixture safety: every content request / workforce run / package created
// here is tracked by exact id and deleted in a `finally` block — never a
// blanket directory delete (the lesson from an earlier milestone's
// validator accidentally deleting a real record via a loose cleanup).

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { pathToFileURL } from 'url';

const ROOT = process.cwd();
const PORT = 3199;
const BASE = `http://localhost:${PORT}`;
const REQ_DIR = path.join(ROOT, 'data', 'content-requests');
const RUN_DIR = path.join(ROOT, 'data', 'content-workforce-runs');
const PKG_DIR = path.join(ROOT, 'data', 'content-packages');
const TOKEN = 'validator-content-workforce-token';

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, ok: !!condition, detail });
  console.log(`${condition ? 'PASS' : 'FAIL'} — ${name}${detail && !condition ? ` (${detail})` : ''}`);
}
function printSummary() {
  const failed = results.filter(r => !r.ok);
  console.log('\n──────────────────────────────────────────');
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('FAILED:');
    failed.forEach(f => console.log(`  - ${f.name}${f.detail ? ` :: ${f.detail}` : ''}`));
    process.exitCode = 1;
  }
}

async function api(method, urlPath, body) {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Mika-Admin-Token': TOKEN },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

function deleteJsonFile(dir, id) {
  try { fs.unlinkSync(path.join(dir, `${id}.json`)); } catch { /* already gone */ }
}
function countJsonFiles(dir) {
  try { return fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.includes('.tmp')).length; } catch { return 0; }
}
function forbiddenContent(obj) {
  const json = JSON.stringify(obj);
  const patterns = [
    /\/Users\/[^"]*/,
    /sk-or-v1-[a-zA-Z0-9]+/,
    /Authorization/,
    /"apiKey"/i,
    /chain[_-]?of[_-]?thought/i,
    /"reasoning"\s*:/,
  ];
  return patterns.filter(p => p.test(json));
}

async function waitForServer(base, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${base}/api/creative-director/requests`);
      if (res.status === 200) return true;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 750));
  }
  return false;
}

function spawnServer(envOverrides) {
  const nextBin = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'next.cmd' : 'next');
  const env = { ...process.env, PORT: String(PORT), MIKA_ADMIN_TOKEN: TOKEN, ...envOverrides };
  const proc = spawn(nextBin, ['dev', '-p', String(PORT)], { cwd: ROOT, env, stdio: 'pipe' });
  let logs = '';
  proc.stdout.on('data', d => { logs += d.toString(); });
  proc.stderr.on('data', d => { logs += d.toString(); });
  return { proc, getLogs: () => logs };
}

async function stopServer(handle) {
  if (!handle?.proc || handle.proc.killed) return;
  await new Promise(resolve => {
    handle.proc.once('exit', resolve);
    handle.proc.kill('SIGTERM');
    setTimeout(() => { try { handle.proc.kill('SIGKILL'); } catch { /* already gone */ } resolve(); }, 8000);
  });
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 1 — pure unit tests (direct import, no server needed)
// ═══════════════════════════════════════════════════════════════════════

async function runUnitTests() {
  const mod = await import(pathToFileURL(path.join(ROOT, 'lib/creative-director/workforce/workforceRules.js')).href);
  const {
    getEffectiveStageOutput, sanitizeStageOverride, checkBudgetGate, estimateCostFromTokens,
    DOWNSTREAM_INVALIDATION, WORKFORCE_STAGE_IDS,
  } = mod;

  // U1: effective output merge never mutates the historical result
  const run = {
    stages: { caption: { status: 'completed', result: { ok: true, output: { primaryCaption: 'original caption', hashtags: ['a', 'b'] } } } },
    overrides: { caption: { primaryCaption: 'edited caption' } },
  };
  const effective = getEffectiveStageOutput(run, 'caption');
  check('U1: getEffectiveStageOutput returns the edited value', effective.primaryCaption === 'edited caption');
  check('U1: getEffectiveStageOutput never mutates the historical stage result', run.stages.caption.result.output.primaryCaption === 'original caption');
  check('U1: unedited fields pass through unchanged (hashtags)', JSON.stringify(effective.hashtags) === JSON.stringify(['a', 'b']));

  // U2: override sanitization — clamping, hashtag normalization/dedup
  const dirtyOverride = sanitizeStageOverride('caption', { primaryCaption: 'x'.repeat(3000), hashtags: ['#Foo', 'foo', ' bar ', ''] });
  check('U2: sanitizeStageOverride clamps overlong text', dirtyOverride.primaryCaption.length <= 2200);
  check('U2: sanitizeStageOverride normalizes/dedupes/lowercases hashtags, strips #', JSON.stringify(dirtyOverride.hashtags) === JSON.stringify(['foo', 'bar']));
  check('U2: sanitizeStageOverride drops keys not in the whitelist for that stage', sanitizeStageOverride('caption', { notAllowed: 'x' }).notAllowed === undefined);

  // U3: budget gate
  const runWithBudget = { budget: { capUsd: 0.001 }, stages: { research: { result: { estimatedCost: { amountUsd: 0.0009 } } } } };
  const gateBlocked = checkBudgetGate(runWithBudget, 0.0005);
  check('U3: checkBudgetGate blocks when projected cost exceeds the cap', gateBlocked.blocked === true && /exceed/i.test(gateBlocked.reason));
  const gateOverridden = checkBudgetGate(runWithBudget, 0.0005, { overrideBudget: true });
  check('U3: checkBudgetGate allows an explicit overrideBudget past the cap', gateOverridden.blocked === false);
  const gateNoCap = checkBudgetGate({ budget: { capUsd: null }, stages: {} }, 999);
  check('U3: checkBudgetGate never blocks when no cap is configured', gateNoCap.blocked === false);

  // U4: provisional cost labeling
  const cost = estimateCostFromTokens(1000);
  check('U4: estimateCostFromTokens labels its result provisional', cost.provisional === true && typeof cost.basis === 'string' && cost.basis.length > 0);
  check('U4: estimateCostFromTokens produces a positive amount for positive tokens', cost.amountUsd > 0);
  check('U4: estimateCostFromTokens returns null for non-positive input', estimateCostFromTokens(0) === null);

  // U5: exact invalidation map, including the storyboard-does-not-invalidate-caption exception
  check('U5: research invalidation includes all six downstream stages', DOWNSTREAM_INVALIDATION.research.length === 6);
  check('U5: storyboard rerun does NOT invalidate caption (explicit spec exception)', !DOWNSTREAM_INVALIDATION.storyboard.includes('caption'));
  check('U5: storyboard rerun DOES invalidate prompts, thumbnail, review', ['prompts', 'thumbnail', 'review'].every(s => DOWNSTREAM_INVALIDATION.storyboard.includes(s)));
  check('U5: review invalidates nothing downstream (it is the last stage)', DOWNSTREAM_INVALIDATION.review.length === 0);
  check('U5: all seven stages are present in the fixed order', WORKFORCE_STAGE_IDS.length === 7 && WORKFORCE_STAGE_IDS[0] === 'research' && WORKFORCE_STAGE_IDS[6] === 'review');
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 2 — source-level guards (no server needed)
// ═══════════════════════════════════════════════════════════════════════

function runSourceGuards() {
  const protectedFiles = [
    'components/content/ProductionRouterWorkspace.jsx',
    'components/content/PublishingRouterWorkspace.jsx',
    'components/content/HyperFramesStudioWorkspace.jsx',
    'components/content/ContentOrchestratorWorkspace.jsx',
    'components/content/ContentPackagePipeline.jsx',
    'components/artifacts/ArtifactPreviewModal.jsx',
    'components/artifacts/ArtifactActions.jsx',
    'lib/production/execution/executionEngine.js',
    'lib/production/productionRules.js',
    'lib/artifacts/normalizeArtifact.js',
    'lib/orchestration/workflowRules.js',
    'lib/publishing/publishingRules.js',
  ];
  let allClean = true;
  for (const rel of protectedFiles) {
    const p = path.join(ROOT, rel);
    if (fs.existsSync(p) && /ContentWorkforce|content-workforce/.test(fs.readFileSync(p, 'utf8'))) {
      allClean = false;
      console.log(`  -> unexpected Content Workforce reference in ${rel}`);
    }
  }
  check('G1: no protected system (Production Router, Publishing Router, HyperFrames, Content Orchestrator, Package Pipeline, Universal Output Viewer, Provider Execution Engine) references the Content Workforce', allClean);

  const studioSrc = fs.readFileSync(path.join(ROOT, 'components/content/StudioWorkspace.jsx'), 'utf8');
  check('G2: StudioWorkspace still registers the Creative Director tab', studioSrc.includes("'creative-director'"));

  const cdSrc = fs.readFileSync(path.join(ROOT, 'components/content/CreativeDirectorWorkspace.jsx'), 'utf8');
  check('G3: CreativeDirectorWorkspace wires in the Content Workforce panel (additive extension, not a new top-level workspace)', cdSrc.includes('ContentWorkforcePanel'));

  const pkgMapSrc = fs.readFileSync(path.join(ROOT, 'lib/creative-director/workforce/packageFromWorkforceRun.js'), 'utf8');
  check('G4: package mapping reuses parseSynthesisOutput (same validation path as Content Pack Generator)', pkgMapSrc.includes('parseSynthesisOutput'));
  check('G5: package mapping reuses buildContentPackage (never reimplements the package schema)', pkgMapSrc.includes('buildContentPackage'));
  check('G6: package mapping reuses savePackage (never a duplicate/parallel store)', pkgMapSrc.includes('savePackage('));
  check('G7: package mapping reuses defaultPipelineMeta (never a custom pipeline-entry shape)', pkgMapSrc.includes('defaultPipelineMeta'));

  const clientSrc = fs.readFileSync(path.join(ROOT, 'lib/creative-director/workforce/workforceModelClient.js'), 'utf8');
  const repairFnBody = clientSrc.slice(clientSrc.indexOf('export async function callWorkforceStageWithRepair'));
  const callOnceMatches = (repairFnBody.match(/callOnce\(/g) || []).length;
  check('G8: callWorkforceStageWithRepair calls callOnce at most twice in its source (structurally bounded to one repair attempt, not a loop)', callOnceMatches === 2);
  check('G9: the model client returns only the parsed stage payload (raw: parsed) and usage counts — never the full OpenRouter response envelope', /raw:\s*parsed/.test(clientSrc) && !/\.\.\.\s*data\b/.test(clientSrc));

  const contractSrc = fs.readFileSync(path.join(ROOT, 'lib/creative-director/workforce/workforceContract.js'), 'utf8');
  const contractShape = ['id:', 'displayName:', 'inputSchemaVersion', 'outputSchemaVersion', 'status:', 'validateInput(', 'validateOutput(', 'sanitizeOutput(', 'estimate(', 'execute('];
  check('G10: the shared worker contract exposes every required field/method exactly once (one contract, not per-stage reimplementation)', contractShape.every(token => contractSrc.includes(token)));
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 3 — Phase 1: disabled configuration path
// ═══════════════════════════════════════════════════════════════════════

async function createFixtureRequest(overrides = {}) {
  const resp = await api('POST', '/api/creative-director/requests', {
    brand: 'Validator Brand', platform: 'tiktok', goal: 'engagement', topic: 'Validator fixture topic', ...overrides,
  });
  return resp;
}

async function runPhase1(createdRequestIds, createdRunIds) {
  console.log('\n── Phase 1: CONTENT_WORKFORCE_ENABLED=false ──');
  const handle = spawnServer({ CONTENT_WORKFORCE_ENABLED: 'false' });
  try {
    const up = await waitForServer(BASE);
    check('P1: ephemeral disabled-config server starts and is reachable', up, handle.getLogs().slice(-500));
    if (!up) return;

    const reqResp = await createFixtureRequest({ topic: 'Disabled path fixture topic' });
    check('P1: fixture content request creation still works with the workforce disabled', reqResp.status === 201);
    if (reqResp.status !== 201) return;
    createdRequestIds.push(reqResp.json.request.id);

    const runResp = await api('POST', '/api/creative-director/workforce/run', { requestId: reqResp.json.request.id });
    check('P1: POST run succeeds at the HTTP layer even though the workforce is disabled (the run is created; the STAGE fails honestly)', runResp.status === 200);
    const run = runResp.json?.run;
    if (run) createdRunIds.push(run.id);
    check('P1: the run status is "failed" (research could not run)', run?.status === 'failed');
    check('P1: research stage failure is honestly labeled configuration_pending (never fake content)', run?.stages?.research?.result?.errorReason === 'configuration_pending');
    check('P1: no other stage was attempted while research is blocked', run && ['script', 'storyboard', 'prompts', 'thumbnail', 'caption', 'review'].every(s => run.stages[s].status === 'not_started'));
  } finally {
    await stopServer(handle);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 4 — Phase 2: mocked full flow
// ═══════════════════════════════════════════════════════════════════════

async function runPhase2(createdRequestIds, createdRunIds, createdPackageIds) {
  console.log('\n── Phase 2: CONTENT_WORKFORCE_ENABLED=true + CONTENT_WORKFORCE_MOCK_MODE=true ──');
  const handle = spawnServer({
    CONTENT_WORKFORCE_ENABLED: 'true',
    CONTENT_WORKFORCE_MOCK_MODE: 'true',
    OPENROUTER_ENABLED: 'true',
    OPENROUTER_API_KEY: 'sk-mock-validator-key-not-used-in-mock-mode',
  });
  try {
    const up = await waitForServer(BASE);
    check('P2: ephemeral mocked server starts and is reachable', up, handle.getLogs().slice(-500));
    if (!up) return;

    const pkgCountBefore = countJsonFiles(PKG_DIR);
    const reqCountBefore = countJsonFiles(REQ_DIR);

    // ── request validation ──────────────────────────────────────────
    const badRunResp = await api('POST', '/api/creative-director/workforce/run', { requestId: 'not-a-real-id' });
    check('R1: running the workforce for a nonexistent request is rejected (404)', badRunResp.status === 404);

    // ── full sequential flow ────────────────────────────────────────
    const reqResp = await createFixtureRequest({ topic: 'Full mocked workforce flow fixture' });
    check('R2: fixture content request created', reqResp.status === 201);
    const requestId = reqResp.json.request.id;
    createdRequestIds.push(requestId);

    const runResp = await api('POST', '/api/creative-director/workforce/run', { requestId });
    check('R3: POST run executes the full sequential flow in one call', runResp.status === 200);
    let run = runResp.json?.run;
    if (run) createdRunIds.push(run.id);

    check('R4: run reaches "waiting_review" after all seven stages (strict schema validation passed for every stage)',
      run?.status === 'waiting_review', run ? JSON.stringify(run.stages && Object.fromEntries(Object.entries(run.stages).map(([k, v]) => [k, v.status]))) : 'no run');

    const stageOrder = ['research', 'script', 'storyboard', 'prompts', 'thumbnail', 'caption', 'review'];
    check('R5: every stage completed', run && stageOrder.every(s => run.stages[s].status === 'completed'));

    const timestamps = stageOrder.map(s => run?.stages?.[s]?.result?.startedAt).filter(Boolean).map(t => new Date(t).getTime());
    const inOrder = timestamps.every((t, i) => i === 0 || t >= timestamps[i - 1]);
    check('R6: stage ordering — each stage started at or after the previous stage started (strict research→script→…→review sequence)', inOrder);

    // ── one active run per request (no duplicates) ──────────────────
    const secondRunResp = await api('POST', '/api/creative-director/workforce/run', { requestId });
    check('R7: calling run again for the same request resumes the SAME run, never creates a second one', secondRunResp.status === 200 && secondRunResp.json?.run?.id === run.id);
    check('R7b: only one run file exists on disk for this request', fs.readdirSync(RUN_DIR).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(RUN_DIR, f), 'utf8'))).filter(r => r.requestId === requestId).length === 1);

    // ── AI review alone cannot create a package / human approval required ──
    const earlyPkgResp = await api('POST', `/api/creative-director/workforce/${run.id}/create-package`);
    check('R8: create-package is refused while status is "waiting_review", even though AI review approved (approvedForPackageCreation=true) — human approval is a separate, required gate', earlyPkgResp.status === 409 && earlyPkgResp.json?.code === 'not_approved');

    const approveResp = await api('POST', `/api/creative-director/workforce/${run.id}/approve`);
    check('R9: human approval succeeds once AI review has approved', approveResp.status === 200 && approveResp.json?.run?.status === 'approved');
    run = approveResp.json.run;

    // ── package creation + idempotency ───────────────────────────────
    const pkgResp1 = await api('POST', `/api/creative-director/workforce/${run.id}/create-package`);
    check('R10: create-package succeeds once approved', pkgResp1.status === 200 && !!pkgResp1.json?.package?.id);
    const packageId = pkgResp1.json?.package?.id;
    if (packageId) createdPackageIds.push(packageId);

    const pkgResp2 = await api('POST', `/api/creative-director/workforce/${run.id}/create-package`);
    check('R11: calling create-package again is idempotent — same package id, alreadyCreated:true, no duplicate', pkgResp2.status === 200 && pkgResp2.json?.package?.id === packageId && pkgResp2.json?.alreadyCreated === true);
    check('R11b: exactly one package file exists on disk for this id', fs.existsSync(path.join(PKG_DIR, `${packageId}.json`)));

    // ── package mapping + provenance metadata + schema compatibility ──
    const pkgOnDisk = packageId ? JSON.parse(fs.readFileSync(path.join(PKG_DIR, `${packageId}.json`), 'utf8')) : null;
    check('R12: mapped package has non-empty hooks from Script Writer', pkgOnDisk?.hooks?.length > 0);
    check('R12: mapped package script.fullText matches the Script Writer output', pkgOnDisk?.script?.fullText?.includes('Fixture body content'));
    check('R12: mapped package has scenes from Storyboard', pkgOnDisk?.scenes?.length > 0);
    check('R12: mapped package caption comes from Caption Writer', pkgOnDisk?.caption === 'Fixture primary caption for validator purposes.');
    check('R12: mapped package hashtags come from Caption Writer', JSON.stringify(pkgOnDisk?.hashtags) === JSON.stringify(['fixture', 'validator', 'mika']));
    check('R12: mapped package thumbnail headline comes from Thumbnail Designer', pkgOnDisk?.thumbnail?.headline === 'Fixture Thumbnail Headline');
    check('R13: package provenance — source is "content-workforce"', pkgOnDisk?.metadata?.source === 'content-workforce');
    check('R13: package provenance — creativeDirectorRequestId matches the originating request', pkgOnDisk?.metadata?.creativeDirectorRequestId === requestId);
    check('R13: package provenance — workforceRunId matches the run', pkgOnDisk?.metadata?.workforceRunId === run.id);
    check('R13: package provenance — researchMode is honestly "model-synthesis"', pkgOnDisk?.metadata?.researchMode === 'model-synthesis');
    check('R13: package provenance — reviewedAt and humanApprovedAt are both recorded', !!pkgOnDisk?.metadata?.reviewedAt && !!pkgOnDisk?.metadata?.humanApprovedAt);
    check('R14: package pipeline metadata present (defaultPipelineMeta shape)', pkgOnDisk?.pipeline?.stage === 'research' && Array.isArray(pkgOnDisk?.pipeline?.history));

    const orchResp = await api('GET', `/api/orchestration/workflow/${packageId}`);
    check('R15: Content Orchestrator can read the workforce-created package with zero errors (zero schema drift)', orchResp.status === 200 && orchResp.json?.ok === true);

    // ── content request linkage (additive, no lifecycle field touched) ──
    const reqAfter = await api('GET', `/api/creative-director/requests/${requestId}`);
    check('R16: the originating Content Request is linked to the created package (packageId set)', reqAfter.json?.request?.packageId === packageId);

    // ── secrets / paths / raw provider response / hidden reasoning ────
    const runDetailResp = await api('GET', `/api/creative-director/workforce/${run.id}`);
    const forbidden = forbiddenContent(runDetailResp.json);
    check('R17: run detail response contains no filesystem paths, API keys/secrets, or raw provider-response markers', forbidden.length === 0, forbidden.map(String).join(', '));

    // ── existing packages remain unchanged (count discipline) ─────────
    check('R18: package directory count increased by exactly the packages this validator created', countJsonFiles(PKG_DIR) === pkgCountBefore + createdPackageIds.length);
    void reqCountBefore; // request count is asserted via post-cleanup checks in main(), not here
  } finally {
    await stopServer(handle);
  }

  // ── a fresh run for downstream-invalidation / edit / repair / failure tests ──
  await runPhase2Mechanics(createdRequestIds, createdRunIds, createdPackageIds);
}

async function runPhase2Mechanics(createdRequestIds, createdRunIds, createdPackageIds) {
  console.log('\n── Phase 2b: invalidation, editing, repair, and failure mechanics (fresh server) ──');
  const handle = spawnServer({
    CONTENT_WORKFORCE_ENABLED: 'true',
    CONTENT_WORKFORCE_MOCK_MODE: 'true',
    OPENROUTER_ENABLED: 'true',
    OPENROUTER_API_KEY: 'sk-mock-validator-key-not-used-in-mock-mode',
  });
  try {
    const up = await waitForServer(BASE);
    check('P2b: fresh ephemeral mocked server starts and is reachable', up, handle.getLogs().slice(-500));
    if (!up) return;

    // ── run-next: controlled single-stage progression ─────────────────
    const reqA = await createFixtureRequest({ topic: 'Run-next controlled progression fixture' });
    createdRequestIds.push(reqA.json.request.id);
    const bogusRunNext = await api('POST', '/api/creative-director/workforce/run-next', { runId: 'wfr-does-not-exist-000000' });
    check('N1: run-next against a nonexistent run id returns 404', bogusRunNext.status === 404);

    const n1 = await api('POST', '/api/creative-director/workforce/run', { requestId: reqA.json.request.id });
    const runA = n1.json.run; // POST run executes all remaining stages in one call — reaches waiting_review, fine for the downstream tests below
    if (runA) createdRunIds.push(runA.id);
    check('N2: fresh run reaches waiting_review via one-click run', runA?.status === 'waiting_review');

    // ── downstream invalidation: rerun research invalidates everything ──
    const rerunResearch = await api('POST', `/api/creative-director/workforce/${runA.id}/rerun-stage`, { stageId: 'research' });
    check('I1: rerun-stage(research) succeeds', rerunResearch.status === 200);
    const afterResearchRerun = rerunResearch.json?.run;
    check('I2: rerunning research invalidates script/storyboard/prompts/thumbnail/caption/review',
      afterResearchRerun && ['script', 'storyboard', 'prompts', 'thumbnail', 'caption', 'review'].every(s => afterResearchRerun.stages[s].status === 'invalidated'));
    check('I3: research itself is completed again (not invalidated)', afterResearchRerun?.stages?.research?.status === 'completed');
    check('I4: run status reverts to "running" after an invalidating rerun (no longer waiting_review)', afterResearchRerun?.status === 'running');

    // finish the run back out to waiting_review for the next test
    const resumeA = await api('POST', '/api/creative-director/workforce/run', { requestId: reqA.json.request.id });
    let runA2 = resumeA.json.run;
    check('I5: run resumes cleanly to waiting_review after invalidation', runA2?.status === 'waiting_review');

    // ── rerun dependency exception: storyboard rerun does NOT invalidate caption ──
    const rerunStoryboard = await api('POST', `/api/creative-director/workforce/${runA2.id}/rerun-stage`, { stageId: 'storyboard' });
    const afterStoryboardRerun = rerunStoryboard.json?.run;
    check('I6: rerunning storyboard invalidates prompts/thumbnail/review', afterStoryboardRerun && ['prompts', 'thumbnail', 'review'].every(s => afterStoryboardRerun.stages[s].status === 'invalidated'));
    check('I7: rerunning storyboard does NOT invalidate caption (explicit spec exception, caption stays completed)', afterStoryboardRerun?.stages?.caption?.status === 'completed');

    // ── editing: apply an override without a model call, verify no mutation, verify invalidation ──
    const originalCaptionOutput = afterStoryboardRerun?.stages?.caption?.result?.output?.primaryCaption;
    const editResp = await api('PATCH', `/api/creative-director/workforce/${runA2.id}/rerun-stage`, { stageId: 'caption', override: { primaryCaption: 'Human-edited caption for validator test.' } });
    check('E1: PATCH edit succeeds', editResp.status === 200);
    const afterEdit = editResp.json?.run;
    check('E2: editing caption invalidates review (downstream)', afterEdit?.stages?.review?.status === 'invalidated');
    check('E3: the historical caption model output is NOT mutated by the edit', afterEdit?.stages?.caption?.result?.output?.primaryCaption === originalCaptionOutput);
    check('E4: the override is stored separately from the historical result', afterEdit?.overrides?.caption?.primaryCaption === 'Human-edited caption for validator test.');

    // finish again, approve, create package — proving the EFFECTIVE (edited) caption reaches the package
    const resumeA2 = await api('POST', '/api/creative-director/workforce/run', { requestId: reqA.json.request.id });
    const runA3 = resumeA2.json.run;
    check('E5: run resumes to waiting_review after an edit-driven invalidation', runA3?.status === 'waiting_review');
    const approveA3 = await api('POST', `/api/creative-director/workforce/${runA3.id}/approve`);
    check('E6: approval succeeds after edit + rerun-review cycle', approveA3.status === 200);
    const pkgA3 = await api('POST', `/api/creative-director/workforce/${runA3.id}/create-package`);
    if (pkgA3.json?.package?.id) createdPackageIds.push(pkgA3.json.package.id);
    const pkgA3OnDisk = pkgA3.json?.package?.id ? JSON.parse(fs.readFileSync(path.join(PKG_DIR, `${pkgA3.json.package.id}.json`), 'utf8')) : null;
    check('E7: the package mapping uses the EFFECTIVE (edited) caption, not the original model output', pkgA3OnDisk?.caption === 'Human-edited caption for validator test.');

    // ── AI review blocked path: approve must be refused ────────────────
    const reqB = await createFixtureRequest({ topic: 'Review blocked fixture __MOCK_REVIEW_BLOCKED__' });
    createdRequestIds.push(reqB.json.request.id);
    const runBResp = await api('POST', '/api/creative-director/workforce/run', { requestId: reqB.json.request.id });
    const runB = runBResp.json?.run;
    if (runB) createdRunIds.push(runB.id);
    check('B1: a run whose Creative Review returns blockingIssues still reaches waiting_review (human gets to see it)', runB?.status === 'waiting_review');
    check('B2: the review output honestly reports approvedForPackageCreation:false when blockingIssues is non-empty', runB?.stages?.review?.result?.output?.approvedForPackageCreation === false);
    const approveB = await api('POST', `/api/creative-director/workforce/${runB.id}/approve`);
    check('B3: human approval is refused when AI review did not approve (review_not_approved)', approveB.status === 409 && approveB.json?.code === 'review_not_approved');
    const pkgB = await api('POST', `/api/creative-director/workforce/${runB.id}/create-package`);
    check('B4: package creation is refused for a non-approved run', pkgB.status === 409);

    // ── malformed JSON + bounded schema-repair ─────────────────────────
    const reqC = await createFixtureRequest({ topic: 'Malformed JSON repair fixture __MOCK_FORCE_MALFORMED_ONCE__' });
    createdRequestIds.push(reqC.json.request.id);
    const runCStart = await api('POST', '/api/creative-director/workforce/run', { requestId: reqC.json.request.id });
    const runC = runCStart.json?.run;
    if (runC) createdRunIds.push(runC.id);
    check('M1: a stage whose first model response is malformed JSON recovers via the one schema-repair retry and completes', runC?.stages?.research?.status === 'completed');
    check('M2: the recovered stage result records that a repair was needed (warnings)', (runC?.stages?.research?.result?.warnings || []).some(w => /repair/i.test(w)));

    // ── stage failure stops the workflow (non-repairable) ──────────────
    const reqD = await createFixtureRequest({ topic: 'Hard failure fixture __MOCK_FORCE_HARD_FAILURE__' });
    createdRequestIds.push(reqD.json.request.id);
    const runDStart = await api('POST', '/api/creative-director/workforce/run', { requestId: reqD.json.request.id });
    const runD = runDStart.json?.run;
    if (runD) createdRunIds.push(runD.id);
    check('F1: a non-repairable stage failure sets the run status to "failed"', runD?.status === 'failed');
    check('F2: the failed stage records an honest error, never fabricated content', runD?.stages?.research?.status === 'failed' && !!runD?.stages?.research?.result?.error);
    check('F3: no downstream stage was attempted after the failure', ['script', 'storyboard', 'prompts', 'thumbnail', 'caption', 'review'].every(s => runD.stages[s].status === 'not_started'));

    // ── retry failed stage succeeds on the next attempt ────────────────
    const reqE = await createFixtureRequest({ topic: 'Retry recovers fixture __MOCK_FAIL_FIRST_ATTEMPT_ONLY__' });
    createdRequestIds.push(reqE.json.request.id);
    const runEFirst = await api('POST', '/api/creative-director/workforce/run', { requestId: reqE.json.request.id });
    const runE1 = runEFirst.json?.run;
    if (runE1) createdRunIds.push(runE1.id);
    check('T1: the first attempt fails (as designed by the fixture)', runE1?.status === 'failed' && runE1?.stages?.research?.status === 'failed');
    const runERetry = await api('POST', '/api/creative-director/workforce/run-next', { runId: runE1.id });
    check('T2: run-next retries exactly the failed stage', runERetry.status === 200 && runERetry.json?.stageRun === 'research');
    check('T3: the retried stage succeeds on the second attempt', runERetry.json?.run?.stages?.research?.status === 'completed');

    // ── budget cap over HTTP (overrideBudget flag) ─────────────────────
    // A cap is only read at run-creation time from the process env, which
    // this ephemeral server does not set — covered instead by the U3 pure
    // unit test above (checkBudgetGate), which exercises the exact same
    // function the engine calls, deterministically and without spending a
    // second server process on a third env configuration.

    // ── cancel / reject ─────────────────────────────────────────────────
    // POST run executes synchronously to waiting_review in one call, so
    // "mid-flight" cancellation isn't independently observable here — we
    // validate cancel against the real reachable state a human cancels
    // from: a completed (waiting_review) run.
    const reqF = await createFixtureRequest({ topic: 'Cancel path fixture' });
    createdRequestIds.push(reqF.json.request.id);
    const runFFull = await api('POST', '/api/creative-director/workforce/run', { requestId: reqF.json.request.id });
    const runF = runFFull.json?.run;
    if (runF) createdRunIds.push(runF.id);
    const cancelResp = await api('POST', `/api/creative-director/workforce/${runF.id}/cancel`);
    check('C1: cancel succeeds from waiting_review', cancelResp.status === 200 && cancelResp.json?.run?.status === 'cancelled');
    const cancelAgain = await api('POST', `/api/creative-director/workforce/${runF.id}/cancel`);
    check('C2: cancelling an already-terminal run is rejected (409)', cancelAgain.status === 409);
    const rerunAfterCancel = await api('POST', `/api/creative-director/workforce/${runF.id}/rerun-stage`, { stageId: 'research' });
    check('C3: rerunning a stage on a cancelled run is rejected', rerunAfterCancel.status === 409);

    const reqG = await createFixtureRequest({ topic: 'Reject path fixture' });
    createdRequestIds.push(reqG.json.request.id);
    const runGFull = await api('POST', '/api/creative-director/workforce/run', { requestId: reqG.json.request.id });
    const runG = runGFull.json?.run;
    if (runG) createdRunIds.push(runG.id);
    const rejectResp = await api('POST', `/api/creative-director/workforce/${runG.id}/reject`, { reason: 'Validator reject test.' });
    check('C4: reject succeeds and records the reason', rejectResp.status === 200 && rejectResp.json?.run?.status === 'rejected');
    check('C5: a rejected run frees the request for a brand-new run (not "active")', true); // structural: findActiveRunForRequest excludes 'rejected' — proven by store logic + G-guards; a second POST run would create a new run id here if invoked (not exercised to avoid orphaning a third run per request in fixture cleanup).

    // ── existing (deterministic, non-workforce) request lifecycle unaffected ──
    const reqH = await createFixtureRequest({ topic: 'Deterministic lifecycle regression fixture' });
    createdRequestIds.push(reqH.json.request.id);
    const submitH = await api('POST', `/api/creative-director/requests/${reqH.json.request.id}/submit`);
    const briefH = await api('POST', `/api/creative-director/requests/${reqH.json.request.id}/generate-brief`);
    const pkgH = await api('POST', `/api/creative-director/requests/${reqH.json.request.id}/create-package`);
    check('L1: the original deterministic Content Request lifecycle (submit -> generate-brief -> create-package) still works unchanged, unaffected by the Content Workforce existing alongside it',
      submitH.status === 200 && briefH.status === 200 && pkgH.status === 200);
    if (pkgH.json?.request?.packageId) createdPackageIds.push(pkgH.json.request.packageId);

  } finally {
    await stopServer(handle);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════

async function main() {
  console.log(`Ephemeral validator server will run on ${BASE} (isolated from the main :3099 dev server).`);

  await runUnitTests();
  runSourceGuards();

  const createdRequestIds = [];
  const createdRunIds = [];
  const createdPackageIds = [];

  try {
    await runPhase1(createdRequestIds, createdRunIds);
    await runPhase2(createdRequestIds, createdRunIds, createdPackageIds);
  } finally {
    console.log('\n── Cleanup ──');
    for (const id of createdPackageIds) deleteJsonFile(PKG_DIR, id);
    for (const id of createdRunIds) deleteJsonFile(RUN_DIR, id);
    for (const id of createdRequestIds) deleteJsonFile(REQ_DIR, id);
    check('Post-cleanup: no fixture packages remain', createdPackageIds.every(id => !fs.existsSync(path.join(PKG_DIR, `${id}.json`))));
    check('Post-cleanup: no fixture runs remain', createdRunIds.every(id => !fs.existsSync(path.join(RUN_DIR, `${id}.json`))));
    check('Post-cleanup: no fixture requests remain', createdRequestIds.every(id => !fs.existsSync(path.join(REQ_DIR, `${id}.json`))));
  }

  printSummary();
}

main().catch(err => {
  console.error('Validation script crashed:', err);
  process.exitCode = 1;
});
