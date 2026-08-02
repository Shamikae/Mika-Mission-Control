#!/usr/bin/env node
// scripts/validate-provider-execution-engine.mjs
//
// Executable validation for Provider Execution Engine v1. Follows this
// project's established convention (no jest/vitest configured) of
// validating against the REAL running dev server and REAL file-backed
// persistence — no mocking of the code under test.
//
// The mock-video adapter's live executable state depends on the server's
// PROVIDER_MOCK_VIDEO_ENABLED env var, which cannot be changed by this
// script (env vars are fixed at process launch). This script detects the
// server's CURRENT mock-video state via GET /api/production/providers and
// runs the matching branch — run it once against the default server
// (mock disabled) and once against a server started with
// PROVIDER_MOCK_VIDEO_ENABLED=true to cover both branches.

import fs from 'fs';
import path from 'path';
import { spawn, execSync } from 'child_process';
import { acquireExecutionLock, releaseExecutionLock } from '../lib/production/execution/executionLock.js';

const ROOT = process.cwd();
const BASE = 'http://localhost:3099';

// The lock module lives under a directory scoped to {"type":"module"}
// (lib/production/execution/package.json), which is what makes the
// direct import above resolvable by plain Node — see that file's comment.
// This lets the concurrency tests below exercise the REAL atomic lock
// primitive directly, including from real child processes, rather than
// only through the HTTP surface.

function runWorker(jobId, action, ttlMs) {
  return new Promise((resolve) => {
    const args = ['scripts/_lock-contention-worker.mjs', jobId, action, ...(ttlMs ? [String(ttlMs)] : [])];
    const child = spawn(process.execPath, args, { cwd: ROOT });
    let out = '';
    let errOut = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { errOut += d; });
    child.on('close', () => {
      try { resolve(JSON.parse(out.trim())); }
      catch { resolve({ ok: false, error: 'worker output parse failure', raw: out, stderr: errOut }); }
    });
  });
}

function readEnvToken() {
  try {
    const raw = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8');
    return raw.match(/^MIKA_ADMIN_TOKEN=(.+)$/m)?.[1]?.trim() || '';
  } catch { return ''; }
}
const TOKEN = readEnvToken();

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, ok: !!condition, detail });
  console.log(`${condition ? 'PASS' : 'FAIL'} — ${name}${detail && !condition ? ` (${detail})` : ''}`);
}
function skip(name, reason) {
  console.log(`SKIP — ${name} (${reason})`);
}

async function api(method, urlPath, body) {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Mika-Admin-Token': TOKEN },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON response */ }
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
    brand: 'PEE Test Brand',
    platform: 'TikTok',
    goal: 'Engagement',
    topic: 'PEE test package',
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
function eligiblePkgOverrides() {
  const now = new Date().toISOString();
  return {
    status: 'approved',
    script: { opening: '', body: '', cta: '', fullText: 'A script long enough to be non-empty for execution eligibility and manual-export brief generation in these tests.' },
    scenes: [{ order: 1, durationSeconds: 5, visual: 'x', voiceover: 'y', onScreenText: 'z' }],
    pipeline: { stage: 'approved', enteredStageAt: now, history: [
      { stage: 'review', at: now, actor: 'test', note: null },
      { stage: 'approved', at: now, actor: 'test', note: null },
    ] },
  };
}

function writeFixture(pkg) {
  fs.mkdirSync(PKG_DIR, { recursive: true });
  fs.writeFileSync(path.join(PKG_DIR, `${pkg.id}.json`), JSON.stringify(pkg, null, 2));
}
function readFixture(id) {
  return JSON.parse(fs.readFileSync(path.join(PKG_DIR, `${id}.json`), 'utf-8'));
}
function readJobFile(id) {
  return JSON.parse(fs.readFileSync(path.join(JOB_DIR, `${id}.json`), 'utf-8'));
}
function writeJobFile(job) {
  fs.writeFileSync(path.join(JOB_DIR, `${job.id}.json`), JSON.stringify(job, null, 2));
}

const createdPackageIds = [];
const createdJobIds = new Set();

function cleanup() {
  for (const id of createdPackageIds) {
    try { fs.unlinkSync(path.join(PKG_DIR, `${id}.json`)); } catch { /* already gone */ }
  }
  for (const id of createdJobIds) {
    try { fs.unlinkSync(path.join(JOB_DIR, `${id}.json`)); } catch { /* already gone */ }
  }
  try {
    const q = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'production-execution-queue.json'), 'utf-8'));
    const cleaned = { items: (q.items || []).filter(i => !createdJobIds.has(i.productionJobId)) };
    fs.writeFileSync(path.join(ROOT, 'data', 'production-execution-queue.json'), JSON.stringify(cleaned, null, 2));
  } catch { /* no queue file yet */ }
}

async function createPlan(packageId, opts = {}) {
  const r = await api('POST', '/api/production/router/plan', { packageId, ...opts });
  if (r.json?.job?.id) createdJobIds.add(r.json.job.id);
  return r;
}

async function main() {
  console.log(`Using admin token: ${TOKEN ? '(configured)' : '(NONE — mutations will 401/503)'}`);
  const up = await waitForServer();
  check('dev server reachable on :3099', up);
  if (!up) { process.exitCode = 1; return; }

  const providersResp = await api('GET', '/api/production/providers');
  const mockEntry = providersResp.json?.providers?.find(p => p.id === 'mock-video');
  const mockEnabled = mockEntry?.executable === true;
  console.log(`Server mock-video state: ${mockEnabled ? 'ENABLED' : 'disabled'} — running the ${mockEnabled ? 'enabled' : 'disabled'} branch of mock-dependent tests.`);

  // ── Provider registry sanity ──────────────────────────────────────────────

  check('Provider registry lists manual-export as active/executable', providersResp.json?.providers?.find(p => p.id === 'manual-export')?.executable === true);
  check('Provider registry lists heygen as non-executable (staged)', providersResp.json?.providers?.find(p => p.id === 'heygen')?.executable === false);
  check('Provider registry marks mock-video with mock:true', mockEntry?.mock === true);

  if (!mockEnabled) {
    check('K: mock-video reported non-executable when disabled', mockEntry?.executable === false && mockEntry?.status === 'staged');
  } else {
    skip('K: mock-video disabled/unavailable check', 'server currently has PROVIDER_MOCK_VIDEO_ENABLED=true — run once against the default server to cover this branch');
  }

  // ── Fixtures ──────────────────────────────────────────────────────────────

  const READY_ID = 'pack-pee-ready';
  const UNAPPROVED_ID = 'pack-pee-unapproved';
  const BACKLINK_ID = 'pack-pee-backlink';

  createdPackageIds.push(READY_ID, UNAPPROVED_ID, BACKLINK_ID);

  writeFixture(baseFixture(READY_ID, { topic: 'Ready-for-execution test package', ...eligiblePkgOverrides() }));
  writeFixture(baseFixture(UNAPPROVED_ID, {
    topic: 'Unapproved test package',
    script: { opening: '', body: '', cta: '', fullText: 'irrelevant but present' },
    scenes: [{ order: 1, durationSeconds: 5, visual: 'x', voiceover: '', onScreenText: '' }],
  })); // status stays 'draft' — never approved
  writeFixture(baseFixture(BACKLINK_ID, { topic: 'Backlink sync test package', ...eligiblePkgOverrides() }));

  // ── A. Ready job can enqueue (manual-export) ─────────────────────────────

  let planResp = await createPlan(READY_ID, { selectedProvider: 'manual-export' });
  const readyJob = planResp.json?.job;
  check('A: plan created, status=ready (manual-export requires no approval)', readyJob?.status === 'ready');

  let enq = await api('POST', '/api/production/execution/enqueue', { productionJobId: readyJob.id });
  check('A: ready job -> enqueue succeeds', enq.status === 200 && enq.json?.ok === true && enq.json?.job?.execution?.status === 'queued');

  // ── D. Duplicate enqueue blocked ─────────────────────────────────────────

  const dupEnq = await api('POST', '/api/production/execution/enqueue', { productionJobId: readyJob.id });
  check('D: duplicate enqueue of an already-queued job is rejected', dupEnq.status === 409 && dupEnq.json?.ok === false);

  // ── G/H. manual-export completes via run-next, artifacts saved ──────────

  const runResp = await api('POST', '/api/production/execution/run-next', undefined);
  check('G: run-next processes the queued manual-export job -> completed', runResp.status === 200 && runResp.json?.job?.execution?.status === 'completed');
  const outputs = runResp.json?.job?.execution?.outputs || [];
  check('H: manual-export produced JSON and Markdown artifacts', outputs.some(o => o.mimeType === 'application/json') && outputs.some(o => o.mimeType === 'text/markdown'));
  check('H: outputs reference local secure artifact routes, not provider URLs', outputs.every(o => o.artifactUrl?.startsWith('/api/production/artifacts/')));

  // Fetch one artifact through the secure route.
  if (outputs[0]) {
    const artifactId = outputs[0].artifactUrl.split('/').pop();
    const artifactRes = await fetch(`${BASE}${outputs[0].artifactUrl}`);
    check('H: artifact is servable via GET /api/production/artifacts/[id]', artifactRes.ok);
    const badArtifact = await fetch(`${BASE}/api/production/artifacts/${encodeURIComponent('../../etc/passwd')}`);
    check('T: path traversal on artifact id -> 400', badArtifact.status === 400);
    const notFoundArtifact = await fetch(`${BASE}/api/production/artifacts/${'a'.repeat(32)}.json`);
    check('T: well-formed but nonexistent artifact id -> 404', notFoundArtifact.status === 404);
    void artifactId;
  }

  // ── U/W. No provider URL / no package content duplicated in job file ────

  const readyJobFile = readJobFile(readyJob.id);
  const rawJobText = JSON.stringify(readyJobFile);
  check('U: persisted job file contains no http(s):// URLs anywhere', !/https?:\/\//.test(rawJobText));
  const pkgNow = readFixture(READY_ID);
  check('W: persisted job file does not contain script.fullText verbatim', !rawJobText.includes(pkgNow.script.fullText));

  // ── X. Latest package backlink synchronized by execution ────────────────

  const pkgAfterRun = await api('GET', `/api/content/pack/${READY_ID}`);
  check('X: package.production.status synchronized to completed', pkgAfterRun.json?.package?.production?.status === 'completed');
  check('X: package.production.latestJobId matches the executed job', pkgAfterRun.json?.package?.production?.latestJobId === readyJob.id);

  // ── B. Unapproved job cannot enqueue ─────────────────────────────────────

  planResp = await createPlan(UNAPPROVED_ID);
  const blockedJob = planResp.json?.job;
  check('B: unapproved package -> plan is blocked', blockedJob?.status === 'blocked');
  const blockedEnq = await api('POST', '/api/production/execution/enqueue', { productionJobId: blockedJob.id });
  check('B: blocked job cannot enqueue', blockedEnq.status === 409 && blockedEnq.json?.ok === false);

  // ── C. Stale job cannot enqueue ───────────────────────────────────────────

  planResp = await createPlan(BACKLINK_ID, { selectedProvider: 'manual-export' });
  const staleJob = planResp.json?.job;
  check('C: fresh plan is ready', staleJob?.status === 'ready');

  const mutatedPkg = readFixture(BACKLINK_ID);
  mutatedPkg.topic = 'Backlink sync test package — UPDATED';
  mutatedPkg.metadata.updatedAt = new Date(Date.now() + 5000).toISOString();
  writeFixture(mutatedPkg);

  const staleEnq = await api('POST', '/api/production/execution/enqueue', { productionJobId: staleJob.id });
  check('C: stale job (package changed since plan built) cannot enqueue', staleEnq.status === 409 && /changed since this plan/.test(staleEnq.json?.error || ''));

  // Refresh reconciles staleness, then it can enqueue.
  const refreshResp = await api('POST', `/api/production/jobs/${staleJob.id}/refresh`);
  const refreshedJob = refreshResp.json?.job;
  const enqAfterRefresh = await api('POST', '/api/production/execution/enqueue', { productionJobId: refreshedJob.id });
  check('C: after explicit refresh, job can enqueue', enqAfterRefresh.status === 200 && enqAfterRefresh.json?.ok === true);

  // ── Y. Older job cannot overwrite package backlink ───────────────────────

  const runResp2 = await api('POST', '/api/production/execution/run-next', undefined); // completes refreshedJob's execution (jobA)
  const jobA = refreshedJob;
  check('Y setup: jobA executed to completion', runResp2.json?.job?.execution?.status === 'completed' && runResp2.json?.job?.id === jobA.id);

  // A second, distinct plan+job for the SAME package (BACKLINK_ID) — this becomes the new latest.
  const planB = await createPlan(BACKLINK_ID, { selectedProvider: 'manual-export' });
  const jobB = planB.json?.job;
  await api('POST', '/api/production/execution/enqueue', { productionJobId: jobB.id });
  const runB = await api('POST', '/api/production/execution/run-next', undefined);
  check('Y setup: jobB (a second, newer job for the same package) executed to completion', runB.json?.job?.execution?.status === 'completed' && runB.json?.job?.id === jobB.id);

  const pkgAfterB = await api('GET', `/api/content/pack/${BACKLINK_ID}`);
  check('Y setup: package backlink now points to jobB (the newer job)', pkgAfterB.json?.package?.production?.latestJobId === jobB.id);

  // Touching the OLDER job (jobA) must NOT overwrite the backlink back to jobA.
  const patchOlder = await api('PATCH', `/api/production/jobs/${jobA.id}`, { userNotes: 'touching the older, superseded job' });
  check('Y: PATCH on the older job (jobA) still succeeds', patchOlder.status === 200 && patchOlder.json?.ok === true);

  const pkgAfterOlderTouch = await api('GET', `/api/content/pack/${BACKLINK_ID}`);
  check('Y: package.production.latestJobId is STILL jobB (jobA did not clobber it)', pkgAfterOlderTouch.json?.package?.production?.latestJobId === jobB.id);

  // ── AA. Execution metadata cannot be forged ──────────────────────────────

  const forgeExec = await api('PATCH', `/api/production/jobs/${blockedJob.id}`, { execution: { status: 'completed', outputs: [{ artifactUrl: 'https://evil.example/video.mp4' }] } });
  check('AA: PATCH with only an `execution` field is inert (400, no recognized fields)', forgeExec.status === 400);

  const forgePkgExec = await api('PATCH', `/api/content/pack/${READY_ID}`, {
    edits: { production: { latestJobId: 'forged', status: 'completed', selectedMode: 'avatar_video', selectedProvider: 'manual-export', updatedAt: '2000-01-01T00:00:00.000Z' } },
  });
  check('AA: package edit cannot forge production/execution metadata', forgePkgExec.status === 200 && forgePkgExec.json?.package?.production?.latestJobId === readyJob.id);

  // ── V. No secrets in any response collected so far ───────────────────────

  const blob = JSON.stringify([enq.json, runResp.json, pkgAfterRun.json, planResp.json, providersResp.json]);
  const leaked = [TOKEN, ROOT].filter(v => v && blob.includes(v));
  check('V: no admin token or filesystem paths in API responses', leaked.length === 0, leaked.join(', '));

  // ── Z. Queue data gitignored ──────────────────────────────────────────────

  let ignored = false;
  try { execSync('git check-ignore -q "data/production-execution-queue.json"', { cwd: ROOT }); ignored = true; }
  catch { ignored = false; }
  check('Z: data/production-execution-queue.json is git-ignored', ignored);
  let artifactsIgnored = false;
  try { execSync('git check-ignore -q "production-artifacts/"', { cwd: ROOT }); artifactsIgnored = true; }
  catch { artifactsIgnored = false; }
  check('Z: production-artifacts/ is git-ignored', artifactsIgnored);

  // ── S. https-only remote download (structural — neither v1 adapter uses a remote URL) ─

  const downloaderSrc = fs.readFileSync(path.join(ROOT, 'lib/production/execution/downloadRemoteArtifact.js'), 'utf-8');
  check('S: downloadRemoteArtifact rejects non-https URLs before any network call (structural check — no v1 adapter exercises this path; both are local-buffer only)',
    /startsWith\('https:\/\/'\)/.test(downloaderSrc) && /throw new Error/.test(downloaderSrc));
  check('R: downloadRemoteArtifact enforces the artifact MIME allowlist and size limit (structural check)',
    /isAllowedArtifactMime/.test(downloaderSrc) && /maxBytesForMime/.test(downloaderSrc));

  // ── L. Illegal transitions rejected (poll a completed job) ──────────────

  const pollCompleted = await api('POST', `/api/production/execution/${readyJob.id}/poll`, {});
  check('L: polling a completed execution is rejected (409)', pollCompleted.status === 409);

  const retryReady = await api('POST', `/api/production/execution/${readyJob.id}/retry`, undefined);
  check('L: retrying a non-failed execution is rejected (409)', retryReady.status === 409);

  // ── P. Cancel a queued job (never submitted) ─────────────────────────────

  const p3 = await createPlan(READY_ID, { selectedProvider: 'manual-export' }); // re-plan same package for a fresh job
  const cancelTargetJob = p3.json?.job;
  const enqForCancel = await api('POST', '/api/production/execution/enqueue', { productionJobId: cancelTargetJob.id });
  check('P setup: job enqueued for cancel test', enqForCancel.json?.job?.execution?.status === 'queued');
  const cancelQueued = await api('POST', `/api/production/execution/${cancelTargetJob.id}/cancel`, {});
  check('P: cancel while queued -> status=cancelled', cancelQueued.status === 200 && cancelQueued.json?.job?.execution?.status === 'cancelled');

  // ── Mock-dependent branch ─────────────────────────────────────────────────

  if (mockEnabled) {
    const MOCK_ID = 'pack-pee-mock';
    createdPackageIds.push(MOCK_ID);
    writeFixture(baseFixture(MOCK_ID, { topic: 'Mock video lifecycle test package', ...eligiblePkgOverrides() }));

    // mock-video is intentionally NOT part of Production Router's own
    // PROVIDER_CATALOG (it is execution-engine-only, test/dev scope, never
    // a real planning recommendation) — POST /api/production/router/plan
    // correctly rejects it as an invalid selectedProvider, and that
    // validation must not be weakened just to make it selectable here.
    // So: build a normal plan (readiness/budget computed for whatever
    // Router actually recommends), then assign mock-video directly on the
    // job fixture — the same "write the fixture directly" pattern already
    // used for package fixtures — to exercise the execution engine itself.
    async function planWithMockProvider(opts = {}) {
      const built = (await createPlan(MOCK_ID, { selectedMode: 'faceless_social', ...opts })).json?.job;
      const job = readJobFile(built.id);
      job.selectedProvider = 'mock-video';
      writeJobFile(job);
      return job;
    }

    let mockJob = await planWithMockProvider();
    check('I setup: mock-video plan readiness passes (script+sceneplan available)', mockJob?.readiness?.ready === true);
    check('I setup: mock-video job ready to enqueue', mockJob?.status === 'ready');

    const mockEnq = await api('POST', '/api/production/execution/enqueue', { productionJobId: mockJob.id });
    check('I: mock job enqueues', mockEnq.status === 200 && mockEnq.json?.ok === true);

    const mockRun = await api('POST', '/api/production/execution/run-next', undefined);
    check('I: submit -> waiting_provider (async)', mockRun.json?.job?.execution?.status === 'waiting_provider');
    check('J: execution.mock === true and clearly labeled', mockRun.json?.job?.execution?.mock === true);

    // ── M. Early poll blocked, force overrides ─────────────────────────────

    const earlyPoll = await api('POST', `/api/production/execution/${mockJob.id}/poll`, {});
    check('M: polling before nextPollAt is rejected (429)', earlyPoll.status === 429);
    const forcedPoll = await api('POST', `/api/production/execution/${mockJob.id}/poll`, { force: true });
    check('M: force:true bypasses the early-poll guard', forcedPoll.status === 200 && forcedPoll.json?.ok === true);

    // ── E. Lock prevents parallel execution ────────────────────────────────

    const parallelEnq = await api('POST', '/api/production/execution/enqueue', { productionJobId: mockJob.id });
    check('E: cannot enqueue a job with an active execution lock', parallelEnq.status === 409 && /already active/.test(parallelEnq.json?.error || ''));

    // ── Q. Cancel an active (waiting_provider) job ─────────────────────────

    const cancelActive = await api('POST', `/api/production/execution/${mockJob.id}/cancel`, { note: 'cancel while waiting on provider' });
    check('Q: cancel while waiting_provider -> cancelled, lock released', cancelActive.status === 200 && cancelActive.json?.job?.execution?.status === 'cancelled' && cancelActive.json?.job?.execution?.lock === null);

    // ── I continued: full completion lifecycle on a second mock job ───────

    const mockJob2 = await planWithMockProvider();
    await api('POST', '/api/production/execution/enqueue', { productionJobId: mockJob2.id });
    await api('POST', '/api/production/execution/run-next', undefined); // -> waiting_provider, stepsCompleted 0->1

    let last;
    for (let i = 0; i < 4; i++) { // TOTAL_STEPS=3 in the adapter; a few extra force-polls are harmless once completed (early-poll guard rejects, not a crash)
      last = await api('POST', `/api/production/execution/${mockJob2.id}/poll`, { force: true });
      if (last.json?.job?.execution?.status === 'completed') break;
    }
    check('I: mock lifecycle reaches completed within bounded polls', last?.json?.job?.execution?.status === 'completed');
    const mockOutputs = last?.json?.job?.execution?.outputs || [];
    check('H/J: mock output is a clearly-labeled manifest, not a real video', mockOutputs.length === 1 && mockOutputs[0].mimeType === 'application/json');
    if (mockOutputs[0]) {
      const manifestRes = await fetch(`${BASE}${mockOutputs[0].artifactUrl}`);
      const manifestJson = await manifestRes.json();
      check('J: mock manifest explicitly disclaims being a real video', manifestJson.disclaimer === 'TEST SIMULATION — NOT A REAL VIDEO' && manifestJson.mock === true);
    }

    // ── F. Stale lock recovery ──────────────────────────────────────────────

    const mockJob3 = await planWithMockProvider();
    await api('POST', '/api/production/execution/enqueue', { productionJobId: mockJob3.id });
    await api('POST', '/api/production/execution/run-next', undefined); // acquires lock, waiting_provider

    // The AUTHORITATIVE lock now lives in data/production-execution-locks/,
    // not job.execution.lock (that's sanitized observability metadata only
    // — renewExecutionLock only cares about token ownership, not staleness,
    // so a legitimate holder always renews successfully regardless of how
    // close to its TTL it is). To genuinely exercise poll's recovery path,
    // simulate the authoritative lock having been fully lost (e.g. cleaned
    // up after a crash) by deleting it outright — this makes the stored
    // token's renewal fail with "not found," forcing poll to fall back to a
    // fresh acquisition rather than assuming it still owns the job.
    const staleLockPath = path.join(ROOT, 'data', 'production-execution-locks', `${mockJob3.id}.lock`);
    fs.unlinkSync(staleLockPath);

    const reclaimPoll = await api('POST', `/api/production/execution/${mockJob3.id}/poll`, { force: true });
    check('F: poll reclaims a stale lock instead of blocking', reclaimPoll.status === 200 && reclaimPoll.json?.ok === true);
    const reclaimEvents = (reclaimPoll.json?.job?.activityHistory || []).map(e => e.type);
    check('F: activity history logs execution_lock_reclaimed', reclaimEvents.includes('execution_lock_reclaimed'));

    // ── N/O. Bounded retry + non-retryable failure rejected ────────────────

    const mockPlan4 = await createPlan(MOCK_ID, { selectedMode: 'faceless_social', selectedProvider: 'heygen' }); // staged, non-executable -> forced failure path
    const mockJob4 = mockPlan4.json?.job;
    // heygen requires approval (non-manual, staged) — approve it first so only "provider not executable" blocks execution, not approval.
    if (mockJob4?.status === 'needs_approval') await api('POST', `/api/production/jobs/${mockJob4.id}/approve`, undefined);

    const heygenEnq = await api('POST', '/api/production/execution/enqueue', { productionJobId: mockJob4.id });
    check('O setup: enqueue against a non-executable provider is rejected outright (never even queues)', heygenEnq.status === 409 && /heygen/i.test(heygenEnq.json?.error || ''));

    // A synthetic "already failed" execution — constructed directly (never
    // actually enqueued/run) since a real 'failed' state only exists AFTER
    // run-next has already dequeued the job; recreating that end-state
    // directly is the correct way to test retry logic in isolation.
    const mockJob5 = await planWithMockProvider({ maxEstimatedCost: 0 });
    const j5 = readJobFile(mockJob5.id);
    j5.status = 'failed';
    j5.execution = {
      status: 'failed', provider: 'mock-video', providerJobId: `mock-${mockJob5.id}`,
      attemptCount: 1, maxAttempts: 3,
      startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      completedAt: null, cancelledAt: null, lastPollAt: null, nextPollAt: null,
      progress: null, error: 'synthetic non-retryable failure for validation', errorReason: 'validation_error',
      outputs: [], providerMetadata: null, lock: null, mock: true,
    };
    writeJobFile(j5);
    const nonRetryableRetry = await api('POST', `/api/production/execution/${mockJob5.id}/retry`, undefined);
    check('O: retrying a non-retryable failure (validation_error) is rejected', nonRetryableRetry.status === 409 && /not retryable/.test(nonRetryableRetry.json?.error || ''));

    // N: bounded retry — mark it retryable with attemptCount already at maxAttempts.
    const j5b = readJobFile(mockJob5.id);
    j5b.execution.errorReason = 'network_error';
    j5b.execution.attemptCount = j5b.execution.maxAttempts;
    writeJobFile(j5b);
    const maxedRetry = await api('POST', `/api/production/execution/${mockJob5.id}/retry`, undefined);
    check('N: retry blocked once attemptCount reaches maxAttempts', maxedRetry.status === 409 && /[Mm]aximum attempts/.test(maxedRetry.json?.error || ''));

    const j5c = readJobFile(mockJob5.id);
    j5c.execution.attemptCount = 1;
    writeJobFile(j5c);
    const okRetry = await api('POST', `/api/production/execution/${mockJob5.id}/retry`, undefined);
    check('N: retry succeeds while attempts remain and reason is retryable', okRetry.status === 200 && okRetry.json?.job?.execution?.status === 'queued');
    // Clean it back out of the queue so it doesn't linger.
    await api('POST', `/api/production/execution/${mockJob5.id}/cancel`, {});
  } else {
    for (const label of [
      'E: lock prevents parallel execution', 'F: stale lock recovery', 'I: mock-video submit/poll/completion lifecycle',
      'J: mock clearly labeled test-only', 'M: early poll blocked / force override',
      'N: bounded retry', 'O: non-retryable failure rejected', 'Q: cancel active (waiting_provider) job',
    ]) skip(label, 'requires a server started with PROVIDER_MOCK_VIDEO_ENABLED=true');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CONCURRENCY HARDENING — real atomic-lock tests
  // ══════════════════════════════════════════════════════════════════════════

  const uniqueSuffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // ── 1. Same-process Promise.all: exactly one acquisition succeeds ───────
  // Note: acquireExecutionLock is synchronous, so within ONE process these
  // calls actually execute serially (the event loop can't interleave sync
  // code) — this proves the function's contract (N calls, exactly 1 winner,
  // rest lock_unavailable), but real OS-level atomicity across genuinely
  // concurrent execution is what the CHILD-PROCESS test (#2 below) proves.
  const sameProcessJobId = `pr-locktest-sp-${uniqueSuffix}`;
  const sameProcessResults = await Promise.all(
    Array.from({ length: 8 }, () => Promise.resolve(acquireExecutionLock(sameProcessJobId, { owner: 'same-process-test' })))
  );
  const spSuccesses = sameProcessResults.filter(r => r.ok);
  const spFailures = sameProcessResults.filter(r => !r.ok);
  check('Lock 1a: same-process Promise.all -> exactly one acquisition succeeds', spSuccesses.length === 1, `successes=${spSuccesses.length}`);
  check('Lock 1b: same-process Promise.all -> all others report lock_unavailable', spFailures.every(r => r.reason === 'lock_unavailable'), JSON.stringify([...new Set(spFailures.map(r => r.reason))]));
  if (spSuccesses[0]) releaseExecutionLock(sameProcessJobId, spSuccesses[0].token);

  // ── 2. Real cross-process concurrency: N child processes, one job ───────
  const crossProcJobId = `pr-locktest-cp-${uniqueSuffix}`;
  const N_WORKERS = 8;
  const workerResults = await Promise.all(Array.from({ length: N_WORKERS }, () => runWorker(crossProcJobId, 'acquire')));
  const cpSuccesses = workerResults.filter(r => r.ok);
  const cpFailures = workerResults.filter(r => !r.ok);
  check('Lock 2a: real cross-process contention -> exactly one of N processes acquires the lock', cpSuccesses.length === 1, `successes=${cpSuccesses.length} of ${N_WORKERS}, results=${JSON.stringify(workerResults)}`);
  check('Lock 2b: cross-process -> all other processes report lock_unavailable', cpFailures.every(r => r.reason === 'lock_unavailable'), JSON.stringify([...new Set(cpFailures.map(r => r.reason))]));
  if (cpSuccesses[0]) releaseExecutionLock(crossProcJobId, cpSuccesses[0].token);

  // ── 3. Stale lock reclaimed by exactly one contender ─────────────────────
  const staleJobId = `pr-locktest-stale-${uniqueSuffix}`;
  const staleHolder = await runWorker(staleJobId, 'acquire', 50); // 50ms TTL, process exits without releasing (simulates a crash)
  check('Lock 3 setup: initial holder acquired with a short TTL', staleHolder.ok === true);
  await new Promise(r => setTimeout(r, 200)); // let it go stale
  const reclaimers = await Promise.all(Array.from({ length: 6 }, () => runWorker(staleJobId, 'acquire')));
  const reclaimSuccesses = reclaimers.filter(r => r.ok);
  check('Lock 3: exactly one contender reclaims a stale lock', reclaimSuccesses.length === 1, `successes=${reclaimSuccesses.length}, results=${JSON.stringify(reclaimers)}`);
  check('Lock 3: the winner\'s result is marked reclaimed:true', reclaimSuccesses[0]?.reclaimed === true);
  if (reclaimSuccesses[0]) releaseExecutionLock(staleJobId, reclaimSuccesses[0].token);

  // ── 4/5. Token-authorized release ─────────────────────────────────────────
  const relJobId = `pr-locktest-rel-${uniqueSuffix}`;
  const relLock = acquireExecutionLock(relJobId, { owner: 'release-test' });
  check('Lock 4 setup: lock acquired for release tests', relLock.ok === true);
  const wrongTokenRelease = releaseExecutionLock(relJobId, 'not-the-real-token');
  check('Lock 4: release with the WRONG token fails', wrongTokenRelease.ok === false && /[Tt]oken mismatch/.test(wrongTokenRelease.error || ''));
  const stillHeld = acquireExecutionLock(relJobId, { owner: 'intruder' });
  check('Lock 4: lock is still held after a failed wrong-token release attempt', stillHeld.ok === false && stillHeld.reason === 'lock_unavailable');
  const correctTokenRelease = releaseExecutionLock(relJobId, relLock.token);
  check('Lock 5: release with the CORRECT token succeeds', correctTokenRelease.ok === true);
  const reacquireAfterRelease = acquireExecutionLock(relJobId, { owner: 'next-owner' });
  check('Lock 5: lock is acquirable again immediately after a correct release', reacquireAfterRelease.ok === true);
  if (reacquireAfterRelease.ok) releaseExecutionLock(relJobId, reacquireAfterRelease.token);

  // ── 7. Invalid / path-traversal job IDs rejected by the lock module itself ─
  const traversalLock = acquireExecutionLock('../../etc/passwd', { owner: 'attacker' });
  check('Lock 7: acquireExecutionLock rejects a path-traversal id', traversalLock.ok === false && traversalLock.reason === 'invalid_id');
  const traversalRelease = releaseExecutionLock('../../etc/passwd', 'x');
  check('Lock 7: releaseExecutionLock rejects a path-traversal id', traversalRelease.ok === false);
  check('Lock 7: no lock file escaped data/production-execution-locks/', !fs.existsSync('/etc/passwd.lock'));

  // ── 2 continued. Real cross-process run-next contention via the HTTP API ─
  const RN_ID = 'pack-pee-lockrace';
  createdPackageIds.push(RN_ID);
  writeFixture(baseFixture(RN_ID, { topic: 'Run-next lock race test package', ...eligiblePkgOverrides() }));
  const rnPlan = await createPlan(RN_ID, { selectedProvider: 'manual-export' });
  const rnJob = rnPlan.json?.job;
  check('Lock 2c setup: ready job created for run-next race test', rnJob?.status === 'ready');
  await api('POST', '/api/production/execution/enqueue', { productionJobId: rnJob.id });

  const runNextResults = await Promise.all(Array.from({ length: 6 }, () => api('POST', '/api/production/execution/run-next', undefined)));
  const completedHits = runNextResults.filter(r => r.json?.job?.id === rnJob.id && r.json?.job?.execution?.status === 'completed');
  check('Lock 2c: exactly one concurrent run-next request actually processed the job', completedHits.length === 1, `hits=${completedHits.length}, statuses=${JSON.stringify(runNextResults.map(r => r.json?.job?.execution?.status || r.json?.message))}`);

  const finalJobState = await api('GET', `/api/production/jobs/${rnJob.id}`);
  check('Lock 2c: attemptCount incremented exactly once (no duplicate submit)', finalJobState.json?.job?.execution?.attemptCount === 1, `attemptCount=${finalJobState.json?.job?.execution?.attemptCount}`);
  const startedEvents = (finalJobState.json?.job?.activityHistory || []).filter(e => e.type === 'execution_started');
  check('Lock 2c: exactly one execution_started event (never submitted twice)', startedEvents.length === 1, `count=${startedEvents.length}`);
  check('Lock 2c: queue has no residual/duplicate entry for this job', !(await api('GET', '/api/production/execution/queue')).json?.items?.some(i => i.productionJobId === rnJob.id));

  // ── 6. Lock token never appears anywhere client-facing ────────────────────

  const allTokens = [
    spSuccesses[0]?.token, ...cpSuccesses.map(r => r.token), reclaimSuccesses[0]?.token,
    relLock?.token, reacquireAfterRelease?.token,
  ].filter(Boolean);

  const jobApiBlob = JSON.stringify(finalJobState.json);
  const queueApiBlob = JSON.stringify((await api('GET', '/api/production/execution/queue')).json);
  const providersApiBlob = JSON.stringify((await api('GET', '/api/production/providers')).json);
  const pkgBacklinkBlob = JSON.stringify((await api('GET', `/api/content/pack/${RN_ID}`)).json?.package?.production);
  const activityBlob = JSON.stringify(finalJobState.json?.job?.activityHistory);

  const surfaces = { job: jobApiBlob, queue: queueApiBlob, providers: providersApiBlob, backlink: pkgBacklinkBlob, activity: activityBlob };
  for (const [name, blob] of Object.entries(surfaces)) {
    const leaked = allTokens.filter(t => blob.includes(t));
    check(`Lock 6: no lock token appears in the ${name} API surface`, leaked.length === 0, `leaked=${leaked.length}`);
  }

  // ── 8. Lock directory gitignored ──────────────────────────────────────────

  let locksIgnored = false;
  try { execSync('git check-ignore -q "data/production-execution-locks/"', { cwd: ROOT }); locksIgnored = true; }
  catch { locksIgnored = false; }
  check('Lock 8: data/production-execution-locks/ is git-ignored', locksIgnored);

  // ── Summary ────────────────────────────────────────────────────────────────

  cleanup();

  const failed = results.filter(r => !r.ok);
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
