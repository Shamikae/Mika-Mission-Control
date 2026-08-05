#!/usr/bin/env node
// scripts/validate-openart-video-mcp-adapter.mjs
//
// Offline + live validation for the OpenArt Video MCP Adapter (real
// openart_generate_video/openart_creation_get execution through the
// Provider Execution Engine). NEVER calls callOpenArtTool with a real
// generation tool — submit()/poll()'s network-calling paths are exercised
// only indirectly via their extracted pure helpers
// (buildOpenArtVideoSubmitArgs/parseOpenArtVideoSubmitResponse/
// mapOpenArtVideoPollResponse), which do no I/O at all. HTTP checks against
// the dev server never enqueue/run an execution — only GET/PATCH-setup
// routes, cost preflight (openart_model_cost — confirmed non-generating),
// and status inspection. Mirrors scripts/validate-higgsfield-mcp-adapter.mjs.

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

function noSecretKeys(obj) {
  const forbidden = ['access_token', 'refresh_token', 'client_secret', 'accessToken', 'refreshToken', 'clientSecret', 'codeVerifier', 'code_verifier', 'pendingState', 'registration_secret', 'registrationSecret'];
  const json = JSON.stringify(obj);
  return forbidden.filter(k => json.includes(k));
}

async function main() {
  console.log(`OPENART_ENABLED (.env.local): ${process.env.OPENART_ENABLED}`);

  // ══════════════════════════════════════════════════════════════════════
  // PART A — pure adapter-logic checks (no I/O, no network, never calls
  // callOpenArtTool — direct ESM import).
  // ══════════════════════════════════════════════════════════════════════

  const openartVideoMcpAdapter = (await import('../lib/production/execution/adapters/openartVideoMcp.adapter.js')).default;
  const {
    validateOpenArtVideoProviderInputSync, buildOpenArtVideoSubmitArgs, buildOpenArtVideoCostPreviewArgs,
    parseOpenArtVideoSubmitResponse, mapOpenArtVideoPollResponse, resolveOpenArtVideoFormSchema,
    buildSafeOpenArtVideoDiagnostics, REQUIRED_OPENART_VIDEO_TOOLS,
  } = await import('../lib/production/execution/adapters/openartVideoMcp.adapter.js');
  const { isRetryableErrorReason, NON_RETRYABLE_ERROR_REASONS } = await import('../lib/production/execution/executionRules.js');
  const { PROVIDER_CATALOG } = await import('../lib/production/productionRules.js');

  // ── A1: adapter identity ─────────────────────────────────────────────
  check('A1: adapter has id=openart-video', openartVideoMcpAdapter.id === 'openart-video');
  check('A1: adapter has displayName', openartVideoMcpAdapter.displayName === 'OpenArt Video');
  check('A1: adapter executionType=mcp', openartVideoMcpAdapter.executionType === 'mcp');
  check('A1: adapter billingPool=openart-credits', openartVideoMcpAdapter.billingPool === 'openart-credits');
  check('A1: adapter supportedModes is exactly [cinematic_broll, product_demo] (image_to_video excluded — no reference-media path implemented)',
    JSON.stringify([...openartVideoMcpAdapter.supportedModes].sort()) === JSON.stringify(['cinematic_broll', 'product_demo'].sort()));
  check('A1: REQUIRED_OPENART_VIDEO_TOOLS is exactly the 6 allowlisted tools',
    JSON.stringify([...REQUIRED_OPENART_VIDEO_TOOLS].sort()) === JSON.stringify(['openart_generate_video', 'openart_creation_get', 'openart_model_list', 'openart_model_form_get', 'openart_model_cost', 'openart_account_get'].sort()));

  // ── A2: catalog correction (pure data — no live call needed) ─────────
  const catalogEntry = PROVIDER_CATALOG.find(p => p.id === 'openart-video');
  check('A2: catalog entry exists', !!catalogEntry);
  check('A2: catalog supportedModes corrected — no "slideshow", no "image_to_video"', !catalogEntry.supportedModes.includes('slideshow') && !catalogEntry.supportedModes.includes('image_to_video'));
  check('A2: catalog supportedModes includes cinematic_broll (the real text2video capability)', catalogEntry.supportedModes.includes('cinematic_broll'));
  check('A2: catalog executionType corrected to "mcp"', catalogEntry.executionType === 'mcp');
  check('A2: catalog default status is "staged" (live-patched at runtime, same pattern as heygen-mcp/higgsfield-mcp)', catalogEntry.status === 'staged');
  check('A2: catalog supportsReferenceImage is honestly false (not implemented this checkpoint)', catalogEntry.supportsReferenceImage === false);

  // ── A3: resolveOpenArtVideoFormSchema — real confirmed shapes ─────────
  const simpleShapeFixture = {
    jsonSchema: {
      allOf: [{ type: 'object', properties: { prompt: { $ref: '#/$defs/__schema0' }, duration: { $ref: '#/$defs/__schema2' }, aspectRatio: { $ref: '#/$defs/__schema3' } }, required: ['prompt', 'duration', 'aspectRatio'] }],
      $defs: { __schema0: { type: 'string' }, __schema2: { type: 'integer', minimum: 4, maximum: 15, default: 5 }, __schema3: { type: 'string', enum: ['16:9', '9:16'], default: '16:9' } },
    },
  };
  const simpleResolved = resolveOpenArtVideoFormSchema(simpleShapeFixture);
  check('A3: simple (allOf-object) schema resolves supported:true', simpleResolved.supported === true);
  check('A3: simple schema resolves $ref indirection correctly (duration minimum/maximum/default)', simpleResolved.properties.duration.minimum === 4 && simpleResolved.properties.duration.maximum === 15 && simpleResolved.properties.duration.default === 5);
  check('A3: simple schema resolves aspectRatio enum correctly', JSON.stringify(simpleResolved.properties.aspectRatio.enum) === JSON.stringify(['16:9', '9:16']));

  const oneOfFixture = { jsonSchema: { allOf: [{ oneOf: [{ type: 'object', properties: {} }, { type: 'object', properties: {} }] }], $defs: {} } };
  const oneOfResolved = resolveOpenArtVideoFormSchema(oneOfFixture);
  check('A3: oneOf-discriminated schema (e.g. gemini-omni-flash, wan2-7) resolves supported:false — never guessed', oneOfResolved.supported === false && typeof oneOfResolved.reason === 'string' && oneOfResolved.reason.length > 0);

  const anyOfFixture = { jsonSchema: { allOf: [{ anyOf: [{ type: 'object', properties: {} }] }], $defs: {} } };
  const anyOfResolved = resolveOpenArtVideoFormSchema(anyOfFixture);
  check('A3: anyOf-discriminated schema (e.g. kling-3-omni) resolves supported:false — never guessed', anyOfResolved.supported === false);

  check('A3: missing/empty schema resolves supported:false, never crashes', resolveOpenArtVideoFormSchema(null).supported === false && resolveOpenArtVideoFormSchema({}).supported === false);

  // ── A4: strict input validation ────────────────────────────────────────
  const baseProviderInput = { model: 'byte-plus-seedance-2-mini', prompt: 'a cat in space', durationSeconds: 5, aspectRatio: '9:16', resolution: '720p' };
  const rValid = validateOpenArtVideoProviderInputSync({ job: { selectedMode: 'cinematic_broll', providerInput: baseProviderInput }, models: [{ id: 'byte-plus-seedance-2-mini' }], formSchema: simpleShapeFixtureResolved() });
  check('A4: valid model+prompt+duration+aspectRatio -> valid', rValid.valid === true, JSON.stringify(rValid.errors));

  function simpleShapeFixtureResolved() {
    return {
      supported: true,
      properties: { duration: { minimum: 4, maximum: 15, default: 5 }, aspectRatio: { enum: ['16:9', '9:16'] }, resolution: { enum: ['480p', '720p'] } },
      required: ['prompt', 'duration', 'aspectRatio', 'resolution'],
    };
  }

  const rBadMode = validateOpenArtVideoProviderInputSync({ job: { selectedMode: 'image_to_video', providerInput: baseProviderInput }, models: null, formSchema: null });
  check('A4: unsupported mode (image_to_video) is blocked', rBadMode.valid === false && rBadMode.errors.some(e => /cinematic_broll, product_demo/.test(e)));

  const rNoModel = validateOpenArtVideoProviderInputSync({ job: { selectedMode: 'cinematic_broll', providerInput: { ...baseProviderInput, model: undefined } }, models: null, formSchema: null });
  check('A4: missing model is blocked', rNoModel.valid === false && rNoModel.errors.some(e => /model must be selected/i.test(e)));

  const rInvalidModel = validateOpenArtVideoProviderInputSync({ job: { selectedMode: 'cinematic_broll', providerInput: baseProviderInput }, models: [{ id: 'some-other-model' }], formSchema: simpleShapeFixtureResolved() });
  check('A4: model not in live catalog is blocked', rInvalidModel.valid === false && rInvalidModel.errors.some(e => /not found in the current live OpenArt/.test(e)));

  const rNoPrompt = validateOpenArtVideoProviderInputSync({ job: { selectedMode: 'cinematic_broll', providerInput: { ...baseProviderInput, prompt: '  ' } }, models: [{ id: 'byte-plus-seedance-2-mini' }], formSchema: simpleShapeFixtureResolved() });
  check('A4: empty prompt is blocked', rNoPrompt.valid === false && rNoPrompt.errors.some(e => /prompt is required/i.test(e)));

  const rLongPrompt = validateOpenArtVideoProviderInputSync({ job: { selectedMode: 'cinematic_broll', providerInput: { ...baseProviderInput, prompt: 'x'.repeat(2001) } }, models: [{ id: 'byte-plus-seedance-2-mini' }], formSchema: simpleShapeFixtureResolved() });
  check('A4: prompt exceeding the safety maximum is blocked', rLongPrompt.valid === false && rLongPrompt.errors.some(e => /exceeds Mika's safety maximum/.test(e)));

  const rBadDuration = validateOpenArtVideoProviderInputSync({ job: { selectedMode: 'cinematic_broll', providerInput: { ...baseProviderInput, durationSeconds: 999 } }, models: [{ id: 'byte-plus-seedance-2-mini' }], formSchema: simpleShapeFixtureResolved() });
  check('A4: durationSeconds outside the model\'s live range is blocked', rBadDuration.valid === false && rBadDuration.errors.some(e => /durationSeconds must be between/.test(e)));

  const rBadAspect = validateOpenArtVideoProviderInputSync({ job: { selectedMode: 'cinematic_broll', providerInput: { ...baseProviderInput, aspectRatio: '5:7' } }, models: [{ id: 'byte-plus-seedance-2-mini' }], formSchema: simpleShapeFixtureResolved() });
  check('A4: aspectRatio not in the model\'s live enum is blocked', rBadAspect.valid === false && rBadAspect.errors.some(e => /aspectRatio "5:7" is not supported/.test(e)));

  const rBadResolution = validateOpenArtVideoProviderInputSync({ job: { selectedMode: 'cinematic_broll', providerInput: { ...baseProviderInput, resolution: '8k' } }, models: [{ id: 'byte-plus-seedance-2-mini' }], formSchema: simpleShapeFixtureResolved() });
  check('A4: resolution not in the model\'s live enum is blocked', rBadResolution.valid === false && rBadResolution.errors.some(e => /resolution "8k" is not supported/.test(e)));

  const rBadOutputCount = validateOpenArtVideoProviderInputSync({ job: { selectedMode: 'cinematic_broll', providerInput: { ...baseProviderInput, outputCount: 4 } }, models: [{ id: 'byte-plus-seedance-2-mini' }], formSchema: simpleShapeFixtureResolved() });
  check('A4: outputCount other than 1 is blocked (one output maximum in v1)', rBadOutputCount.valid === false && rBadOutputCount.errors.some(e => /outputCount must be exactly 1/.test(e)));

  const rUnsupportedSchema = validateOpenArtVideoProviderInputSync({ job: { selectedMode: 'cinematic_broll', providerInput: { ...baseProviderInput, model: 'kling-3-omni' } }, models: [{ id: 'kling-3-omni' }], formSchema: { supported: false, reason: 'multi-variant', properties: {} } });
  check('A4: a model with an unsupported (multi-variant) schema is blocked, never silently allowed', rUnsupportedSchema.valid === false && rUnsupportedSchema.errors.some(e => /not supported in this checkpoint/.test(e)));

  const rReferenceMedia = validateOpenArtVideoProviderInputSync({ job: { selectedMode: 'cinematic_broll', providerInput: { ...baseProviderInput, imageUrl: 'https://example.com/x.png' } }, models: [{ id: 'byte-plus-seedance-2-mini' }], formSchema: simpleShapeFixtureResolved() });
  check('A4: a reference-media field (image2video/element2video) is rejected — text2video only in v1', rReferenceMedia.valid === false && rReferenceMedia.errors.some(e => /image2video, element2video/.test(e)));

  // ── A5: buildOpenArtVideoSubmitArgs — schema-driven, never a fixed field set ──
  const fullSchema = { properties: { duration: {}, aspectRatio: {}, resolution: {}, generateAudio: { default: true }, seed: { default: -1 } } };
  const argsFull = buildOpenArtVideoSubmitArgs({ providerInput: baseProviderInput, formSchema: fullSchema });
  check('A5: full schema -> params include prompt(trimmed)/videoCount=1/duration/aspectRatio/resolution/generateAudio/seed', argsFull.params.prompt === 'a cat in space' && argsFull.params.videoCount === 1 && argsFull.params.duration === 5 && argsFull.params.aspectRatio === '9:16' && argsFull.params.resolution === '720p' && argsFull.params.generateAudio === true && argsFull.params.seed === -1);
  check('A5: model/mode set correctly (mode is always text2video in this checkpoint)', argsFull.model === 'byte-plus-seedance-2-mini' && argsFull.mode === 'text2video');

  const noSeedSchema = { properties: { duration: {}, aspectRatio: {}, resolution: {}, generateAudio: { default: false } } }; // pixverseV6-shaped: no seed field
  const argsNoSeed = buildOpenArtVideoSubmitArgs({ providerInput: baseProviderInput, formSchema: noSeedSchema });
  check('A5: a model schema without a "seed" field (confirmed live: pixverseV6) never includes seed in params', !('seed' in argsNoSeed.params));
  check('A5: generateAudio uses the model\'s OWN declared default, not a hardcoded true', argsNoSeed.params.generateAudio === false);

  const minimalSchema = { properties: {} };
  const argsMinimal = buildOpenArtVideoSubmitArgs({ providerInput: baseProviderInput, formSchema: minimalSchema });
  check('A5: an empty/unresolved schema never includes duration/aspectRatio/resolution/generateAudio/seed (safe fallback, never fabricated fields)', !('duration' in argsMinimal.params) && !('aspectRatio' in argsMinimal.params) && !('resolution' in argsMinimal.params) && !('generateAudio' in argsMinimal.params) && !('seed' in argsMinimal.params));
  check('A5: prompt and videoCount are always present regardless of schema', argsMinimal.params.prompt === 'a cat in space' && argsMinimal.params.videoCount === 1);

  const costArgs = buildOpenArtVideoCostPreviewArgs({ providerInput: baseProviderInput, formSchema: fullSchema });
  check('A5: cost preview args are identical in shape to real submit args (same model/mode/params)', JSON.stringify(costArgs) === JSON.stringify(argsFull));

  // ── A6: parseOpenArtVideoSubmitResponse — reuses the PROVEN extractHistoryId ──
  check('A6: extracts historyId (flat json.historyId — the real openart_generate_video/openart_generate_image shape)', parseOpenArtVideoSubmitResponse({ json: { historyId: 'hist-abc', status: 'PENDING' } }).historyId === 'hist-abc');
  check('A6: extracts history_id (snake_case fallback)', parseOpenArtVideoSubmitResponse({ json: { history_id: 'hist-def' } }).historyId === 'hist-def');
  check('A6: malformed/empty submit response -> historyId null (never crashes)', parseOpenArtVideoSubmitResponse({ json: {} }).historyId === null);
  check('A6: null submit response -> historyId null (never crashes)', parseOpenArtVideoSubmitResponse(null).historyId === null);

  // ── A7: mapOpenArtVideoPollResponse — real, documented status vocabulary ──
  const pollPending = mapOpenArtVideoPollResponse({ json: { status: 'PENDING' } });
  check('A7: PENDING -> waiting_provider', pollPending.ok === true && pollPending.status === 'waiting_provider');
  const pollRunning = mapOpenArtVideoPollResponse({ json: { status: 'RUNNING', pollAfterSeconds: 8 } });
  check('A7: RUNNING -> waiting_provider, real pollAfterSeconds passed through', pollRunning.status === 'waiting_provider' && pollRunning.nextPollSeconds === 8);
  check('A7: never fabricates progress (progress is always null — OpenArt reports none)', pollPending.progress === null && pollRunning.progress === null);
  check('A7: defaults nextPollSeconds to 5 when the provider omits pollAfterSeconds', mapOpenArtVideoPollResponse({ json: { status: 'PENDING' } }).nextPollSeconds === 5);
  check('A7: status is case-insensitive (lowercase "pending" still maps correctly)', mapOpenArtVideoPollResponse({ json: { status: 'pending' } }).status === 'waiting_provider');

  const pollCompleted = mapOpenArtVideoPollResponse({ json: { status: 'COMPLETED' }, resources: [{ uri: 'https://cdn.openart.ai/x.mp4', mimeType: 'video/mp4' }] });
  check('A7: COMPLETED with a resource URL -> completed with one video output', pollCompleted.ok === true && pollCompleted.status === 'completed' && pollCompleted.outputs?.[0]?.url === 'https://cdn.openart.ai/x.mp4');
  check('A7: completed output mimeType is video/mp4 (in the shared artifact MIME allowlist)', pollCompleted.outputs?.[0]?.mimeType === 'video/mp4');
  check('A7: completed output type is "video"', pollCompleted.outputs?.[0]?.type === 'video');

  const pollCompletedUrlField = mapOpenArtVideoPollResponse({ json: { status: 'COMPLETED', url: 'https://cdn.openart.ai/y.mp4' } });
  check('A7: COMPLETED with a json.url field (alternate real shape) -> completed', pollCompletedUrlField.ok === true && pollCompletedUrlField.outputs?.[0]?.url === 'https://cdn.openart.ai/y.mp4');

  const pollCompletedNoUrl = mapOpenArtVideoPollResponse({ json: { status: 'COMPLETED' } });
  check('A7: COMPLETED without any URL -> ok:false, malformed_output (never fabricates a URL)', pollCompletedNoUrl.ok === false && pollCompletedNoUrl.errorReason === 'malformed_output');

  const pollFailedGeneric = mapOpenArtVideoPollResponse({ json: { status: 'FAILED', error: 'generic provider error' } });
  check('A7: FAILED (generic message) -> provider_error (retryable), message passed through', pollFailedGeneric.ok === false && pollFailedGeneric.errorReason === 'provider_error' && pollFailedGeneric.error === 'generic provider error' && pollFailedGeneric.retryable === true);

  const pollFailedCredits = mapOpenArtVideoPollResponse({ json: { status: 'FAILED', error: 'Insufficient credits to complete this generation.' } });
  check('A7: FAILED with an "insufficient credits"-pattern message -> insufficient_credits, non-retryable', pollFailedCredits.errorReason === 'insufficient_credits' && pollFailedCredits.retryable === false);

  const pollFailedPlan = mapOpenArtVideoPollResponse({ json: { status: 'FAILED', error: 'Your current plan does not include this feature — upgrade required.' } });
  check('A7: FAILED with a plan/entitlement-pattern message -> entitlement_required, non-retryable', pollFailedPlan.errorReason === 'entitlement_required' && pollFailedPlan.retryable === false);

  const pollCancelled = mapOpenArtVideoPollResponse({ json: { status: 'CANCELLED' } });
  check('A7: CANCELLED -> ok:false, errorReason cancelled, non-retryable', pollCancelled.ok === false && pollCancelled.errorReason === 'cancelled' && pollCancelled.retryable === false);

  const pollUnrecognized = mapOpenArtVideoPollResponse({ json: { status: 'SOME_UNKNOWN_FUTURE_STATUS' } });
  check('A7: an unrecognized status never crashes and never fabricates a terminal state (treated as still in progress)', pollUnrecognized.ok === true && pollUnrecognized.status === 'waiting_provider');
  const pollNull = mapOpenArtVideoPollResponse(null);
  check('A7: null poll response never crashes', pollNull.ok === true && pollNull.status === 'waiting_provider');

  // ── A8: cancel() — no real cancel tool exists in the live 16-tool discovery ──
  const cancelResult = await openartVideoMcpAdapter.cancel({ providerJobId: 'hist-abc' });
  check('A8: cancel() reports ok:false (never claims a remote render was cancelled)', cancelResult.ok === false);
  check('A8: cancel() errorReason is provider_cancel_unsupported', cancelResult.errorReason === 'provider_cancel_unsupported');
  check('A8: cancel() warns that provider work may continue and consume credits', /may continue and consume credits/.test(cancelResult.error));
  const cancelNoJob = await openartVideoMcpAdapter.cancel({ providerJobId: null });
  check('A8: cancel() with no provider job id reports the honest "never submitted" case', /No provider job was ever submitted/.test(cancelNoJob.error));

  // ── A9: normalizeResult() passthrough ──────────────────────────────────
  const normalized = openartVideoMcpAdapter.normalizeResult({ status: 'completed', outputs: [{ type: 'video', url: 'x' }], rawMetadata: { a: 1 } });
  check('A9: normalizeResult() passes through status/outputs/providerMetadata', normalized.status === 'completed' && normalized.outputs.length === 1 && normalized.providerMetadata.a === 1);

  // ── A10: no OAuth secret fields in any pure adapter output ─────────────
  check('A10: no OAuth secret fields in submit args / cost args / poll results', noSecretKeys({ argsFull, argsNoSeed, costArgs, pollPending, pollCompleted, pollFailedCredits }).length === 0);

  // ── A11: non-retryable error reasons registered ─────────────────────────
  check('A11: insufficient_credits is registered as non-retryable', NON_RETRYABLE_ERROR_REASONS.has('insufficient_credits') && isRetryableErrorReason('insufficient_credits') === false);
  check('A11: entitlement_required is registered as non-retryable', NON_RETRYABLE_ERROR_REASONS.has('entitlement_required') && isRetryableErrorReason('entitlement_required') === false);
  check('A11: cancelled is non-retryable (shared reason, confirms no regression to the existing set)', isRetryableErrorReason('cancelled') === false);

  // ── A12: buildSafeOpenArtVideoDiagnostics — structural only, never content ──
  const diagFixture = { isError: false, text: 'Job hist-abc — completed\nhttps://cdn.openart.ai/secret/x.mp4', json: { historyId: 'hist-abc', results: { url: 'https://example.com/x.mp4' } }, resources: [{ uri: 'https://example.com/x.mp4' }] };
  const diag = buildSafeOpenArtVideoDiagnostics(diagFixture);
  check('A12: diagnostics topLevelKeys reflect the real envelope (key names only)', JSON.stringify([...diag.topLevelKeys].sort()) === JSON.stringify(['isError', 'json', 'resources', 'text'].sort()));
  check('A12: diagnostics jsonKeys includes "historyId"/"results" (key names only)', diag.jsonKeys.includes('historyId') && diag.jsonKeys.includes('results'));
  check('A12: no URL substring anywhere in the diagnostics object (structure only, never values)', !JSON.stringify(diag).includes('https://'));
  check('A12: no historyId VALUE anywhere in the diagnostics object', !JSON.stringify(diag).includes('hist-abc'));
  const emptyDiag = buildSafeOpenArtVideoDiagnostics(null);
  check('A12: null result -> safe empty diagnostics, never crashes', emptyDiag.topLevelKeys.length === 0 && emptyDiag.hasJson === false);

  // ══════════════════════════════════════════════════════════════════════
  // PART B — live HTTP checks against the running dev server. Never
  // enqueues/runs an execution — GET/PATCH-setup routes, cost preflight
  // (confirmed non-generating), and status inspection only.
  // ══════════════════════════════════════════════════════════════════════

  const b1 = await api('GET', '/api/production/providers');
  check('B1: dev server reachable on :3099', b1.status === 200 && b1.json?.ok === true);

  const openartVideoEntry = b1.json?.providers?.find(p => p.id === 'openart-video');
  const heygenMcp = b1.json?.providers?.find(p => p.id === 'heygen-mcp');
  const higgsfieldMcp = b1.json?.providers?.find(p => p.id === 'higgsfield-mcp');
  const enabled = String(process.env.OPENART_ENABLED || '').trim().toLowerCase() === 'true';

  check('B2: openart-video entry present in provider registry (real adapter now registered, not the old special-case)', !!openartVideoEntry);
  check('B2: openart-video executionType=mcp, billingPool=openart-credits', openartVideoEntry?.executionType === 'mcp' && openartVideoEntry?.billingPool === 'openart-credits');
  check('B2: heygen-mcp entry unaffected by this milestone', heygenMcp?.executionType === 'mcp-oauth');
  check('B2: higgsfield-mcp entry unaffected by this milestone', higgsfieldMcp?.executionType === 'mcp-oauth');
  check('B3: no secret substrings in the providers registry response', noSecretKeys(b1.json).length === 0);

  if (enabled && openartVideoEntry?.status === 'active') {
    console.log(`INFO — B4: openart-video live executable=${openartVideoEntry.executable}, status=${openartVideoEntry.status}, toolCount=${openartVideoEntry.toolCount} (real cross-check against live health).`);
  } else {
    console.log('SKIP — B4-B12 (OpenArt not currently active/connected) status:', openartVideoEntry?.status);
  }

  const modelsResp = await api('GET', '/api/production/providers/openart-video/models');
  let realModel = null;
  if (enabled && openartVideoEntry?.status === 'active') {
    check('B5: GET openart-video/models -> 200 ok with a sanitized list', modelsResp.status === 200 && modelsResp.json?.ok === true);
    check('B5: at least one text2video-capable model was discovered', (modelsResp.json?.models?.length || 0) > 0);
    const supportedModels = modelsResp.json?.models?.filter(m => m.supported) || [];
    const unsupportedModels = modelsResp.json?.models?.filter(m => !m.supported) || [];
    check('B5: at least one model has a supported (simple-shape) form (confirmed live: byte-plus-seedance-2/-fast/-mini, pixverseV6)', supportedModels.length > 0);
    check('B5: unsupported (multi-variant-schema) models are reported with an honest reason, never silently dropped', unsupportedModels.every(m => typeof m.unsupportedReason === 'string' && m.unsupportedReason.length > 0));
    check('B5: supported models carry real duration/aspectRatio/resolution constraints', supportedModels.every(m => m.duration && Array.isArray(m.aspectRatios) && m.aspectRatios.length > 0 && Array.isArray(m.resolutions) && m.resolutions.length > 0));
    check('B5: no secrets in models response', noSecretKeys(modelsResp.json).length === 0);
    realModel = supportedModels[0];
  } else {
    console.log('SKIP — B5 (OpenArt not currently active/connected).');
  }

  // ── provider-input PATCH route — forgery/whitelist checks, using an
  // ISOLATED synthetic fixture package. Cleaned up unconditionally.
  const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const PKG_DIR = path.join(ROOT, 'data', 'content-packages');
  const JOB_DIR = path.join(ROOT, 'data', 'production-jobs');
  const FIXTURE_PKG_ID = `pack-openart-video-adapter-test-${RUN_ID}`;
  const createdPackageIds = [];
  const createdJobIds = [];

  function writeFixturePackage() {
    const now = new Date().toISOString();
    const pkg = {
      id: FIXTURE_PKG_ID,
      status: 'approved',
      brand: 'OpenArt Video Adapter Test Brand',
      platform: 'TikTok',
      goal: 'Engagement',
      topic: 'OpenArt video adapter validator test package',
      audience: '', offer: '', tone: '', videoDuration: '5-10s',
      hooks: [{ text: 'Test hook', angle: 'curiosity' }],
      script: { opening: '', body: '', cta: '', fullText: 'Unused by OpenArt Video — prompt is a separate providerInput field.' },
      scenes: [{ order: 1, durationSeconds: 5, visual: 'x', voiceover: 'y', onScreenText: 'z' }],
      caption: 'Test caption', cta: 'Shop now', hashtags: ['test'], keywords: ['test'],
      thumbnail: { headline: 'Test', visualBrief: '', artifactId: null, artifactUrl: null, status: 'not_requested', error: null },
      pipeline: { stage: 'approved', enteredStageAt: now, history: [{ stage: 'approved', at: now, actor: 'validator', note: null }] },
      metadata: { workflowId: FIXTURE_PKG_ID, model: null, provider: 'test-fixture', createdAt: now, updatedAt: now, estimatedCost: null, actualCost: null, instructions: '' },
      production: null,
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
    if (enabled && openartVideoEntry?.status === 'active' && realModel) {
      writeFixturePackage();
      const planResp = await api('POST', '/api/production/router/plan', { packageId: FIXTURE_PKG_ID, selectedMode: 'cinematic_broll', selectedProvider: 'openart-video' });
      if ((planResp.status === 200 || planResp.status === 201) && planResp.json?.ok && planResp.json.job?.id) {
        const jobId = planResp.json.job.id;
        createdJobIds.push(jobId);

        check('B6: freshly created openart-video job is a real job with selectedProvider openart-video', planResp.json.job.selectedProvider === 'openart-video');

        const forgeResp = await api('PATCH', `/api/production/jobs/${jobId}/openart-video-provider-input`, {
          model: 'forged-model', prompt: 'forged prompt',
          execution: { status: 'completed' }, providerJobId: 'hacked', lock: { token: 'x' }, someRandomKey: 'x', imageUrl: 'https://example.com/nope.png',
        });
        check('B7: PATCH openart-video-provider-input rejects a model not in live discovery (setup forgery blocked)', forgeResp.status !== 200 || forgeResp.json?.validation?.valid === false);
        const afterForge = await api('GET', `/api/production/jobs/${jobId}`);
        check('B7: forged execution/providerJobId fields never reached job storage', !afterForge.json?.job?.execution?.providerJobId);
        check('B7: unknown key ("someRandomKey") never persisted into providerInput', !('someRandomKey' in (afterForge.json?.job?.providerInput || {})));
        check('B7: imageUrl (reference-media field) never persisted into providerInput (not in the PATCH whitelist)', !('imageUrl' in (afterForge.json?.job?.providerInput || {})));

        // B8: an unsupported (multi-variant-schema) real model is rejected by the live route
        const unsupportedModels2 = modelsResp.json?.models?.filter(m => !m.supported) || [];
        if (unsupportedModels2.length) {
          const unsupportedResp = await api('PATCH', `/api/production/jobs/${jobId}/openart-video-provider-input`, {
            model: unsupportedModels2[0].id, prompt: 'a validator test prompt, never submitted for real generation', aspectRatio: '9:16', durationSeconds: 5, resolution: '720p',
          });
          check('B8: PATCH rejects a real live model whose schema is unsupported (multi-variant) in this checkpoint', unsupportedResp.json?.validation?.valid === false && /not supported in this checkpoint/.test(unsupportedResp.json?.validation?.errors?.join(' ') || ''));
        } else {
          console.log('SKIP — B8 (no unsupported-shape model currently discovered to test with).');
        }

        // B10/B11/B12: a real supported model — setup + real live cost preflight
        const goodResp = await api('PATCH', `/api/production/jobs/${jobId}/openart-video-provider-input`, {
          model: realModel.id, prompt: 'A validator test prompt, never submitted for real generation.',
          aspectRatio: realModel.defaultAspectRatio, durationSeconds: realModel.duration?.default, resolution: realModel.defaultResolution,
        });
        check('B10: PATCH openart-video-provider-input with a real supported model succeeds', goodResp.status === 200 && goodResp.json?.ok === true, JSON.stringify(goodResp.json));
        check('B10: setup validation reports valid once model+prompt+duration+aspectRatio+resolution are set', goodResp.json?.validation?.valid === true, JSON.stringify(goodResp.json?.validation));

        const costResp = await api('POST', `/api/production/jobs/${jobId}/openart-video-cost-preview`);
        check('B11: POST openart-video-cost-preview succeeds once setup is valid', costResp.status === 200 && costResp.json?.ok === true, JSON.stringify(costResp.json));
        check('B11: real cost preflight is non-provisional with a numeric credits range (openart_model_cost confirmed live)', costResp.json?.estimate?.provisional === false && typeof costResp.json?.estimate?.estimatedRange?.min === 'number');
        check('B12: cost preflight never submits a job (job execution still absent)', !(await api('GET', `/api/production/jobs/${jobId}`)).json?.job?.execution?.providerJobId);
      } else {
        console.log('SKIP — B6-B12 (could not create a synthetic test plan): ', planResp.json?.error);
      }
    } else {
      console.log('SKIP — B6-B12 (OpenArt not currently active/connected, or no supported model discovered).');
    }
  } finally {
    cleanupFixtures();
  }

  // ── Regression: existing manual-export / mock-video / heygen-mcp / higgsfield-mcp adapters unaffected
  const manualExport = b1.json?.providers?.find(p => p.id === 'manual-export');
  const mockVideo = b1.json?.providers?.find(p => p.id === 'mock-video');
  const hyperframes = b1.json?.providers?.find(p => p.id === 'hyperframes');
  check('B13: manual-export adapter unaffected (still executable)', manualExport?.executable === true);
  check('B13: mock-video adapter entry still present and reported honestly', !!mockVideo);
  check('B13: HyperFrames provider entry unaffected by this milestone (still staged, no adapter)', !hyperframes || hyperframes.status === 'staged');

  // ── Regression: OpenArt image generation flow (openartMcpClient.js) unaffected —
  // the exported helpers (extractHistoryId etc.) are ADDITIVE (export keyword only),
  // never a logic change, and the image-generation status route still responds.
  const openArtImageStatus = await api('GET', '/api/openart/status');
  check('B14: GET /api/openart/status (shared connection, image flow) unaffected', openArtImageStatus.status === 200 && openArtImageStatus.json?.ok === true);

  console.log('NOTE — Higgsfield/HeyGen/HyperFrames/Universal Output Viewer/Publishing Router full regression coverage is verified by running their own dedicated validator scripts separately (see the final report).');

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
