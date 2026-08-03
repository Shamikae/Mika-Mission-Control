#!/usr/bin/env node
// scripts/validate-heygen-mcp-adapter.mjs
//
// Offline validation for HeyGen MCP Adapter Checkpoint 2 (real
// create_video_from_avatar execution through the Provider Execution
// Engine). NEVER calls callHeyGenTool with the real generation tool —
// submit()/poll()'s network-calling paths are exercised only indirectly via
// their extracted pure helpers (buildHeyGenSubmitArgs/parseHeyGenSubmitResponse/
// mapHeyGenPollResponse), which do no I/O at all. HTTP checks against the
// dev server never enqueue/run an execution — only GET/PATCH-setup routes
// and status inspection.

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

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
  console.log(`HEYGEN_MCP_ENABLED (.env.local): ${process.env.HEYGEN_MCP_ENABLED}`);

  // ══════════════════════════════════════════════════════════════════════
  // PART A — pure adapter-logic checks (no I/O, no network, never calls
  // callHeyGenTool — direct ESM import via lib/production/execution/'s and
  // lib/heygen/'s scoped package.json).
  // ══════════════════════════════════════════════════════════════════════

  const heygenMcpAdapter = (await import('../lib/production/execution/adapters/heygenMcp.adapter.js')).default;
  const {
    validateHeyGenProviderInputSync, buildHeyGenSubmitArgs, parseHeyGenSubmitResponse, mapHeyGenPollResponse,
  } = await import('../lib/production/execution/adapters/heygenMcp.adapter.js');

  // ── A1: adapter contract shape ──────────────────────────────────────────
  check('A1: adapter has id=heygen-mcp', heygenMcpAdapter.id === 'heygen-mcp');
  check('A1: adapter has displayName', heygenMcpAdapter.displayName === 'HeyGen MCP');
  check('A1: adapter executionType=mcp-oauth', heygenMcpAdapter.executionType === 'mcp-oauth');
  check('A1: adapter billingPool=web-plan-premium-credits', heygenMcpAdapter.billingPool === 'web-plan-premium-credits');
  check('A1: adapter supportedModes is exactly [avatar_video, talking_head]',
    JSON.stringify([...heygenMcpAdapter.supportedModes].sort()) === JSON.stringify(['avatar_video', 'talking_head']));
  for (const fn of ['healthCheck', 'validateInput', 'estimate', 'submit', 'poll', 'cancel', 'normalizeResult']) {
    check(`A1: adapter.${fn} is a function`, typeof heygenMcpAdapter[fn] === 'function');
  }

  // ── A2: estimate() — provisional, approval-required, no fabricated cost ─
  const estimate = heygenMcpAdapter.estimate();
  check('A2: estimate() is provisional', estimate.provisional === true && estimate.estimateType === 'provisional');
  check('A2: estimate() requires approval', estimate.approvalRequired === true);
  check('A2: estimate() reports no numeric estimatedRange (no cost tool exists)', estimate.estimatedRange === null);
  check('A2: estimate() currency is web-plan-premium-credits', estimate.currency === 'web-plan-premium-credits');

  // ── A3: pure validation logic (validateHeyGenProviderInputSync) ────────
  const samplePkg = { script: { fullText: 'A short avatar script for validation testing.' } };
  const sampleAvatars = [{ avatarId: 'avatar-1', displayName: 'Test Avatar', availability: 'available' }, { avatarId: 'avatar-broken', displayName: 'Broken', availability: 'processing' }];
  const sampleVoices = [{ voiceId: 'voice-1', displayName: 'Test Voice' }];

  const validJob = { selectedMode: 'avatar_video', providerInput: { avatarId: 'avatar-1', voiceId: 'voice-1' } };
  const rValid = validateHeyGenProviderInputSync({ job: validJob, pkg: samplePkg, avatars: sampleAvatars, voices: sampleVoices });
  check('A3: valid avatar+voice+script -> valid', rValid.valid === true, JSON.stringify(rValid.errors));

  const rBadMode = validateHeyGenProviderInputSync({ job: { ...validJob, selectedMode: 'cinematic_broll' }, pkg: samplePkg, avatars: sampleAvatars, voices: sampleVoices });
  check('A3: unsupported mode is blocked', rBadMode.valid === false && rBadMode.errors.some(e => /avatar_video and talking_head/.test(e)));

  const rNoAvatar = validateHeyGenProviderInputSync({ job: { selectedMode: 'avatar_video', providerInput: { voiceId: 'voice-1' } }, pkg: samplePkg, avatars: sampleAvatars, voices: sampleVoices });
  check('A3: missing avatarId is blocked', rNoAvatar.valid === false && rNoAvatar.errors.some(e => /avatar must be selected/i.test(e)));

  const rNoVoice = validateHeyGenProviderInputSync({ job: { selectedMode: 'avatar_video', providerInput: { avatarId: 'avatar-1' } }, pkg: samplePkg, avatars: sampleAvatars, voices: sampleVoices });
  check('A3: missing voiceId is blocked', rNoVoice.valid === false && rNoVoice.errors.some(e => /voice must be selected/i.test(e)));

  const rInvalidAvatar = validateHeyGenProviderInputSync({ job: { selectedMode: 'avatar_video', providerInput: { avatarId: 'not-real', voiceId: 'voice-1' } }, pkg: samplePkg, avatars: sampleAvatars, voices: sampleVoices });
  check('A3: avatar not in discovery list is blocked', rInvalidAvatar.valid === false && rInvalidAvatar.errors.some(e => /not found/i.test(e)));

  const rUnavailableAvatar = validateHeyGenProviderInputSync({ job: { selectedMode: 'avatar_video', providerInput: { avatarId: 'avatar-broken', voiceId: 'voice-1' } }, pkg: samplePkg, avatars: sampleAvatars, voices: sampleVoices });
  check('A3: avatar with availability != available is blocked', rUnavailableAvatar.valid === false && rUnavailableAvatar.errors.some(e => /not currently available/i.test(e)));

  const rInvalidVoice = validateHeyGenProviderInputSync({ job: { selectedMode: 'avatar_video', providerInput: { avatarId: 'avatar-1', voiceId: 'not-real' } }, pkg: samplePkg, avatars: sampleAvatars, voices: sampleVoices });
  check('A3: voice not in discovery list is blocked', rInvalidVoice.valid === false && rInvalidVoice.errors.some(e => /voice was not found/i.test(e)));

  const rEmptyScript = validateHeyGenProviderInputSync({ job: validJob, pkg: { script: { fullText: '   ' } }, avatars: sampleAvatars, voices: sampleVoices });
  check('A3: empty script is blocked', rEmptyScript.valid === false && rEmptyScript.errors.some(e => /script is required/i.test(e)));

  const longScript = 'x'.repeat(5001);
  const rLongScript = validateHeyGenProviderInputSync({ job: validJob, pkg: { script: { fullText: longScript } }, avatars: sampleAvatars, voices: sampleVoices });
  check('A3: script exceeding the safety maximum is blocked', rLongScript.valid === false && rLongScript.errors.some(e => /exceeds Mika's safety maximum/.test(e)), rLongScript.errors.join(' '));
  check('A3: over-limit error names actual length and maximum', rLongScript.errors.some(e => e.includes('5001') && e.includes('5000')));

  const rBadTool = validateHeyGenProviderInputSync({ job: { selectedMode: 'avatar_video', providerInput: { avatarId: 'avatar-1', voiceId: 'voice-1', selectedTool: 'create_video_agent' } }, pkg: samplePkg, avatars: sampleAvatars, voices: sampleVoices });
  check('A3: unsupported selectedTool is blocked (only create_video_from_avatar allowlisted)', rBadTool.valid === false && rBadTool.errors.some(e => /Unsupported generation tool/.test(e)));

  const rBadSpeed = validateHeyGenProviderInputSync({ job: { selectedMode: 'avatar_video', providerInput: { avatarId: 'avatar-1', voiceId: 'voice-1', voiceSpeed: 3 } }, pkg: samplePkg, avatars: sampleAvatars, voices: sampleVoices });
  check('A3: out-of-range voiceSpeed is blocked', rBadSpeed.valid === false && rBadSpeed.errors.some(e => /voiceSpeed must be/.test(e)));

  check('A3: forgery — arbitrary unknown keys never appear in providerInput validation output', !JSON.stringify(rValid).includes('__proto__'));

  // ── A4: buildHeyGenSubmitArgs — exact live-schema argument filtering ────
  const fullSchema = { supportsCaption: true, supportsVoiceSpeed: true, voiceSpeedRange: { min: 0.5, max: 1.5, default: 1 } };
  const noOptionalSchema = { supportsCaption: false, supportsVoiceSpeed: false, voiceSpeedRange: null };
  const baseJob = { id: 'pr-test-1', outputSpec: { aspectRatio: '9:16' } };
  const basePkg = { topic: 'Test Topic', id: 'pkg-1' };
  const scriptText = 'Ten to twenty words is a good length for this short avatar video test payload example here.';

  const argsWithExtras = buildHeyGenSubmitArgs({
    job: baseJob, pkg: basePkg, schema: fullSchema, scriptText,
    providerInput: { avatarId: 'avatar-1', voiceId: 'voice-1', captionEnabled: true, voiceSpeed: 1.2 },
  });
  check('A4: submit args include required fields', argsWithExtras.avatarId === 'avatar-1' && argsWithExtras.voiceId === 'voice-1' && argsWithExtras.script === scriptText);
  check('A4: submit args aspectRatio comes from job.outputSpec', argsWithExtras.aspectRatio === '9:16');
  check('A4: submit args caption included when schema supports it and captionEnabled=true', JSON.stringify(argsWithExtras.caption) === JSON.stringify({ file_format: 'srt', style: 'default' }));
  check('A4: submit args voiceSettings.speed included when schema supports it', argsWithExtras.voiceSettings?.speed === 1.2);
  check('A4: submit args never include callbackUrl/motionPrompt/engine (not in our payload builder)', !('callbackUrl' in argsWithExtras) && !('motionPrompt' in argsWithExtras) && !('engine' in argsWithExtras));

  const argsWithoutSchemaSupport = buildHeyGenSubmitArgs({
    job: baseJob, pkg: basePkg, schema: noOptionalSchema, scriptText,
    providerInput: { avatarId: 'avatar-1', voiceId: 'voice-1', captionEnabled: true, voiceSpeed: 1.2 },
  });
  check('A4: caption omitted when live schema does not support it, even if requested', !('caption' in argsWithoutSchemaSupport));
  check('A4: voiceSettings omitted when live schema does not support it, even if requested', !('voiceSettings' in argsWithoutSchemaSupport));

  const argsNoOptionalInput = buildHeyGenSubmitArgs({
    job: baseJob, pkg: basePkg, schema: fullSchema, scriptText,
    providerInput: { avatarId: 'avatar-1', voiceId: 'voice-1' },
  });
  check('A4: caption omitted when captionEnabled is not set (no captions at all)', !('caption' in argsNoOptionalInput));
  check('A4: voiceSettings omitted when voiceSpeed is not set', !('voiceSettings' in argsNoOptionalInput));

  // ── A5: parseHeyGenSubmitResponse — id extraction + malformed responses ─
  check('A5: extracts video_id (snake_case)', parseHeyGenSubmitResponse({ video_id: 'abc123' }).videoId === 'abc123');
  check('A5: extracts videoId (camelCase fallback)', parseHeyGenSubmitResponse({ videoId: 'abc456' }).videoId === 'abc456');
  check('A5: extracts id (generic fallback)', parseHeyGenSubmitResponse({ id: 'abc789' }).videoId === 'abc789');
  check('A5: malformed/empty submit response -> videoId null (never crashes)', parseHeyGenSubmitResponse({}).videoId === null);
  check('A5: null submit response -> videoId null (never crashes)', parseHeyGenSubmitResponse(null).videoId === null);

  // ── A6: mapHeyGenPollResponse — status mapping + malformed responses ────
  const pollQueued = mapHeyGenPollResponse({ status: 'queued' });
  check('A6: queued -> waiting_provider', pollQueued.ok === true && pollQueued.status === 'waiting_provider');
  const pollProcessing = mapHeyGenPollResponse({ status: 'processing', progress: 42 });
  check('A6: processing -> waiting_provider, real numeric progress passed through', pollProcessing.status === 'waiting_provider' && pollProcessing.progress === 42);
  check('A6: never fabricates progress when provider omits it', mapHeyGenPollResponse({ status: 'processing' }).progress === null);
  const pollCompleted = mapHeyGenPollResponse({ status: 'completed', video_url: 'https://cdn.heygen.example/video.mp4' });
  check('A6: completed with valid https URL -> completed with one video output', pollCompleted.ok === true && pollCompleted.status === 'completed' && pollCompleted.outputs?.[0]?.url === 'https://cdn.heygen.example/video.mp4');
  check('A6: completed output mimeType is video/mp4', pollCompleted.outputs?.[0]?.mimeType === 'video/mp4');
  const pollCompletedNoUrl = mapHeyGenPollResponse({ status: 'completed' });
  check('A6: completed without a URL -> ok:false, malformed_output (never fabricates a URL)', pollCompletedNoUrl.ok === false && pollCompletedNoUrl.errorReason === 'malformed_output');
  const pollCompletedHttpUrl = mapHeyGenPollResponse({ status: 'completed', video_url: 'http://insecure.example/video.mp4' });
  check('A6: completed with non-https URL is rejected (https required)', pollCompletedHttpUrl.ok === false && pollCompletedHttpUrl.errorReason === 'malformed_output');
  const pollFailed = mapHeyGenPollResponse({ status: 'failed', error_message: 'render error' });
  check('A6: generic failure fallback (no failure_code) -> ok:false, provider_error (retryable), message from error_message', pollFailed.ok === false && pollFailed.errorReason === 'provider_error' && pollFailed.error === 'render error');
  check('A6: generic fallback retryable flag is honest (provider_error IS retryable)', pollFailed.retryable === true);

  // ── A6b: real observed failure shape — failure_code + failure_message ───
  // (RESOLUTION_NOT_ALLOWED / "Please subscribe to higher plan..." — the
  // exact shape returned by a real, live, rejected HeyGen render.)
  const pollResolutionNotAllowed = mapHeyGenPollResponse({
    status: 'failed', failure_code: 'RESOLUTION_NOT_ALLOWED',
    failure_message: 'Please subscribe to higher plan to generate higher resolution videos',
  });
  check('A6b: failure_code is normalized to a safe lowercase errorReason', pollResolutionNotAllowed.errorReason === 'resolution_not_allowed', pollResolutionNotAllowed.errorReason);
  check('A6b: failure_message is used verbatim as the error message', pollResolutionNotAllowed.error === 'Please subscribe to higher plan to generate higher resolution videos');
  check('A6b: RESOLUTION_NOT_ALLOWED is classified non-retryable', pollResolutionNotAllowed.retryable === false);
  check('A6b: retryable flag matches isRetryableErrorReason (same function the engine\'s retry endpoint uses)', pollResolutionNotAllowed.retryable === false && pollResolutionNotAllowed.ok === false);
  check('A6b: rawMetadata contains ONLY the sanitized failureCode — no raw response, no providerStatus noise', JSON.stringify(pollResolutionNotAllowed.rawMetadata) === JSON.stringify({ failureCode: 'RESOLUTION_NOT_ALLOWED' }));

  // Another plan/entitlement-style code, to confirm this isn't hardcoded to
  // one literal string — any HeyGen-supplied code normalizes the same way.
  const pollInsufficientCredits = mapHeyGenPollResponse({ status: 'failed', failure_code: 'INSUFFICIENT_CREDITS', failure_message: 'Not enough credits.' });
  check('A6b: a different plan/entitlement-style failure_code is also non-retryable', pollInsufficientCredits.errorReason === 'insufficient_credits' && pollInsufficientCredits.retryable === false);

  // Existing fallback fields must still all work when failure_code is absent.
  check('A6b: falls back to error.message when present', mapHeyGenPollResponse({ status: 'failed', error: { message: 'nested message' } }).error === 'nested message');
  check('A6b: falls back to error_message when present', mapHeyGenPollResponse({ status: 'failed', error_message: 'flat message' }).error === 'flat message');
  check('A6b: falls back to failure_reason when present', mapHeyGenPollResponse({ status: 'failed', failure_reason: 'reason text' }).error === 'reason text');
  check('A6b: falls back to bare message field when present', mapHeyGenPollResponse({ status: 'failed', message: 'bare message' }).error === 'bare message');
  check('A6b: falls back to the generic default when nothing recognizable is present', mapHeyGenPollResponse({ status: 'failed' }).error === 'HeyGen reported the render failed.');
  check('A6b: none of the fallback-field cases fabricate a failure_code-derived errorReason', mapHeyGenPollResponse({ status: 'failed', message: 'bare message' }).errorReason === 'provider_error');

  // failure_message takes priority over the other fields when several are present.
  const pollPriority = mapHeyGenPollResponse({ status: 'failed', failure_message: 'priority message', error_message: 'should not win', message: 'should not win either' });
  check('A6b: failure_message takes priority over error_message/message when multiple are present', pollPriority.error === 'priority message');

  // Message sanitization / length clamp.
  const veryLongMessage = 'x'.repeat(2000);
  const pollLongMessage = mapHeyGenPollResponse({ status: 'failed', failure_code: 'SOME_CODE', failure_message: veryLongMessage });
  check('A6b: overlong failure_message is clamped to 500 characters', pollLongMessage.error.length === 500, pollLongMessage.error.length);

  // failure_code with odd characters must normalize safely, never leak raw punctuation/case into a persisted job field.
  const pollWeirdCode = mapHeyGenPollResponse({ status: 'failed', failure_code: '  Some Weird!! Code--123  ', failure_message: 'x' });
  check('A6b: a failure_code with mixed case/punctuation normalizes to a safe snake_case value', /^[a-z0-9_]+$/.test(pollWeirdCode.errorReason), pollWeirdCode.errorReason);
  check('A6b: normalized failure_code has no leading/trailing underscores', !pollWeirdCode.errorReason.startsWith('_') && !pollWeirdCode.errorReason.endsWith('_'));

  // No secrets/raw-response leakage anywhere in a normalized failure result.
  const pollWithSecretsInRaw = mapHeyGenPollResponse({
    status: 'failed', failure_code: 'RESOLUTION_NOT_ALLOWED', failure_message: 'Please subscribe to higher plan to generate higher resolution videos',
    access_token: 'should-never-appear', video_url: 'https://cdn.heygen.example/should-never-appear.mp4', internal_debug: { anything: 'should not leak either' },
  });
  check('A6b: normalized failure result never carries the raw provider response through', noSecretKeys(pollWithSecretsInRaw).length === 0 && !JSON.stringify(pollWithSecretsInRaw).includes('should-never-appear'));

  // completed/not_found branches also carry an honest `retryable` flag now.
  check('A6b: not_found failure carries retryable:false', mapHeyGenPollResponse({ status: 'not_found' }).retryable === false);
  check('A6b: completed-without-URL failure carries retryable:false', mapHeyGenPollResponse({ status: 'completed' }).retryable === false);

  const pollNotFound = mapHeyGenPollResponse({ status: 'not_found' });
  check('A6: not_found -> ok:false, malformed_output (non-retryable)', pollNotFound.ok === false && pollNotFound.errorReason === 'malformed_output');
  const pollUnknown = mapHeyGenPollResponse({ status: 'some_future_status_we_have_never_seen' });
  check('A6: unrecognized status never crashes, defaults to waiting_provider', pollUnknown.ok === true && pollUnknown.status === 'waiting_provider');
  const pollMalformed = mapHeyGenPollResponse(null);
  check('A6: null poll response never crashes', pollMalformed.ok === true && pollMalformed.status === 'waiting_provider');

  // ── A7: cancel() — honest, non-fabricated cancellation support ─────────
  const cancelResult = await heygenMcpAdapter.cancel({ providerJobId: 'video-123' });
  check('A7: cancel() reports ok:false (not silently claiming success)', cancelResult.ok === false);
  check('A7: cancel() errorReason is provider_cancel_unsupported', cancelResult.errorReason === 'provider_cancel_unsupported');
  check('A7: cancel() warns that provider work may continue and consume credits', /may continue and consume premium credits/.test(cancelResult.error));

  // ── A8: normalizeResult() passthrough ───────────────────────────────────
  const normalized = heygenMcpAdapter.normalizeResult({ status: 'completed', outputs: [{ id: 'x' }], rawMetadata: { a: 1 } });
  check('A8: normalizeResult() passes through status/outputs/providerMetadata', normalized.status === 'completed' && normalized.outputs.length === 1 && normalized.providerMetadata.a === 1);

  // ── A9: no secrets anywhere in any of the above pure-function outputs ───
  const allPureOutputs = [estimate, rValid, argsWithExtras, parseHeyGenSubmitResponse({ video_id: 'x' }), pollCompleted, cancelResult, normalized];
  check('A9: no OAuth secret fields in any pure adapter output', noSecretKeys(allPureOutputs).length === 0, JSON.stringify(noSecretKeys(allPureOutputs)));

  // ══════════════════════════════════════════════════════════════════════
  // PART B — HTTP checks against the running dev server (setup/discovery
  // routes and status inspection only — never enqueues/runs execution).
  // ══════════════════════════════════════════════════════════════════════

  const up = await waitForServer();
  check('B1: dev server reachable on :3099', up);
  if (!up) { printSummary(); return; }

  // ── Provider registry — heygen-mcp promoted to a real, registered adapter
  const providersResp = await api('GET', '/api/production/providers');
  const heygenMcp = providersResp.json?.providers?.find(p => p.id === 'heygen-mcp');
  const heygenApi = providersResp.json?.providers?.find(p => p.id === 'heygen-api');
  const heygenOld = providersResp.json?.providers?.find(p => p.id === 'heygen');
  check('B2: heygen-mcp entry present in provider registry', !!heygenMcp);
  check('B2: heygen-mcp executionType=mcp-oauth, billingPool=web-plan-premium-credits', heygenMcp?.executionType === 'mcp-oauth' && heygenMcp?.billingPool === 'web-plan-premium-credits');
  check('B2: heygen-api remains staged/non-executable (Direct API out of scope)', heygenApi?.executable === false && heygenApi?.status === 'staged');
  check('B2: old agent-domain "heygen" catalog entry is untouched (still staged, unrelated)', heygenOld?.status === 'staged' && heygenOld?.executionType === 'api_staged');
  check('B3: no secret substrings in the providers registry response', noSecretKeys(providersResp.json).length === 0);

  const enabled = String(process.env.HEYGEN_MCP_ENABLED || '').toLowerCase() === 'true';
  if (enabled) {
    // We are live-connected right now — verify the honest "active" path.
    check('B4: heygen-mcp is executable while live-connected with required tools present', heygenMcp?.executable === true && heygenMcp?.status === 'active');
    check('B4: heygen-mcp reports a real toolCount', typeof heygenMcp?.toolCount === 'number' && heygenMcp.toolCount > 0);
  } else {
    check('B4: heygen-mcp is not executable while disabled', heygenMcp?.executable === false && heygenMcp?.status === 'disabled');
  }

  // ── Router recommendation now includes heygen-mcp as a catalog candidate
  const routerPlanResp = await api('GET', '/api/production/jobs');
  check('B5: jobs listing endpoint still responds (no regression to job listing)', routerPlanResp.status === 200 && routerPlanResp.json?.ok === true);

  // ── Discovery routes (avatars/voices/generation-schema) — read-only ────
  if (enabled && heygenMcp?.status === 'active') {
    const avatarsResp = await api('GET', '/api/production/providers/heygen/avatars');
    check('B6: GET avatars -> 200 ok with a sanitized list', avatarsResp.status === 200 && avatarsResp.json?.ok === true && Array.isArray(avatarsResp.json.avatars));
    const avatarKeys = Object.keys(avatarsResp.json?.avatars?.[0] || {});
    check('B6: avatar objects only contain the allowlisted fields', avatarKeys.every(k => ['avatarId', 'displayName', 'type', 'gender', 'previewUrl', 'availability'].includes(k)), JSON.stringify(avatarKeys));

    const voicesResp = await api('GET', '/api/production/providers/heygen/voices');
    check('B7: GET voices -> 200 ok with a sanitized list', voicesResp.status === 200 && voicesResp.json?.ok === true && Array.isArray(voicesResp.json.voices));
    const voiceKeys = Object.keys(voicesResp.json?.voices?.[0] || {});
    check('B7: voice objects only contain the allowlisted fields', voiceKeys.every(k => ['voiceId', 'displayName', 'language', 'gender', 'locale', 'previewUrl', 'availability'].includes(k)), JSON.stringify(voiceKeys));

    const schemaResp = await api('GET', '/api/production/providers/heygen/generation-schema');
    check('B8: GET generation-schema -> 200 ok', schemaResp.status === 200 && schemaResp.json?.ok === true);
    check('B8: generation-schema reports cancellationSupported: false (honest — no cancel tool exists)', schemaResp.json?.cancellationSupported === false);
    check('B8: generation-schema includes a provisional estimate', schemaResp.json?.estimate?.provisional === true);
    check('B9: no secrets in avatars/voices/schema responses', noSecretKeys(avatarsResp.json).length === 0 && noSecretKeys(voicesResp.json).length === 0 && noSecretKeys(schemaResp.json).length === 0);

    // ── Preview URLs are never persisted into a job — only into the sanitized API response.
    const anyPreview = (avatarsResp.json.avatars || []).find(a => a.previewUrl) || (voicesResp.json.voices || []).find(v => v.previewUrl);
    check('B10: at least one live avatar/voice item has a previewUrl (display-only)', !!anyPreview, 'no preview URLs present in this account\'s discovery data');
  } else {
    console.log('SKIP — B6-B10 discovery-route checks (HeyGen not currently active/connected).');
  }

  // ── provider-input PATCH route — forgery/whitelist checks, using an
  // ISOLATED synthetic fixture package (RUN_ID-suffixed, written directly to
  // data/content-packages/, never a real user package) — same pattern as
  // scripts/validate-provider-execution-engine.mjs. Cleaned up unconditionally.
  const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const PKG_DIR = path.join(ROOT, 'data', 'content-packages');
  const JOB_DIR = path.join(ROOT, 'data', 'production-jobs');
  const FIXTURE_PKG_ID = `pack-heygen-adapter-test-${RUN_ID}`;
  const createdPackageIds = [];
  const createdJobIds = [];

  function writeFixturePackage() {
    const now = new Date().toISOString();
    const pkg = {
      id: FIXTURE_PKG_ID,
      status: 'approved',
      brand: 'HeyGen Adapter Test Brand',
      platform: 'TikTok',
      goal: 'Engagement',
      topic: 'HeyGen adapter validator test package',
      audience: '', offer: '', tone: '', videoDuration: '30-60s',
      hooks: [{ text: 'Test hook', angle: 'curiosity' }],
      script: { opening: '', body: '', cta: '', fullText: 'A short avatar script for the HeyGen adapter offline validator — ten to twenty words is a realistic test length.' },
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
    const planResp = await api('POST', '/api/production/router/plan', { packageId: FIXTURE_PKG_ID, selectedMode: 'avatar_video', selectedProvider: 'heygen-mcp' });
    if ((planResp.status === 200 || planResp.status === 201) && planResp.json?.ok && planResp.json.job?.id) {
      const jobId = planResp.json.job.id;
      createdJobIds.push(jobId);

      check('B11: freshly created heygen-mcp avatar_video job starts needs_assets (no avatar/voice selected yet)', planResp.json.job.status === 'needs_assets', planResp.json.job.status);

      const forgeResp = await api('PATCH', `/api/production/jobs/${jobId}/provider-input`, {
        avatarId: 'forged-id', voiceId: 'forged-id',
        execution: { status: 'completed' }, providerJobId: 'hacked', lock: { token: 'x' }, someRandomKey: 'x',
      });
      check('B12: PATCH provider-input rejects an avatar/voice not in live discovery (setup forgery blocked)', forgeResp.status !== 200 || forgeResp.json?.validation?.valid === false);
      const afterForge = await api('GET', `/api/production/jobs/${jobId}`);
      check('B12: forged execution/providerJobId fields never reached job storage', !afterForge.json?.job?.execution?.providerJobId);
      check('B12: unknown key ("someRandomKey") never persisted into providerInput', !('someRandomKey' in (afterForge.json?.job?.providerInput || {})));

      if (enabled && heygenMcp?.status === 'active') {
        const avatarsResp2 = await api('GET', '/api/production/providers/heygen/avatars');
        const voicesResp2 = await api('GET', '/api/production/providers/heygen/voices');
        const realAvatar = avatarsResp2.json?.avatars?.find(a => a.availability === 'available');
        const realVoice = voicesResp2.json?.voices?.[0];
        if (realAvatar && realVoice) {
          const goodResp = await api('PATCH', `/api/production/jobs/${jobId}/provider-input`, { avatarId: realAvatar.avatarId, voiceId: realVoice.voiceId });
          check('B13: PATCH provider-input with real avatar+voice succeeds', goodResp.status === 200 && goodResp.json?.ok === true, JSON.stringify(goodResp.json));
          check('B13: no previewUrl persisted into job.providerInput', !('previewUrl' in (goodResp.json?.job?.providerInput || {})));
          check('B14: readiness recomputed — avatar_video job becomes needs_approval once avatar+voice are set', goodResp.json?.job?.status === 'needs_approval', goodResp.json?.job?.status);
          check('B14: readiness.available now includes avatar and voice', goodResp.json?.job?.readiness?.available?.includes('avatar') && goodResp.json?.job?.readiness?.available?.includes('voice'));

          // ── Package backlink synchronization — job.status change must reflect on pkg.production
          const pkgAfter = await api('GET', `/api/content/pipeline/list`);
          const linkedPkg = (pkgAfter.json?.packages || []).find(p => p.id === FIXTURE_PKG_ID);
          check('B14: package backlink (production.latestJobId/status) synced to this job', linkedPkg?.production?.latestJobId === jobId && linkedPkg?.production?.status === 'needs_approval');

          // ── B15: a job whose execution genuinely failed with a
          // failure_code-derived, non-retryable errorReason (e.g. the real
          // resolution_not_allowed case) must be rejected by the retry
          // endpoint — never auto-retried. Constructed by directly writing a
          // synthetic terminal-failure execution state onto THIS validator's
          // own isolated fixture job (never a real user job), mirroring the
          // established pattern in validate-provider-execution-engine.mjs.
          // No provider call is made for this check.
          const jobFilePath = path.join(JOB_DIR, `${jobId}.json`);
          const jobOnDisk = JSON.parse(fs.readFileSync(jobFilePath, 'utf-8'));
          jobOnDisk.status = 'failed';
          jobOnDisk.execution = {
            status: 'failed', provider: 'heygen-mcp', providerJobId: 'heygen-video-resolution-test',
            attemptCount: 1, maxAttempts: 3,
            startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
            completedAt: null, cancelledAt: null, lastPollAt: new Date().toISOString(), nextPollAt: null,
            progress: null,
            error: 'Please subscribe to higher plan to generate higher resolution videos',
            errorReason: 'resolution_not_allowed',
            outputs: [], providerMetadata: { failureCode: 'RESOLUTION_NOT_ALLOWED' }, lock: null, mock: false,
          };
          fs.writeFileSync(jobFilePath, JSON.stringify(jobOnDisk, null, 2));

          const blockedRetry = await api('POST', `/api/production/execution/${jobId}/retry`, undefined);
          check('B15r: retrying a resolution_not_allowed failure is rejected (not retryable, cannot auto-retry)', blockedRetry.status === 409 && /not retryable/i.test(blockedRetry.json?.error || ''), JSON.stringify(blockedRetry.json));

          const jobViewAfter = await api('GET', `/api/production/jobs/${jobId}`);
          check('B15r: job UI-facing record exposes the real sanitized failure code via execution.errorReason', jobViewAfter.json?.job?.execution?.errorReason === 'resolution_not_allowed');
          check('B15r: job UI-facing record exposes the real sanitized failure message via execution.error', jobViewAfter.json?.job?.execution?.error === 'Please subscribe to higher plan to generate higher resolution videos');
          check('B15r: no secrets/raw-response leakage in the failed job\'s API response', noSecretKeys(jobViewAfter.json).length === 0);
        } else {
          console.log('SKIP — B13/B14 (no available avatar/voice found on this account to test with).');
        }
      } else {
        console.log('SKIP — B13/B14 (HeyGen not currently active/connected).');
      }
    } else {
      console.log('SKIP — B11-B14 (could not create a synthetic test plan): ', planResp.json?.error);
    }
  } finally {
    cleanupFixtures();
  }

  // ── Regression: existing manual-export / mock-video adapters still known & executable-as-before
  const manualExport = providersResp.json?.providers?.find(p => p.id === 'manual-export');
  const mockVideo = providersResp.json?.providers?.find(p => p.id === 'mock-video');
  check('B15: manual-export adapter unaffected (still executable)', manualExport?.executable === true);
  check('B15: mock-video adapter entry still present and reported honestly', !!mockVideo);

  // ── Regression: OpenArt MCP + HeyGen OAuth (Checkpoint 1) unaffected ────
  const openArtStatus = await api('GET', '/api/openart/status');
  check('B16: GET /api/openart/status unaffected', openArtStatus.status === 200 && openArtStatus.json?.ok === true);
  const heygenAuthStatus = await api('GET', '/api/production/providers/heygen/status');
  check('B16: GET heygen/status (Checkpoint 1 route) unaffected', heygenAuthStatus.status === 200 && heygenAuthStatus.json?.ok === true);

  // ── Artifact-serving route: Range support + path-traversal/MIME guard intact
  const traversalResp = await fetch(`${BASE}/api/production/artifacts/${encodeURIComponent('../../../etc/passwd')}`);
  check('B17: artifact route rejects a path-traversal-style id', traversalResp.status === 400 || traversalResp.status === 404);
  const badExtResp = await fetch(`${BASE}/api/production/artifacts/abc.exe`);
  check('B17: artifact route rejects a disallowed extension', badExtResp.status === 400);

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
