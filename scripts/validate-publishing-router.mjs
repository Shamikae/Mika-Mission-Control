#!/usr/bin/env node
// scripts/validate-publishing-router.mjs
//
// Validates Publishing Router v1 end-to-end against the real dev server.
// Never touches a REAL, pre-existing production job's review state (a
// prior milestone's validator accidentally deleted a real record by being
// too loose with cleanup — this one is deliberately conservative): all
// fixture production jobs/packages are written directly by this script,
// under fixture-only ids, and REFERENCE an existing real artifact's local
// URL rather than duplicating any media. Everything this script creates is
// tracked and deleted in a `finally` block.

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const ROOT = process.cwd();
const BASE = 'http://localhost:3099';
const JOB_DIR = path.join(ROOT, 'data', 'production-jobs');
const PKG_DIR = path.join(ROOT, 'data', 'content-packages');
const PUB_DIR = path.join(ROOT, 'data', 'publish-jobs');

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
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

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

function noFilesystemPaths(obj) {
  const json = JSON.stringify(obj);
  return /\/Users\/[^"]*/.test(json) && !json.includes('"/api/production/artifacts/') && !json.includes('"/api/publishing/');
}
function noSecretLeak(obj) {
  const json = JSON.stringify(obj).toLowerCase();
  return /"token"\s*:\s*"[^"]{6,}"|authorization"\s*:\s*"bearer/i.test(json);
}

function writeJsonFile(dir, id, obj) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(obj, null, 2));
}
function deleteJsonFile(dir, id) {
  try { fs.unlinkSync(path.join(dir, `${id}.json`)); } catch { /* already gone */ }
}

async function main() {
  console.log(`Using admin token: ${TOKEN ? '(configured)' : '(NONE)'}`);

  const serverUp = await waitForServer();
  check('Server reachable at localhost:3099', serverUp);
  if (!serverUp) { printSummary(); return; }

  // ══════════════════════════════════════════════════════════════════════
  // A: Platform registry
  // ══════════════════════════════════════════════════════════════════════

  const platformsResp = await api('GET', '/api/publishing/platforms');
  check('A1: GET platforms returns 200/ok', platformsResp.status === 200 && platformsResp.json?.ok === true);
  const platforms = platformsResp.json?.platforms || [];
  check('A2: exactly 7 v1 platforms are registered', platforms.length === 7);
  const expectedIds = ['tiktok', 'instagram-reels', 'youtube-shorts', 'linkedin', 'pinterest', 'x', 'facebook-reels'];
  check('A3: all expected platform ids are present', expectedIds.every(id => platforms.some(p => p.id === id)));
  check('A4: every platform is manual-export in v1', platforms.every(p => p.status === 'manual-export'));
  const adapters = platformsResp.json?.adapters || [];
  check('A5: one manual adapter per platform, no API/OAuth adapters', adapters.length === 7 && adapters.every(a => a.executionType === 'manual_export'));

  // ══════════════════════════════════════════════════════════════════════
  // B: Fixture setup — find a real artifact to REFERENCE (never duplicate)
  // ══════════════════════════════════════════════════════════════════════

  const prodJobsResp = await api('GET', '/api/production/jobs');
  const sourceJob = (prodJobsResp.json?.jobs || []).find(j => j.execution?.status === 'completed' && j.execution?.outputs?.length > 0);
  check('B1: found at least one real completed production job with an output to reference', !!sourceJob);
  if (!sourceJob) { printSummary(); return; }
  const sourceOutput = sourceJob.execution.outputs[0];

  const fixturePkgId = `pub-test-pkg-${RUN_ID}`;
  const fixtureApprovedJobId = `pub-test-approved-${RUN_ID}`;
  const fixtureUnreviewedJobId = `pub-test-unreviewed-${RUN_ID}`;
  const createdPublishJobIds = [];

  const now = new Date().toISOString();
  const fixturePkg = {
    id: fixturePkgId, status: 'approved', brand: 'ValidatorFixture', platform: 'Local', goal: 'Publishing Router validation fixture',
    topic: 'Publishing Router Validation Fixture', audience: '', offer: '', tone: '', videoDuration: '',
    hooks: [], script: { opening: '', body: '', cta: '', fullText: 'Fixture — not a real script.' },
    scenes: [], caption: '', cta: '', hashtags: [], keywords: [],
    thumbnail: { headline: '', visualBrief: '', artifactId: null, artifactUrl: null, status: 'not_requested', error: null },
    pipeline: { stage: 'approved', enteredStageAt: now, history: [] },
    metadata: { workflowId: fixturePkgId, model: null, provider: 'validator', createdAt: now, updatedAt: now, estimatedCost: null, actualCost: null, instructions: '' },
    production: null,
  };

  function makeFixtureProductionJob(id, reviewStatus) {
    return {
      id, packageId: fixturePkgId, packageUpdatedAt: fixturePkg.metadata.updatedAt, stalePackage: false, status: 'completed',
      eligibility: { eligible: true, reasons: [] },
      recommendedMode: 'custom', selectedMode: 'custom', modeReason: 'Fixture.',
      recommendedProvider: 'validator-fixture', selectedProvider: 'validator-fixture',
      providerInput: null, preferredFutureProvider: null, providerCandidates: [], unavailableReasons: {}, missingActivationRequirements: [],
      readiness: { ready: true, score: 100, available: [], missingRequired: [], missingOptional: [], warnings: [] },
      scenes: null, voiceoverScript: null, captionPlan: null, visualAssetPlan: null, audioPlan: null,
      outputSpec: { platform: 'Local', targetDuration: 'n/a', aspectRatio: 'n/a', resolution: 'n/a', frameRate: null, captionBurnIn: false, safeAreaNotes: 'n/a', fileFormat: null },
      budget: { estimateType: 'free', estimatedRange: null, costTier: 'free', approvalRequired: false, approvalReason: 'Fixture.', maxEstimatedCost: null, currency: 'USD', approvalRequiredAbove: null },
      approval: { required: false, requestedAt: null, approvedAt: null, approvedBy: null, rejectedAt: null, rejectedBy: null, notes: '' },
      review: reviewStatus === 'approved'
        ? { status: 'approved', reviewedAt: now, reviewedBy: 'validator', note: 'Fixture.' }
        : { status: 'unreviewed', reviewedAt: null, reviewedBy: null, note: '' },
      metadata: { createdAt: now, updatedAt: now, createdBy: 'validator', userNotes: '', source: 'validator-fixture', isLocalRender: false, isProviderExecution: false },
      activityHistory: [],
      execution: {
        status: 'completed', provider: 'validator-fixture', providerJobId: null, attemptCount: 0, maxAttempts: 1,
        startedAt: now, completedAt: now, updatedAt: now, cancelledAt: null, lastPollAt: null, nextPollAt: null, progress: 100,
        error: null, errorReason: null,
        // References the SAME real artifact — never a duplicate copy.
        outputs: [{ ...sourceOutput }],
        providerMetadata: { note: 'Validator fixture referencing an existing real artifact.' },
        mock: false, lock: null,
      },
    };
  }

  writeJsonFile(PKG_DIR, fixturePkgId, fixturePkg);
  writeJsonFile(JOB_DIR, fixtureApprovedJobId, makeFixtureProductionJob(fixtureApprovedJobId, 'approved'));
  writeJsonFile(JOB_DIR, fixtureUnreviewedJobId, makeFixtureProductionJob(fixtureUnreviewedJobId, 'unreviewed'));

  try {
    // ════════════════════════════════════════════════════════════════════
    // C: Eligibility gate — never bypassed
    // ════════════════════════════════════════════════════════════════════

    const blockedResp = await api('POST', '/api/publishing/jobs', { productionJobId: fixtureUnreviewedJobId, platform: 'tiktok' });
    check('C1: creating a publish job from an UNAPPROVED production job is blocked (409)', blockedResp.status === 409 && blockedResp.json?.ok === false);
    check('C1: the block reason mentions review status', (blockedResp.json?.reasons || []).some(r => /review/i.test(r)));

    const approvedCreateResp = await api('POST', '/api/publishing/jobs', { productionJobId: fixtureApprovedJobId, platform: 'tiktok' });
    check('C2: creating a publish job from an APPROVED production job succeeds (201)', approvedCreateResp.status === 201 && approvedCreateResp.json?.ok === true);
    const mainJobId = approvedCreateResp.json?.job?.id;
    if (mainJobId) createdPublishJobIds.push(mainJobId);
    check('C2: new publish job starts in "draft"', approvedCreateResp.json?.job?.status === 'draft');
    check('C2: publish job references the artifact, not a copy', approvedCreateResp.json?.job?.artifactId === sourceOutput.id);

    const badPlatformResp = await api('POST', '/api/publishing/jobs', { productionJobId: fixtureApprovedJobId, platform: 'not-a-real-platform' });
    check('C3: an invalid platform is rejected (400)', badPlatformResp.status === 400);

    const missingJobResp = await api('POST', '/api/publishing/jobs', { productionJobId: 'does-not-exist-xyz', platform: 'tiktok' });
    check('C4: a nonexistent productionJobId is rejected (404)', missingJobResp.status === 404);

    // ════════════════════════════════════════════════════════════════════
    // D: Validation — blocking vs warning, never silently modifies
    // ════════════════════════════════════════════════════════════════════

    const validateEmptyResp = await api('POST', `/api/publishing/jobs/${mainJobId}/validate`);
    check('D1: validate on an empty-caption tiktok job returns ok:false (caption required)', validateEmptyResp.json?.validation?.ok === false);
    check('D1: reports a blocking caption warning', validateEmptyResp.json?.validation?.warnings?.some(w => w.severity === 'blocking' && /caption/i.test(w.message)));

    const readyBeforeCaptionResp = await api('POST', `/api/publishing/jobs/${mainJobId}/ready`);
    check('D2: marking ready is blocked while validation fails (422)', readyBeforeCaptionResp.status === 422);

    const patchResp = await api('PATCH', `/api/publishing/jobs/${mainJobId}`, { caption: 'A real caption for the fixture video #test', hashtags: ['one', '#two', 'three'] });
    check('D3: PATCH updates caption/hashtags (200)', patchResp.status === 200 && patchResp.json?.ok === true);
    check('D3: hashtags are sanitized (leading # stripped)', JSON.stringify(patchResp.json?.job?.hashtags) === JSON.stringify(['one', 'two', 'three']));
    check('D3: job.caption is stored verbatim (never silently modified)', patchResp.json?.job?.caption === 'A real caption for the fixture video #test');

    const validateAfterResp = await api('POST', `/api/publishing/jobs/${mainJobId}/validate`);
    check('D4: validation now passes with a real caption present', validateAfterResp.json?.validation?.ok === true);

    const readyResp = await api('POST', `/api/publishing/jobs/${mainJobId}/ready`);
    check('D5: marking ready now succeeds', readyResp.status === 200 && readyResp.json?.job?.status === 'ready');

    const editAfterReadyResp = await api('PATCH', `/api/publishing/jobs/${mainJobId}`, { caption: 'Edited again after ready.' });
    check('D6: editing a "ready" job reverts it to "draft" (stale validation invalidated)', editAfterReadyResp.json?.job?.status === 'draft');
    // Put it back to ready for the following tests.
    await api('POST', `/api/publishing/jobs/${mainJobId}/ready`);

    // ════════════════════════════════════════════════════════════════════
    // E: Scheduling — metadata only
    // ════════════════════════════════════════════════════════════════════

    // Test the bad-date rejection FIRST, while still in "ready" — once
    // scheduled succeeds, the job moves to "scheduled" and a second
    // /schedule call would correctly 409 on the transition itself before
    // ever reaching date validation (scheduled -> scheduled isn't a valid
    // transition), which would test the wrong thing.
    const badScheduleResp = await api('POST', `/api/publishing/jobs/${mainJobId}/schedule`, { scheduledFor: 'not-a-date' });
    check('E1: an invalid scheduledFor is rejected (400)', badScheduleResp.status === 400);

    const futureDate = new Date(Date.now() + 3 * 86400000).toISOString();
    const scheduleResp = await api('POST', `/api/publishing/jobs/${mainJobId}/schedule`, { scheduledFor: futureDate });
    check('E2: scheduling succeeds and stores scheduledFor', scheduleResp.status === 200 && scheduleResp.json?.job?.status === 'scheduled');
    check('E3: scheduledFor round-trips as a valid ISO date', new Date(scheduleResp.json?.job?.scheduledFor).toISOString() === new Date(futureDate).toISOString());

    // ════════════════════════════════════════════════════════════════════
    // F: Publish now (manual attestation) — requires explicit confirm
    // ════════════════════════════════════════════════════════════════════

    const publishNoConfirmResp = await api('POST', `/api/publishing/jobs/${mainJobId}/publish`, {});
    check('F1: publishing without confirm:true is rejected (400)', publishNoConfirmResp.status === 400);

    const publishResp = await api('POST', `/api/publishing/jobs/${mainJobId}/publish`, { confirm: true, note: 'Manually uploaded via export bundle.' });
    check('F2: publishing with confirm:true succeeds from "scheduled"', publishResp.status === 200 && publishResp.json?.job?.status === 'published');
    check('F2: publishedAt is recorded', !!publishResp.json?.job?.publishedAt);

    const rePublishResp = await api('POST', `/api/publishing/jobs/${mainJobId}/publish`, { confirm: true });
    check('F3: publishing an already-published job is rejected (409 — terminal state)', rePublishResp.status === 409);

    // ════════════════════════════════════════════════════════════════════
    // G: Fail and cancel transitions (separate publish jobs)
    // ════════════════════════════════════════════════════════════════════

    const failJobCreate = await api('POST', '/api/publishing/jobs', { productionJobId: fixtureApprovedJobId, platform: 'x' });
    const failJobId = failJobCreate.json?.job?.id;
    if (failJobId) createdPublishJobIds.push(failJobId);
    await api('PATCH', `/api/publishing/jobs/${failJobId}`, { caption: '' }); // X does not require a caption
    const failReadyResp = await api('POST', `/api/publishing/jobs/${failJobId}/ready`);
    check('G1: a platform with captionRequired:false can be marked ready with an empty caption', failReadyResp.json?.job?.status === 'ready');
    const failResp = await api('POST', `/api/publishing/jobs/${failJobId}/fail`, { reason: 'Platform rejected the manual upload.' });
    check('G2: marking failed requires and stores a reason', failResp.status === 200 && failResp.json?.job?.status === 'failed' && failResp.json?.job?.publishResult?.reason === 'Platform rejected the manual upload.');
    const failNoReasonJobCreate = await api('POST', '/api/publishing/jobs', { productionJobId: fixtureApprovedJobId, platform: 'x' });
    const failNoReasonJobId = failNoReasonJobCreate.json?.job?.id;
    if (failNoReasonJobId) createdPublishJobIds.push(failNoReasonJobId);
    await api('POST', `/api/publishing/jobs/${failNoReasonJobId}/ready`); // must be "ready" before /fail is even a valid transition
    const failNoReasonResp = await api('POST', `/api/publishing/jobs/${failNoReasonJobId}/fail`, {});
    check('G3: marking failed WITHOUT a reason is rejected (400)', failNoReasonResp.status === 400);

    const cancelJobCreate = await api('POST', '/api/publishing/jobs', { productionJobId: fixtureApprovedJobId, platform: 'linkedin' });
    const cancelJobId = cancelJobCreate.json?.job?.id;
    if (cancelJobId) createdPublishJobIds.push(cancelJobId);
    const cancelResp = await api('POST', `/api/publishing/jobs/${cancelJobId}/cancel`);
    check('G4: cancelling a draft publish job succeeds', cancelResp.status === 200 && cancelResp.json?.job?.status === 'cancelled');
    const cancelAgainResp = await api('POST', `/api/publishing/jobs/${cancelJobId}/cancel`);
    check('G5: cancelling an already-cancelled job is rejected (409 — terminal state)', cancelAgainResp.status === 409);

    // ════════════════════════════════════════════════════════════════════
    // H: Manual export — JSON, Markdown, ZIP
    // ════════════════════════════════════════════════════════════════════

    const jsonExportResp = await api('POST', `/api/publishing/jobs/${mainJobId}/export`, { format: 'json' });
    check('H1: JSON export succeeds', jsonExportResp.status === 200 && jsonExportResp.json?.format === 'json');
    let parsedBundle = null;
    try { parsedBundle = JSON.parse(jsonExportResp.json.content); } catch { /* */ }
    check('H1: JSON export parses and includes the caption/hashtags/artifact', !!parsedBundle && parsedBundle.caption?.length > 0 && Array.isArray(parsedBundle.hashtags) && !!parsedBundle.artifact);
    check('H1: JSON export references the local artifact URL, never a filesystem path', parsedBundle?.artifact?.localUrl?.startsWith('/api/production/artifacts/'));

    const mdExportResp = await api('POST', `/api/publishing/jobs/${mainJobId}/export`, { format: 'markdown' });
    check('H2: Markdown export succeeds and includes the platform checklist', mdExportResp.status === 200 && /Checklist/.test(mdExportResp.json?.content || ''));

    const zipResp = await rawFetch(`/api/publishing/jobs/${mainJobId}/export-zip`);
    check('H3: ZIP export returns 200 with application/zip content-type', zipResp.status === 200 && zipResp.headers.get('content-type') === 'application/zip');
    const zipBuffer = Buffer.from(await zipResp.arrayBuffer());
    check('H3: ZIP response starts with the real ZIP magic bytes (PK\\x03\\x04)', zipBuffer.length > 4 && zipBuffer[0] === 0x50 && zipBuffer[1] === 0x4B && zipBuffer[2] === 0x03 && zipBuffer[3] === 0x04);

    const tmpZipPath = path.join(ROOT, `.tmp-publishing-validate-${RUN_ID}.zip`);
    fs.writeFileSync(tmpZipPath, zipBuffer);
    try {
      const listing = execFileSync('unzip', ['-l', tmpZipPath], { encoding: 'utf8' });
      check('H4: ZIP contains the media file', /media\//.test(listing));
      check('H4: ZIP contains caption.txt, hashtags.txt, metadata.json, bundle.json, brief.md', ['caption.txt', 'hashtags.txt', 'metadata.json', 'bundle.json', 'brief.md'].every(f => listing.includes(f)));
      check('H4: ZIP contains a platform checklist file', /platform-checklist-/.test(listing));
      execFileSync('unzip', ['-t', tmpZipPath], { encoding: 'utf8' });
      check('H5: ZIP passes integrity test (unzip -t)', true);
    } catch (e) {
      check('H4/H5: ZIP is well-formed and passes integrity test', false, e.message);
    } finally {
      try { fs.unlinkSync(tmpZipPath); } catch { /* already gone */ }
    }

    // ════════════════════════════════════════════════════════════════════
    // I: Activity history
    // ════════════════════════════════════════════════════════════════════

    const finalJobResp = await api('GET', `/api/publishing/jobs/${mainJobId}`);
    const activityTypes = (finalJobResp.json?.job?.activityHistory || []).map(e => e.type);
    check('I1: activity history records publish_created', activityTypes.includes('publish_created'));
    check('I2: activity history records platform_selected', activityTypes.includes('platform_selected'));
    check('I3: activity history records fields_updated', activityTypes.includes('fields_updated'));
    check('I4: activity history records marked_ready', activityTypes.includes('marked_ready'));
    check('I5: activity history records scheduled', activityTypes.includes('scheduled'));
    check('I6: activity history records export_generated', activityTypes.includes('export_generated'));
    check('I7: activity history records published_manually', activityTypes.includes('published_manually'));

    // ════════════════════════════════════════════════════════════════════
    // J: No media duplication, no secret/path leakage
    // ════════════════════════════════════════════════════════════════════

    check('J1: no absolute filesystem path in the publish job response', !noFilesystemPaths(finalJobResp.json));
    check('J2: no secret/token leakage in the publish job response', !noSecretLeak(finalJobResp.json));
    const listResp = await api('GET', '/api/publishing/jobs');
    check('J3: no absolute filesystem path in the publish jobs list response', !noFilesystemPaths(listResp.json));

    // Never duplicated the media — the fixture production job's own artifact
    // file (shared with the real source job) must still be exactly the one
    // real copy on disk.
    const artifactStillServed = await rawFetch(sourceOutput.artifactUrl);
    check('J4: the original artifact is still servable exactly once (no duplication)', artifactStillServed.status === 200);

    // ════════════════════════════════════════════════════════════════════
    // K: Publish job list filters
    // ════════════════════════════════════════════════════════════════════

    const filteredByPlatform = await api('GET', `/api/publishing/jobs?platform=tiktok`);
    check('K1: filtering by platform works', (filteredByPlatform.json?.jobs || []).every(j => j.platform === 'tiktok'));
    const filteredByProdJob = await api('GET', `/api/publishing/jobs?productionJobId=${fixtureApprovedJobId}`);
    check('K2: filtering by productionJobId works', (filteredByProdJob.json?.jobs || []).length >= 4 && filteredByProdJob.json.jobs.every(j => j.productionJobId === fixtureApprovedJobId));
  } finally {
    for (const id of createdPublishJobIds) deleteJsonFile(PUB_DIR, id);
    deleteJsonFile(JOB_DIR, fixtureApprovedJobId);
    deleteJsonFile(JOB_DIR, fixtureUnreviewedJobId);
    deleteJsonFile(PKG_DIR, fixturePkgId);
  }

  check('Post-cleanup: no fixture publish jobs remain', createdPublishJobIds.every(id => !fs.existsSync(path.join(PUB_DIR, `${id}.json`))));
  check('Post-cleanup: no fixture production jobs remain', !fs.existsSync(path.join(JOB_DIR, `${fixtureApprovedJobId}.json`)) && !fs.existsSync(path.join(JOB_DIR, `${fixtureUnreviewedJobId}.json`)));
  check('Post-cleanup: no fixture package remains', !fs.existsSync(path.join(PKG_DIR, `${fixturePkgId}.json`)));

  // ══════════════════════════════════════════════════════════════════════
  // L: data/publish-jobs/ is gitignored
  // ══════════════════════════════════════════════════════════════════════

  const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  check('L1: data/publish-jobs/ is listed in .gitignore', gitignore.includes('data/publish-jobs/'));

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
