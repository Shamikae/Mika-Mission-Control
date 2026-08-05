#!/usr/bin/env node
// scripts/validate-higgsfield-mcp-adapter.mjs
//
// Offline validation for Higgsfield MCP Adapter Checkpoint 2 (real
// generate_image/generate_video execution through the Provider Execution
// Engine). NEVER calls callHiggsfieldTool with a real generation tool —
// submit()/poll()'s network-calling paths are exercised only indirectly via
// their extracted pure helpers (buildHiggsfieldSubmitArgs/
// parseHiggsfieldSubmitResponse/mapHiggsfieldPollResponse), which do no I/O
// at all. HTTP checks against the dev server never enqueue/run an
// execution — only GET/PATCH-setup routes and status inspection. Mirrors
// scripts/validate-heygen-mcp-adapter.mjs.

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const BASE = 'http://localhost:3099';

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

function noSecretKeys(obj) {
  const forbidden = ['access_token', 'refresh_token', 'client_secret', 'accessToken', 'refreshToken', 'clientSecret', 'codeVerifier', 'pendingState'];
  const json = JSON.stringify(obj);
  return forbidden.filter(k => json.includes(k));
}

async function main() {
  console.log(`HIGGSFIELD_MCP_ENABLED (.env.local): ${process.env.HIGGSFIELD_MCP_ENABLED}`);

  // ══════════════════════════════════════════════════════════════════════
  // PART A — pure adapter-logic checks (no I/O, no network, never calls
  // callHiggsfieldTool — direct ESM import).
  // ══════════════════════════════════════════════════════════════════════

  const higgsfieldMcpAdapter = (await import('../lib/production/execution/adapters/higgsfieldMcp.adapter.js')).default;
  const {
    validateHiggsfieldProviderInputSync, buildHiggsfieldSubmitArgs, buildHiggsfieldCostPreviewArgs,
    parseHiggsfieldSubmitResponse, mapHiggsfieldPollResponse, REQUIRED_HIGGSFIELD_TOOLS,
  } = await import('../lib/production/execution/adapters/higgsfieldMcp.adapter.js');

  // ── A1: adapter contract shape ──────────────────────────────────────────
  check('A1: adapter has id=higgsfield-mcp', higgsfieldMcpAdapter.id === 'higgsfield-mcp');
  check('A1: adapter has displayName', higgsfieldMcpAdapter.displayName === 'Higgsfield MCP');
  check('A1: adapter executionType=mcp-oauth', higgsfieldMcpAdapter.executionType === 'mcp-oauth');
  check('A1: adapter billingPool=higgsfield-account-credits', higgsfieldMcpAdapter.billingPool === 'higgsfield-account-credits');
  check('A1: adapter supportedModes is exactly [cinematic_broll, product_demo, image_to_video]',
    JSON.stringify([...higgsfieldMcpAdapter.supportedModes].sort()) === JSON.stringify(['cinematic_broll', 'image_to_video', 'product_demo']));
  for (const fn of ['healthCheck', 'validateInput', 'estimate', 'submit', 'poll', 'cancel', 'normalizeResult']) {
    check(`A1: adapter.${fn} is a function`, typeof higgsfieldMcpAdapter[fn] === 'function');
  }
  check('A1: REQUIRED_HIGGSFIELD_TOOLS is exactly the 5 allowlisted tools (no crawl/map/research)',
    JSON.stringify([...REQUIRED_HIGGSFIELD_TOOLS].sort()) === JSON.stringify(['balance', 'generate_image', 'generate_video', 'job_status', 'models_explore'].sort()));

  // ── A2: estimate() — provisional fallback when providerInput is incomplete
  const provisionalEstimate = await higgsfieldMcpAdapter.estimate({ job: { providerInput: {} } });
  check('A2: estimate() falls back to provisional when no model/prompt/mediaType is set', provisionalEstimate.provisional === true && provisionalEstimate.estimateType === 'provisional');
  check('A2: provisional estimate() requires approval', provisionalEstimate.approvalRequired === true);
  check('A2: provisional estimate() reports no numeric estimatedRange (never fabricated)', provisionalEstimate.estimatedRange === null);
  check('A2: provisional estimate() currency is higgsfield-credits', provisionalEstimate.currency === 'higgsfield-credits');
  check('A2: provisional estimate() note is the honest cost-unknown message', /Cost unknown/.test(provisionalEstimate.note));

  // ── A3: pure validation logic (validateHiggsfieldProviderInputSync) ─────
  const samplePkg = { script: { fullText: 'unused for higgsfield — prompt is separate' } };
  const sampleModels = [
    { id: 'nano_banana_2', name: 'Nano Banana 2', aspect_ratios: ['1:1', '9:16', '16:9'], supports_unlim: true },
    { id: 'seedance_2_0_mini', name: 'Seedance 2.0 Mini', aspect_ratios: ['9:16', '16:9'], supports_unlim: true },
  ];

  const validJob = { selectedMode: 'cinematic_broll', providerInput: { mediaType: 'image', model: 'nano_banana_2', prompt: 'A test prompt', aspectRatio: '9:16' } };
  const rValid = validateHiggsfieldProviderInputSync({ job: validJob, pkg: samplePkg, models: sampleModels });
  check('A3: valid mediaType+model+prompt+aspectRatio -> valid', rValid.valid === true, JSON.stringify(rValid.errors));

  const rBadMode = validateHiggsfieldProviderInputSync({ job: { ...validJob, selectedMode: 'avatar_video' }, pkg: samplePkg, models: sampleModels });
  check('A3: unsupported mode is blocked', rBadMode.valid === false && rBadMode.errors.some(e => /cinematic_broll, product_demo, and image_to_video/.test(e)));

  const rNoMediaType = validateHiggsfieldProviderInputSync({ job: { selectedMode: 'cinematic_broll', providerInput: { model: 'nano_banana_2', prompt: 'x' } }, pkg: samplePkg, models: sampleModels });
  check('A3: missing mediaType is blocked', rNoMediaType.valid === false && rNoMediaType.errors.some(e => /mediaType must be one of/.test(e)));

  const rNoModel = validateHiggsfieldProviderInputSync({ job: { selectedMode: 'cinematic_broll', providerInput: { mediaType: 'image', prompt: 'x' } }, pkg: samplePkg, models: sampleModels });
  check('A3: missing model is blocked', rNoModel.valid === false && rNoModel.errors.some(e => /model must be selected/i.test(e)));

  const rInvalidModel = validateHiggsfieldProviderInputSync({ job: { selectedMode: 'cinematic_broll', providerInput: { mediaType: 'image', model: 'not-real', prompt: 'x' } }, pkg: samplePkg, models: sampleModels });
  check('A3: model not in live catalog is blocked', rInvalidModel.valid === false && rInvalidModel.errors.some(e => /not found in the current live Higgsfield model catalog/.test(e)));

  const rBadAspect = validateHiggsfieldProviderInputSync({ job: { selectedMode: 'cinematic_broll', providerInput: { mediaType: 'image', model: 'nano_banana_2', prompt: 'x', aspectRatio: '99:1' } }, pkg: samplePkg, models: sampleModels });
  check('A3: aspect ratio not supported by the selected model is blocked', rBadAspect.valid === false && rBadAspect.errors.some(e => /does not support aspect ratio/.test(e)));

  const rNoPrompt = validateHiggsfieldProviderInputSync({ job: { selectedMode: 'cinematic_broll', providerInput: { mediaType: 'image', model: 'nano_banana_2', prompt: '' } }, pkg: samplePkg, models: sampleModels });
  check('A3: empty prompt is blocked', rNoPrompt.valid === false && rNoPrompt.errors.some(e => /prompt is required/i.test(e)));

  const longPrompt = 'x'.repeat(2001);
  const rLongPrompt = validateHiggsfieldProviderInputSync({ job: { selectedMode: 'cinematic_broll', providerInput: { mediaType: 'image', model: 'nano_banana_2', prompt: longPrompt } }, pkg: samplePkg, models: sampleModels });
  check('A3: prompt exceeding the safety maximum is blocked', rLongPrompt.valid === false && rLongPrompt.errors.some(e => /exceeds Mika's safety maximum/.test(e)));

  const rBadDuration = validateHiggsfieldProviderInputSync({ job: { selectedMode: 'cinematic_broll', providerInput: { mediaType: 'video', model: 'seedance_2_0_mini', prompt: 'x', durationSeconds: 999 } }, pkg: samplePkg, models: sampleModels });
  check('A3: out-of-range durationSeconds is blocked', rBadDuration.valid === false && rBadDuration.errors.some(e => /durationSeconds must be/.test(e)));

  const rBadCount = validateHiggsfieldProviderInputSync({ job: { selectedMode: 'cinematic_broll', providerInput: { mediaType: 'image', model: 'nano_banana_2', prompt: 'x', outputCount: 3 } }, pkg: samplePkg, models: sampleModels });
  check('A3: outputCount other than 1 is blocked (maximum one output in v1)', rBadCount.valid === false && rBadCount.errors.some(e => /outputCount must be exactly 1/.test(e)));

  const rReferenceRejected = validateHiggsfieldProviderInputSync({ job: { selectedMode: 'cinematic_broll', providerInput: { mediaType: 'image', model: 'nano_banana_2', prompt: 'x', referenceArtifactIds: ['art-1'] } }, pkg: samplePkg, models: sampleModels });
  check('A3: non-empty referenceArtifactIds is blocked (not implemented this checkpoint)', rReferenceRejected.valid === false && rReferenceRejected.errors.some(e => /Reference image input is not implemented/.test(e)));

  const rNegativePromptRejected = validateHiggsfieldProviderInputSync({ job: { selectedMode: 'cinematic_broll', providerInput: { mediaType: 'image', model: 'nano_banana_2', prompt: 'x', negativePrompt: 'bad stuff' } }, pkg: samplePkg, models: sampleModels });
  check('A3: negativePrompt is rejected (not a real Higgsfield schema field — never invented)', rNegativePromptRejected.valid === false && rNegativePromptRejected.errors.some(e => /not a supported field/.test(e)));

  check('A3: forgery — no prototype pollution / unknown key echo', !JSON.stringify(rValid).includes('__proto__'));

  // ── A4: buildHiggsfieldSubmitArgs / buildHiggsfieldCostPreviewArgs ───────
  const argsImage = buildHiggsfieldSubmitArgs({ providerInput: { mediaType: 'image', model: 'nano_banana_2', prompt: '  A cat in space  ', aspectRatio: '9:16' } });
  check('A4: submit args include model/prompt(trimmed)/count=1', argsImage.params.model === 'nano_banana_2' && argsImage.params.prompt === 'A cat in space' && argsImage.params.count === 1);
  check('A4: submit args include aspect_ratio when provided', argsImage.params.aspect_ratio === '9:16');
  check('A4: submit args never include duration for an image request', !('duration' in argsImage.params));

  const argsVideo = buildHiggsfieldSubmitArgs({ providerInput: { mediaType: 'video', model: 'seedance_2_0_mini', prompt: 'A dog running', aspectRatio: '9:16', durationSeconds: 5 } });
  check('A4: video submit args include duration', argsVideo.params.duration === 5);

  const argsUnlim = buildHiggsfieldSubmitArgs({ providerInput: { mediaType: 'image', model: 'nano_banana_2', prompt: 'x', useUnlim: true } });
  check('A4: use_unlim included when explicitly set true', argsUnlim.params.use_unlim === true);
  const argsNoUnlim = buildHiggsfieldSubmitArgs({ providerInput: { mediaType: 'image', model: 'nano_banana_2', prompt: 'x' } });
  check('A4: use_unlim omitted when not set (server decides)', !('use_unlim' in argsNoUnlim.params));

  const costArgs = buildHiggsfieldCostPreviewArgs({ providerInput: { mediaType: 'image', model: 'nano_banana_2', prompt: 'x' } });
  check('A4: cost preview args set get_cost:true', costArgs.params.get_cost === true);
  check('A4: cost preview args are otherwise identical to real submit args', costArgs.params.model === 'nano_banana_2' && costArgs.params.prompt === 'x' && costArgs.params.count === 1);

  // ── A5: parseHiggsfieldSubmitResponse — id extraction + malformed responses
  check('A5: extracts job_id (snake_case)', parseHiggsfieldSubmitResponse({ job_id: 'abc123' }).jobId === 'abc123');
  check('A5: extracts jobId (camelCase fallback)', parseHiggsfieldSubmitResponse({ jobId: 'abc456' }).jobId === 'abc456');
  check('A5: extracts id (generic fallback)', parseHiggsfieldSubmitResponse({ id: 'abc789' }).jobId === 'abc789');
  check('A5: extracts generation_id (fallback)', parseHiggsfieldSubmitResponse({ generation_id: 'gen1' }).jobId === 'gen1');
  check('A5: malformed/empty submit response -> jobId null (never crashes)', parseHiggsfieldSubmitResponse({}).jobId === null);
  check('A5: null submit response -> jobId null (never crashes)', parseHiggsfieldSubmitResponse(null).jobId === null);

  // ── A5b: CONFIRMED real shape (image, 2026-08-05) — top-level "generation" wrapper.
  // This is the PRIMARY case: Higgsfield's real generate_image/job_status responses
  // are always { generation: { id, type, status, model, params, results, createdAt } },
  // never flat. Confirmed against a real successful paid generation
  // (id 9dd87c20-e40c-42ac-a5ba-d242b2fd6c31).
  const realSubmitResponse = {
    generation: {
      id: '9dd87c20-e40c-42ac-a5ba-d242b2fd6c31',
      type: 'image',
      status: 'completed',
      model: 'nano_banana_2',
      params: { prompt: 'A cozy neighborhood coffee shop counter with a barista steaming milk, warm morning light, photorealistic', aspect_ratio: '9:16' },
      results: {
        rawUrl: 'https://d1a2b3c4d5e6f7.cloudfront.net/9dd87c20-e40c-42ac-a5ba-d242b2fd6c31/raw.png',
        minUrl: 'https://d1a2b3c4d5e6f7.cloudfront.net/9dd87c20-e40c-42ac-a5ba-d242b2fd6c31/min.png',
      },
      createdAt: '2026-08-05T04:22:35.000Z',
    },
  };
  check('A5b: real generation-wrapper shape extracts id correctly', parseHiggsfieldSubmitResponse(realSubmitResponse).jobId === '9dd87c20-e40c-42ac-a5ba-d242b2fd6c31');

  // ── A5c: plural "generations[]" candidate shape — the real submit-time
  // response shape for generate_video is still unconfirmed (see file header
  // caveat); this is a plausible second shape based on the tool's own docs
  // ("count" 1-4 variants "rendered together in one widget").
  check('A5c: plural generations[] array extracts id from the first item',
    parseHiggsfieldSubmitResponse({ generations: [{ id: 'gen-plural-1' }, { id: 'gen-plural-2' }] }).jobId === 'gen-plural-1');
  check('A5c: results[] array (alternate candidate) extracts id from the first item',
    parseHiggsfieldSubmitResponse({ results: [{ id: 'gen-results-1' }] }).jobId === 'gen-results-1');
  check('A5c: singular "generation" is still checked before either plural fallback',
    parseHiggsfieldSubmitResponse({ generation: { id: 'singular-wins' }, generations: [{ id: 'plural-loses' }] }).jobId === 'singular-wins');

  // ── A6: mapHiggsfieldPollResponse — status mapping + malformed responses ─
  const pollQueued = mapHiggsfieldPollResponse({ status: 'queued' });
  check('A6: queued -> waiting_provider', pollQueued.ok === true && pollQueued.status === 'waiting_provider');
  const pollProcessing = mapHiggsfieldPollResponse({ status: 'processing', progress: 42, poll_after_seconds: 8 });
  check('A6: processing -> waiting_provider, real numeric progress + nextPollSeconds passed through', pollProcessing.status === 'waiting_provider' && pollProcessing.progress === 42 && pollProcessing.nextPollSeconds === 8);
  check('A6: never fabricates progress when provider omits it', mapHiggsfieldPollResponse({ status: 'processing' }).progress === null);
  check('A6: defaults nextPollSeconds to 15 when provider omits poll_after_seconds', mapHiggsfieldPollResponse({ status: 'processing' }).nextPollSeconds === 15);

  const pollCompletedImage = mapHiggsfieldPollResponse({ status: 'completed', output_url: 'https://cdn.higgsfield.example/image.png', type: 'image' });
  check('A6: completed image with valid https URL -> completed with one image output', pollCompletedImage.ok === true && pollCompletedImage.status === 'completed' && pollCompletedImage.outputs?.[0]?.url === 'https://cdn.higgsfield.example/image.png');
  check('A6: completed image output mimeType is image/png', pollCompletedImage.outputs?.[0]?.mimeType === 'image/png');

  const pollCompletedVideo = mapHiggsfieldPollResponse({ status: 'completed', outputs: [{ url: 'https://cdn.higgsfield.example/clip.mp4' }] });
  check('A6: completed video (outputs[].url shape) -> video output, inferred from .mp4 extension', pollCompletedVideo.outputs?.[0]?.mimeType === 'video/mp4');

  // ── A6c: CONFIRMED real shape (image, 2026-08-05) — job_status also returns
  // the top-level "generation" wrapper with results.rawUrl, never a flat output_url.
  const realPollResponse = {
    generation: {
      id: '9dd87c20-e40c-42ac-a5ba-d242b2fd6c31',
      type: 'image',
      status: 'completed',
      model: 'nano_banana_2',
      params: { prompt: 'A cozy neighborhood coffee shop counter with a barista steaming milk, warm morning light, photorealistic', aspect_ratio: '9:16' },
      results: {
        rawUrl: 'https://d1a2b3c4d5e6f7.cloudfront.net/9dd87c20-e40c-42ac-a5ba-d242b2fd6c31/raw.png',
        minUrl: 'https://d1a2b3c4d5e6f7.cloudfront.net/9dd87c20-e40c-42ac-a5ba-d242b2fd6c31/min.png',
      },
      createdAt: '2026-08-05T04:22:35.000Z',
    },
  };
  const pollRealWrapped = mapHiggsfieldPollResponse(realPollResponse);
  check('A6c: real generation-wrapper completed -> ok:true, status completed', pollRealWrapped.ok === true && pollRealWrapped.status === 'completed');
  check('A6c: real generation-wrapper extracts results.rawUrl as the output URL', pollRealWrapped.outputs?.[0]?.url === realPollResponse.generation.results.rawUrl);
  check('A6c: real generation-wrapper output mediaType is image', pollRealWrapped.outputs?.[0]?.mimeType === 'image/png');

  const pollCompletedNoUrl = mapHiggsfieldPollResponse({ status: 'completed' });
  check('A6: completed without a URL -> ok:false, malformed_output (never fabricates a URL)', pollCompletedNoUrl.ok === false && pollCompletedNoUrl.errorReason === 'malformed_output');
  const pollCompletedHttpUrl = mapHiggsfieldPollResponse({ status: 'completed', output_url: 'http://insecure.example/image.png' });
  check('A6: completed with non-https URL is rejected (https required)', pollCompletedHttpUrl.ok === false && pollCompletedHttpUrl.errorReason === 'malformed_output');

  const pollFailed = mapHiggsfieldPollResponse({ status: 'failed', message: 'generic failure' });
  check('A6: generic failure fallback (no failure_code) -> ok:false, provider_error (retryable), message passed through', pollFailed.ok === false && pollFailed.errorReason === 'provider_error' && pollFailed.error === 'generic failure');
  check('A6: generic fallback retryable flag is honest (provider_error IS retryable)', pollFailed.retryable === true);

  const pollWithCode = mapHiggsfieldPollResponse({ status: 'failed', failure_code: 'INSUFFICIENT_CREDITS', failure_message: 'Not enough credits.' });
  check('A6b: failure_code is normalized to a safe lowercase errorReason', pollWithCode.errorReason === 'insufficient_credits', pollWithCode.errorReason);
  check('A6b: failure_message is used as the error message', pollWithCode.error === 'Not enough credits.');
  check('A6b: a plan/entitlement-style failure_code is non-retryable', pollWithCode.retryable === false);
  check('A6b: rawMetadata contains ONLY the sanitized failureCode — no raw response noise', JSON.stringify(pollWithCode.rawMetadata) === JSON.stringify({ failureCode: 'INSUFFICIENT_CREDITS' }));

  const pollFailReason = mapHiggsfieldPollResponse({ status: 'failed', fail_reason: 'UNSUPPORTED_RESOLUTION', message: 'x' });
  check('A6b: fail_reason is accepted as an alternate failure-code field', pollFailReason.errorReason === 'unsupported_resolution');

  const veryLongMessage = 'x'.repeat(2000);
  const pollLongMessage = mapHiggsfieldPollResponse({ status: 'failed', failure_code: 'SOME_CODE', failure_message: veryLongMessage });
  check('A6b: overlong failure_message is clamped to 500 characters', pollLongMessage.error.length === 500, pollLongMessage.error.length);

  const pollWeirdCode = mapHiggsfieldPollResponse({ status: 'failed', failure_code: '  Some Weird!! Code--123  ', failure_message: 'x' });
  check('A6b: a failure_code with mixed case/punctuation normalizes to a safe snake_case value', /^[a-z0-9_]+$/.test(pollWeirdCode.errorReason), pollWeirdCode.errorReason);
  check('A6b: normalized failure_code has no leading/trailing underscores', !pollWeirdCode.errorReason.startsWith('_') && !pollWeirdCode.errorReason.endsWith('_'));

  const pollWithSecretsInRaw = mapHiggsfieldPollResponse({
    status: 'failed', failure_code: 'INSUFFICIENT_CREDITS', failure_message: 'Not enough credits.',
    access_token: 'should-never-appear', output_url: 'https://cdn.higgsfield.example/should-never-appear.png', internal_debug: { anything: 'should not leak either' },
  });
  check('A6b: normalized failure result never carries the raw provider response through', noSecretKeys(pollWithSecretsInRaw).length === 0 && !JSON.stringify(pollWithSecretsInRaw).includes('should-never-appear'));

  check('A6b: not_found failure carries retryable:false', mapHiggsfieldPollResponse({ status: 'not_found' }).retryable === false);
  check('A6b: completed-without-URL failure carries retryable:false', mapHiggsfieldPollResponse({ status: 'completed' }).retryable === false);

  const pollNotFound = mapHiggsfieldPollResponse({ status: 'not_found' });
  check('A6: not_found -> ok:false, malformed_output (non-retryable)', pollNotFound.ok === false && pollNotFound.errorReason === 'malformed_output');
  const pollUnknown = mapHiggsfieldPollResponse({ status: 'some_future_status_we_have_never_seen' });
  check('A6: unrecognized status never crashes, defaults to waiting_provider', pollUnknown.ok === true && pollUnknown.status === 'waiting_provider');
  const pollMalformed = mapHiggsfieldPollResponse(null);
  check('A6: null poll response never crashes', pollMalformed.ok === true && pollMalformed.status === 'waiting_provider');

  // ── A7: cancel() — honest, non-fabricated cancellation support ──────────
  const cancelResult = await higgsfieldMcpAdapter.cancel({ providerJobId: 'job-123' });
  check('A7: cancel() reports ok:false (not silently claiming success)', cancelResult.ok === false);
  check('A7: cancel() errorReason is provider_cancel_unsupported', cancelResult.errorReason === 'provider_cancel_unsupported');
  check('A7: cancel() warns that provider work may continue and consume credits', /may continue and consume credits/.test(cancelResult.error));

  // ── A8: normalizeResult() passthrough ────────────────────────────────────
  const normalized = higgsfieldMcpAdapter.normalizeResult({ status: 'completed', outputs: [{ id: 'x' }], rawMetadata: { a: 1 } });
  check('A8: normalizeResult() passes through status/outputs/providerMetadata', normalized.status === 'completed' && normalized.outputs.length === 1 && normalized.providerMetadata.a === 1);

  // ── A9: no secrets anywhere in any of the above pure-function outputs ────
  const allPureOutputs = [provisionalEstimate, rValid, argsImage, parseHiggsfieldSubmitResponse({ job_id: 'x' }), pollCompletedImage, cancelResult, normalized];
  check('A9: no OAuth secret fields in any pure adapter output', noSecretKeys(allPureOutputs).length === 0, JSON.stringify(noSecretKeys(allPureOutputs)));

  // ══════════════════════════════════════════════════════════════════════
  // PART B — HTTP checks against the running dev server (setup/discovery
  // routes and status inspection only — never enqueues/runs execution).
  // ══════════════════════════════════════════════════════════════════════

  const up = await waitForServer();
  check('B1: dev server reachable on :3099', up);
  if (!up) { printSummary(); return; }

  const providersResp = await api('GET', '/api/production/providers');
  const higgsfieldMcp = providersResp.json?.providers?.find(p => p.id === 'higgsfield-mcp');
  const higgsfieldOld = providersResp.json?.providers?.find(p => p.id === 'higgsfield');
  const heygenMcp = providersResp.json?.providers?.find(p => p.id === 'heygen-mcp');
  check('B2: higgsfield-mcp entry present in provider registry', !!higgsfieldMcp);
  check('B2: higgsfield-mcp executionType=mcp-oauth, billingPool=higgsfield-account-credits', higgsfieldMcp?.executionType === 'mcp-oauth' && higgsfieldMcp?.billingPool === 'higgsfield-account-credits');
  check('B2: old agent-domain "higgsfield" catalog entry is untouched (still staged, unrelated)', higgsfieldOld?.status === 'staged' && higgsfieldOld?.executionType === 'api_staged');
  check('B2: heygen-mcp entry is unaffected by this milestone (still present, distinct)', !!heygenMcp && heygenMcp.executionType === 'mcp-oauth');
  check('B3: no secret substrings in the providers registry response', noSecretKeys(providersResp.json).length === 0);

  const enabled = String(process.env.HIGGSFIELD_MCP_ENABLED || '').toLowerCase() === 'true';
  if (enabled) {
    console.log(`INFO — B4: higgsfield-mcp live executable=${higgsfieldMcp?.executable}, status=${higgsfieldMcp?.status}, toolCount=${higgsfieldMcp?.toolCount} (real cross-check against live health).`);
  } else {
    check('B4: higgsfield-mcp is not executable while disabled', higgsfieldMcp?.executable === false && higgsfieldMcp?.status === 'disabled');
  }

  const routerPlanResp = await api('GET', '/api/production/jobs');
  check('B5: jobs listing endpoint still responds (no regression to job listing)', routerPlanResp.status === 200 && routerPlanResp.json?.ok === true);

  // ── Discovery routes (models) — read-only ────────────────────────────────
  if (enabled && higgsfieldMcp?.status === 'active') {
    const modelsResp = await api('GET', '/api/production/providers/higgsfield/models?type=image');
    check('B6: GET models?type=image -> 200 ok with a sanitized list', modelsResp.status === 200 && modelsResp.json?.ok === true && Array.isArray(modelsResp.json.models));
    const modelKeys = Object.keys(modelsResp.json?.models?.[0] || {});
    check('B6: model objects only contain the allowlisted fields', modelKeys.every(k => ['id', 'name', 'providerName', 'description', 'aspectRatios', 'durationParam', 'supportsUnlim', 'tags'].includes(k)), JSON.stringify(modelKeys));
    check('B6: at least one real image model was discovered', modelsResp.json.models.length > 0);

    const videoModelsResp = await api('GET', '/api/production/providers/higgsfield/models?type=video');
    check('B7: GET models?type=video -> 200 ok', videoModelsResp.status === 200 && videoModelsResp.json?.ok === true && videoModelsResp.json.models.length > 0);

    const badTypeResp = await api('GET', '/api/production/providers/higgsfield/models?type=crawl');
    check('B8: GET models with an unsupported type is rejected (400) — never silently forwards an arbitrary type to models_explore', badTypeResp.status === 400);

    check('B9: no secrets in models responses', noSecretKeys(modelsResp.json).length === 0 && noSecretKeys(videoModelsResp.json).length === 0);
  } else {
    console.log('SKIP — B6-B9 discovery-route checks (Higgsfield not currently active/connected).');
  }

  // ── provider-input PATCH route — forgery/whitelist checks, using an
  // ISOLATED synthetic fixture package. Cleaned up unconditionally.
  const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const PKG_DIR = path.join(ROOT, 'data', 'content-packages');
  const JOB_DIR = path.join(ROOT, 'data', 'production-jobs');
  const FIXTURE_PKG_ID = `pack-higgsfield-adapter-test-${RUN_ID}`;
  const createdPackageIds = [];
  const createdJobIds = [];

  function writeFixturePackage() {
    const now = new Date().toISOString();
    const pkg = {
      id: FIXTURE_PKG_ID,
      status: 'approved',
      brand: 'Higgsfield Adapter Test Brand',
      platform: 'TikTok',
      goal: 'Engagement',
      topic: 'Higgsfield adapter validator test package',
      audience: '', offer: '', tone: '', videoDuration: '5-10s',
      hooks: [{ text: 'Test hook', angle: 'curiosity' }],
      script: { opening: '', body: '', cta: '', fullText: 'Unused by Higgsfield — prompt is a separate providerInput field.' },
      scenes: [{ order: 1, durationSeconds: 5, visual: 'x', voiceover: 'y', onScreenText: 'z' }],
      caption: 'Test caption', cta: 'Shop now', hashtags: ['test'], keywords: ['test'],
      thumbnail: { headline: 'Test', visualBrief: '', artifactId: null, artifactUrl: null, status: 'not_requested', error: null },
      pipeline: { stage: 'approved', enteredStageAt: now, history: [{ stage: 'approved', at: now, actor: 'validator', note: null }] },
      metadata: { workflowId: FIXTURE_PKG_ID, model: null, provider: 'test-fixture', createdAt: now, updatedAt: now, estimatedCost: null, actualCost: null, instructions: '' },
    };
    fs.mkdirSync(PKG_DIR, { recursive: true });
    fs.writeFileSync(path.join(PKG_DIR, `${FIXTURE_PKG_ID}.json`), JSON.stringify(pkg, null, 2));
    createdPackageIds.push(FIXTURE_PKG_ID);
    return pkg;
  }

  function cleanupFixtures() {
    for (const id of createdPackageIds) { try { fs.unlinkSync(path.join(PKG_DIR, `${id}.json`)); } catch { /* already gone */ } }
    for (const id of createdJobIds) { try { fs.unlinkSync(path.join(JOB_DIR, `${id}.json`)); } catch { /* already gone */ } }
  }

  try {
    writeFixturePackage();
    const planResp = await api('POST', '/api/production/router/plan', { packageId: FIXTURE_PKG_ID, selectedMode: 'cinematic_broll', selectedProvider: 'higgsfield-mcp' });
    if ((planResp.status === 200 || planResp.status === 201) && planResp.json?.ok && planResp.json.job?.id) {
      const jobId = planResp.json.job.id;
      createdJobIds.push(jobId);

      check('B10: freshly created higgsfield-mcp job starts needs_assets/blocked (no model/prompt selected yet)', ['needs_assets', 'blocked'].includes(planResp.json.job.status), planResp.json.job.status);

      const forgeResp = await api('PATCH', `/api/production/jobs/${jobId}/higgsfield-provider-input`, {
        model: 'forged-model', prompt: 'forged prompt',
        execution: { status: 'completed' }, providerJobId: 'hacked', lock: { token: 'x' }, someRandomKey: 'x', referenceArtifactIds: ['nope'],
      });
      check('B11: PATCH higgsfield-provider-input rejects a model not in live discovery (setup forgery blocked), or honestly errors when Higgsfield is not connected', forgeResp.status !== 200 || forgeResp.json?.validation?.valid === false);
      const afterForge = await api('GET', `/api/production/jobs/${jobId}`);
      check('B11: forged execution/providerJobId fields never reached job storage', !afterForge.json?.job?.execution?.providerJobId);
      check('B11: unknown key ("someRandomKey") never persisted into providerInput', !('someRandomKey' in (afterForge.json?.job?.providerInput || {})));
      check('B11: referenceArtifactIds never persisted into providerInput (not in the PATCH whitelist)', !('referenceArtifactIds' in (afterForge.json?.job?.providerInput || {})));

      if (enabled && higgsfieldMcp?.status === 'active') {
        const modelsResp2 = await api('GET', '/api/production/providers/higgsfield/models?type=image');
        const realModel = modelsResp2.json?.models?.[0];
        if (realModel) {
          const goodResp = await api('PATCH', `/api/production/jobs/${jobId}/higgsfield-provider-input`, { mediaType: 'image', model: realModel.id, prompt: 'A validator test prompt, never submitted for real generation.' });
          check('B12: PATCH higgsfield-provider-input with a real model succeeds', goodResp.status === 200 && goodResp.json?.ok === true, JSON.stringify(goodResp.json));
          check('B12: setup validation reports valid once mediaType+model+prompt are set', goodResp.json?.validation?.valid === true, JSON.stringify(goodResp.json?.validation));

          // ── Real, non-generating cost preflight (get_cost:true) ──────────
          const costResp = await api('POST', `/api/production/jobs/${jobId}/higgsfield-cost-preview`);
          check('B13: POST higgsfield-cost-preview succeeds once setup is valid', costResp.status === 200 && costResp.json?.ok === true, JSON.stringify(costResp.json));
          check('B13: real cost preflight is non-provisional with a numeric credits range (get_cost confirmed live)', costResp.json?.estimate?.provisional === false && typeof costResp.json?.estimate?.estimatedRange?.min === 'number');
          check('B13: cost preflight never submits a job (job execution still absent)', !(await api('GET', `/api/production/jobs/${jobId}`)).json?.job?.execution?.providerJobId);
        } else {
          console.log('SKIP — B12/B13 (no model found on this account to test with).');
        }
      } else {
        console.log('SKIP — B12/B13 (Higgsfield not currently active/connected).');
      }
    } else {
      console.log('SKIP — B10-B13 (could not create a synthetic test plan): ', planResp.json?.error);
    }
  } finally {
    cleanupFixtures();
  }

  // ── Regression: existing manual-export / mock-video / heygen-mcp adapters unaffected
  const manualExport = providersResp.json?.providers?.find(p => p.id === 'manual-export');
  const mockVideo = providersResp.json?.providers?.find(p => p.id === 'mock-video');
  check('B14: manual-export adapter unaffected (still executable)', manualExport?.executable === true);
  check('B14: mock-video adapter entry still present and reported honestly', !!mockVideo);
  check('B14: heygen-mcp adapter entry unaffected by this milestone', heygenMcp?.executionType === 'mcp-oauth');

  // ── Regression: OpenArt MCP + HeyGen OAuth + Higgsfield Checkpoint 1 unaffected
  const openArtStatus = await api('GET', '/api/openart/status');
  check('B15: GET /api/openart/status unaffected', openArtStatus.status === 200 && openArtStatus.json?.ok === true);
  const heygenAuthStatus = await api('GET', '/api/production/providers/heygen/status');
  check('B15: GET heygen/status unaffected', heygenAuthStatus.status === 200 && heygenAuthStatus.json?.ok === true);
  const higgsfieldAuthStatus = await api('GET', '/api/production/providers/higgsfield/status');
  check('B15: GET higgsfield/status (Checkpoint 1 route) unaffected', higgsfieldAuthStatus.status === 200 && higgsfieldAuthStatus.json?.ok === true);

  // ── Artifact-serving route: Range support + path-traversal/MIME guard intact
  const traversalResp = await fetch(`${BASE}/api/production/artifacts/${encodeURIComponent('../../../etc/passwd')}`);
  check('B16: artifact route rejects a path-traversal-style id', traversalResp.status === 400 || traversalResp.status === 404);
  const badExtResp = await fetch(`${BASE}/api/production/artifacts/abc.exe`);
  check('B16: artifact route rejects a disallowed extension', badExtResp.status === 400);

  // ══════════════════════════════════════════════════════════════════════
  // PART C — the "provider_submission_unresolved" failure class + governed
  // no-spend reconciliation (lib/production/execution/higgsfieldReconciliation.js).
  // C1-C3 are pure/offline (no I/O). C4-C11 are live HTTP checks against the
  // running dev server — all read-only except C10, which is the one
  // deliberate end-to-end proof: it re-confirms a REAL, already-completed,
  // already-paid generation from this milestone's own approved smoke test
  // (image, id 9dd87c20-e40c-42ac-a5ba-d242b2fd6c31, 2026-08-05) via the
  // free, read-only show_generations + job_status tools and a plain CDN
  // download — zero new Higgsfield spend, never calls generate_image or
  // generate_video. Every fixture package/job/artifact this section creates
  // is deleted unconditionally in its own finally block.
  // ══════════════════════════════════════════════════════════════════════

  const { buildSafeSubmitDiagnostics } = await import('../lib/production/execution/adapters/higgsfieldMcp.adapter.js');
  const { isRetryableErrorReason, NON_RETRYABLE_ERROR_REASONS } = await import('../lib/production/execution/executionRules.js');
  // Imported from the pure matcher module (not higgsfieldReconciliation.js
  // itself) so this stays a direct-import unit test with zero I/O —
  // higgsfieldReconciliation.js also imports productionJobStore.js, which
  // is only resolvable through Next.js's own bundler, not a raw ESM import.
  const { matchHiggsfieldGenerations, classifyHiggsfieldMatches } = await import('../lib/production/execution/higgsfieldReconciliationMatcher.js');

  // ── C1: safe structural diagnostics — key names/booleans only, never values ──
  const sampleToolResult = {
    isError: false,
    text: 'Job 9dd87c20-e40c-42ac-a5ba-d242b2fd6c31 — completed\nhttps://d8j0ntlcm91z4.cloudfront.net/user_secret_path/file.png',
    json: { generation: { id: '9dd87c20-e40c-42ac-a5ba-d242b2fd6c31', results: { rawUrl: 'https://example.com/x.png' } } },
    resources: [{ uri: 'https://example.com/x.png', mimeType: 'image/png' }],
  };
  const diag = buildSafeSubmitDiagnostics(sampleToolResult);
  check('C1: diagnostics topLevelKeys reflect the real envelope (key names only)', JSON.stringify([...diag.topLevelKeys].sort()) === JSON.stringify(['isError', 'json', 'resources', 'text'].sort()));
  check('C1: diagnostics jsonKeys includes "generation" (key name only)', diag.jsonKeys.includes('generation'));
  check('C1: diagnostics nestedKeys.generation lists the generation object\'s own key names', Array.isArray(diag.nestedKeys.generation) && diag.nestedKeys.generation.includes('id') && diag.nestedKeys.generation.includes('results'));
  check('C1: hasText/hasJson/hasResources booleans are correct', diag.hasText === true && diag.hasJson === true && diag.hasResources === true);
  check('C1: textPreview never contains the raw URL', !diag.textPreview.includes('https://') && !diag.textPreview.includes('http://'));
  check('C1: textPreview never contains the raw generation id', !diag.textPreview.includes('9dd87c20-e40c-42ac-a5ba-d242b2fd6c31'));
  check('C1: textPreview is tightly clamped (<= 40 chars)', diag.textPreview.length <= 40);
  check('C1: no URL substring anywhere in the full diagnostics object', !JSON.stringify(diag).includes('https://'));
  const emptyDiag = buildSafeSubmitDiagnostics(null);
  check('C1: null tool result -> safe empty diagnostics, never crashes', emptyDiag.topLevelKeys.length === 0 && emptyDiag.jsonKeys.length === 0 && emptyDiag.hasJson === false && emptyDiag.textPreview === null);

  // ── C2: provider_submission_unresolved is registered as non-retryable ──
  check('C2: provider_submission_unresolved is in NON_RETRYABLE_ERROR_REASONS', NON_RETRYABLE_ERROR_REASONS.has('provider_submission_unresolved'));
  check('C2: isRetryableErrorReason("provider_submission_unresolved") === false', isRetryableErrorReason('provider_submission_unresolved') === false);

  // ── C3: pure reconciliation matcher — zero/one/ambiguous, image + video,
  // narrow time window, and never a raw prompt/URL in a candidate summary ──
  const fakeSubmittedAt = '2026-08-05T04:22:31.726Z';
  const baseProviderInput = { mediaType: 'image', model: 'nano_banana_2', prompt: 'A cozy neighborhood coffee shop counter with a barista steaming milk, warm morning light, photorealistic', aspectRatio: '9:16' };

  check('C3: zero matches when history is empty', matchHiggsfieldGenerations({ providerInput: baseProviderInput, submittedAtIso: fakeSubmittedAt, generations: [] }).length === 0);
  check('C3: classifyHiggsfieldMatches([]) === "no_match"', classifyHiggsfieldMatches([]) === 'no_match');

  const realShapeGeneration = {
    id: '9dd87c20-e40c-42ac-a5ba-d242b2fd6c31', type: 'image', status: 'completed', model: 'nano_banana_flash', // real confirmed provider-side model alias
    params: { prompt: baseProviderInput.prompt, aspect_ratio: '9:16' },
    results: { rawUrl: 'https://example.com/real.png' },
    createdAt: new Date(fakeSubmittedAt).getTime() / 1000 + 5,
  };
  const oneMatch = matchHiggsfieldGenerations({ providerInput: baseProviderInput, submittedAtIso: fakeSubmittedAt, generations: [realShapeGeneration] });
  check('C3: one confident match despite a provider-side model alias (nano_banana_2 -> nano_banana_flash)', oneMatch.length === 1 && oneMatch[0].providerGenerationId === realShapeGeneration.id && oneMatch[0].modelMatches === false);
  check('C3: classifyHiggsfieldMatches(one) === "confident_match"', classifyHiggsfieldMatches(oneMatch) === 'confident_match');
  check('C3: candidate summary never carries the raw prompt or a provider URL', !JSON.stringify(oneMatch).includes(baseProviderInput.prompt) && !JSON.stringify(oneMatch).includes('https://'));

  const decoyGeneration = { ...realShapeGeneration, id: 'decoy-generation-id', createdAt: realShapeGeneration.createdAt + 30 };
  const ambiguous = matchHiggsfieldGenerations({ providerInput: baseProviderInput, submittedAtIso: fakeSubmittedAt, generations: [realShapeGeneration, decoyGeneration] });
  check('C3: two independently-matching generations -> both returned, never pre-selected', ambiguous.length === 2);
  check('C3: classifyHiggsfieldMatches(two) === "ambiguous" (never auto-resolved)', classifyHiggsfieldMatches(ambiguous) === 'ambiguous');

  const outsideWindow = { ...realShapeGeneration, createdAt: realShapeGeneration.createdAt + 3600 };
  check('C3: a generation outside the narrow creation-time window is excluded', matchHiggsfieldGenerations({ providerInput: baseProviderInput, submittedAtIso: fakeSubmittedAt, generations: [outsideWindow] }).length === 0);

  const wrongPrompt = { ...realShapeGeneration, params: { ...realShapeGeneration.params, prompt: 'a completely different, unrelated prompt' } };
  check('C3: a different prompt (different hash) is excluded — never matched on media type/model/time alone', matchHiggsfieldGenerations({ providerInput: baseProviderInput, submittedAtIso: fakeSubmittedAt, generations: [wrongPrompt] }).length === 0);

  const videoProviderInput = { mediaType: 'video', model: 'seedance_2_0_mini', prompt: 'A cozy neighborhood coffee shop counter with a barista steaming milk, warm morning light, photorealistic, slow camera pan', aspectRatio: '9:16', durationSeconds: 5 };
  const videoGeneration = { id: 'a4b89e53-ea98-4779-98b5-e23929d65b3c', type: 'video', status: 'completed', model: 'seedance_2_0_mini', params: { prompt: videoProviderInput.prompt, aspect_ratio: '9:16', duration: 5 }, results: { rawUrl: 'https://example.com/real.mp4' }, createdAt: new Date(fakeSubmittedAt).getTime() / 1000 + 5 };
  const videoMatch = matchHiggsfieldGenerations({ providerInput: videoProviderInput, submittedAtIso: fakeSubmittedAt, generations: [videoGeneration] });
  check('C3: video matching works the same way as image matching', videoMatch.length === 1 && videoMatch[0].providerGenerationId === videoGeneration.id && videoMatch[0].durationMatches === true);

  const wrongDuration = { ...videoGeneration, params: { ...videoGeneration.params, duration: 15 } };
  check('C3: a mismatched duration on a video job is excluded when the job specified one', matchHiggsfieldGenerations({ providerInput: videoProviderInput, submittedAtIso: fakeSubmittedAt, generations: [wrongDuration] }).length === 0);

  // ── C4-C11: live HTTP checks against the reconciliation API route ──────
  const RECON_RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const RECON_BRAND = 'HiggsfieldReconTestBrand';
  const RECON_PKG_ID = `pack-higgsfield-recon-test-${RECON_RUN_ID}`;
  const reconJobIds = [];
  let reconPackageWritten = false;

  function writeReconFixturePackage() {
    const now = new Date().toISOString();
    const pkg = {
      id: RECON_PKG_ID, status: 'approved', brand: RECON_BRAND, platform: 'TikTok', goal: 'Engagement',
      topic: 'Reconciliation validator fixture package', audience: '', offer: '', tone: '', videoDuration: '5-10s',
      hooks: [{ text: 'Test hook', angle: 'curiosity' }],
      script: { opening: '', body: '', cta: '', fullText: 'Unused by Higgsfield.' },
      scenes: [{ order: 1, durationSeconds: 5, visual: 'x', voiceover: '', onScreenText: '' }],
      caption: 'Test caption', cta: 'Learn more', hashtags: ['test'], keywords: ['test'],
      thumbnail: { headline: 'Test', visualBrief: '', artifactId: null, artifactUrl: null, status: 'not_requested', error: null },
      pipeline: { stage: 'approved', enteredStageAt: now, history: [{ stage: 'approved', at: now, actor: 'validator', note: null }] },
      metadata: { workflowId: RECON_PKG_ID, model: null, provider: 'test-fixture', createdAt: now, updatedAt: now, estimatedCost: null, actualCost: null, instructions: '' },
      production: null,
    };
    fs.mkdirSync(PKG_DIR, { recursive: true });
    fs.writeFileSync(path.join(PKG_DIR, `${RECON_PKG_ID}.json`), JSON.stringify(pkg, null, 2));
    reconPackageWritten = true;
  }

  function writeReconciliationFixtureJob({ suffix, providerInput, errorReason, executionStatus, startedAt }) {
    const jobId = `pr-recon-test-${RECON_RUN_ID}-${suffix}`;
    const now = new Date().toISOString();
    const job = {
      id: jobId, packageId: RECON_PKG_ID, packageUpdatedAt: now, stalePackage: false,
      status: executionStatus === 'completed' ? 'completed' : 'failed',
      eligibility: { eligible: true, reasons: [] }, recommendedMode: 'cinematic_broll', selectedMode: 'cinematic_broll',
      modeReason: 'fixture', recommendedProvider: 'higgsfield-mcp', selectedProvider: 'higgsfield-mcp',
      providerInput, preferredFutureProvider: 'higgsfield', providerCandidates: [], unavailableReasons: {}, missingActivationRequirements: [],
      readiness: { ready: true, score: 70, available: [], missingRequired: [], missingOptional: [], warnings: [] },
      scenes: { count: 1, totalDurationSeconds: 5, orderedSegments: [] },
      voiceoverScript: { available: false, wordCount: 0, estimatedDurationSeconds: 0 },
      captionPlan: { source: 'none', segmentsWithText: 0, totalSegments: 1 },
      visualAssetPlan: { thumbnailAvailable: false, thumbnailArtifactId: null, referenceImageAvailable: false, productImageAvailable: false, brandAssetsAvailable: false },
      audioPlan: { voiceoverNeeded: false, voiceoverAvailable: false, musicNeeded: false, musicAvailable: false },
      outputSpec: { platform: 'TikTok', targetDuration: 'Not specified', aspectRatio: '9:16', resolution: '1080x1920', frameRate: 30, captionBurnIn: true, safeAreaNotes: '', fileFormat: 'mp4' },
      budget: { estimateType: 'provisional_tier', estimatedRange: null, costTier: 'variable', approvalRequired: true, approvalReason: '', maxEstimatedCost: null, currency: 'USD', approvalRequiredAbove: null },
      approval: { required: true, requestedAt: now, approvedAt: now, approvedBy: 'validator', rejectedAt: null, rejectedBy: null, notes: '' },
      review: { status: 'unreviewed', reviewedAt: null, reviewedBy: null, note: '' },
      metadata: { createdAt: now, updatedAt: now, createdBy: 'validator', userNotes: '' },
      activityHistory: [{ type: 'job_created', at: now, actor: 'validator', note: 'Reconciliation validator fixture — not a real production job.', metadata: null }],
      execution: {
        status: executionStatus, provider: 'higgsfield-mcp', providerJobId: null, attemptCount: 1, maxAttempts: 3,
        startedAt, updatedAt: now, completedAt: null, cancelledAt: null, lastPollAt: null, nextPollAt: null, progress: null,
        error: executionStatus === 'failed' ? 'synthetic validator fixture' : null, errorReason, outputs: [], providerMetadata: null, mock: false, lock: null,
      },
    };
    fs.mkdirSync(JOB_DIR, { recursive: true });
    fs.writeFileSync(path.join(JOB_DIR, `${jobId}.json`), JSON.stringify(job, null, 2));
    reconJobIds.push(jobId);
    return jobId;
  }

  function cleanupReconFixtures() {
    for (const id of reconJobIds) {
      try { fs.unlinkSync(path.join(JOB_DIR, `${id}.json`)); } catch { /* already gone */ }
      try { fs.rmSync(path.join(ROOT, 'production-artifacts', RECON_BRAND, id), { recursive: true, force: true }); } catch { /* nothing ingested */ }
    }
    if (reconPackageWritten) { try { fs.unlinkSync(path.join(PKG_DIR, `${RECON_PKG_ID}.json`)); } catch { /* already gone */ } }
    try { fs.rmdirSync(path.join(ROOT, 'production-artifacts', RECON_BRAND)); } catch { /* not empty, or never created */ }
  }

  try {
    writeReconFixturePackage();

    // C4 — rejects a non-reconcilable (completed) job, never calls Higgsfield
    const completedJobId = writeReconciliationFixtureJob({ suffix: 'completed', providerInput: { mediaType: 'image', model: 'x', prompt: 'x' }, errorReason: null, executionStatus: 'completed', startedAt: new Date().toISOString() });
    const searchOnCompleted = await api('POST', `/api/production/execution/${completedJobId}/reconcile-provider-submission`, {});
    check('C4: search on a non-reconcilable (completed) job is rejected, never calls Higgsfield', searchOnCompleted.status === 409 && searchOnCompleted.json?.ok === false);

    // C5 — 404s a nonexistent job
    const missingResp = await api('POST', `/api/production/execution/pr-recon-does-not-exist-${RECON_RUN_ID}/reconcile-provider-submission`, {});
    check('C5: reconciliation route 404s a nonexistent job', missingResp.status === 404);

    // C6 — the normal retry endpoint rejects provider_submission_unresolved
    const unresolvedJobId = writeReconciliationFixtureJob({
      suffix: 'unresolved',
      providerInput: { mediaType: 'image', model: 'nano_banana_2', prompt: 'a synthetic prompt with no matching real Higgsfield history', aspectRatio: '9:16' },
      errorReason: 'provider_submission_unresolved', executionStatus: 'failed', startedAt: new Date(Date.now() - 3600_000).toISOString(),
    });
    const retryResp = await api('POST', `/api/production/execution/${unresolvedJobId}/retry`, {});
    check('C6: normal retry endpoint rejects a provider_submission_unresolved job (never resubmits)', retryResp.status === 409 && /not retryable/i.test(retryResp.json?.error || ''));

    if (enabled && higgsfieldAuthStatus.json?.authenticated) {
      // C7 — search with no matching real history -> no_match, zero candidates
      const noMatchResp = await api('POST', `/api/production/execution/${unresolvedJobId}/reconcile-provider-submission`, {});
      check('C7: search for a prompt with no real matching history -> no_match, zero candidates', noMatchResp.status === 200 && noMatchResp.json?.result === 'no_match' && noMatchResp.json?.candidates?.length === 0);

      // C8 — search that DOES match Test 1's real, already-paid generation
      const matchingJobId = writeReconciliationFixtureJob({
        suffix: 'matching',
        providerInput: { mediaType: 'image', model: 'nano_banana_2', prompt: 'A cozy neighborhood coffee shop counter with a barista steaming milk, warm morning light, photorealistic', aspectRatio: '9:16' },
        errorReason: 'provider_submission_unresolved', executionStatus: 'failed', startedAt: '2026-08-05T04:22:31.726Z',
      });
      const matchResp = await api('POST', `/api/production/execution/${matchingJobId}/reconcile-provider-submission`, {});
      check('C8: search correctly finds the real Test 1 generation as a single confident match', matchResp.status === 200 && matchResp.json?.result === 'confident_match' && matchResp.json?.candidates?.[0]?.providerGenerationId === '9dd87c20-e40c-42ac-a5ba-d242b2fd6c31');
      check('C8: search response never leaks a prompt or provider URL', !JSON.stringify(matchResp.json).includes('barista') && !JSON.stringify(matchResp.json).includes('https://'));

      // C9 — confirm rejects a bogus/unverified id
      const bogusConfirm = await api('POST', `/api/production/execution/${matchingJobId}/reconcile-provider-submission`, { confirmedProviderGenerationId: 'not-a-real-candidate-id' });
      check('C9: confirm rejects an id that is not among the freshly matched candidates', bogusConfirm.status === 409);

      // C10 — confirm with the correct id: attaches + drives the existing poll
      // path to completion. Zero new Higgsfield spend (job_status + a CDN GET
      // are both free) — never calls generate_image/generate_video.
      const realConfirm = await api('POST', `/api/production/execution/${matchingJobId}/reconcile-provider-submission`, { confirmedProviderGenerationId: '9dd87c20-e40c-42ac-a5ba-d242b2fd6c31' });
      check('C10: confirm attaches the id and drives the job to completed via the existing poll path', realConfirm.status === 200 && realConfirm.json?.job?.execution?.status === 'completed');
      check('C10: providerJobId is exactly the confirmed generation id (never resubmitted)', realConfirm.json?.job?.execution?.providerJobId === '9dd87c20-e40c-42ac-a5ba-d242b2fd6c31');
      check('C10: a real artifact was ingested through the unmodified artifact pipeline', !!realConfirm.json?.job?.execution?.outputs?.[0]?.artifactUrl);
      check('C10: activity history recorded an immutable "execution_reconciled" event', realConfirm.json?.job?.activityHistory?.some(e => e.type === 'execution_reconciled'));

      // C11 — idempotency: a second confirm on the now-completed job is safely rejected
      const secondConfirm = await api('POST', `/api/production/execution/${matchingJobId}/reconcile-provider-submission`, { confirmedProviderGenerationId: '9dd87c20-e40c-42ac-a5ba-d242b2fd6c31' });
      check('C11: idempotent — a second confirm on an already-reconciled job is safely rejected, not re-applied', secondConfirm.status === 409);
    } else {
      console.log('SKIP — C7-C11 (Higgsfield not currently connected/active).');
    }
  } finally {
    cleanupReconFixtures();
  }

  // ── C12: no changes to sibling systems' own behavior outside this narrow extension ──
  check('C12: HeyGen MCP adapter entry unaffected by this hardening pass', heygenMcp?.executionType === 'mcp-oauth');
  const hyperframesStatus = await api('GET', '/api/production/providers');
  const hyperframesEntry = hyperframesStatus.json?.providers?.find(p => p.id === 'hyperframes');
  check('C12: HyperFrames provider entry unaffected by this hardening pass', !hyperframesEntry || hyperframesEntry.status === 'staged');

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
