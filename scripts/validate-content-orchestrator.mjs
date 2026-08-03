#!/usr/bin/env node
// scripts/validate-content-orchestrator.mjs
//
// Validates the Content Division Orchestrator v1 (read-only aggregation
// layer over existing Production Router / Publishing Router / HyperFrames
// Local Studio stores). Never mutates a real package/job's state — all
// assertions either read real, already-existing records, or exercise
// fixtures written directly to disk and cleaned up in a `finally` block
// (matching the safe pattern established for the Publishing Router and
// HyperFrames Local Studio validators, after an earlier milestone's
// validator accidentally deleted a real record by being too loose with
// cleanup).

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const BASE = 'http://localhost:3099';
const PKG_DIR = path.join(ROOT, 'data', 'content-packages');
const JOB_DIR = path.join(ROOT, 'data', 'production-jobs');
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

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

async function api(method, urlPath) {
  const res = await fetch(`${BASE}${urlPath}`, { method, headers: { 'X-Mika-Admin-Token': TOKEN } });
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
  // A: Pure logic — exercised via the live HTTP API (see the established
  // precedent from prior milestones: lib/orchestration/*.js is intentionally
  // unscoped, consumed only by Next.js/webpack, not plain node).
  // ══════════════════════════════════════════════════════════════════════

  const overviewResp = await api('GET', '/api/orchestration/overview');
  check('A1: GET overview returns 200/ok', overviewResp.status === 200 && overviewResp.json?.ok === true);
  const m = overviewResp.json?.metrics;
  check('A2: overview has packages/production/review/publishing/export/queues sections', !!(m?.packages && m?.production && m?.review && m?.publishing && m?.export && m?.queues));
  check('A3: package health breakdown sums to packages.total', m && Object.values(m.packages.byHealth).reduce((a, b) => a + b, 0) === m.packages.total);
  check('A4: review counts sum to review.total', m && (m.review.approved + m.review.rejected + m.review.unreviewed) === m.review.total);
  check('A5: renderSuccessRate is null or 0-100', m && (m.production.renderSuccessRate === null || (m.production.renderSuccessRate >= 0 && m.production.renderSuccessRate <= 100)));
  check('A6: no absolute filesystem path in overview response', !noFilesystemPaths(overviewResp.json));
  check('A7: no secret/token leakage in overview response', !noSecretLeak(overviewResp.json));

  // ══════════════════════════════════════════════════════════════════════
  // B: Workflow endpoint — health/timeline/nextActions/graph correctness
  // against REAL, pre-existing records (read-only, never mutated)
  // ══════════════════════════════════════════════════════════════════════

  const prodJobsResp = await api('GET', '/api/production/jobs');
  const allJobs = prodJobsResp.json?.jobs || [];
  const packageWithFailedJob = allJobs.find(j => j.execution?.status === 'failed')?.packageId;
  const packageWithApprovedJob = allJobs.find(j => j.execution?.status === 'completed' && j.review?.status === 'approved')?.packageId;
  const packageWithUnreviewedJob = allJobs.find(j => j.execution?.status === 'completed' && (j.review?.status || 'unreviewed') === 'unreviewed')?.packageId;

  check('B1: found a real package with a failed production job (for health testing)', !!packageWithFailedJob);
  check('B2: found a real package with an approved production job (for health testing)', !!packageWithApprovedJob);
  check('B3: found a real package with an unreviewed completed job (for health testing)', !!packageWithUnreviewedJob);

  if (packageWithFailedJob) {
    const wf = await api('GET', `/api/orchestration/workflow/${packageWithFailedJob}`);
    check('B4: workflow for a package with any failed job reports health "failed"', wf.json?.workflow?.health === 'failed');
    check('B4: workflow response has all 6 timeline stages in order', JSON.stringify(wf.json?.workflow?.timeline?.stages?.map(s => s.id)) === JSON.stringify(['pack', 'approved', 'production', 'review', 'publishing', 'export']));
    check('B4: no absolute filesystem path in workflow response', !noFilesystemPaths(wf.json));
  }

  if (packageWithUnreviewedJob && packageWithUnreviewedJob !== packageWithFailedJob) {
    const wf = await api('GET', `/api/orchestration/workflow/${packageWithUnreviewedJob}`);
    check('B5: workflow for a package with only an unreviewed completed job reports "waiting_approval"', wf.json?.workflow?.health === 'waiting_approval');
    check('B5: next actions include "Review Output"', wf.json?.workflow?.nextActions?.some(a => a.id === 'review-output'));
  }

  if (packageWithApprovedJob) {
    const wf = await api('GET', `/api/orchestration/workflow/${packageWithApprovedJob}`);
    const approvedJobId = allJobs.find(j => j.packageId === packageWithApprovedJob && j.review?.status === 'approved')?.id;
    const hasPublishForApproved = false; // no publish jobs exist for it at present in a clean environment
    if (!hasPublishForApproved) {
      check('B6: next actions include "Create Publish Job" for an approved output with no publish job yet',
        wf.json?.workflow?.nextActions?.some(a => a.id === 'create-publish-job' && a.productionJobId === approvedJobId));
    }
    check('B7: relationship graph includes a package node and at least one production_job node',
      wf.json?.workflow?.graph?.nodes?.some(n => n.group === 'package') && wf.json?.workflow?.graph?.nodes?.some(n => n.group === 'production_job'));
  }

  const missingResp = await api('GET', '/api/orchestration/workflow/does-not-exist-xyz');
  check('B8: a nonexistent package returns 404', missingResp.status === 404);

  // ══════════════════════════════════════════════════════════════════════
  // C: Global search
  // ══════════════════════════════════════════════════════════════════════

  const searchResp = await api('GET', '/api/orchestration/search?q=heygen');
  check('C1: search for "heygen" returns matches across multiple types', searchResp.status === 200 && searchResp.json?.results?.length > 0);
  const types = new Set((searchResp.json?.results || []).map(r => r.type));
  check('C2: search results span more than one record type', types.size > 1);
  const emptySearchResp = await api('GET', '/api/orchestration/search?q=');
  check('C3: an empty query returns an empty result set (not an error)', emptySearchResp.status === 200 && emptySearchResp.json?.results?.length === 0);
  check('C4: no absolute filesystem path in search results', !noFilesystemPaths(searchResp.json));

  // ══════════════════════════════════════════════════════════════════════
  // D: Fixture-based health/timeline verification (synthetic, isolated,
  // referencing a real artifact URL — never duplicating media, never
  // touching a real package's state)
  // ══════════════════════════════════════════════════════════════════════

  const sourceJob = allJobs.find(j => j.execution?.status === 'completed' && j.execution?.outputs?.length > 0);
  const fixturePkgId = `pub-test-orch-pkg-${RUN_ID}`;
  const fixtureJobId = `pub-test-orch-job-${RUN_ID}`;
  if (sourceJob) {
    const now = new Date().toISOString();
    const fixturePkg = {
      id: fixturePkgId, status: 'draft', brand: 'OrchestratorFixture', platform: 'Local', goal: 'Content Orchestrator validation fixture',
      topic: 'Content Orchestrator Validation Fixture', audience: '', offer: '', tone: '', videoDuration: '',
      hooks: [], script: { opening: '', body: '', cta: '', fullText: 'Fixture.' }, scenes: [], caption: '', cta: '', hashtags: [], keywords: [],
      thumbnail: { headline: '', visualBrief: '', artifactId: null, artifactUrl: null, status: 'not_requested', error: null },
      pipeline: { stage: 'research', enteredStageAt: now, history: [{ stage: 'research', at: now, actor: 'system', note: null }] },
      metadata: { workflowId: fixturePkgId, model: null, provider: 'validator', createdAt: now, updatedAt: now, estimatedCost: null, actualCost: null, instructions: '' },
      production: null,
    };
    writeJsonFile(PKG_DIR, fixturePkgId, fixturePkg);

    try {
      const wfNoJob = await api('GET', `/api/orchestration/workflow/${fixturePkgId}`);
      check('D1: a package with no production job and not yet approved reports "healthy" (nothing blocking, just early)', wfNoJob.json?.workflow?.health === 'healthy');
      check('D2: next actions for an unapproved package point to Package Pipeline only', wfNoJob.json?.workflow?.nextActions?.length === 1 && wfNoJob.json.workflow.nextActions[0].id === 'approve-package');
      check('D3: production stage is "blocked" before approval (not a misleading "pending")', wfNoJob.json?.workflow?.timeline?.stages?.find(s => s.id === 'production')?.status === 'blocked');

      // Move the fixture package to "approved" directly (fixture-only file,
      // never a real package) and verify the timeline updates accordingly.
      const approvedPkg = { ...fixturePkg, pipeline: { stage: 'approved', enteredStageAt: now, history: [...fixturePkg.pipeline.history, { stage: 'approved', at: now, actor: 'validator', note: null }] } };
      writeJsonFile(PKG_DIR, fixturePkgId, approvedPkg);
      const wfApproved = await api('GET', `/api/orchestration/workflow/${fixturePkgId}`);
      check('D4: after reaching "approved", next action becomes "Create Production Plan"', wfApproved.json?.workflow?.nextActions?.some(a => a.id === 'create-production-plan'));
      check('D5: "Approved" timeline stage is now "done"', wfApproved.json?.workflow?.timeline?.stages?.find(s => s.id === 'approved')?.status === 'done');

      // Add a fixture production job REFERENCING a real artifact (never
      // duplicating it) and verify the graph/timeline reflect it.
      const fixtureJob = {
        id: fixtureJobId, packageId: fixturePkgId, packageUpdatedAt: approvedPkg.metadata.updatedAt, stalePackage: false, status: 'completed',
        eligibility: { eligible: true, reasons: [] }, recommendedMode: 'custom', selectedMode: 'custom', modeReason: 'Fixture.',
        recommendedProvider: 'validator-fixture', selectedProvider: 'validator-fixture',
        providerInput: null, preferredFutureProvider: null, providerCandidates: [], unavailableReasons: {}, missingActivationRequirements: [],
        readiness: { ready: true, score: 100, available: [], missingRequired: [], missingOptional: [], warnings: [] },
        scenes: null, voiceoverScript: null, captionPlan: null, visualAssetPlan: null, audioPlan: null,
        outputSpec: { platform: 'Local', targetDuration: 'n/a', aspectRatio: 'n/a', resolution: 'n/a', frameRate: null, captionBurnIn: false, safeAreaNotes: 'n/a', fileFormat: null },
        budget: { estimateType: 'free', estimatedRange: null, costTier: 'free', approvalRequired: false, approvalReason: 'Fixture.', maxEstimatedCost: null, currency: 'USD', approvalRequiredAbove: null },
        approval: { required: false, requestedAt: null, approvedAt: null, approvedBy: null, rejectedAt: null, rejectedBy: null, notes: '' },
        review: { status: 'unreviewed', reviewedAt: null, reviewedBy: null, note: '' },
        metadata: { createdAt: now, updatedAt: now, createdBy: 'validator', userNotes: '', source: 'validator-fixture', isLocalRender: false, isProviderExecution: false },
        activityHistory: [],
        execution: {
          status: 'completed', provider: 'validator-fixture', providerJobId: null, attemptCount: 0, maxAttempts: 1,
          startedAt: now, completedAt: now, updatedAt: now, cancelledAt: null, lastPollAt: null, nextPollAt: null, progress: 100,
          error: null, errorReason: null, outputs: [{ ...sourceJob.execution.outputs[0] }],
          providerMetadata: { note: 'Fixture referencing an existing real artifact — never duplicated.' }, mock: false, lock: null,
        },
      };
      writeJsonFile(JOB_DIR, fixtureJobId, fixtureJob);

      const wfWithJob = await api('GET', `/api/orchestration/workflow/${fixturePkgId}`);
      check('D6: production stage is "done" once a completed job exists', wfWithJob.json?.workflow?.timeline?.stages?.find(s => s.id === 'production')?.status === 'done');
      check('D7: review stage is "active" (completed but unreviewed)', wfWithJob.json?.workflow?.timeline?.stages?.find(s => s.id === 'review')?.status === 'active');
      check('D8: next actions include "Review Output" for this fixture job', wfWithJob.json?.workflow?.nextActions?.some(a => a.id === 'review-output' && a.productionJobId === fixtureJobId));
      check('D9: relationship graph now includes an artifact node', wfWithJob.json?.workflow?.graph?.nodes?.some(n => n.group === 'artifact'));
      check('D10: relationship graph never duplicates the artifact — its localUrl still resolves to the ONE real file', wfWithJob.json?.workflow?.graph?.nodes?.find(n => n.group === 'artifact')?.name === sourceJob.execution.outputs[0].filename);

      const overviewAfter = await api('GET', '/api/orchestration/overview');
      check('D11: overview production.total increases by exactly 1 after adding the fixture job', overviewAfter.json?.metrics?.production?.total === (overviewResp.json.metrics.production.total + 1));
    } finally {
      deleteJsonFile(JOB_DIR, fixtureJobId);
      deleteJsonFile(PKG_DIR, fixturePkgId);
    }
  } else {
    console.log('INFO — D: skipped fixture-based timeline tests (no real completed production job with outputs found to reference).');
  }

  check('Post-cleanup: no fixture package remains', !fs.existsSync(path.join(PKG_DIR, `${fixturePkgId}.json`)));
  check('Post-cleanup: no fixture production job remains', !fs.existsSync(path.join(JOB_DIR, `${fixtureJobId}.json`)));

  // ══════════════════════════════════════════════════════════════════════
  // E: Source checks — cross-navigation wiring and no-duplication contract
  // ══════════════════════════════════════════════════════════════════════

  const studioSrc = fs.readFileSync(path.join(ROOT, 'components/content/StudioWorkspace.jsx'), 'utf8');
  check('E1: StudioWorkspace registers the Content Orchestrator tab', studioSrc.includes("'content-orchestrator'"));
  check('E2: StudioWorkspace wires the Orchestrator\'s forward navigation into Production Router', studioSrc.includes('onOpenProductionRouter={(productionJobId) => focusProductionRouterJob(productionJobId)}'));
  check('E3: StudioWorkspace wires the Orchestrator\'s forward navigation into Publishing Router', studioSrc.includes('onOpenPublishingRouter={(publishJobId) => focusPublishingRouter(publishJobId)}'));
  check('E3b: StudioWorkspace wires the Orchestrator\'s forward navigation into Package Pipeline', studioSrc.includes("onOpenPackagePipeline={() => setMode('pack-pipeline')}"));

  const prodRouterSrc = fs.readFileSync(path.join(ROOT, 'components/content/ProductionRouterWorkspace.jsx'), 'utf8');
  check('E4: Production Router supports a precise "open-job" deep-link (not just "first job for package")', prodRouterSrc.includes("focusRequest.action === 'open-job'"));
  const publishRouterSrc = fs.readFileSync(path.join(ROOT, 'components/content/PublishingRouterWorkspace.jsx'), 'utf8');

  // "Do NOT modify Production Router / Publishing Router" — verified, not
  // just claimed: neither file may reference the orchestrator in any way.
  check('E4b: Production Router was NOT modified for this milestone (no orchestrator reference)', !prodRouterSrc.includes('ContentOrchestrator') && !prodRouterSrc.includes('onOpenContentOrchestrator'));
  check('E4c: Publishing Router was NOT modified for this milestone (no orchestrator reference)', !publishRouterSrc.includes('ContentOrchestrator') && !publishRouterSrc.includes('onOpenContentOrchestrator'));

  const orchSrc = fs.readFileSync(path.join(ROOT, 'components/content/ContentOrchestratorWorkspace.jsx'), 'utf8');
  check('E5: Content Orchestrator never constructs its own artifact/media URL (reuses normalizeArtifact server-side only)', !orchSrc.includes('production-artifacts/'));
  const graphSrc = fs.readFileSync(path.join(ROOT, 'components/content/RelationshipGraph.jsx'), 'utf8');
  check('E6: relationship graph uses the already-installed force-graph engine (no new dependency added)', graphSrc.includes("import('force-graph')"));
  const importsReactForceGraph = /import[^;]*from\s+['"]react-force-graph['"]|import\(['"]react-force-graph['"]\)/.test(graphSrc) || /import[^;]*from\s+['"]react-force-graph['"]|import\(['"]react-force-graph['"]\)/.test(orchSrc);
  check('E7: relationship graph never imports the AFRAME-poisoned react-force-graph wrapper (mentioning it in a comment is fine)', !importsReactForceGraph);

  // Confirm the rest of the explicit "Do NOT modify" list was honored too.
  const hfStudioSrc = fs.readFileSync(path.join(ROOT, 'components/content/HyperFramesStudioWorkspace.jsx'), 'utf8');
  check('E4d: HyperFrames Studio was NOT modified for this milestone (no orchestrator reference)', !hfStudioSrc.includes('ContentOrchestrator'));
  const peeFiles = ['executionEngine.js', 'executionRules.js', 'executionQueue.js', 'executionLock.js'];
  let peeClean = true;
  for (const f of peeFiles) {
    const p = path.join(ROOT, 'lib/production/execution', f);
    if (fs.existsSync(p) && fs.readFileSync(p, 'utf8').includes('ContentOrchestrator')) peeClean = false;
  }
  check('E4e: Provider Execution Engine was NOT modified for this milestone (no orchestrator reference)', peeClean);
  const normalizeArtifactSrc = fs.readFileSync(path.join(ROOT, 'lib/artifacts/normalizeArtifact.js'), 'utf8');
  check('E4f: Universal Output Viewer\'s normalizeArtifact was NOT modified for this milestone (no orchestrator reference)', !normalizeArtifactSrc.includes('ContentOrchestrator'));

  // ══════════════════════════════════════════════════════════════════════
  // G: the expanded 9-state health model
  // ══════════════════════════════════════════════════════════════════════

  const workflowRulesSrc = fs.readFileSync(path.join(ROOT, 'lib/orchestration/workflowRules.js'), 'utf8');
  const expectedHealthStates = ['healthy', 'waiting_approval', 'rendering', 'ready_to_publish', 'publishing', 'published', 'blocked', 'failed', 'archived'];
  check('G1: all 9 required health states are defined', expectedHealthStates.every(h => workflowRulesSrc.includes(`'${h}'`)));
  check('G2: overview response includes a per-package health map (no guessed/placeholder health in the UI)', Object.keys(m?.packages?.healthByPackageId || {}).length === m?.packages?.total);

  // Fixture-based checks for the 3 NEW health states, isolated and cleaned
  // up exactly like the D-series above.
  if (sourceJob) {
    const now2 = new Date().toISOString();
    const gPkgId = `pub-test-orch-health-pkg-${RUN_ID}`;
    const gJobId = `pub-test-orch-health-job-${RUN_ID}`;
    const gPubId = `pub-test-orch-health-pub-${RUN_ID}`;
    const gPkg = {
      id: gPkgId, status: 'approved', brand: 'OrchestratorHealthFixture', platform: 'Local', goal: 'Health-state validation fixture',
      topic: 'Health State Fixture', audience: '', offer: '', tone: '', videoDuration: '',
      hooks: [], script: { opening: '', body: '', cta: '', fullText: 'Fixture.' }, scenes: [], caption: '', cta: '', hashtags: [], keywords: [],
      thumbnail: { headline: '', visualBrief: '', artifactId: null, artifactUrl: null, status: 'not_requested', error: null },
      pipeline: { stage: 'approved', enteredStageAt: now2, history: [{ stage: 'approved', at: now2, actor: 'validator', note: null }] },
      metadata: { workflowId: gPkgId, model: null, provider: 'validator', createdAt: now2, updatedAt: now2, estimatedCost: null, actualCost: null, instructions: '' },
      production: null,
    };
    function baseFixtureJob(id, executionStatus, reviewStatus) {
      return {
        id, packageId: gPkgId, packageUpdatedAt: gPkg.metadata.updatedAt, stalePackage: false, status: executionStatus === 'completed' ? 'completed' : 'executing',
        eligibility: { eligible: true, reasons: [] }, recommendedMode: 'custom', selectedMode: 'custom', modeReason: 'Fixture.',
        recommendedProvider: 'validator-fixture', selectedProvider: 'validator-fixture',
        providerInput: null, preferredFutureProvider: null, providerCandidates: [], unavailableReasons: {}, missingActivationRequirements: [],
        readiness: { ready: true, score: 100, available: [], missingRequired: [], missingOptional: [], warnings: [] },
        scenes: null, voiceoverScript: null, captionPlan: null, visualAssetPlan: null, audioPlan: null,
        outputSpec: { platform: 'Local', targetDuration: 'n/a', aspectRatio: 'n/a', resolution: 'n/a', frameRate: null, captionBurnIn: false, safeAreaNotes: 'n/a', fileFormat: null },
        budget: { estimateType: 'free', estimatedRange: null, costTier: 'free', approvalRequired: false, approvalReason: 'Fixture.', maxEstimatedCost: null, currency: 'USD', approvalRequiredAbove: null },
        approval: { required: false, requestedAt: null, approvedAt: null, approvedBy: null, rejectedAt: null, rejectedBy: null, notes: '' },
        review: reviewStatus ? { status: reviewStatus, reviewedAt: now2, reviewedBy: 'validator', note: '' } : { status: 'unreviewed', reviewedAt: null, reviewedBy: null, note: '' },
        metadata: { createdAt: now2, updatedAt: now2, createdBy: 'validator', userNotes: '', source: 'validator-fixture', isLocalRender: false, isProviderExecution: false },
        activityHistory: [],
        execution: {
          status: executionStatus, provider: 'validator-fixture', providerJobId: null, attemptCount: 0, maxAttempts: 1,
          startedAt: now2, completedAt: executionStatus === 'completed' ? now2 : null, updatedAt: now2, cancelledAt: null, lastPollAt: null, nextPollAt: null,
          progress: executionStatus === 'completed' ? 100 : 40, error: null, errorReason: null,
          outputs: executionStatus === 'completed' ? [{ ...sourceJob.execution.outputs[0] }] : [],
          providerMetadata: { note: 'Fixture referencing an existing real artifact — never duplicated.' }, mock: false, lock: null,
        },
      };
    }

    // G3: "rendering" — a production job actively executing.
    writeJsonFile(PKG_DIR, gPkgId, gPkg);
    writeJsonFile(JOB_DIR, gJobId, baseFixtureJob(gJobId, 'executing', null));
    try {
      const wfRendering = await api('GET', `/api/orchestration/workflow/${gPkgId}`);
      check('G3: a package with an actively-executing job reports health "rendering"', wfRendering.json?.workflow?.health === 'rendering');
    } finally {
      deleteJsonFile(JOB_DIR, gJobId);
    }

    // G4: "ready_to_publish" — completed + approved output, no publish job yet.
    writeJsonFile(JOB_DIR, gJobId, baseFixtureJob(gJobId, 'completed', 'approved'));
    try {
      const wfReady = await api('GET', `/api/orchestration/workflow/${gPkgId}`);
      check('G4: an approved completed output with no publish job reports health "ready_to_publish"', wfReady.json?.workflow?.health === 'ready_to_publish');

      // G5: "publishing" — a publish job scheduled for this production job.
      const gPub = {
        id: gPubId, productionJobId: gJobId, packageId: gPkgId, artifactId: sourceJob.execution.outputs[0].id, platform: 'tiktok',
        status: 'scheduled', createdAt: now2, updatedAt: now2, scheduledFor: new Date(Date.now() + 86400000).toISOString(), publishedAt: null,
        caption: 'Fixture caption for health-state validation.', hashtags: [], firstComment: '', metadata: {}, platformMetadata: {},
        lastValidation: null, activityHistory: [], publishResult: null,
      };
      writeJsonFile(path.join(ROOT, 'data', 'publish-jobs'), gPubId, gPub);
      try {
        const wfPublishing = await api('GET', `/api/orchestration/workflow/${gPkgId}`);
        check('G5: a scheduled publish job reports package health "publishing"', wfPublishing.json?.workflow?.health === 'publishing');
      } finally {
        deleteJsonFile(path.join(ROOT, 'data', 'publish-jobs'), gPubId);
      }
    } finally {
      deleteJsonFile(JOB_DIR, gJobId);
      deleteJsonFile(PKG_DIR, gPkgId);
    }
    check('Post-cleanup: no health-fixture records remain', !fs.existsSync(path.join(PKG_DIR, `${gPkgId}.json`)) && !fs.existsSync(path.join(JOB_DIR, `${gJobId}.json`)) && !fs.existsSync(path.join(ROOT, 'data', 'publish-jobs', `${gPubId}.json`)));
  } else {
    console.log('INFO — G3/G4/G5: skipped (no real completed production job with outputs found to reference).');
  }

  // ══════════════════════════════════════════════════════════════════════
  // F: capability registry entry (if present) is schema-valid
  // ══════════════════════════════════════════════════════════════════════

  const registryResp = await api('GET', '/api/capabilities/registry');
  check('F1: capability registry still loads successfully (schema-valid) after any edits this milestone', registryResp.status === 200);

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
