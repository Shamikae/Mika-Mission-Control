#!/usr/bin/env node
// Phase E.6 — Content Video Factory verification script
// Checks all 9 categories: data store, API routes, VideoFactory UI,
// ContentArtifactsPanel integration, Executive Intelligence, HyperFrames,
// governance (no paid API calls, no API keys required, manual approval only)

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PASS = '✓';
const FAIL = '✗';

let passed = 0;
let failed = 0;

function check(label, ok, detail = '') {
  if (ok) {
    console.log(`  ${PASS} ${label}`);
    passed++;
  } else {
    console.log(`  ${FAIL} ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function read(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
  catch { return null; }
}

function readJson(rel) {
  const raw = read(rel);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function fileExists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

// ── 1. Data Store ────────────────────────────────────────────────────────────
console.log('\n1. DATA STORE');
const videoJobsJson = readJson('data/video-jobs.json');
check('data/video-jobs.json exists', videoJobsJson !== null);
check('data/video-jobs.json has jobs array', Array.isArray(videoJobsJson?.jobs));

// ── 2. API Routes ────────────────────────────────────────────────────────────
console.log('\n2. API ROUTES');
const listApi   = read('pages/api/video-jobs/list.js');
const createApi = read('pages/api/video-jobs/create.js');
const updateApi = read('pages/api/video-jobs/update.js');

check('pages/api/video-jobs/list.js exists',   listApi   !== null);
check('pages/api/video-jobs/create.js exists', createApi !== null);
check('pages/api/video-jobs/update.js exists', updateApi !== null);

check('list.js returns summary object',     listApi   ? listApi.includes('summary')          : false);
check('create.js sets status to pending',   createApi ? /status:\s*['"]pending['"]/.test(createApi) : false);
check('create.js sets approvalRequired',    createApi ? createApi.includes('approvalRequired') : false);
check('update.js validates VALID_STATUS',   updateApi ? updateApi.includes('VALID_STATUS')     : false);

// ── 3. VideoFactory Component ────────────────────────────────────────────────
console.log('\n3. VIDEO FACTORY COMPONENT');
const vf = read('components/sections/VideoFactory.jsx');
check('components/sections/VideoFactory.jsx exists', vf !== null);
check('VideoFactory has JobCard component',     vf ? vf.includes('JobCard')         : false);
check('VideoFactory has SummaryCard component', vf ? vf.includes('SummaryCard')     : false);
check('VideoFactory has provider filter pills', vf ? vf.includes('PROVIDERS_FILTER'): false);
check('VideoFactory has status filter pills',   vf ? vf.includes('STATUS_FILTERS')  : false);
check('VideoFactory has governance notice',     vf ? vf.includes('Activation Gate') : false);

// ── 4. ContentArtifactsPanel Integration ────────────────────────────────────
console.log('\n4. CONTENT ARTIFACTS PANEL INTEGRATION');
const cap = read('components/sections/ContentArtifactsPanel.jsx');
check('ContentArtifactsPanel.jsx exists',             cap !== null);
check('Has CreateVideoJobModal component',            cap ? cap.includes('CreateVideoJobModal')     : false);
check('Has CREATE VIDEO JOB button',                  cap ? cap.includes('CREATE VIDEO JOB')        : false);
check('Checks for video prompt pack existence',       cap ? cap.includes('hasVideoPack')            : false);
check('Fetches /api/video-router/get-pack',           cap ? cap.includes('get-pack')                : false);
check('Posts to /api/video-jobs/create',              cap ? cap.includes('/api/video-jobs/create')  : false);

// ── 5. ContentDivision Navigation ────────────────────────────────────────────
console.log('\n5. CONTENT DIVISION NAVIGATION');
const cd = read('components/sections/ContentDivision.jsx');
check('ContentDivision.jsx imports VideoFactory',     cd ? cd.includes("import VideoFactory")      : false);
check('Video Factory tab in SPECIAL_VIEWS',           cd ? cd.includes("'video-factory'")           : false);
check('Video Factory rendered in content area',       cd ? cd.includes("activeView === 'video-factory'") : false);

// ── 6. Executive Intelligence Metrics ────────────────────────────────────────
console.log('\n6. EXECUTIVE INTELLIGENCE METRICS');
const briefing = read('pages/api/executive/briefing.js');
const execIntel = read('components/sections/ExecutiveIntelligence.jsx');

check('briefing.js reads data/video-jobs.json',         briefing  ? briefing.includes('video-jobs.json')     : false);
check('briefing.js adds videoJobsTotal to contentFactory', briefing ? briefing.includes('videoJobsTotal')    : false);
check('briefing.js adds videoJobsPending',              briefing  ? briefing.includes('videoJobsPending')    : false);
check('briefing.js adds videoJobsComplete',             briefing  ? briefing.includes('videoJobsComplete')   : false);
check('ExecutiveIntelligence shows video job metrics',  execIntel ? execIntel.includes('VIDEO PRODUCTION')   : false);
check('ExecutiveIntelligence has videoJobsTotal guard', execIntel ? execIntel.includes('videoJobsTotal')     : false);
check('ExecutiveIntelligence shows failed jobs warning',execIntel ? execIntel.includes('videoJobsFailed')    : false);

// ── 7. HyperFrames Provider ───────────────────────────────────────────────────
console.log('\n7. HYPERFRAMES PROVIDER');
const arch     = readJson('data/video-router-architecture.json');
const profiles = readJson('video-router/provider-profiles.json');

const archCommercial  = arch?.providers?.commercial || [];
const archHF          = archCommercial.find(p => p.id === 'hyperframes');
const archRoutingRule = (arch?.routingRules || []).find(r => r.provider === 'hyperframes');
const profileHF       = (profiles?.providers || []).find(p => p.providerId === 'hyperframes');
const brollRouting    = profiles?.contentFormatRouting?.['b-roll'];
const cinematicProd   = profiles?.contentFormatRouting?.['cinematic-product'];

check('HyperFrames in video-router-architecture.json commercial providers', archHF !== undefined);
check('HyperFrames routing rule added (Cinematic Product / B-Roll)',        archRoutingRule !== undefined);
check('HyperFrames provider profile exists in provider-profiles.json',      profileHF !== undefined);
check('HyperFrames has promptStyle: product-cinematic',                     profileHF?.promptStyle === 'product-cinematic');
check('HyperFrames has routingPriority for cinematic-product: 1',           profileHF?.routingPriority?.['cinematic-product'] === 1);
check('contentFormatRouting b-roll primary is now hyperframes',             brollRouting?.primary === 'hyperframes');
check('contentFormatRouting cinematic-product added with hyperframes',      cinematicProd?.primary === 'hyperframes');

// ── 8. Governance — No Paid API Calls ────────────────────────────────────────
console.log('\n8. GOVERNANCE — NO PAID API CALLS');

// Checks that no external provider domain/endpoint is called directly.
// Internal Next.js API routes (/api/...) are allowed.
function noApiCall(src, providerNames) {
  if (!src) return true;
  // Look for fetch/axios/http calls that target provider domains (not /api/ routes)
  const externalCallRe = /(?:fetch|axios\.get|axios\.post|https?\.get|https?\.post|got)\s*\(\s*['"`]https?:\/\//gi;
  const matches = src.match(externalCallRe) || [];
  for (const m of matches) {
    const lower = m.toLowerCase();
    if (providerNames.some(p => lower.includes(p))) return false;
  }
  return true;
}

const PROVIDER_NAMES = ['higgsfield', 'heygen', 'hyperframes', 'openart', 'wan', 'comfyui', 'kling', 'veo'];

check('list.js makes no provider API calls',    noApiCall(listApi,   PROVIDER_NAMES));
check('create.js makes no provider API calls',  noApiCall(createApi, PROVIDER_NAMES));
check('update.js makes no provider API calls',  noApiCall(updateApi, PROVIDER_NAMES));
check('VideoFactory makes no provider API calls', noApiCall(vf, PROVIDER_NAMES));

// ── 9. Governance — Manual Approval Required ─────────────────────────────────
console.log('\n9. GOVERNANCE — MANUAL APPROVAL REQUIRED');
check('create.js sets approvalRequired: true',          createApi ? /approvalRequired:\s*true/.test(createApi) : false);
check('VideoFactory shows approval status in job cards', vf        ? vf.includes('pending') && vf.includes('approved') : false);
check('No provider adapter calls in create route',      createApi ? !createApi.includes('callProvider') && !createApi.includes('generateVideo') : false);
check('No provider adapter calls in update route',      updateApi ? !updateApi.includes('callProvider') && !updateApi.includes('generateVideo') : false);

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(55));
const total = passed + failed;
console.log(`Phase E.6 Video Factory: ${passed}/${total} checks passed`);
if (failed === 0) {
  console.log('All checks passed. Phase E.6 Video Factory is complete.\n');
} else {
  console.log(`${failed} check${failed !== 1 ? 's' : ''} failed. Review output above.\n`);
  process.exit(1);
}
