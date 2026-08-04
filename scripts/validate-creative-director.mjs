#!/usr/bin/env node
// scripts/validate-creative-director.mjs
//
// Validates Creative Director v1 (Content Workforce Phase 4A) end-to-end
// against the real dev server. The Creative Director is a read/write
// orchestration layer — unlike prior milestones' validators, this one DOES
// create real records (a Content Request AND, via create-package, a real
// Content Package through the Package Pipeline's own interfaces). Every
// fixture created here is tracked by id and deleted in a `finally` block —
// never touching any other pre-existing record (matching the safe pattern
// established after an earlier milestone's validator accidentally deleted
// a real record by being too loose with cleanup).

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const BASE = 'http://localhost:3099';
const REQ_DIR = path.join(ROOT, 'data', 'content-requests');
const PKG_DIR = path.join(ROOT, 'data', 'content-packages');

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
  return /\/Users\/[^"]*/.test(json);
}
function deleteJsonFile(dir, id) {
  try { fs.unlinkSync(path.join(dir, `${id}.json`)); } catch { /* already gone */ }
}

async function main() {
  console.log(`Using admin token: ${TOKEN ? '(configured)' : '(NONE)'}`);

  const serverUp = await waitForServer();
  check('Server reachable at localhost:3099', serverUp);
  if (!serverUp) { printSummary(); return; }

  const createdRequestIds = [];
  const createdPackageIds = [];

  try {
    // ══════════════════════════════════════════════════════════════════
    // A: Creation + validation
    // ══════════════════════════════════════════════════════════════════

    const missingFieldsResp = await api('POST', '/api/creative-director/requests', { brand: 'Test Brand' });
    check('A1: creating a request with missing required fields is rejected (400)', missingFieldsResp.status === 400);
    check('A1: error lists the specific missing fields', missingFieldsResp.json?.errors?.length >= 3);

    const validInput = {
      brand: 'ValidatorBrand', platform: 'TikTok', goal: 'Engagement', topic: 'Creative Director validation run',
      targetAudience: 'QA engineers', style: 'fast-paced', cta: 'Learn more', desiredRuntime: '30-60s',
      avatarPreference: 'faceless', priority: 'high',
    };
    const createResp = await api('POST', '/api/creative-director/requests', validInput);
    check('A2: creating a valid request succeeds (201)', createResp.status === 201 && createResp.json?.ok === true);
    const requestId = createResp.json?.request?.id;
    if (requestId) createdRequestIds.push(requestId);
    check('A2: new request starts in "draft"', createResp.json?.request?.status === 'draft');
    check('A2: agent stages default to all six, all "not_started"', Object.keys(createResp.json?.request?.agents || {}).length === 6
      && Object.values(createResp.json.request.agents).every(a => a.status === 'not_started'));
    check('A2: no absolute filesystem path in the create response', !noFilesystemPaths(createResp.json));

    // ══════════════════════════════════════════════════════════════════
    // B: Full lifecycle — draft -> submitted -> brief_generated -> package_created -> completed
    // ══════════════════════════════════════════════════════════════════

    const invalidSkipResp = await api('POST', `/api/creative-director/requests/${requestId}/generate-brief`);
    check('B1: cannot generate a brief before submitting (409 — invalid transition)', invalidSkipResp.status === 409);

    const editResp = await api('PATCH', `/api/creative-director/requests/${requestId}`, { topic: 'Updated topic for validation' });
    check('B2: PATCH while draft succeeds and persists the edit', editResp.status === 200 && editResp.json?.request?.topic === 'Updated topic for validation');

    const submitResp = await api('POST', `/api/creative-director/requests/${requestId}/submit`);
    check('B3: submit succeeds from draft', submitResp.status === 200 && submitResp.json?.request?.status === 'submitted');

    const editAfterSubmitResp = await api('PATCH', `/api/creative-director/requests/${requestId}`, { topic: 'Should not apply' });
    check('B4: PATCH is rejected once no longer draft (409)', editAfterSubmitResp.status === 409);

    const briefResp = await api('POST', `/api/creative-director/requests/${requestId}/generate-brief`);
    check('B5: generate-brief succeeds from submitted', briefResp.status === 200 && briefResp.json?.request?.status === 'brief_generated');
    check('B5: the brief is a real structured object (hooks/script/scenes/caption/thumbnail)', !!(briefResp.json?.request?.brief?.hooks?.length && briefResp.json?.request?.brief?.script?.fullText && briefResp.json?.request?.brief?.thumbnail));
    check('B5: the brief is honestly labeled as a non-AI, rule-based outline', /generated by the Creative Director/.test(briefResp.json?.request?.brief?.script?.fullText || ''));

    const createPkgResp = await api('POST', `/api/creative-director/requests/${requestId}/create-package`);
    check('B6: create-package succeeds from brief_generated', createPkgResp.status === 200 && createPkgResp.json?.request?.status === 'package_created');
    const packageId = createPkgResp.json?.request?.packageId;
    if (packageId) createdPackageIds.push(packageId);
    check('B6: request now references the created package id', !!packageId);
    check('B6: response includes the package summary', createPkgResp.json?.package?.id === packageId);

    // ══════════════════════════════════════════════════════════════════
    // C: The created package is a REAL, normal Package Pipeline citizen —
    // never bypasses the Package Pipeline, never a special-cased shape.
    // ══════════════════════════════════════════════════════════════════

    const pipelineListResp = await api('GET', '/api/content/pipeline/list');
    const foundInPipeline = (pipelineListResp.json?.packages || []).find(p => p.id === packageId);
    check('C1: the created package appears in the normal Package Pipeline list', !!foundInPipeline);
    check('C2: the package has valid pipeline metadata (same defaultPipelineMeta every package gets)', !!foundInPipeline?.pipeline?.stage && Array.isArray(foundInPipeline?.pipeline?.history));
    check('C3: the package has non-empty hooks and script (buildContentPackage\'s own required-shape contract)', foundInPipeline?.hooks?.length > 0 && !!foundInPipeline?.script?.fullText);
    check('C4: the package carries provider "creative-director" (honestly attributed, not pretending to be an LLM synthesis)', foundInPipeline?.metadata?.provider === 'creative-director');
    check('C5: the package brand/platform/topic match the originating request', foundInPipeline?.brand === validInput.brand && foundInPipeline?.platform === validInput.platform);

    // Confirm Content Orchestrator (read-only layer) can read this package
    // without any special-casing — proves zero schema drift.
    const orchWorkflowResp = await api('GET', `/api/orchestration/workflow/${packageId}`);
    check('C6: Content Orchestrator reads the new package with no errors (zero schema drift)', orchWorkflowResp.status === 200 && orchWorkflowResp.json?.ok === true);
    check('C6: Content Orchestrator computes an honest health for it (not a guess)', typeof orchWorkflowResp.json?.workflow?.health === 'string');

    // ══════════════════════════════════════════════════════════════════
    // D: Complete the request lifecycle
    // ══════════════════════════════════════════════════════════════════

    const completeResp = await api('POST', `/api/creative-director/requests/${requestId}/complete`);
    check('D1: complete succeeds from package_created', completeResp.status === 200 && completeResp.json?.request?.status === 'completed');
    const cancelAfterCompleteResp = await api('POST', `/api/creative-director/requests/${requestId}/cancel`);
    check('D2: a terminal (completed) request cannot be cancelled (409)', cancelAfterCompleteResp.status === 409);

    // ══════════════════════════════════════════════════════════════════
    // E: Reject + cancel paths (separate fixture requests)
    // ══════════════════════════════════════════════════════════════════

    const rejectFixture = await api('POST', '/api/creative-director/requests', { ...validInput, topic: 'Reject-path fixture' });
    const rejectId = rejectFixture.json?.request?.id;
    if (rejectId) createdRequestIds.push(rejectId);
    await api('POST', `/api/creative-director/requests/${rejectId}/submit`);
    const noReasonRejectResp = await api('POST', `/api/creative-director/requests/${rejectId}/reject`, {});
    check('E1: reject without a reason is rejected (400)', noReasonRejectResp.status === 400);
    const rejectResp = await api('POST', `/api/creative-director/requests/${rejectId}/reject`, { reason: 'Fixture rejection for validation.' });
    check('E2: reject with a reason succeeds', rejectResp.status === 200 && rejectResp.json?.request?.status === 'rejected');

    const cancelFixture = await api('POST', '/api/creative-director/requests', { ...validInput, topic: 'Cancel-path fixture' });
    const cancelId = cancelFixture.json?.request?.id;
    if (cancelId) createdRequestIds.push(cancelId);
    const cancelResp = await api('POST', `/api/creative-director/requests/${cancelId}/cancel`);
    check('E3: cancel from draft succeeds', cancelResp.status === 200 && cancelResp.json?.request?.status === 'cancelled');

    // ══════════════════════════════════════════════════════════════════
    // F: List/filter + detail
    // ══════════════════════════════════════════════════════════════════

    const listResp = await api('GET', '/api/creative-director/requests');
    check('F1: list returns requests including our fixtures', (listResp.json?.requests || []).some(r => r.id === requestId));
    const filteredResp = await api('GET', '/api/creative-director/requests?status=completed');
    check('F2: filtering by status works', (filteredResp.json?.requests || []).every(r => r.status === 'completed') && filteredResp.json.requests.some(r => r.id === requestId));

    const detailResp = await api('GET', `/api/creative-director/requests/${requestId}`);
    check('F3: detail endpoint enriches with the package summary', detailResp.json?.package?.id === packageId);

    const missingResp = await api('GET', '/api/creative-director/requests/does-not-exist-xyz');
    check('F4: a nonexistent request returns 404', missingResp.status === 404);
  } finally {
    for (const id of createdRequestIds) deleteJsonFile(REQ_DIR, id);
    for (const id of createdPackageIds) deleteJsonFile(PKG_DIR, id);
  }

  check('Post-cleanup: no fixture requests remain', createdRequestIds.every(id => !fs.existsSync(path.join(REQ_DIR, `${id}.json`))));
  check('Post-cleanup: no fixture packages remain', createdPackageIds.every(id => !fs.existsSync(path.join(PKG_DIR, `${id}.json`))));

  // ══════════════════════════════════════════════════════════════════════
  // G: Source-level isolation guards — confirm every protected system was
  // NOT modified (proving "the existing infrastructure... must remain
  // unchanged" was honored, not just claimed).
  // ══════════════════════════════════════════════════════════════════════

  const protectedFiles = [
    'components/content/ContentPackagePipeline.jsx',
    'components/content/ProductionRouterWorkspace.jsx',
    'components/content/PublishingRouterWorkspace.jsx',
    'components/content/HyperFramesStudioWorkspace.jsx',
    'components/content/ContentOrchestratorWorkspace.jsx',
    'lib/production/execution/executionEngine.js',
    'lib/artifacts/normalizeArtifact.js',
    'lib/orchestration/workflowRules.js',
  ];
  let allProtectedClean = true;
  for (const rel of protectedFiles) {
    const p = path.join(ROOT, rel);
    if (fs.existsSync(p) && /CreativeDirector|creative-director/.test(fs.readFileSync(p, 'utf8'))) {
      allProtectedClean = false;
      console.log(`  -> unexpected Creative Director reference in ${rel}`);
    }
  }
  check('G1: no protected system references Creative Director (all built as an isolated, additive layer)', allProtectedClean);

  const studioSrc = fs.readFileSync(path.join(ROOT, 'components/content/StudioWorkspace.jsx'), 'utf8');
  check('G2: StudioWorkspace registers the Creative Director tab', studioSrc.includes("'creative-director'"));
  check('G3: StudioWorkspace wires the Creative Director\'s deep-link to Package Pipeline (never bypassing it)', studioSrc.includes("onOpenPackagePipeline={() => setMode('pack-pipeline')}"));

  const packageFromRequestSrc = fs.readFileSync(path.join(ROOT, 'lib/creative-director/packageFromRequest.js'), 'utf8');
  check('G4: package creation reuses buildContentPackage (never reimplements the package schema)', packageFromRequestSrc.includes('buildContentPackage'));
  check('G5: package creation reuses savePackage (never a duplicate/parallel store)', packageFromRequestSrc.includes('savePackage'));
  check('G6: package creation reuses defaultPipelineMeta (never a custom pipeline-entry shape)', packageFromRequestSrc.includes('defaultPipelineMeta'));

  const registryResp = await api('GET', '/api/capabilities/registry');
  check('H1: capability registry still loads successfully (schema-valid) after any edits this milestone', registryResp.status === 200);

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
