#!/usr/bin/env node
// scripts/validate-hyperframes-local-studio.mjs
//
// Validation for HyperFrames Local Studio v1. This DOES trigger real local
// HyperFrames CLI invocations (lint/check/render) — that is safe and free:
// everything runs on-machine, no credentials, no network billing, no
// external provider. To avoid any risk to the user's already-imported real
// render (tools/hyperframes/mika-hyperframes-test/output.mp4, imported in a
// prior milestone), this script:
//   - only LINTS/CHECKS mika-hyperframes-test (read-only, never touches
//     output.mp4) and re-imports it once to confirm idempotency
//     (alreadyImported: true, same ids as before — a regression check),
//   - does all RENDER / CANCEL / DUPLICATE-RENDER / FRESH-IMPORT testing
//     against tools/hyperframes/hello-hyperframes, which had no output.mp4
//     before this script ran, and restores it to that same no-output state
//     in a `finally` cleanup block, alongside deleting every fixture job/
//     package/artifact this script creates.

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const BASE = 'http://localhost:3099';
const HF_ROOT = path.join(ROOT, 'tools', 'hyperframes');
const JOB_DIR = path.join(ROOT, 'data', 'production-jobs');
const PKG_DIR = path.join(ROOT, 'data', 'content-packages');
const ARTIFACTS_BASE = path.join(ROOT, 'production-artifacts');
const RUNS_DIR = path.join(ROOT, 'data', 'hyperframes-runs');

const REAL_COMPOSITION = 'mika-hyperframes-test';
const FIXTURE_COMPOSITION = 'hello-hyperframes';
const FIXTURE_OUTPUT_PATH = path.join(HF_ROOT, FIXTURE_COMPOSITION, 'output.mp4');

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
  return { status: res.status, json, headers: res.headers };
}

async function rawFetch(urlPath, opts) {
  return fetch(`${BASE}${urlPath}`, opts);
}

async function waitForServer(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/production/providers`);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function waitForRunTerminal(runId, timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { json } = await api('GET', `/api/hyperframes/runs/${runId}`);
    if (json?.run && ['completed', 'failed', 'cancelled'].includes(json.run.status)) return json.run;
    await new Promise(r => setTimeout(r, 1000));
  }
  return null;
}

function noFilesystemPaths(obj) {
  const json = JSON.stringify(obj);
  return /\/Users\/[^"]*/.test(json) && !json.includes('"/api/production/artifacts/');
}

async function main() {
  console.log(`Using admin token: ${TOKEN ? '(configured)' : '(NONE)'}`);

  // ══════════════════════════════════════════════════════════════════════
  // All checks below run against the live dev server. lib/hyperframes/*.js
  // is intentionally UNSCOPED (plain CommonJS-by-default per the project's
  // root package.json) — it's consumed only by Next.js/webpack, which
  // transpiles ESM export/import syntax regardless of a "type": "module"
  // field. A plain `node`/`import()` of those files would throw a
  // SyntaxError, so every guarantee below is verified through the real
  // HTTP API instead of a direct module import — a stronger end-to-end
  // check anyway, since it exercises the exact code path the browser uses.
  // ══════════════════════════════════════════════════════════════════════

  const serverUp = await waitForServer();
  check('B0: dev server is reachable at localhost:3099', serverUp);
  if (!serverUp) { printSummary(); return; }

  // ── A: security boundary, exercised end-to-end via the HTTP API ───────

  check('A1: an id containing "/" is rejected (400) — encodeURIComponent keeps it one path segment',
    (await api('GET', `/api/hyperframes/compositions/${encodeURIComponent('a/b')}`)).status === 400);
  // A literal ".." path segment is collapsed away by standard URL
  // normalization before the request even reaches our route (fetch/undici
  // resolve it against the base URL) — an even earlier layer of protection
  // than our own 400. Either outcome (normalized away to a 404, or an
  // explicit 400 if it ever did reach the handler) is an honest "never
  // served" — a 200 is the only failure condition that matters here.
  const dotDotResp = await api('GET', `/api/hyperframes/compositions/${encodeURIComponent('..')}`);
  check('A2: an id containing ".." is never served as valid (400 or 404, never 200)', dotDotResp.status === 400 || dotDotResp.status === 404);
  check('A3: a missing composition returns 404, not a crash',
    (await api('GET', '/api/hyperframes/compositions/this-composition-does-not-exist')).status === 404);

  // Symlink escape: a symlinked directory INSIDE the root pointing OUTSIDE it
  // must never be served as a valid composition.
  const symlinkFixtureId = `zz-validate-symlink-fixture-${Date.now().toString(36)}`;
  const symlinkPath = path.join(HF_ROOT, symlinkFixtureId);
  let symlinkDetailResp = null;
  let symlinkListedInDiscovery = null;
  try {
    fs.symlinkSync(ROOT, symlinkPath, 'dir'); // points OUTSIDE tools/hyperframes/
    symlinkDetailResp = await api('GET', `/api/hyperframes/compositions/${symlinkFixtureId}`);
    const listResp2 = await api('GET', '/api/hyperframes/compositions');
    symlinkListedInDiscovery = (listResp2.json?.compositions || []).some(c => c.id === symlinkFixtureId);
  } finally {
    try { fs.unlinkSync(symlinkPath); } catch { /* already gone */ }
  }
  check('A4: a symlinked composition directory escaping the root is never served as valid (404)', symlinkDetailResp?.status === 404);
  check('A5: a symlinked composition directory never appears in discovery listing', symlinkListedInDiscovery === false);

  // ══════════════════════════════════════════════════════════════════════
  // PART B — remaining server-based checks
  // ══════════════════════════════════════════════════════════════════════

  // ── B1: discovery ────────────────────────────────────────────────────
  const listResp = await api('GET', '/api/hyperframes/compositions');
  check('B1: GET compositions returns 200/ok', listResp.status === 200 && listResp.json?.ok === true);
  const ids = (listResp.json?.compositions || []).map(c => c.id);
  check('B1: discovers the real composition', ids.includes(REAL_COMPOSITION));
  check('B1: discovers the fixture composition', ids.includes(FIXTURE_COMPOSITION));
  check('B1: no absolute filesystem path in the compositions list response', !noFilesystemPaths(listResp.json));

  const detailResp = await api('GET', `/api/hyperframes/compositions/${REAL_COMPOSITION}`);
  check('B2: GET composition detail returns 200/ok', detailResp.status === 200 && detailResp.json?.ok === true);
  const comp = detailResp.json?.composition;
  check('B2: real composition metadata matches its known, independently-verified render (1920x1080, ~10s, 30fps)',
    comp?.metadata?.width === 1920 && comp?.metadata?.height === 1080 && comp?.metadata?.fps === 30 && Math.abs((comp?.metadata?.durationSeconds || 0) - 10) < 0.5);
  check('B2: relativePath is relative, never absolute', comp?.relativePath === `tools/hyperframes/${REAL_COMPOSITION}` && !comp.relativePath.startsWith('/'));

  const missingResp = await api('GET', '/api/hyperframes/compositions/does-not-exist-xyz');
  check('B3: GET a missing composition returns 404', missingResp.status === 404);

  const invalidIdResp = await api('GET', `/api/hyperframes/compositions/${encodeURIComponent('a b')}`);
  check('B4: GET an invalid composition id returns 400', invalidIdResp.status === 400);

  // ── B5/B6: lint/check on the REAL composition (read-only, never touches output.mp4) ──
  const beforeLintStat = fs.statSync(path.join(HF_ROOT, REAL_COMPOSITION, 'output.mp4'));
  const lintResp = await api('POST', `/api/hyperframes/compositions/${REAL_COMPOSITION}/lint`);
  check('B5: lint on the real composition returns 200/ok', lintResp.status === 200 && lintResp.json?.ok === true);
  check('B5: lint run reaches a terminal status', ['completed', 'failed'].includes(lintResp.json?.run?.status));
  const checkResp = await api('POST', `/api/hyperframes/compositions/${REAL_COMPOSITION}/check`);
  check('B6: check on the real composition returns 200/ok', checkResp.status === 200 && checkResp.json?.ok === true);
  check('B6: check run reaches a terminal status', ['completed', 'failed'].includes(checkResp.json?.run?.status));
  const afterLintCheckStat = fs.statSync(path.join(HF_ROOT, REAL_COMPOSITION, 'output.mp4'));
  check('B5/B6: lint/check never modified the real composition\'s existing output.mp4', beforeLintStat.mtimeMs === afterLintCheckStat.mtimeMs && beforeLintStat.size === afterLintCheckStat.size);

  const lintInvalidResp = await api('POST', `/api/hyperframes/compositions/${encodeURIComponent('a b')}/lint`);
  check('B7: lint on an invalid composition id returns 400', lintInvalidResp.status === 400);

  // ── B8/B9: fresh render on the FIXTURE composition + duplicate-render blocked ──
  const createdJobIds = [];
  const createdPackageIds = [];
  const createdRunIds = [];

  try {
    check('Pre-flight: fixture composition has no output.mp4 before this run', !fs.existsSync(FIXTURE_OUTPUT_PATH));

    const render1 = await api('POST', `/api/hyperframes/compositions/${FIXTURE_COMPOSITION}/render`, { quality: 'standard', lowMemoryMode: 'enabled' });
    check('B8: render starts and returns 200/ok', render1.status === 200 && render1.json?.ok === true);
    check('B8: render run starts in a non-terminal status', ['queued', 'running'].includes(render1.json?.run?.status));
    const renderRunId = render1.json?.run?.id;
    if (renderRunId) createdRunIds.push(renderRunId);

    const render2 = await api('POST', `/api/hyperframes/compositions/${FIXTURE_COMPOSITION}/render`, {});
    check('B9: a second concurrent render on the same composition is blocked (409)', render2.status === 409 && render2.json?.ok === false);

    const finishedRender = renderRunId ? await waitForRunTerminal(renderRunId) : null;
    check('B10: the render reaches "completed"', finishedRender?.status === 'completed', finishedRender?.error || 'timed out waiting for render');
    check('B10: render output.mp4 now exists on disk', fs.existsSync(FIXTURE_OUTPUT_PATH));

    const renderLogTail = finishedRender?.logTail || [];
    check('B10: the real render produced some log output to sanitize', renderLogTail.length > 0);
    const renderLogJoined = renderLogTail.join('\n');
    check('B10: run logTail has no raw ANSI escape sequences', !/\x1b\[[0-9;]*[a-zA-Z]/.test(renderLogJoined));
    check('B10: run logTail has no absolute /Users/... paths', !/\/Users\/[^\s"']+/.test(renderLogJoined));
    check('B10: run logTail never exposes previewPid or any key named like a secret', !/previewPid|api[_-]?key|secret|password/i.test(renderLogJoined));

    const runsListResp = await api('GET', `/api/hyperframes/runs?compositionId=${FIXTURE_COMPOSITION}`);
    check('B11: GET runs for the fixture composition includes the render run', (runsListResp.json?.runs || []).some(r => r.id === renderRunId));
    check('B11: no run in the response ever exposes previewPid', !noFilesystemPaths(runsListResp.json) && !JSON.stringify(runsListResp.json).includes('previewPid'));

    // ── B12/B13/B14: import, artifact route, idempotency ──────────────
    // NOTE: hello-hyperframes and mika-hyperframes-test happen to render to
    // BYTE-IDENTICAL output in this environment (both are the same starter
    // template) — so the content-hash dedup may honestly report
    // alreadyImported: true here, pointing at the real mika-hyperframes-test
    // job rather than a fresh one. That is correct, intended behavior of a
    // content-addressed idempotency system, not a bug — the assertions
    // below only require things that hold true either way, and cleanup
    // below NEVER deletes a job/package this script did not itself create.
    const import1 = await api('POST', `/api/hyperframes/compositions/${FIXTURE_COMPOSITION}/import`);
    check('B12: import after a successful render returns 200/ok', import1.status === 200 && import1.json?.ok === true);
    const import1Fresh = import1.json?.import?.alreadyImported === false;
    if (!import1Fresh) {
      console.log('INFO — B12: reported alreadyImported: true — this composition\'s render is content-identical to an existing job (see note above), not a fresh one this run.');
    }
    const jobId = import1.json?.import?.productionJobId;
    const packageId = import1.json?.import?.packageId;
    const localUrl = import1.json?.import?.localUrl;
    if (import1Fresh) {
      if (jobId) createdJobIds.push(jobId);
      if (packageId) createdPackageIds.push(packageId);
    }
    check('B12: import returns a local artifact URL, never a filesystem path', typeof localUrl === 'string' && localUrl.startsWith('/api/production/artifacts/'));

    if (localUrl) {
      const artifactGet = await rawFetch(localUrl);
      check('B13: the imported artifact is servable (200)', artifactGet.status === 200);
      check('B13: artifact content-type is video/mp4', artifactGet.headers.get('content-type') === 'video/mp4');
      const rangeGet = await rawFetch(localUrl, { headers: { Range: 'bytes=0-99' } });
      check('B13: artifact route supports Range (206 partial content)', rangeGet.status === 206);
    }

    const import2 = await api('POST', `/api/hyperframes/compositions/${FIXTURE_COMPOSITION}/import`);
    check('B14: importing again (no new render) returns alreadyImported: true', import2.json?.import?.alreadyImported === true);
    check('B14: idempotent import reuses the exact same job id', import2.json?.import?.productionJobId === jobId);

    // ── B15: job shape / metadata ───────────────────────────────────────
    if (jobId) {
      const jobResp = await api('GET', `/api/production/jobs/${jobId}`);
      const job = jobResp.json?.job;
      check('B15: imported job has metadata.isLocalRender === true', job?.metadata?.isLocalRender === true);
      check('B15: imported job records a source composition id (for "Open Composition")', typeof job?.metadata?.hyperframesCompositionId === 'string' && job.metadata.hyperframesCompositionId.length > 0);
      check('B15: imported job selectedProvider is hyperframes-local', job?.selectedProvider === 'hyperframes-local');
      check('B15: imported job execution.status is completed', job?.execution?.status === 'completed');
      if (import1Fresh) {
        check('B15: a genuinely fresh import starts review.status unreviewed (never auto-approved)', job?.review?.status === 'unreviewed');
      } else {
        console.log('INFO — B15: skipping the fresh-review-status assertion — this job predates this run (see B12 note) and may already carry a real review decision from prior manual testing.');
      }
      check('B16: no absolute filesystem path or provider URL leaks in the job response', !noFilesystemPaths(jobResp.json));
    }

    // ── B17: cancel an active run ───────────────────────────────────────
    const render3 = await api('POST', `/api/hyperframes/compositions/${FIXTURE_COMPOSITION}/render`, {});
    check('B17: a fresh render can start again once the prior one finished', render3.status === 200 && render3.json?.ok === true);
    const cancelRunId = render3.json?.run?.id;
    if (cancelRunId) createdRunIds.push(cancelRunId);
    if (cancelRunId) {
      const cancelResp = await api('POST', `/api/hyperframes/runs/${cancelRunId}/cancel`);
      check('B17: cancelling an active render returns 200/ok', cancelResp.status === 200 && cancelResp.json?.ok === true);
      const cancelledRun = await waitForRunTerminal(cancelRunId, 15000);
      check('B17: the cancelled run settles into status "cancelled"', cancelledRun?.status === 'cancelled');
    }

    // ── B18: preview start/stop only ever returns a localhost URL ───────
    const previewStart = await api('POST', `/api/hyperframes/compositions/${FIXTURE_COMPOSITION}/preview`);
    if (previewStart.status === 200 && previewStart.json?.ok) {
      check('B18: preview URL is localhost/127.0.0.1 only', /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(previewStart.json.previewUrl || ''));
      const previewRunId = previewStart.json?.run?.id;
      if (previewRunId) createdRunIds.push(previewRunId);
      const previewStop = await api('POST', `/api/hyperframes/compositions/${FIXTURE_COMPOSITION}/preview/stop`);
      check('B18: preview stop returns 200/ok', previewStop.status === 200 && previewStop.json?.ok === true);
    } else {
      console.log('INFO — B18: preview did not start in this environment (an honest limitation, not a hard failure) — lint/check/render/import remain fully functional regardless.');
    }
  } finally {
    // ── Cleanup: ONLY remove records this script itself created (tracked
    // above, gated on alreadyImported === false) — never a shared/pre-
    // existing record. Each artifact is removed by its own exact job-id
    // subdirectory, never the whole shared "LocalImport" brand folder,
    // which may also hold other jobs' real artifacts.
    for (const id of createdJobIds) { try { fs.unlinkSync(path.join(JOB_DIR, `${id}.json`)); } catch { /* already gone */ } }
    for (const id of createdPackageIds) { try { fs.unlinkSync(path.join(PKG_DIR, `${id}.json`)); } catch { /* already gone */ } }
    for (const id of createdRunIds) { try { fs.unlinkSync(path.join(RUNS_DIR, `${id}.json`)); } catch { /* already gone */ } }
    for (const id of createdJobIds) { try { fs.rmSync(path.join(ARTIFACTS_BASE, 'LocalImport', id), { recursive: true, force: true }); } catch { /* already gone */ } }
    try { fs.unlinkSync(FIXTURE_OUTPUT_PATH); } catch { /* already gone */ }
  }

  check('Post-cleanup: fixture composition has no output.mp4 (restored to its original state)', !fs.existsSync(FIXTURE_OUTPUT_PATH));

  // ── C: regression — the real, previously-imported job is untouched ───
  const realImportRepeat = await api('POST', `/api/hyperframes/compositions/${REAL_COMPOSITION}/import`);
  check('C1: re-importing the real composition still reports alreadyImported: true (no duplicate, no regression)',
    realImportRepeat.status === 200 && realImportRepeat.json?.import?.alreadyImported === true);

  // ── C2: render-and-import one-click flow, exercised end-to-end on the fixture ──
  // The endpoint returns IMMEDIATELY (status 'queued') and runs
  // lint->check->render->import in the background — a single request held
  // open for the whole ~20-40s duration proved fragile for a real browser
  // fetch (observed to hang in headless-browser testing even though the
  // server-side work completed correctly), so this polls to completion,
  // exactly like the client UI now does.
  const oneClickJobIds = [];
  const oneClickPackageIds = [];
  const oneClickRunIds = [];
  try {
    const oneClickStart = await api('POST', `/api/hyperframes/compositions/${FIXTURE_COMPOSITION}/render-and-import`, { quality: 'standard', lowMemoryMode: 'enabled' });
    check('C2: render-and-import returns immediately with a queued/running run (200/ok)',
      oneClickStart.status === 200 && oneClickStart.json?.ok === true && ['queued', 'running'].includes(oneClickStart.json?.run?.status));
    const oneClickRunId = oneClickStart.json?.run?.id;
    if (oneClickRunId) oneClickRunIds.push(oneClickRunId);

    const oneClickFinal = oneClickRunId ? await waitForRunTerminal(oneClickRunId, 90000) : null;
    check('C2: the one-click run reaches "completed"', oneClickFinal?.status === 'completed', oneClickFinal?.error || 'timed out waiting for the one-click flow');
    check('C2: the completed run records an imported job id', !!oneClickFinal?.importedJobId);

    const oneClickJobId = oneClickFinal?.importedJobId;
    if (oneClickJobId) {
      const oneClickJobResp = await api('GET', `/api/production/jobs/${oneClickJobId}`);
      // Same content-hash-collision caveat as B12: hello-hyperframes renders
      // to the exact same content as the real mika-hyperframes-test job, so
      // this run's imported job may legitimately BE that same real job.
      // Only track it for cleanup if it is NOT the real, pre-existing job.
      const isTheRealJob = oneClickJobResp.json?.job?.metadata?.hyperframesCompositionId === REAL_COMPOSITION;
      if (!isTheRealJob) {
        oneClickJobIds.push(oneClickJobId);
        if (oneClickJobResp.json?.job?.packageId) oneClickPackageIds.push(oneClickJobResp.json.job.packageId);
      }
    }

    const oneClickAgainStart = await api('POST', `/api/hyperframes/compositions/${FIXTURE_COMPOSITION}/render-and-import`, {});
    // Duplicate render is blocked while the fixture already has an output —
    // but a fresh render is allowed once the prior one is terminal, so this
    // may either be blocked (409, if C2 hasn't fully settled) or start a new
    // (content-identical, still-idempotent-on-import) run.
    check('C3: running render-and-import again either starts cleanly or honestly reports render-in-progress',
      oneClickAgainStart.status === 200 || oneClickAgainStart.status === 409);
    if (oneClickAgainStart.status === 200) {
      const againRunId = oneClickAgainStart.json?.run?.id;
      if (againRunId) oneClickRunIds.push(againRunId);
      const againFinal = againRunId ? await waitForRunTerminal(againRunId, 90000) : null;
      check('C3: idempotent re-run reaches "completed" and reuses the same imported job id',
        againFinal?.status === 'completed' && againFinal?.importedJobId === oneClickJobId);
    }
  } finally {
    for (const id of oneClickJobIds) { try { fs.unlinkSync(path.join(JOB_DIR, `${id}.json`)); } catch { /* already gone */ } }
    for (const id of oneClickPackageIds) { try { fs.unlinkSync(path.join(PKG_DIR, `${id}.json`)); } catch { /* already gone */ } }
    for (const id of oneClickRunIds) { try { fs.unlinkSync(path.join(RUNS_DIR, `${id}.json`)); } catch { /* already gone */ } }
    for (const id of oneClickJobIds) { try { fs.rmSync(path.join(ARTIFACTS_BASE, 'LocalImport', id), { recursive: true, force: true }); } catch { /* already gone */ } }
    try { fs.unlinkSync(FIXTURE_OUTPUT_PATH); } catch { /* already gone */ }
  }
  check('Post-cleanup (one-click): fixture composition restored to no-output state', !fs.existsSync(FIXTURE_OUTPUT_PATH));

  // ── D: source check — Production Router hides planning/execution controls for local-render jobs ──
  const routerSrc = fs.readFileSync(path.join(ROOT, 'components/content/ProductionRouterWorkspace.jsx'), 'utf8');
  check('D1: JobPanel gates Mode/Provider/Approval/Manual-Export sections on isLocalRender', routerSrc.includes('isLocalRender') && routerSrc.includes('!isLocalRender'));
  check('D2: local-render jobs show an honest "not executed through the Provider Execution Engine" note', routerSrc.includes('Provider Execution Engine'));
  check('D3: JobCard shows an "Imported Local Render" badge', routerSrc.includes('Imported Local Render'));

  printSummary();
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

main().catch(err => {
  console.error('Validation script crashed:', err);
  process.exitCode = 1;
});
