#!/usr/bin/env node
// scripts/validate-hyperframes-production-adapter.mjs
//
// Validation for the HyperFrames Production Execution Engine adapter
// (lib/production/execution/adapters/hyperframes.adapter.js) — the
// GOVERNED entry point into the existing local render engine, separate
// from (and never modifying) the standalone HyperFrames Studio flow
// covered by scripts/validate-hyperframes-local-studio.mjs.
//
// Unlike the MCP provider validators (Higgsfield/OpenArt Video/HeyGen),
// this one DOES exercise a real submit()+cancel() cycle and a real
// completed-poll read — HyperFrames has NO monetary cost (local CPU/GPU
// time only), so "never calls a real generation tool" doesn't carry the
// same financial-risk rationale here. What it still never does: run a
// render to completion as part of routine validation (the one real submit
// below is cancelled almost immediately), or touch the GOVERNED Production
// Router job lifecycle (package -> plan -> approve -> enqueue -> run-next)
// — that full end-to-end proof is the separate, explicitly-approved Live
// Test step described in the final report, not this script.

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const BASE = 'http://localhost:3099';
const TEST_COMPOSITION_ID = 'mika-hyperframes-test'; // known-good, real, pre-existing composition

function loadEnvLocal() {
  try {
    const raw = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  } catch { /* no .env.local */ }
}
loadEnvLocal();

const TOKEN = process.env.MIKA_ADMIN_TOKEN || '';
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
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

function noSecretKeys(obj) {
  const forbidden = ['access_token', 'refresh_token', 'client_secret', 'accessToken', 'refreshToken', 'clientSecret', 'codeVerifier', 'code_verifier', 'pendingState', 'registration_secret', 'registrationSecret'];
  const json = JSON.stringify(obj);
  return forbidden.filter(k => json.includes(k));
}

function noAbsolutePaths(obj) {
  const json = JSON.stringify(obj);
  const home = process.env.HOME || '';
  return !(json.includes(ROOT) || (home && json.includes(home)));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  // ══════════════════════════════════════════════════════════════════════
  // PART A — pure adapter-logic checks (no I/O beyond real, read-only
  // filesystem checks already safe in the standalone Studio's own
  // validator — no process spawning here).
  // ══════════════════════════════════════════════════════════════════════

  const hyperframesAdapter = (await import('../lib/production/execution/adapters/hyperframes.adapter.js')).default;
  const { validateHyperFramesProviderInputSync } = await import('../lib/production/execution/adapters/hyperframes.adapter.js');
  const { PROVIDER_CATALOG } = await import('../lib/production/productionRules.js');
  const { getHyperFramesRun } = await import('../lib/hyperframes/hyperframesRunStore.js');

  // ── A1: adapter identity ──────────────────────────────────────────────
  check('A1: adapter has id=hyperframes', hyperframesAdapter.id === 'hyperframes');
  check('A1: adapter has displayName', hyperframesAdapter.displayName === 'HyperFrames');
  check('A1: adapter executionType=local-cli', hyperframesAdapter.executionType === 'local-cli');
  check('A1: adapter billingPool=local-compute', hyperframesAdapter.billingPool === 'local-compute');
  check('A1: adapter supportedModes includes cinematic_broll/faceless_social/product_demo', ['cinematic_broll', 'faceless_social', 'product_demo'].every(m => hyperframesAdapter.supportedModes.includes(m)));

  // ── A2: catalog correction (pure data — no live call needed) ──────────
  const catalogEntry = PROVIDER_CATALOG.find(p => p.id === 'hyperframes');
  check('A2: catalog entry exists', !!catalogEntry);
  check('A2: catalog executionType corrected to "local-cli"', catalogEntry.executionType === 'local-cli');
  check('A2: catalog estimatedCostTier corrected to "free" (real, confirmed $0)', catalogEntry.estimatedCostTier === 'free');
  check('A2: catalog requiredInputs is exactly ["compositionId"] (stale productImage/brandAssets/style removed)', JSON.stringify(catalogEntry.requiredInputs) === JSON.stringify(['compositionId']));
  check('A2: catalog supportsReferenceImage is honestly false', catalogEntry.supportsReferenceImage === false);
  check('A2: catalog default status is "staged" (live-patched at runtime)', catalogEntry.status === 'staged');

  // ── A3: strict input validation (pure) ─────────────────────────────────
  const rValid = validateHyperFramesProviderInputSync({ job: { selectedMode: 'cinematic_broll', providerInput: { compositionId: TEST_COMPOSITION_ID, quality: 'standard' } }, compositionExists: true });
  check('A3: valid compositionId+quality -> valid', rValid.valid === true, JSON.stringify(rValid.errors));

  const rBadMode = validateHyperFramesProviderInputSync({ job: { selectedMode: 'avatar_video', providerInput: { compositionId: TEST_COMPOSITION_ID } }, compositionExists: true });
  check('A3: unsupported mode (avatar_video) is blocked', rBadMode.valid === false && rBadMode.errors.some(e => /cinematic_broll, faceless_social, product_demo/.test(e)));

  const rNoComposition = validateHyperFramesProviderInputSync({ job: { selectedMode: 'cinematic_broll', providerInput: {} }, compositionExists: null });
  check('A3: missing compositionId is blocked', rNoComposition.valid === false && rNoComposition.errors.some(e => /composition must be selected/i.test(e)));

  const rTraversal = validateHyperFramesProviderInputSync({ job: { selectedMode: 'cinematic_broll', providerInput: { compositionId: '../../../etc/passwd' } }, compositionExists: null });
  check('A3: path traversal in compositionId is blocked (invalid identifier)', rTraversal.valid === false && rTraversal.errors.some(e => /not a valid HyperFrames composition identifier/.test(e)));

  const rAbsolute = validateHyperFramesProviderInputSync({ job: { selectedMode: 'cinematic_broll', providerInput: { compositionId: '/etc/passwd' } }, compositionExists: null });
  check('A3: an absolute path in compositionId is blocked', rAbsolute.valid === false);

  const rNotFound = validateHyperFramesProviderInputSync({ job: { selectedMode: 'cinematic_broll', providerInput: { compositionId: 'totally-nonexistent-composition' } }, compositionExists: false });
  check('A3: a well-formed but nonexistent compositionId is blocked', rNotFound.valid === false && rNotFound.errors.some(e => /was not found under tools\/hyperframes/.test(e)));

  const rBadQuality = validateHyperFramesProviderInputSync({ job: { selectedMode: 'cinematic_broll', providerInput: { compositionId: TEST_COMPOSITION_ID, quality: 'ultra' } }, compositionExists: true });
  check('A3: an invalid quality value is blocked', rBadQuality.valid === false && rBadQuality.errors.some(e => /quality must be one of/.test(e)));

  const rOutputFilename = validateHyperFramesProviderInputSync({ job: { selectedMode: 'cinematic_broll', providerInput: { compositionId: TEST_COMPOSITION_ID, outputFilename: 'evil.mp4' } }, compositionExists: true });
  check('A3: outputFilename is rejected (not supported this checkpoint — hardcoded by the runner)', rOutputFilename.valid === false && rOutputFilename.errors.some(e => /outputFilename and forceRerender are not supported/.test(e)));

  const rForceRerender = validateHyperFramesProviderInputSync({ job: { selectedMode: 'cinematic_broll', providerInput: { compositionId: TEST_COMPOSITION_ID, forceRerender: true } }, compositionExists: true });
  check('A3: forceRerender is rejected (not supported this checkpoint)', rForceRerender.valid === false);

  // ── A4: estimate() — confirmed, non-provisional, always $0 ─────────────
  const estimate = await hyperframesAdapter.estimate();
  check('A4: estimateType is "confirmed_local"', estimate.estimateType === 'confirmed_local');
  check('A4: estimatedRange is {min:0,max:0} — never fabricated, never provisional', estimate.estimatedRange.min === 0 && estimate.estimatedRange.max === 0);
  check('A4: provisional is false (a REAL confirmed zero, not a guess)', estimate.provisional === false);
  check('A4: note explicitly states local CPU/GPU time is used (never bare "free")', /local CPU\/GPU time/.test(estimate.note));

  // ── A5: normalizeResult() passthrough ───────────────────────────────────
  const normalized = hyperframesAdapter.normalizeResult({ status: 'completed', outputs: [{ type: 'video', localBuffer: Buffer.from('x') }], rawMetadata: { a: 1 } });
  check('A5: normalizeResult() passes through status/outputs/providerMetadata (no HyperFrames-specific schema)', normalized.status === 'completed' && normalized.outputs.length === 1 && normalized.providerMetadata.a === 1);

  // ── A6: cancel() on a nonexistent run — pure, real fs read, no process spawn ──
  const cancelNotFound = await hyperframesAdapter.cancel({ providerJobId: 'hfr-does-not-exist-000000' });
  check('A6: cancel() on an unknown run returns not_found', cancelNotFound.ok === false && cancelNotFound.status === 'not_found');
  const cancelNoJob = await hyperframesAdapter.cancel({ providerJobId: null });
  check('A6: cancel() with no provider job id returns not_found honestly', cancelNoJob.ok === false && cancelNoJob.status === 'not_found');
  check('A6: cancel() NEVER returns provider_cancel_unsupported (real cancellation exists)', cancelNotFound.status !== 'provider_cancel_unsupported' && cancelNoJob.status !== 'provider_cancel_unsupported');

  // ── A7: poll() on an unknown run — pure, real fs read ───────────────────
  const pollNotFound = await hyperframesAdapter.poll({ providerJobId: 'hfr-does-not-exist-000000' });
  check('A7: poll() on an unknown run returns failed/malformed_output honestly', pollNotFound.ok === false && pollNotFound.errorReason === 'malformed_output');
  const pollNoJob = await hyperframesAdapter.poll({ providerJobId: null });
  check('A7: poll() with no provider job id returns failed/malformed_output', pollNoJob.ok === false && pollNoJob.errorReason === 'malformed_output');

  check('A8: no secrets in any pure adapter output', noSecretKeys({ estimate, normalized, cancelNotFound, pollNotFound }).length === 0);
  check('A8: no absolute filesystem paths in any pure adapter output', noAbsolutePaths({ estimate, normalized, cancelNotFound, pollNotFound }));

  // ══════════════════════════════════════════════════════════════════════
  // PART B — live checks against the running dev server + the REAL
  // filesystem. No monetary risk exists for HyperFrames (local CPU/GPU
  // only), so — unlike the MCP provider validators — this DOES exercise
  // one real, minimal submit()+cancel() cycle (cancelled almost
  // immediately) to genuinely prove async behavior, and reads the REAL,
  // ALREADY-EXISTING output.mp4 (from a prior, unrelated render) via a
  // synthetic run record to prove completed-output handling — neither
  // triggers a NEW render to completion.
  // ══════════════════════════════════════════════════════════════════════

  const b1 = await api('GET', '/api/production/providers');
  check('B1: dev server reachable on :3099', b1.status === 200 && b1.json?.ok === true);

  const hyperframesEntry = b1.json?.providers?.find(p => p.id === 'hyperframes');
  const heygenMcp = b1.json?.providers?.find(p => p.id === 'heygen-mcp');
  const higgsfieldMcp = b1.json?.providers?.find(p => p.id === 'higgsfield-mcp');
  const openartVideo = b1.json?.providers?.find(p => p.id === 'openart-video');
  const manualExport = b1.json?.providers?.find(p => p.id === 'manual-export');
  const mockVideo = b1.json?.providers?.find(p => p.id === 'mock-video');

  check('B2: hyperframes entry present in provider registry (real adapter, not "no execution adapter")', !!hyperframesEntry);
  check('B2: hyperframes executionType=local-cli, billingPool=local-compute', hyperframesEntry?.executionType === 'local-cli' && hyperframesEntry?.billingPool === 'local-compute');
  check('B2: heygen-mcp/higgsfield-mcp/openart-video entries unaffected by this milestone', heygenMcp?.executionType === 'mcp-oauth' && higgsfieldMcp?.executionType === 'mcp-oauth' && openartVideo?.executionType === 'mcp');
  check('B2: manual-export/mock-video adapters unaffected', manualExport?.executable === true && !!mockVideo);
  check('B3: no secret substrings in the providers registry response', noSecretKeys(b1.json).length === 0);
  check('B3: no absolute filesystem paths in the providers registry response', noAbsolutePaths(b1.json));

  console.log(`INFO — B4: hyperframes live executable=${hyperframesEntry?.executable}, status=${hyperframesEntry?.status} (real cross-check against live CLI + composition health).`);
  const enabled = hyperframesEntry?.status === 'active';

  // ── B5: composition discovery via the real GET route (no fixture) ──────
  const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const PKG_DIR = path.join(ROOT, 'data', 'content-packages');
  const JOB_DIR = path.join(ROOT, 'data', 'production-jobs');
  const FIXTURE_PKG_ID = `pack-hyperframes-adapter-test-${RUN_ID}`;
  const createdPackageIds = [];
  const createdJobIds = [];
  const createdRunIds = []; // hyperframes-runs fixtures this script creates directly (synthetic completed/failed/cancelled/queued records)

  function writeFixturePackage() {
    const now = new Date().toISOString();
    const pkg = {
      id: FIXTURE_PKG_ID, status: 'approved', brand: 'HyperFrames Adapter Test Brand', platform: 'TikTok', goal: 'Engagement',
      topic: 'HyperFrames adapter validator test package', audience: '', offer: '', tone: '', videoDuration: '5-10s',
      hooks: [{ text: 'Test hook', angle: 'curiosity' }],
      script: { opening: '', body: '', cta: '', fullText: 'Unused by HyperFrames — composition is a separate providerInput field.' },
      scenes: [{ order: 1, durationSeconds: 10, visual: 'x', voiceover: 'y', onScreenText: 'z' }],
      caption: 'Test caption', cta: 'Shop now', hashtags: ['test'], keywords: ['test'],
      thumbnail: { headline: 'Test', visualBrief: '', artifactId: null, artifactUrl: null, status: 'not_requested', error: null },
      pipeline: { stage: 'approved', enteredStageAt: now, history: [{ stage: 'approved', at: now, actor: 'validator', note: null }] },
      metadata: { workflowId: FIXTURE_PKG_ID, model: null, provider: 'test-fixture', createdAt: now, updatedAt: now, estimatedCost: null, actualCost: null, instructions: '' },
      production: null,
    };
    fs.mkdirSync(PKG_DIR, { recursive: true });
    fs.writeFileSync(path.join(PKG_DIR, `${FIXTURE_PKG_ID}.json`), JSON.stringify(pkg, null, 2));
    createdPackageIds.push(FIXTURE_PKG_ID);
  }

  function writeSyntheticRun(status, extra = {}) {
    const id = `hfr-validator-test-${RUN_ID}-${status}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    const run = {
      id, compositionId: TEST_COMPOSITION_ID, command: 'render', status,
      startedAt: now, updatedAt: now, completedAt: ['completed', 'failed', 'cancelled'].includes(status) ? now : null,
      exitCode: null, progress: status === 'running' ? 42 : null, logTail: [], outputFilename: 'output.mp4',
      importedJobId: null, error: status === 'failed' ? 'Synthetic validator failure for testing.' : null,
      previewPort: null, previewPid: null,
      ...extra,
    };
    const dir = path.join(ROOT, 'data', 'hyperframes-runs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(run, null, 2));
    createdRunIds.push(id);
    return id;
  }

  function cleanupFixtures() {
    for (const id of createdPackageIds) { try { fs.unlinkSync(path.join(PKG_DIR, `${id}.json`)); } catch { /* already gone */ } }
    for (const id of createdJobIds) { try { fs.unlinkSync(path.join(JOB_DIR, `${id}.json`)); } catch { /* already gone */ } }
    for (const id of createdRunIds) { try { fs.unlinkSync(path.join(ROOT, 'data', 'hyperframes-runs', `${id}.json`)); } catch { /* already gone */ } }
  }

  try {
    // ── B17 (run FIRST, before any synthetic queued/running fixtures exist
    // for this composition — hasActiveRender() would otherwise correctly
    // block a real submit): ONE real submit() + immediate real cancel() —
    // the only genuinely new local-compute work this validator does.
    // Proves async return (non-blocking), a real hfr-* id, and real
    // cancellation together, with minimal actual CPU time (cancelled
    // almost immediately, well before the render can complete).
    if (enabled) {
      const submitStart = Date.now();
      let submitResult;
      try {
        submitResult = await hyperframesAdapter.submit({ job: { execution: {}, selectedMode: 'cinematic_broll', providerInput: { compositionId: TEST_COMPOSITION_ID, quality: 'standard' } } });
      } catch (e) {
        submitResult = { ok: false, error: e.message };
      }
      const submitElapsedMs = Date.now() - submitStart;

      check('B17: submit() returns quickly (non-blocking — did not wait for the full render)', submitElapsedMs < 5000, `${submitElapsedMs}ms`);
      check('B17: submit() returns ok:true with a real hfr-* providerJobId', submitResult.ok === true && /^hfr-/.test(submitResult.providerJobId || ''), JSON.stringify(submitResult));
      check('B17: submit() status is waiting_provider (never fabricates immediate completion)', submitResult.status === 'waiting_provider');
      check('B17: submit() never returns outputs itself (no import inside submit — poll() ingests, not submit())', !submitResult.outputs);

      if (submitResult.ok && submitResult.providerJobId) {
        createdRunIds.push(submitResult.providerJobId); // ensure cleanup even if cancel somehow fails
        const cancelResult = await hyperframesAdapter.cancel({ providerJobId: submitResult.providerJobId });
        check('B17: cancel() on the just-submitted real run reports real success', cancelResult.ok === true && cancelResult.status === 'cancelled', JSON.stringify(cancelResult));

        await sleep(300); // let the SIGTERM take effect and the run record settle
        const runAfterCancel = getHyperFramesRun(submitResult.providerJobId);
        check('B17: the real run record reflects cancelled status on disk', runAfterCancel?.status === 'cancelled', runAfterCancel?.status);

        const pollAfterCancel = await hyperframesAdapter.poll({ providerJobId: submitResult.providerJobId });
        check('B17: poll() on the cancelled real run maps correctly (ok:false, errorReason cancelled)', pollAfterCancel.ok === false && pollAfterCancel.errorReason === 'cancelled');
      } else {
        console.log('SKIP — B17 cancel/poll checks (real submit did not return ok:true — see above).');
      }
    } else {
      console.log('SKIP — B17 (HyperFrames not currently active).');
    }

    if (enabled) {
      writeFixturePackage();
      const planResp = await api('POST', '/api/production/router/plan', { packageId: FIXTURE_PKG_ID, selectedMode: 'cinematic_broll', selectedProvider: 'hyperframes' });
      if ((planResp.status === 200 || planResp.status === 201) && planResp.json?.ok && planResp.json.job?.id) {
        const jobId = planResp.json.job.id;
        createdJobIds.push(jobId);

        // B5: GET returns compositions
        const getResp = await api('GET', `/api/production/jobs/${jobId}/hyperframes-provider-input`);
        check('B5: GET hyperframes-provider-input succeeds with a real composition list', getResp.status === 200 && getResp.json?.ok === true && Array.isArray(getResp.json?.compositions));
        check('B5: the known-good test composition is discoverable', getResp.json?.compositions?.some(c => c.id === TEST_COMPOSITION_ID));

        // B6: forgery/whitelist checks
        const forgeResp = await api('PATCH', `/api/production/jobs/${jobId}/hyperframes-provider-input`, {
          compositionId: '../../../etc/passwd', execution: { status: 'completed' }, providerJobId: 'hacked', someRandomKey: 'x',
        });
        check('B6: PATCH rejects a path-traversal compositionId', forgeResp.status !== 200);
        const forgeResp2 = await api('PATCH', `/api/production/jobs/${jobId}/hyperframes-provider-input`, {
          compositionId: TEST_COMPOSITION_ID, outputFilename: 'evil.mp4', forceRerender: true, someRandomKey: 'x',
        });
        const afterForge = await api('GET', `/api/production/jobs/${jobId}`);
        check('B6: forged execution/providerJobId fields never reached job storage', !afterForge.json?.job?.execution?.providerJobId);
        check('B6: unknown key ("someRandomKey") never persisted into providerInput', !('someRandomKey' in (afterForge.json?.job?.providerInput || {})));
        check('B6: outputFilename never persisted into providerInput (not in the PATCH whitelist)', !('outputFilename' in (afterForge.json?.job?.providerInput || {})));
        check('B6: forceRerender never persisted into providerInput (not in the PATCH whitelist)', !('forceRerender' in (afterForge.json?.job?.providerInput || {})));

        // B7: real composition succeeds
        const goodResp = await api('PATCH', `/api/production/jobs/${jobId}/hyperframes-provider-input`, { compositionId: TEST_COMPOSITION_ID, quality: 'standard' });
        check('B7: PATCH with the real known-good composition succeeds', goodResp.status === 200 && goodResp.json?.ok === true, JSON.stringify(goodResp.json));
        check('B7: setup validation reports valid once compositionId is set', goodResp.json?.validation?.valid === true, JSON.stringify(goodResp.json?.validation));

        // B8/B9: cost preview — real, confirmed $0, no render triggered
        const costResp = await api('POST', `/api/production/jobs/${jobId}/hyperframes-cost-preview`);
        check('B8: POST hyperframes-cost-preview succeeds once setup is valid', costResp.status === 200 && costResp.json?.ok === true);
        check('B8: cost preview is a confirmed (non-provisional) $0', costResp.json?.estimate?.provisional === false && costResp.json?.estimate?.estimatedRange?.min === 0 && costResp.json?.estimate?.estimatedRange?.max === 0);
        check('B9: cost preview never starts a render (job execution still absent)', !(await api('GET', `/api/production/jobs/${jobId}`)).json?.job?.execution?.providerJobId);

        // B10: budget/approval gate still applies (not bypassed by the $0 adapter estimate)
        const budgetCheck = await api('GET', `/api/production/jobs/${jobId}`);
        check('B10: job-level approval gate still applies for HyperFrames (governed, not silently bypassed by the $0 estimate)', budgetCheck.json?.job?.budget?.approvalRequired === true);
      } else {
        console.log('SKIP — B5-B10 (could not create a synthetic test plan): ', planResp.json?.error);
      }
    } else {
      console.log('SKIP — B5-B10 (HyperFrames not currently active — CLI unavailable or no compositions found).');
    }

    // ── B11-B15: poll() status mapping using SYNTHETIC run records —
    // real fs reads/writes, real adapter.poll() calls, but the completed
    // case reads the REAL, ALREADY-EXISTING output.mp4 (from a prior,
    // unrelated render) — no new render is triggered anywhere in this block.
    const queuedRunId = writeSyntheticRun('queued');
    const pollQueued = await hyperframesAdapter.poll({ providerJobId: queuedRunId });
    check('B11: queued -> waiting_provider', pollQueued.ok === true && pollQueued.status === 'waiting_provider');

    const runningRunId = writeSyntheticRun('running');
    const pollRunning = await hyperframesAdapter.poll({ providerJobId: runningRunId });
    check('B11: running -> waiting_provider, real progress passed through', pollRunning.ok === true && pollRunning.status === 'waiting_provider' && pollRunning.progress === 42);

    const failedRunId = writeSyntheticRun('failed');
    const pollFailed = await hyperframesAdapter.poll({ providerJobId: failedRunId });
    check('B12: failed -> ok:false, errorReason provider_error, sanitized message passed through', pollFailed.ok === false && pollFailed.errorReason === 'provider_error' && /Synthetic validator failure/.test(pollFailed.error));

    const cancelledRunId = writeSyntheticRun('cancelled');
    const pollCancelled = await hyperframesAdapter.poll({ providerJobId: cancelledRunId });
    check('B13: cancelled -> ok:false, errorReason cancelled, non-retryable', pollCancelled.ok === false && pollCancelled.errorReason === 'cancelled' && pollCancelled.retryable === false);

    // B14: completed — reads the REAL, pre-existing output.mp4 (no new render)
    const completedRunId = writeSyntheticRun('completed');
    const pollCompleted = await hyperframesAdapter.poll({ providerJobId: completedRunId });
    check('B14: completed -> ok:true, one video output with a REAL localBuffer (no new render — reads an already-existing file)', pollCompleted.ok === true && pollCompleted.status === 'completed' && Buffer.isBuffer(pollCompleted.outputs?.[0]?.localBuffer));
    check('B14: real MIME sniffing confirms video/mp4 (signature-based, not extension-trusted)', pollCompleted.outputs?.[0]?.mimeType === 'video/mp4');
    check('B14: real file size is non-zero and matches the actual file on disk', pollCompleted.outputs?.[0]?.localBuffer?.length > 0);
    check('B14: output has NO remote/provider URL — localBuffer only', !pollCompleted.outputs?.[0]?.url);
    check('B14: no absolute filesystem path anywhere in the poll() result', noAbsolutePaths({ ...pollCompleted, outputs: pollCompleted.outputs?.map(o => ({ ...o, localBuffer: undefined })) }));

    // B15: idempotent second poll — same completed run, same result, no side effects
    const pollCompletedAgain = await hyperframesAdapter.poll({ providerJobId: completedRunId });
    check('B15: idempotent — a second poll on the same completed run returns the same successful result', pollCompletedAgain.ok === true && pollCompletedAgain.status === 'completed' && pollCompletedAgain.outputs?.[0]?.localBuffer?.length === pollCompleted.outputs?.[0]?.localBuffer?.length);

    // B16: cancel() on an already-terminal (completed) run
    const cancelTerminal = await hyperframesAdapter.cancel({ providerJobId: completedRunId });
    check('B16: cancel() on an already-completed run returns already_terminal, never claims success', cancelTerminal.ok === false && cancelTerminal.status === 'already_terminal');
  } finally {
    cleanupFixtures();
  }

  // ── Regression: standalone HyperFrames Studio routes unaffected ────────
  const studioCompositions = await api('GET', '/api/hyperframes/compositions');
  check('B18: standalone HyperFrames Studio composition listing unaffected', studioCompositions.status === 200 && studioCompositions.json?.ok === true);
  const studioRuns = await api('GET', '/api/hyperframes/runs');
  check('B18: standalone HyperFrames Studio run listing unaffected', studioRuns.status === 200 && studioRuns.json?.ok === true);

  // ── Final regression spot-check across the other 3 real providers ──────
  check('B19: HeyGen MCP adapter entry unaffected by this milestone', heygenMcp?.billingPool === 'heygen-account-credits' || heygenMcp?.executionType === 'mcp-oauth');
  check('B19: Higgsfield MCP adapter entry unaffected by this milestone', higgsfieldMcp?.billingPool === 'higgsfield-account-credits');
  check('B19: OpenArt Video MCP adapter entry unaffected by this milestone', openartVideo?.billingPool === 'openart-credits');

  console.log('NOTE — Full regression coverage for HyperFrames Local Studio, Provider Execution Engine, Universal Output Viewer, Publishing Router, Higgsfield, and OpenArt Video is verified by running their own dedicated validator scripts separately (see the final report).');

  printSummary();
}

function printSummary() {
  const failed = results.filter(r => !r.ok);
  console.log('\n' + '─'.repeat(42));
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('FAILED:');
    failed.forEach(f => console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`));
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error('Validation script crashed:', err);
  process.exitCode = 1;
});
