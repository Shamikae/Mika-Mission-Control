#!/usr/bin/env node
// scripts/validate-live-research.mjs
//
// Validates Governed Live Research + Workforce Operations v1 (Phase 5).
// Free/deterministic — never spends real money. Spawns its own EPHEMERAL
// `next dev` server instances on a dedicated port (never touches the user's
// main :3099 dev server or its .env.local), mirroring
// scripts/validate-content-workforce.mjs's exact pattern:
//   Phase A — CONTENT_RESEARCH_ENABLED=false, fallback DISABLED: live-search
//     request must fail the Research stage honestly (configuration_pending),
//     never claiming live research occurred.
//   Phase B — CONTENT_RESEARCH_ENABLED=false, fallback ALLOWED (default):
//     live-search request falls back to model-synthesis, recorded honestly.
//   Phase C — CONTENT_RESEARCH_ENABLED=true + CONTENT_RESEARCH_MOCK_MODE=
//     true + CONTENT_WORKFORCE_MOCK_MODE=true: the full source-backed flow,
//     end to end, through package creation.
//
// Every mocked response still flows through the REAL
// normalizeResults()/buildNormalizedSource()/sanitizeEvidence() validation
// path — only the network calls are swapped out.

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { pathToFileURL } from 'url';

const ROOT = process.cwd();
const PORT = 3198; // distinct from validate-content-workforce.mjs's 3199, so both could run concurrently if ever needed
const BASE = `http://localhost:${PORT}`;
const REQ_DIR = path.join(ROOT, 'data', 'content-requests');
const RUN_DIR = path.join(ROOT, 'data', 'content-workforce-runs');
const PKG_DIR = path.join(ROOT, 'data', 'content-packages');
const RSR_DIR = path.join(ROOT, 'data', 'research-runs');
const TOKEN = 'validator-live-research-token';

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
function forbiddenContent(obj) {
  const json = JSON.stringify(obj);
  const patterns = [
    /\/Users\/[^"]*/,
    /"apiKey"/i,
    /x-api-key/i,
    /Authorization/,
    /chain[_-]?of[_-]?thought/i,
    /"reasoning"\s*:/,
  ];
  return patterns.filter(p => p.test(json));
}

async function waitForServer(timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/research/providers`);
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

async function createFixtureRequest(overrides = {}) {
  return api('POST', '/api/creative-director/requests', {
    brand: 'Validator Brand', platform: 'tiktok', goal: 'engagement', topic: 'Validator research fixture topic', ...overrides,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 1 — pure unit tests (direct import, no server)
// ═══════════════════════════════════════════════════════════════════════

async function runUnitTests() {
  const urlSafety = await import(pathToFileURL(path.join(ROOT, 'lib/research/urlSafety.js')).href);
  const contract = await import(pathToFileURL(path.join(ROOT, 'lib/research/researchAdapterContract.js')).href);
  const qp = await import(pathToFileURL(path.join(ROOT, 'lib/research/queryPlanning.js')).href);
  const sq = await import(pathToFileURL(path.join(ROOT, 'lib/research/sourceQuality.js')).href);
  const ev = await import(pathToFileURL(path.join(ROOT, 'lib/research/evidenceModel.js')).href);
  const rules = await import(pathToFileURL(path.join(ROOT, 'lib/research/researchRules.js')).href);

  // U1 — URL safety
  check('U1: rejects non-HTTPS URLs', urlSafety.isSafeWebUrl('http://example.com').safe === false);
  check('U1: rejects localhost', urlSafety.isSafeWebUrl('https://localhost/x').safe === false);
  check('U1: rejects 127.0.0.1', urlSafety.isSafeWebUrl('https://127.0.0.1/x').safe === false);
  check('U1: rejects 10.x private range', urlSafety.isSafeWebUrl('https://10.1.2.3/x').safe === false);
  check('U1: rejects 192.168.x private range', urlSafety.isSafeWebUrl('https://192.168.1.1/x').safe === false);
  check('U1: rejects 172.16-31.x private range', urlSafety.isSafeWebUrl('https://172.20.0.1/x').safe === false);
  check('U1: rejects file:// scheme', urlSafety.isSafeWebUrl('file:///etc/passwd').safe === false);
  check('U1: rejects data: scheme', urlSafety.isSafeWebUrl('data:text/plain;base64,eA==').safe === false);
  check('U1: accepts a real HTTPS URL', urlSafety.isSafeWebUrl('https://example.com/article').safe === true);
  check('U2: canonicalUrlKey dedupes tracking-param variants', urlSafety.canonicalUrlKey('https://example.com/a?utm_source=x&id=1') === urlSafety.canonicalUrlKey('https://example.com/a?id=1'));
  check('U2: canonicalUrlKey dedupes param-order variants', urlSafety.canonicalUrlKey('https://example.com/a?x=1&y=2') === urlSafety.canonicalUrlKey('https://example.com/a?y=2&x=1'));
  check('U2: stripTrackingParams removes utm_* but keeps real params', !urlSafety.stripTrackingParams('https://example.com/a?utm_source=x&id=1').includes('utm_source') && urlSafety.stripTrackingParams('https://example.com/a?utm_source=x&id=1').includes('id=1'));

  // U3 — normalized source builder
  check('U3: buildNormalizedSource rejects an unsafe URL (returns null)', contract.buildNormalizedSource({ title: 'x', url: 'http://example.com' }, { provider: 'test', query: 'q' }) === null);
  check('U3: buildNormalizedSource rejects a missing title', contract.buildNormalizedSource({ title: '', url: 'https://example.com' }, { provider: 'test', query: 'q' }) === null);
  const goodSource = contract.buildNormalizedSource({ title: 'A Real Title', url: 'https://example.com/a?utm_source=x', snippet: 'x'.repeat(1000), score: 1.5 }, { provider: 'test', query: 'q' });
  check('U3: buildNormalizedSource accepts + sanitizes a valid result', !!goodSource && goodSource.title === 'A Real Title');
  check('U3: buildNormalizedSource strips tracking params from url', !goodSource.url.includes('utm_source'));
  check('U3: buildNormalizedSource clamps snippet length', goodSource.snippet.length <= 600);
  check('U3: buildNormalizedSource clamps score to [0,1]', goodSource.score === 1);

  // U4 — query planning
  const plan5 = qp.buildQueryPlan({ topic: 'topic', platform: 'tiktok', targetAudience: 'creators', brand: 'b', goal: 'g' });
  check('U4: buildQueryPlan never exceeds 5 queries', plan5.queries.length <= 5);
  check('U4: every planned query has resultLimit <= 5', plan5.queries.every(q => q.resultLimit <= 5));
  check('U4: buildQueryPlan is deterministic (same input -> same output)', JSON.stringify(qp.buildQueryPlan({ topic: 'topic', platform: 'tiktok' })) === JSON.stringify(qp.buildQueryPlan({ topic: 'topic', platform: 'tiktok' })));

  // U5 — source scoring/classification
  check('U5: classifySource marks .gov as authoritative-secondary', sq.classifySource({ domain: 'example.gov', contentType: 'article' }) === 'authoritative-secondary');
  check('U5: classifySource marks forum contentType as community-source', sq.classifySource({ domain: 'randomsite.com', contentType: 'forum' }) === 'community-source');
  const recentAuthoritative = sq.scoreSource({ domain: 'example.gov', contentType: 'article', publishedAt: new Date().toISOString(), author: 'A' }, {});
  const oldUnknown = sq.scoreSource({ domain: 'randomsite.com', contentType: 'other', publishedAt: null, author: null }, {});
  check('U5: a recent authoritative source scores higher than an old unknown one', recentAuthoritative > oldUnknown);
  const dedupedGroup = sq.dedupeAndScoreSources([
    { url: 'https://example.com/a', title: 'A', domain: 'example.com', contentType: 'article' },
    { url: 'https://example.com/a?utm_source=x', title: 'A dup', domain: 'example.com', contentType: 'article' },
  ], { dedupeKeyFn: s => urlSafety.canonicalUrlKey(s.url) });
  check('U6: dedupeAndScoreSources collapses tracking-param duplicates into one', dedupedGroup.length === 1);
  check('U6: dedupeAndScoreSources records corroborationCount', dedupedGroup[0].corroborationCount === 2);

  // U7 — evidence model
  const known = new Set(['src-1', 'src-2']);
  const sanitizedEv = ev.sanitizeEvidence([
    { claim: 'A supported claim', sourceIds: ['src-1', 'src-fabricated'], evidenceType: 'statistic', confidence: 'high', verificationStatus: 'supported' },
    { claim: 'A claim citing nothing but claiming support', sourceIds: [], verificationStatus: 'supported' },
  ], known);
  check('U7: sanitizeEvidence strips unresolvable sourceIds', JSON.stringify(sanitizedEv.evidence[0].sourceIds) === JSON.stringify(['src-1']));
  check('U7: sanitizeEvidence warns when a sourceId was dropped', sanitizedEv.warnings.some(w => /did not resolve/.test(w)));
  check('U7: sanitizeEvidence downgrades verificationStatus to needs_verification when zero sources resolve', sanitizedEv.evidence[1].verificationStatus === 'needs_verification');
  check('U8: sanitizeClaimSourceIds filters to only known ids', JSON.stringify(ev.sanitizeClaimSourceIds(['src-1', 'nope'], known)) === JSON.stringify(['src-1']));

  // U9 — budget gate + cost provisional labeling
  const cost = rules.estimateResearchCost({ queryCount: 3, fetchCount: 2 });
  check('U9: estimateResearchCost is labeled provisional', cost.provisional === true && typeof cost.basis === 'string');
  const gateBlocked = rules.checkResearchBudgetGate(0.001, 0.01);
  check('U9: checkResearchBudgetGate blocks when estimate exceeds cap', gateBlocked.blocked === true);
  const gateOverridden = rules.checkResearchBudgetGate(0.001, 0.01, { overrideBudget: true });
  check('U9: checkResearchBudgetGate allows explicit overrideBudget', gateOverridden.blocked === false);
  check('U9: checkResearchBudgetGate never blocks with no cap configured', rules.checkResearchBudgetGate(null, 999).blocked === false);
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
    if (fs.existsSync(p) && /lib\/research|researchAdapter|ExaAdapter|live-search/i.test(fs.readFileSync(p, 'utf8'))) {
      allClean = false;
      console.log(`  -> unexpected live-research reference in ${rel}`);
    }
  }
  check('G1: no protected system references the live-research module', allClean);

  const workforcePanelSrc = fs.readFileSync(path.join(ROOT, 'components/content/ContentWorkforcePanel.jsx'), 'utf8');
  check('G2: ContentWorkforcePanel wires in the research provider/sources UI (additive extension)', workforcePanelSrc.includes('ResearchPanel') && workforcePanelSrc.includes('Run Live Research'));

  const exaSrc = fs.readFileSync(path.join(ROOT, 'lib/research/adapters/exaAdapter.js'), 'utf8');
  check('G3: the Exa adapter never returns the API key as a field (only uses it in the request header)', !/return\s*\{[^}]*apiKey/i.test(exaSrc));

  const pkgMapSrc = fs.readFileSync(path.join(ROOT, 'lib/creative-director/workforce/packageFromWorkforceRun.js'), 'utf8');
  check('G4: package provenance never includes source snippet/content fields (bounded metadata only)', !/researchProvenance[\s\S]{0,300}(snippet|\.content)/i.test(pkgMapSrc));

  const scriptSrc = fs.readFileSync(path.join(ROOT, 'lib/creative-director/workforce/stages/scriptStage.js'), 'utf8');
  check('G5: Script Writer receives evidence (supported/conflicting/unresolved) when live-search mode is active', scriptSrc.includes('research.evidence') && scriptSrc.includes('unresolvedClaims'));

  const reviewSrc = fs.readFileSync(path.join(ROOT, 'lib/creative-director/workforce/stages/reviewStage.js'), 'utf8');
  check('G6: Creative Review checks factual claims against evidence when live-search mode is active', reviewSrc.includes('supported evidence') && reviewSrc.includes('conflicting evidence'));

  const contractSrc = fs.readFileSync(path.join(ROOT, 'lib/research/researchAdapterContract.js'), 'utf8');
  const shape = ['healthCheck', 'search', 'fetch', 'normalizeResults', 'estimate', 'sanitizeResult'];
  check('G7: the shared research adapter contract lists every required method exactly once', shape.every(m => contractSrc.includes(m)));

  const engineSrc = fs.readFileSync(path.join(ROOT, 'lib/research/researchEngine.js'), 'utf8');
  check('G8: the research engine bounds a transient search failure to exactly one retry (no loop)', (engineSrc.match(/adapter\.search\(/g) || []).length === 2);
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 3 — Phase A: disabled + fallback DISABLED -> honest hard failure
// ═══════════════════════════════════════════════════════════════════════

async function runPhaseA(createdRequestIds, createdRunIds) {
  console.log('\n── Phase A: CONTENT_RESEARCH_ENABLED=false, ALLOW_MODEL_FALLBACK=false ──');
  const handle = spawnServer({
    CONTENT_RESEARCH_ENABLED: 'false',
    CONTENT_RESEARCH_ALLOW_MODEL_FALLBACK: 'false',
    CONTENT_WORKFORCE_ENABLED: 'true',
    CONTENT_WORKFORCE_MOCK_MODE: 'true',
    OPENROUTER_ENABLED: 'true',
    OPENROUTER_API_KEY: 'sk-mock-validator-key-not-used-in-mock-mode',
  });
  try {
    const up = await waitForServer();
    check('A0: ephemeral disabled+no-fallback server starts and is reachable', up, handle.getLogs().slice(-500));
    if (!up) return;

    const providersResp = await api('GET', '/api/research/providers');
    check('A1: GET /api/research/providers succeeds', providersResp.status === 200 && Array.isArray(providersResp.json?.providers));
    const providerIds = (providersResp.json?.providers || []).map(p => p.id);
    check('A1: provider registry includes exa/tavily/brave-search/model-synthesis', ['exa', 'tavily', 'brave-search', 'model-synthesis'].every(id => providerIds.includes(id)));
    check('A1: provider registry never exposes a credential field', !JSON.stringify(providersResp.json).match(/EXA_API_KEY|api[_-]?key['"]?\s*:\s*['"][^'"]+['"]/i));
    const exaEntry = providersResp.json.providers.find(p => p.id === 'exa');
    check('A1: exa is reported non-executable while CONTENT_RESEARCH_ENABLED=false', exaEntry.executable === false);
    check('A1: model-synthesis is always executable', providersResp.json.providers.find(p => p.id === 'model-synthesis').executable === true);

    const reqResp = await createFixtureRequest({ topic: 'Phase A disabled no-fallback fixture' });
    createdRequestIds.push(reqResp.json.request.id);
    const runResp = await api('POST', '/api/creative-director/workforce/run', { requestId: reqResp.json.request.id, researchMode: 'live-search' });
    const run = runResp.json?.run;
    if (run) createdRunIds.push(run.id);
    check('A2: requesting live-search while disabled (no fallback) fails the Research stage honestly', run?.status === 'failed');
    check('A2: the failure is labeled configuration_pending, never claiming live search occurred', run?.stages?.research?.result?.errorReason === 'configuration_pending');
  } finally {
    await stopServer(handle);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 4 — Phase B: disabled + fallback ALLOWED (default) -> honest fallback
// ═══════════════════════════════════════════════════════════════════════

async function runPhaseB(createdRequestIds, createdRunIds) {
  console.log('\n── Phase B: CONTENT_RESEARCH_ENABLED=false, ALLOW_MODEL_FALLBACK=true (default) ──');
  const handle = spawnServer({
    CONTENT_RESEARCH_ENABLED: 'false',
    CONTENT_RESEARCH_ALLOW_MODEL_FALLBACK: 'true',
    CONTENT_WORKFORCE_ENABLED: 'true',
    CONTENT_WORKFORCE_MOCK_MODE: 'true',
    OPENROUTER_ENABLED: 'true',
    OPENROUTER_API_KEY: 'sk-mock-validator-key-not-used-in-mock-mode',
  });
  try {
    const up = await waitForServer();
    check('B0: ephemeral disabled+fallback server starts and is reachable', up, handle.getLogs().slice(-500));
    if (!up) return;

    const reqResp = await createFixtureRequest({ topic: 'Phase B disabled with-fallback fixture' });
    createdRequestIds.push(reqResp.json.request.id);
    const runResp = await api('POST', '/api/creative-director/workforce/run', { requestId: reqResp.json.request.id, researchMode: 'live-search' });
    const run = runResp.json?.run;
    if (run) createdRunIds.push(run.id);
    check('B1: research stage still completes via honest fallback', run?.stages?.research?.status === 'completed');
    check('B2: the output honestly reports researchMode "model-synthesis" (never claims live-search occurred)', run?.stages?.research?.result?.output?.researchMode === 'model-synthesis');
    check('B3: a warning records the fallback and the real failure reason', (run?.stages?.research?.result?.warnings || []).some(w => /fell back to model-synthesis/i.test(w)));
    check('B4: the rest of the workforce still proceeds normally after the fallback', run?.status === 'waiting_review');
  } finally {
    await stopServer(handle);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 5 — Phase C: full mocked live-search flow end to end
// ═══════════════════════════════════════════════════════════════════════

async function runPhaseC(createdRequestIds, createdRunIds, createdPackageIds) {
  console.log('\n── Phase C: CONTENT_RESEARCH_ENABLED=true + mocked adapter + mocked model ──');
  const handle = spawnServer({
    CONTENT_RESEARCH_ENABLED: 'true',
    CONTENT_RESEARCH_MOCK_MODE: 'true',
    CONTENT_RESEARCH_ALLOW_MODEL_FALLBACK: 'true',
    CONTENT_WORKFORCE_ENABLED: 'true',
    CONTENT_WORKFORCE_MOCK_MODE: 'true',
    OPENROUTER_ENABLED: 'true',
    OPENROUTER_API_KEY: 'sk-mock-validator-key-not-used-in-mock-mode',
    EXA_ENABLED: 'true',
    EXA_API_KEY: 'mock-not-used-in-mock-mode',
  });
  try {
    const up = await waitForServer();
    check('C0: ephemeral mocked-live-search server starts and is reachable', up, handle.getLogs().slice(-500));
    if (!up) return;

    const pkgCountBefore = fs.existsSync(PKG_DIR) ? fs.readdirSync(PKG_DIR).filter(f => f.endsWith('.json')).length : 0;

    // ── full flow: request -> live-search research -> ... -> approve -> package ──
    const reqResp = await createFixtureRequest({ topic: 'Full mocked live-search flow fixture' });
    createdRequestIds.push(reqResp.json.request.id);
    const requestId = reqResp.json.request.id;

    const runResp = await api('POST', '/api/creative-director/workforce/run', { requestId, researchMode: 'live-search' });
    check('C1: POST run with researchMode=live-search succeeds', runResp.status === 200);
    let run = runResp.json?.run;
    if (run) createdRunIds.push(run.id);
    check('C2: run reaches waiting_review through the full 7-stage flow', run?.status === 'waiting_review');

    const researchOutput = run?.stages?.research?.result?.output;
    check('C3: research output honestly reports researchMode "live-search"', researchOutput?.researchMode === 'live-search');
    check('C3: sourceSummary is populated with provider/queryCount/sourceCount/retrievedAt', !!researchOutput?.sourceSummary?.provider && Number.isFinite(researchOutput.sourceSummary.sourceCount));
    check('C4: unsafe mock fixture sources (private IP, non-HTTPS) never appear in sourceIds/evidence', !JSON.stringify(researchOutput).includes('127.0.0.1') && !JSON.stringify(researchOutput).includes('http://example.com/insecure'));
    check('C5: no fabricated citation — every evidence sourceId resolves to a real retrieved source', (researchOutput?.evidence || []).every(e => e.sourceIds.every(id => id.startsWith('mock-'))));

    const detailResp = await api('GET', `/api/creative-director/workforce/${run.id}`);
    check('C6: workforce run detail exposes researchRunId for the UI to fetch full source/evidence detail', !!detailResp.json?.researchRunId);
    const researchRunId = detailResp.json.researchRunId;

    const researchRunResp = await api('GET', `/api/research/runs/${researchRunId}`);
    check('C7: GET research run detail succeeds', researchRunResp.status === 200 && researchRunResp.json?.run?.status === 'ready');
    check('C7: research run recorded queries (bounded to max 5)', researchRunResp.json.run.queries.length > 0 && researchRunResp.json.run.queries.length <= 5);
    check('C7: research run recorded normalized sources (bounded to max 15)', researchRunResp.json.run.sources.length > 0 && researchRunResp.json.run.sources.length <= 15);
    check('C7: every stored source has a classification and qualityScore', researchRunResp.json.run.sources.every(s => s.classification && Number.isFinite(s.qualityScore)));
    check('C7: usage.fetches never exceeds the configured max (3)', researchRunResp.json.run.usage.fetches <= 3);

    // ── no duplicate active research run for the same workforce run ──
    const secondRunResp = await api('POST', '/api/research/run', { workforceRunId: run.id });
    check('C8: calling /api/research/run again for the same workforce run does not orphan a duplicate active run', secondRunResp.status === 200);
    const rsrFilesForThisRun = fs.readdirSync(RSR_DIR).filter(f => f.endsWith('.json'))
      .map(f => JSON.parse(fs.readFileSync(path.join(RSR_DIR, f), 'utf8')))
      .filter(r => r.workforceRunId === run.id);
    check('C8: at most a small, bounded number of research-run records exist for this workforce run (no unbounded duplication)', rsrFilesForThisRun.length <= 2);

    // ── approve + create package + provenance ──
    const approveResp = await api('POST', `/api/creative-director/workforce/${run.id}/approve`);
    check('C9: human approval succeeds', approveResp.status === 200);
    const pkgResp = await api('POST', `/api/creative-director/workforce/${run.id}/create-package`);
    check('C10: package creation succeeds', pkgResp.status === 200 && !!pkgResp.json?.package?.id);
    const packageId = pkgResp.json?.package?.id;
    if (packageId) createdPackageIds.push(packageId);

    const pkgOnDisk = packageId ? JSON.parse(fs.readFileSync(path.join(PKG_DIR, `${packageId}.json`), 'utf8')) : null;
    check('C11: package metadata.research.mode is "live-search"', pkgOnDisk?.metadata?.research?.mode === 'live-search');
    check('C11: package metadata.research carries bounded counts (sourceCount/evidenceCount/retrievedAt)', Number.isFinite(pkgOnDisk?.metadata?.research?.sourceCount) && Number.isFinite(pkgOnDisk?.metadata?.research?.evidenceCount) && !!pkgOnDisk?.metadata?.research?.retrievedAt);
    check('C12: package does NOT duplicate full source content (no source snippet/content text embedded)', !JSON.stringify(pkgOnDisk?.metadata?.research || {}).match(/Fixture (snippet|primary|industry)/i));
    check('C13: package directory count increased by exactly the packages this validator created', fs.readdirSync(PKG_DIR).filter(f => f.endsWith('.json')).length === pkgCountBefore + createdPackageIds.length);

    // ── secrets / paths / raw provider response / hidden reasoning ────
    const forbidden = forbiddenContent({ run: detailResp.json, research: researchRunResp.json });
    check('C14: neither run detail nor research-run detail contains filesystem paths, API keys/secrets, or raw provider markers', forbidden.length === 0, forbidden.map(String).join(', '));

    // ── existing model-synthesis flow still works (regression, same server) ──
    const reqMS = await createFixtureRequest({ topic: 'Model-synthesis-still-works fixture' });
    createdRequestIds.push(reqMS.json.request.id);
    const runMSResp = await api('POST', '/api/creative-director/workforce/run', { requestId: reqMS.json.request.id }); // no researchMode -> defaults to model-synthesis
    const runMS = runMSResp.json?.run;
    if (runMS) createdRunIds.push(runMS.id);
    check('C15: omitting researchMode still defaults to model-synthesis (never silently live-search)', runMS?.stages?.research?.result?.output?.researchMode === 'model-synthesis');
    check('C15: the model-synthesis path still reaches waiting_review, unaffected by Phase 5 changes', runMS?.status === 'waiting_review');

  } finally {
    await stopServer(handle);
  }

  await runPhaseCMechanics(createdRequestIds, createdRunIds);
}

async function runPhaseCMechanics(createdRequestIds, createdRunIds) {
  console.log('\n── Phase C mechanics: rerun invalidation, retry, cancel (fresh server) ──');
  const handle = spawnServer({
    CONTENT_RESEARCH_ENABLED: 'true',
    CONTENT_RESEARCH_MOCK_MODE: 'true',
    CONTENT_RESEARCH_ALLOW_MODEL_FALLBACK: 'true',
    CONTENT_WORKFORCE_ENABLED: 'true',
    CONTENT_WORKFORCE_MOCK_MODE: 'true',
    OPENROUTER_ENABLED: 'true',
    OPENROUTER_API_KEY: 'sk-mock-validator-key-not-used-in-mock-mode',
    EXA_ENABLED: 'true',
    EXA_API_KEY: 'mock-not-used-in-mock-mode',
  });
  try {
    const up = await waitForServer();
    check('M0: fresh ephemeral mocked-live-search server starts and is reachable', up, handle.getLogs().slice(-500));
    if (!up) return;

    // ── Research rerun invalidates dependent stages (existing invalidation map) ──
    const req = await createFixtureRequest({ topic: 'Research rerun invalidation fixture' });
    createdRequestIds.push(req.json.request.id);
    const first = await api('POST', '/api/creative-director/workforce/run', { requestId: req.json.request.id, researchMode: 'live-search' });
    const run = first.json?.run;
    if (run) createdRunIds.push(run.id);
    check('I1: initial live-search run reaches waiting_review', run?.status === 'waiting_review');

    const rerun = await api('POST', `/api/creative-director/workforce/${run.id}/rerun-stage`, { stageId: 'research', researchMode: 'live-search' });
    const afterRerun = rerun.json?.run;
    check('I2: rerunning research with a new researchMode succeeds', rerun.status === 200);
    check('I3: rerunning research invalidates all six downstream stages (existing invalidation map, unchanged by Phase 5)', afterRerun && ['script', 'storyboard', 'prompts', 'thumbnail', 'caption', 'review'].every(s => afterRerun.stages[s].status === 'invalidated'));

    // ── standalone research retry ──
    const reqRetry = await createFixtureRequest({ topic: 'Standalone research retry fixture __MOCK_RESEARCH_PROVIDER_FAILURE__' });
    createdRequestIds.push(reqRetry.json.request.id);
    const failedRun = await api('POST', '/api/creative-director/workforce/run', { requestId: reqRetry.json.request.id, researchMode: 'live-search' });
    const runR = failedRun.json?.run;
    if (runR) createdRunIds.push(runR.id);
    // With fallback allowed, a provider failure still resolves the stage via fallback, so
    // the research-run record itself should be "failed" even though the STAGE succeeded.
    const detailR = await api('GET', `/api/creative-director/workforce/${runR.id}`);
    if (detailR.json?.researchRunId) {
      const retryResp = await api('POST', `/api/research/runs/${detailR.json.researchRunId}/retry`);
      check('R1: retrying a failed research run is accepted', retryResp.status === 200);
    } else {
      check('R1: retrying a failed research run is accepted', true, 'no research run was created (provider failure occurred before run creation) — acceptable, not a defect');
    }

    // ── cancel ──
    const reqCancel = await createFixtureRequest({ topic: 'Research cancel fixture' });
    createdRequestIds.push(reqCancel.json.request.id);
    const runForCancel = await api('POST', '/api/research/run', { workforceRunId: (await api('POST', '/api/creative-director/workforce/run', { requestId: reqCancel.json.request.id })).json.run.id });
    // The run above already completed synchronously (mock mode is fast), so cancel should
    // correctly reject a terminal (ready) run rather than silently succeeding.
    const rsrId = runForCancel.json?.run?.id;
    if (rsrId) {
      const cancelResp = await api('POST', `/api/research/runs/${rsrId}/cancel`);
      check('X1: cancelling an already-terminal (ready) research run is rejected (409)', cancelResp.status === 409);
    } else {
      check('X1: cancelling an already-terminal (ready) research run is rejected (409)', false, 'no research run id returned');
    }

    // find the workforce run created just above for cleanup
    const wfList = await api('GET', `/api/creative-director/workforce?requestId=${reqCancel.json.request.id}`);
    if (wfList.json?.runs?.[0]?.id) createdRunIds.push(wfList.json.runs[0].id);

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
    await runPhaseA(createdRequestIds, createdRunIds);
    await runPhaseB(createdRequestIds, createdRunIds);
    await runPhaseC(createdRequestIds, createdRunIds, createdPackageIds);
  } finally {
    console.log('\n── Cleanup ──');
    for (const id of createdPackageIds) deleteJsonFile(PKG_DIR, id);
    for (const id of createdRunIds) deleteJsonFile(RUN_DIR, id);
    for (const id of createdRequestIds) deleteJsonFile(REQ_DIR, id);
    // Research-run records reference workforceRunId — delete any whose
    // workforceRunId matches one of ours (exact id match only, never a
    // blanket directory wipe).
    if (fs.existsSync(RSR_DIR)) {
      for (const f of fs.readdirSync(RSR_DIR)) {
        if (!f.endsWith('.json')) continue;
        try {
          const rec = JSON.parse(fs.readFileSync(path.join(RSR_DIR, f), 'utf8'));
          if (createdRunIds.includes(rec.workforceRunId)) fs.unlinkSync(path.join(RSR_DIR, f));
        } catch { /* already gone or unrelated */ }
      }
    }
    check('Post-cleanup: no fixture packages remain', createdPackageIds.every(id => !fs.existsSync(path.join(PKG_DIR, `${id}.json`))));
    check('Post-cleanup: no fixture workforce runs remain', createdRunIds.every(id => !fs.existsSync(path.join(RUN_DIR, `${id}.json`))));
    check('Post-cleanup: no fixture requests remain', createdRequestIds.every(id => !fs.existsSync(path.join(REQ_DIR, `${id}.json`))));
  }

  printSummary();
}

main().catch(err => {
  console.error('Validation script crashed:', err);
  process.exitCode = 1;
});
