#!/usr/bin/env node
// scripts/validate-kie-adapter.mjs
//
// Executable validation for the Kie.ai provider adapter (v1, image only).
// Real code, real filesystem, no dev server, NO NETWORK, NO SPEND.
//
// The HTTP transport is replaced with a captured stub for the duration of each
// async assertion. That is deliberately NOT mocking the code under test: every
// branch below runs the adapter's real submit/poll/healthCheck/error-mapping
// logic, and the stub only stands in for the wire. It is the only way to prove
// failure, auth-error and unresolved-submission handling without credentials
// and without creating a paid task.
//
// Run: node scripts/validate-kie-adapter.mjs

import fs from 'fs';
import path from 'path';
import kieAdapter, {
  listKieModels, getKieModel, validateKieProviderInput, buildKieTaskInput,
  parseKieResultUrls, mapKiePollResponse, classifyKieCode, resolveKieConfigState,
  KIE_TASK_STATES,
} from '../lib/production/execution/adapters/kie.adapter.js';
import { getExecutionAdapter, isProviderKnown } from '../lib/production/execution/providerAdapterRegistry.js';
import { recommendBinding } from '../lib/diamond/recommendBinding.js';
import { preflightCost, isPreflightSupported } from '../lib/diamond/costPreflight.js';
import { buildProviderInputFromBinding, unsupportedRequestFields, validateAssetRecord } from '../lib/production/assets/assetRules.js';
import { sanitizeProviderMetadata, isRetryableErrorReason, NON_RETRYABLE_ERROR_REASONS } from '../lib/production/execution/executionRules.js';
import { downloadRemoteArtifact } from '../lib/production/execution/downloadRemoteArtifact.js';
import { ESTIMATE_TYPES, isPaidExecution } from '../lib/ledger/ledgerRules.js';

const ROOT = process.cwd();
const ADAPTER_PATH = path.join(ROOT, 'lib/production/execution/adapters/kie.adapter.js');
const ASSETS_DIR = path.join(ROOT, 'lib/production/assets');
const ADAPTER_SRC = fs.readFileSync(ADAPTER_PATH, 'utf8');

// A sentinel, never a real credential. Its whole purpose is to be searched for
// in every value the adapter returns.
const SENTINEL_KEY = 'kie-sentinel-value-not-a-real-credential';

const results = [];
function check(n, c, d = '') { results.push({ n, ok: !!c, d }); console.log(`${c ? 'PASS' : 'FAIL'} — ${n}${d && !c ? ` (${d})` : ''}`); }
function section(t) { console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 52 - t.length))}`); }
function stripComments(s) { return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); }
const ADAPTER_CODE = stripComments(ADAPTER_SRC);

// ── Environment + transport harness ──────────────────────────────────────

const ENV_KEYS = ['KIE_ENABLED', 'KIE_API_KEY', 'KIE_API_URL'];
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));

function setEnv(values) {
  for (const k of ENV_KEYS) {
    if (values[k] === undefined) delete process.env[k];
    else process.env[k] = values[k];
  }
}
function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (ORIGINAL_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL_ENV[k];
  }
}
const CONFIGURED = { KIE_ENABLED: 'true', KIE_API_KEY: SENTINEL_KEY, KIE_API_URL: 'https://api.kie.ai' };

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** Runs `fn` with the wire replaced. Always restores, even on throw. */
async function withTransport(handler, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return handler(String(url), init); };
  try { return { value: await fn(), calls }; }
  finally { globalThis.fetch = original; }
}

/** A transport that fails the run if it is ever reached. */
const NO_NETWORK = () => { throw new Error('NETWORK CALL ATTEMPTED — this path must not touch the wire.'); };

const job = (providerInput, extra = {}) => ({ id: 'job-kie-test', selectedProvider: 'kie', providerInput, ...extra });
const GOOD_INPUT = { mediaType: 'image', model: 'google/nano-banana', prompt: 'A quiet obsidian control room at golden hour', aspectRatio: '9:16', outputCount: 1 };

try {
  // ── Adapter contract ─────────────────────────────────────────────────────
  section('Adapter contract');

  for (const m of ['healthCheck', 'validateInput', 'estimate', 'submit', 'poll', 'cancel', 'normalizeResult']) {
    check(`implements ${m}()`, typeof kieAdapter[m] === 'function');
  }
  check('declares provider id "kie"', kieAdapter.id === 'kie');
  check('registered in the execution engine registry', isProviderKnown('kie') && getExecutionAdapter('kie') === kieAdapter);
  check('registers ONE provider, not one per model',
    !isProviderKnown('google/nano-banana') && !isProviderKnown('nano-banana-2') && !isProviderKnown('nano-banana'));
  check('declares a direct-api execution type', kieAdapter.executionType === 'direct-api');
  check('is not marked as a mock provider', kieAdapter.mock === false);
  check('adapter never uses the legacy dispatch path', !/executeDispatch/.test(ADAPTER_CODE));
  // Mirrors validate-ledger.mjs exactly: no ledger IMPORT and no ledger CALL,
  // checked over raw source. The adapter is allowed to name the Ledger in a
  // comment — it documents which system owns the permanent record — but must
  // never touch it.
  const LEDGER_LOGIC = /from\s+['"][^'"]*ledger[^'"]*['"]|require\(\s*['"][^'"]*ledger|\b(appendLedgerEntry|buildLedgerRecord|validateLedgerRecord|buildCorrectionRecord|recordLedger|generateLedgerId)\s*\(/i;
  check('adapter contains no Ledger import and no Ledger call', !LEDGER_LOGIC.test(ADAPTER_SRC));
  check('adapter creates no execution engine of its own', !/executionEngine|executionQueue|executionLock/.test(ADAPTER_CODE));

  // ── Frozen architecture decision: direct REST, never MCP ────────────────
  // These lock the decision so a future edit cannot quietly reroute Kie spend
  // through the third-party MCP server.
  section('Frozen decision: direct REST, never MCP');

  check('Kie executes over direct REST, not MCP', kieAdapter.executionType === 'direct-api');
  check('the adapter imports no MCP client',
    !/mcpClient|@modelcontextprotocol|callHiggsfieldTool|callOpenArtTool|callHeyGenTool/i.test(ADAPTER_CODE));
  check('the adapter spawns no external process or CLI',
    !/child_process|execSync|spawn\(|execFile|\bnpx\b/.test(ADAPTER_CODE));
  check('the adapter opens no second task database',
    !/sqlite|better-sqlite|tasks\.db|createDatabase|\.db['"]/i.test(ADAPTER_CODE));
  check('the adapter never blocks waiting for completion',
    !/waitFor|wait_for_task|awaitCompletion|while\s*\(|setTimeout/i.test(ADAPTER_CODE));
  check('submit returns a task id rather than a finished result',
    /providerJobId: taskId/.test(ADAPTER_CODE));
  check('the balance capability is retained', /chat\/credit/.test(ADAPTER_CODE));
  check('the frozen decision is documented in the adapter itself',
    /never MCP/i.test(ADAPTER_SRC) && /one tool per model/i.test(ADAPTER_SRC));
  check('the two expiry facts are documented',
    /expire QUICKLY|~10 minutes/i.test(ADAPTER_SRC) && /14 days/i.test(ADAPTER_SRC));
  check('the permanent record is named, and it is not the provider',
    /Production Job\s*→\s*Ledger\s*→\s*Asset Library/i.test(ADAPTER_SRC)
    && /NEVER the provider's remote task history/i.test(ADAPTER_SRC));

  // No MCP server is wired anywhere as a Kie execution path.
  const REGISTRY_SRC = fs.readFileSync(path.join(ROOT, 'lib/production/execution/providerAdapterRegistry.js'), 'utf8');
  check('no kie-mcp provider is registered', !/kie-mcp|kie_mcp|kieMcp/i.test(REGISTRY_SRC));
  check('the repo declares no Kie MCP dependency', (() => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    return !Object.keys(deps).some(d => /kie/i.test(d));
  })());

  // ── Configuration states ─────────────────────────────────────────────────
  section('Configuration states');

  setEnv({});
  check('unconfigured resolves to "disabled"', resolveKieConfigState().status === 'disabled');
  let r = await withTransport(NO_NETWORK, () => kieAdapter.healthCheck());
  check('disabled healthCheck makes no network call', r.calls.length === 0);
  check('disabled healthCheck reports ok:false + disabled', r.value.ok === false && r.value.status === 'disabled');

  setEnv({ KIE_ENABLED: 'true' });
  check('enabled without a key resolves to "configuration_pending"', resolveKieConfigState().status === 'configuration_pending');
  r = await withTransport(NO_NETWORK, () => kieAdapter.healthCheck());
  check('missing key makes no network call', r.calls.length === 0);
  check('missing key reports configuration_pending', r.value.status === 'configuration_pending');
  check('missing-key message does not claim an outage', !/unavailable|offline/i.test(r.value.error));

  setEnv({ KIE_ENABLED: 'true', KIE_API_KEY: SENTINEL_KEY, KIE_API_URL: 'http://api.kie.ai' });
  check('a non-https base URL is refused', resolveKieConfigState().status === 'configuration_pending');

  setEnv(CONFIGURED);
  check('fully configured resolves to active', resolveKieConfigState().ok === true);

  // active: real authenticated call succeeds
  r = await withTransport(() => response({ code: 200, msg: 'success', data: 350 }), () => kieAdapter.healthCheck());
  check('active healthCheck proves auth with a real call, not key presence', r.calls.length === 1 && /\/api\/v1\/chat\/credit$/.test(r.calls[0].url));
  check('active healthCheck reports active + balance', r.value.ok === true && r.value.status === 'active' && r.value.balance === 350);
  check('balance is reported in kie-credits, never dollars', r.value.balanceCurrency === 'kie-credits');
  check('the API key is sent as a bearer token', r.calls[0].init.headers.Authorization === `Bearer ${SENTINEL_KEY}`);

  // auth_error
  r = await withTransport(() => response({ code: 401, msg: 'Unauthorized' }, 401), () => kieAdapter.healthCheck());
  check('HTTP 401 maps to auth_error, not unavailable', r.value.ok === false && r.value.status === 'auth_error');

  // unavailable
  r = await withTransport(() => { throw new Error('getaddrinfo ENOTFOUND'); }, () => kieAdapter.healthCheck());
  check('an unreachable host maps to unavailable', r.value.ok === false && r.value.status === 'unavailable');

  check('every required status is reachable',
    ['disabled', 'configuration_pending', 'active', 'auth_error', 'unavailable']
      .every(s => new RegExp(`'${s}'`).test(ADAPTER_CODE)));

  check('classifyKieCode maps the documented taxonomy',
    classifyKieCode(401) === 'authentication_error' && classifyKieCode(403) === 'authentication_error'
    && classifyKieCode(402) === 'insufficient_credits' && classifyKieCode(429) === 'rate_limited'
    && classifyKieCode(422) === 'validation_error' && classifyKieCode(400) === 'validation_error'
    && classifyKieCode(404) === 'validation_error' && classifyKieCode(500) === 'provider_error');

  // ── Model allowlist ──────────────────────────────────────────────────────
  section('Model allowlist');

  const models = listKieModels();
  check('allowlist is small (at most 2 models in v1)', models.length > 0 && models.length <= 2, `${models.length}`);
  check('every allowlisted model is text-to-image', models.every(m => Array.isArray(m.aspectRatios) && m.aspectRatios.length > 0));
  check('google/nano-banana is allowlisted with its exact documented id', !!getKieModel('google/nano-banana'));
  check('nano-banana-2 is allowlisted with its exact documented id', !!getKieModel('nano-banana-2'));
  check('model ids are stored verbatim, never constructed from a pattern',
    !/`\$\{[^}]*\}\/nano|'google\/' \+|"google\/" \+/.test(ADAPTER_CODE));
  check('unknown model is rejected', getKieModel('nano-banana-9000') === null);
  check('no video model is exposed', !/veo|sora|kling|runway|seedance/i.test(JSON.stringify(models)));
  check('no video/audio/LLM media type is accepted',
    validateKieProviderInput({ ...GOOD_INPUT, mediaType: 'video' }).valid === false
    && validateKieProviderInput({ ...GOOD_INPUT, mediaType: 'audio' }).valid === false);
  check('every model declares its unsupported fields', models.every(m => m.supports && m.supports.negativePrompt === false && m.supports.multipleOutputs === false));

  // ── Input validation ─────────────────────────────────────────────────────
  section('Input validation');

  check('a well-formed request validates', validateKieProviderInput(GOOD_INPUT).valid === true);
  check('an unknown model is rejected', validateKieProviderInput({ ...GOOD_INPUT, model: 'stable-diffusion-99' }).valid === false);
  check('a missing model is rejected', validateKieProviderInput({ ...GOOD_INPUT, model: undefined }).valid === false);
  check('a missing prompt is rejected', validateKieProviderInput({ ...GOOD_INPUT, prompt: '   ' }).valid === false);
  check('an over-length prompt is rejected',
    validateKieProviderInput({ ...GOOD_INPUT, prompt: 'x'.repeat(5001) }).valid === false);
  check('an unsupported aspect ratio is rejected',
    validateKieProviderInput({ ...GOOD_INPUT, aspectRatio: '7:3' }).valid === false);
  check('9:16 is accepted (the brand vertical format)', validateKieProviderInput({ ...GOOD_INPUT, aspectRatio: '9:16' }).valid === true);
  check('outputCount is capped at 1', validateKieProviderInput({ ...GOOD_INPUT, outputCount: 2 }).valid === false);
  check('outputCount 1 is accepted', validateKieProviderInput({ ...GOOD_INPUT, outputCount: 1 }).valid === true);
  check('a negative prompt is rejected rather than silently ignored',
    validateKieProviderInput({ ...GOOD_INPUT, negativePrompt: 'blurry' }).valid === false);

  const withPixels = validateKieProviderInput({ ...GOOD_INPUT, width: 1080, height: 1920 });
  check('pixel dimensions are dropped WITH a warning, never silently',
    withPixels.valid === true && withPixels.warnings.some(w => /width\/height/i.test(w)));

  const resOnFlat = validateKieProviderInput({ ...GOOD_INPUT, resolution: '4K' });
  check('a resolution sent to a model without that parameter warns honestly',
    resOnFlat.valid === true && resOnFlat.warnings.some(w => /resolution/i.test(w)));
  check('an invalid resolution on a model that HAS the parameter is rejected',
    validateKieProviderInput({ mediaType: 'image', model: 'nano-banana-2', prompt: 'x', resolution: '8K', outputCount: 1 }).valid === false);
  check('an unsupported output format is rejected',
    validateKieProviderInput({ ...GOOD_INPUT, outputFormat: 'tiff' }).valid === false);

  // Only documented parameters reach the wire.
  const built = buildKieTaskInput(GOOD_INPUT);
  check('task input carries only documented parameters',
    Object.keys(built).every(k => ['prompt', 'aspect_ratio', 'output_format', 'resolution'].includes(k)), Object.keys(built).join(','));
  check('task input never carries a negative prompt', !('negative_prompt' in built) && !('negativePrompt' in built));
  check('task input never carries pixel width/height', !('width' in built) && !('height' in built));
  check('task input never carries a batch count', !('n' in built) && !('num_images' in built) && !('outputCount' in built));
  check('a model with a resolution parameter receives one',
    'resolution' in buildKieTaskInput({ mediaType: 'image', model: 'nano-banana-2', prompt: 'x', outputCount: 1 }));
  check('a model without a resolution parameter never receives one', !('resolution' in built));

  // ── Cost estimate honesty ────────────────────────────────────────────────
  section('Cost estimate honesty');

  const est = await withTransport(NO_NETWORK, () => kieAdapter.estimate({ job: job(GOOD_INPUT) }));
  check('estimate makes no network call (Kie has no preflight endpoint)', est.calls.length === 0);
  check('estimate is always provisional', est.value.provisional === true);
  check('estimate is never labelled confirmed_provider', est.value.estimateType !== 'confirmed_provider');
  check('estimate declares it came from a catalogue', est.value.estimateType === 'provisional_catalog');
  check('estimate names its unofficial source', /marketing|not the API/i.test(est.value.note || ''));
  check('estimate states that no preflight exists', /no cost-preflight/i.test(est.value.note || ''));
  check('estimate requires approval', est.value.approvalRequired === true);
  check('estimate reports USD, matching the published unit', est.value.currency === 'USD');
  check('adapter never returns a confirmed estimate anywhere', !/estimateType: 'confirmed/.test(ADAPTER_CODE));
  check('provisional:true is a literal, not a derived condition', /provisional: true,/.test(ADAPTER_CODE));

  const floorEst = kieAdapter.estimate({ job: job({ mediaType: 'image', model: 'nano-banana-2', prompt: 'x', outputCount: 1 }) });
  check('a floor price is reported open-ended, never as a total',
    floorEst.estimatedRange.min === 0.04 && floorEst.estimatedRange.max === null);

  const noModelEst = kieAdapter.estimate({ job: job({ mediaType: 'image', prompt: 'x' }) });
  check('an unpriced request reports unknown rather than guessing',
    noModelEst.estimateType === 'unknown' && noModelEst.estimatedRange === null && noModelEst.currency === null);

  check('no fabricated credit-to-USD conversion exists', !/0\.005|\/\s*200\b|\*\s*200\b/.test(ADAPTER_CODE));

  // Diamond Control preflight integration
  check('Kie is wired into the cost preflight', isPreflightSupported('kie') === true);
  const kieBinding = recommendBinding({ capability: 'background_plate' }, { providerOverride: 'kie' });
  check('policy returns a Kie binding only on explicit override', kieBinding.ok === true && kieBinding.binding.providerId === 'kie');
  check('the Kie binding carries the test policy version', kieBinding.binding.policyVersion === 'kie-v1-test');
  check('the Kie binding is marked an operator override, not a preference', kieBinding.binding.confidence === 'operator_override');
  check('Kie is NOT the default binding for background_plate',
    recommendBinding({ capability: 'background_plate' }).binding.providerId !== 'kie');
  check('the Kie binding declares negativePrompt unsupported', kieBinding.binding.supports.negativePrompt === false);

  const assetReq = {
    requestId: 'areq-test-s1-background_plate', capability: 'background_plate',
    prompt: 'A quiet obsidian control room at golden hour', negativePrompt: 'text, watermark',
    aspectRatio: '9:16', width: 1080, height: 1920, outputCount: 1,
  };
  const pre = await withTransport(NO_NETWORK, () => preflightCost(assetReq, kieBinding.binding));
  check('preflight never confirms a Kie cost', pre.value.confirmed === false);
  check('preflight preserves the catalogue estimate type', pre.value.estimateType === 'provisional_catalog');
  check('preflight returns the published amount', pre.value.amount === 0.02);

  // ── Unsupported fields are dropped honestly ──────────────────────────────
  section('Unsupported field handling');

  const dropped = unsupportedRequestFields(assetReq, kieBinding.binding);
  check('a negative prompt is reported as dropped, not discarded silently',
    dropped.some(d => d.field === 'negativePrompt'));
  const providerInput = buildProviderInputFromBinding(assetReq, kieBinding.binding);
  check('the dropped negative prompt never reaches the provider input', !('negativePrompt' in providerInput));
  check('the built provider input passes the adapter\'s own validation',
    validateKieProviderInput(providerInput).valid === true, JSON.stringify(validateKieProviderInput(providerInput).errors));

  // ── Async submit ─────────────────────────────────────────────────────────
  section('Async submit');

  let sub = await withTransport(
    (url) => /createTask/.test(url) ? response({ code: 200, msg: 'success', data: { taskId: 'task_abc123' } }) : response({}, 404),
    () => kieAdapter.submit({ job: job(GOOD_INPUT) }));
  check('submit posts to the documented createTask endpoint',
    sub.calls.length === 1 && sub.calls[0].url === 'https://api.kie.ai/api/v1/jobs/createTask' && sub.calls[0].init.method === 'POST');
  check('submit returns the provider task id', sub.value.ok === true && sub.value.providerJobId === 'task_abc123');
  check('submit never blocks waiting for completion', sub.value.status === 'waiting_provider');
  check('submit schedules a prompt first poll (URLs expire in ~10 min)', sub.value.nextPollSeconds > 0 && sub.value.nextPollSeconds <= 15);
  check('submit sends exactly one task', sub.calls.length === 1);
  const body = JSON.parse(sub.calls[0].init.body);
  check('the wire body carries model + input only', Object.keys(body).sort().join(',') === 'input,model');
  check('the wire body names the exact allowlisted model', body.model === 'google/nano-banana');
  check('no callback URL is used in v1 (polling is the only completion path)',
    !('callBackUrl' in body) && !/callBackUrl:/.test(ADAPTER_CODE));

  sub = await withTransport(NO_NETWORK, () => kieAdapter.submit({ job: job({ ...GOOD_INPUT, model: 'bogus' }) }));
  check('an invalid request never reaches the wire', sub.calls.length === 0 && sub.value.ok === false);
  check('an invalid request is a validation_error', sub.value.errorReason === 'validation_error');

  sub = await withTransport(NO_NETWORK, () => kieAdapter.submit({ job: job(GOOD_INPUT, { execution: { providerJobId: 'task_existing' } }) }));
  check('a double-submit is refused before the wire', sub.calls.length === 0 && sub.value.ok === false);

  sub = await withTransport(() => response({ code: 200, msg: 'success', data: {} }), () => kieAdapter.submit({ job: job(GOOD_INPUT) }));
  check('an accepted submission with no task id is "provider_submission_unresolved"',
    sub.value.errorReason === 'provider_submission_unresolved');
  check('unresolved submission warns about duplicate paid work', /duplicate paid work/i.test(sub.value.error));

  sub = await withTransport(() => response({ code: 401, msg: 'Unauthorized' }, 401), () => kieAdapter.submit({ job: job(GOOD_INPUT) }));
  check('a 401 at submit is an authentication_error', sub.value.errorReason === 'authentication_error');
  sub = await withTransport(() => response({ code: 429, msg: 'Too Many Requests' }, 429), () => kieAdapter.submit({ job: job(GOOD_INPUT) }));
  check('a 429 at submit is rate_limited', sub.value.errorReason === 'rate_limited');
  sub = await withTransport(() => response({ code: 402, msg: 'Insufficient credits' }, 402), () => kieAdapter.submit({ job: job(GOOD_INPUT) }));
  check('a 402 at submit is insufficient_credits', sub.value.errorReason === 'insufficient_credits');
  sub = await withTransport(() => response({ code: 500, msg: 'boom' }, 200), () => kieAdapter.submit({ job: job(GOOD_INPUT) }));
  check('an HTTP-200 body with a non-200 code is still a failure', sub.value.ok === false);
  sub = await withTransport(() => { throw new Error('socket hang up'); }, () => kieAdapter.submit({ job: job(GOOD_INPUT) }));
  check('a transport failure is a network_error', sub.value.errorReason === 'network_error');

  // ── Poll mapping ─────────────────────────────────────────────────────────
  section('Poll state mapping');

  check('the documented state vocabulary is complete',
    KIE_TASK_STATES.join(',') === 'waiting,queuing,generating,success,fail');

  for (const state of ['waiting', 'queuing', 'generating']) {
    const m = mapKiePollResponse({ code: 200, data: { state } });
    check(`"${state}" maps to waiting_provider`, m.ok === true && m.status === 'waiting_provider' && m.outputs.length === 0);
  }
  check('progress is never fabricated for a pending task',
    mapKiePollResponse({ code: 200, data: { state: 'generating' } }).progress === null);
  check('a reported progress value is preserved',
    mapKiePollResponse({ code: 200, data: { state: 'generating', progress: 42 } }).progress === 42);

  const okPoll = mapKiePollResponse({
    code: 200,
    data: { state: 'success', model: 'google/nano-banana', creditsConsumed: 4, costTime: 5200, resultJson: JSON.stringify({ resultUrls: ['https://tempfile.kie.ai/x/y.png'] }) },
  });
  check('"success" maps to completed', okPoll.ok === true && okPoll.status === 'completed' && okPoll.progress === 100);
  check('success stops polling', okPoll.nextPollSeconds === null);
  check('one image output is produced', okPoll.outputs.length === 1 && okPoll.outputs[0].type === 'image');
  check('the output mime is derived from the real result URL', okPoll.outputs[0].mimeType === 'image/png');
  check('a jpg result URL yields image/jpeg',
    mapKiePollResponse({ code: 200, data: { state: 'success', resultJson: JSON.stringify({ resultUrls: ['https://tempfile.kie.ai/x/y.jpg'] }) } }).outputs[0].mimeType === 'image/jpeg');
  check('the real credits consumed are carried for the Ledger', okPoll.rawMetadata.creditsConsumed === 4);
  check('actual cost is labelled in kie-credits, not USD', okPoll.rawMetadata.actualCostCurrency === 'kie-credits');
  check('the ~10-minute URL expiry is recorded as a diagnosable fact', okPoll.rawMetadata.resultUrlExpiresInSeconds === 600);

  check('resultJson is parsed from a JSON string as documented',
    parseKieResultUrls(JSON.stringify({ resultUrls: ['https://a.example/b.png'] })).length === 1);
  check('an already-parsed resultJson object is tolerated',
    parseKieResultUrls({ resultUrls: ['https://a.example/b.png'] }).length === 1);
  check('malformed resultJson yields no URLs rather than throwing', parseKieResultUrls('{not json').length === 0);
  check('a non-https result URL is discarded',
    parseKieResultUrls({ resultUrls: ['http://insecure.example/b.png'] }).length === 0);

  const emptySuccess = mapKiePollResponse({ code: 200, data: { state: 'success', resultJson: '{}' } });
  check('success with no usable URL fails as malformed_output',
    emptySuccess.ok === false && emptySuccess.errorReason === 'malformed_output');

  const unknownState = mapKiePollResponse({ code: 200, data: { state: 'reticulating' } });
  check('an undocumented state keeps waiting rather than inventing an outcome',
    unknownState.status === 'waiting_provider' && unknownState.rawMetadata.unrecognizedState === true);

  const pollNoId = await withTransport(NO_NETWORK, () => kieAdapter.poll({ providerJobId: null }));
  check('polling without a task id never reaches the wire', pollNoId.calls.length === 0 && pollNoId.value.ok === false);

  const pollLive = await withTransport(
    () => response({ code: 200, data: { state: 'generating' } }),
    () => kieAdapter.poll({ job: job(GOOD_INPUT), providerJobId: 'task_abc123' }));
  check('poll queries the documented recordInfo endpoint with the task id',
    pollLive.calls[0].url === 'https://api.kie.ai/api/v1/jobs/recordInfo?taskId=task_abc123' && pollLive.calls[0].init.method === 'GET');
  check('poll queries an existing task only — it never creates one',
    pollLive.calls.every(c => !/createTask/.test(c.url)));

  // ── Failure + billing ────────────────────────────────────────────────────
  section('Failure and billing behaviour');

  const failPoll = mapKiePollResponse({ code: 200, data: { state: 'fail', failCode: 'CONTENT_POLICY', failMsg: 'Prompt rejected by safety filter.', creditsConsumed: 0 } });
  check('"fail" maps to failed', failPoll.ok === false && failPoll.status === 'failed');
  check('the provider failure message is preserved', /safety filter/i.test(failPoll.error));
  check('the provider fail code becomes a normalized error reason', failPoll.errorReason === 'content_policy');
  check('the failure carries the real credits consumed', failPoll.rawMetadata.creditsConsumed === 0);
  check('the "failed tasks are not charged" claim is recorded as unverified',
    /unverified/i.test(failPoll.rawMetadata.billingNote || ''));
  // Tests for retry BEHAVIOUR, not the word: the adapter's error strings say
  // "retrying could duplicate paid work", which is the warning, not the act.
  check('the adapter has no retry loop and never re-submits itself',
    !/\bfor\s*\(|\bwhile\s*\(|setTimeout|setInterval/.test(ADAPTER_CODE)
    && !/this\.submit\(|kieAdapter\.submit\(/.test(ADAPTER_CODE));
  check('an unresolved submission is non-retryable by shared rule, not adapter opinion',
    NON_RETRYABLE_ERROR_REASONS.has('provider_submission_unresolved')
    && isRetryableErrorReason('provider_submission_unresolved') === false);
  check('insufficient credits is never retried automatically',
    isRetryableErrorReason('insufficient_credits') === false);
  check('the adapter never re-submits inside poll', !/createTask/.test(ADAPTER_CODE.split('async poll')[1] || ''));
  check('a Kie job is treated as PAID for approval purposes',
    isPaidExecution({ costTier: 'low', estimateType: 'provisional_catalog', amount: 0.02 }) === true);

  // ── Cancellation ─────────────────────────────────────────────────────────
  section('Cancellation');

  const cancelled = await withTransport(NO_NETWORK, () => kieAdapter.cancel({ providerJobId: 'task_abc123' }));
  check('cancel makes no network call — no endpoint exists', cancelled.calls.length === 0);
  check('cancel honestly reports unsupported', cancelled.value.ok === false && cancelled.value.status === 'unsupported');
  check('cancel warns that credits may still be consumed', /consume credits/i.test(cancelled.value.error));
  check('cancel does not pretend a task was stopped', !/cancelled successfully|stopped/i.test(cancelled.value.error));

  // ── Secure artifact ingestion ────────────────────────────────────────────
  section('Secure artifact ingestion');

  check('the adapter never downloads the artifact itself',
    !/downloadRemoteArtifact|arrayBuffer|writeFile|createWriteStream/.test(ADAPTER_CODE));
  check('the output is handed to the engine as a url for its own secure pipeline',
    typeof okPoll.outputs[0].url === 'string' && okPoll.outputs[0].url.startsWith('https://'));
  check('the output declares a mime the artifact allowlist accepts',
    ['image/png', 'image/jpeg', 'image/webp'].includes(okPoll.outputs[0].mimeType));

  let rejected = null;
  try { await downloadRemoteArtifact('http://insecure.example/a.png', 'image/png'); }
  catch (e) { rejected = e.message; }
  check('the shared downloader refuses a non-https URL', /https/.test(rejected || ''));

  rejected = null;
  await withTransport(
    () => ({ ok: true, status: 200, headers: { get: (h) => (h === 'content-type' ? 'application/x-msdownload' : null) }, arrayBuffer: async () => new ArrayBuffer(8) }),
    async () => { try { await downloadRemoteArtifact('https://a.example/x.exe', null); } catch (e) { rejected = e.message; } });
  check('the shared downloader enforces the MIME allowlist', /allowlist/i.test(rejected || ''));

  rejected = null;
  await withTransport(
    () => ({ ok: true, status: 200, headers: { get: (h) => (h === 'content-type' ? 'image/png' : h === 'content-length' ? String(99 * 1024 * 1024) : null) }, arrayBuffer: async () => new ArrayBuffer(8) }),
    async () => { try { await downloadRemoteArtifact('https://a.example/x.png', 'image/png'); } catch (e) { rejected = e.message; } });
  check('the shared downloader enforces a size limit', /maximum/i.test(rejected || ''));

  // ── No remote URL survives downstream ────────────────────────────────────
  section('No remote URL retained downstream');

  const normalized = kieAdapter.normalizeResult(okPoll);
  check('normalizeResult passes outputs and metadata through unchanged',
    normalized.status === 'completed' && normalized.outputs.length === 1);
  const persisted = sanitizeProviderMetadata(normalized.providerMetadata);
  check('no remote URL survives into persisted provider metadata', !/https?:\/\//.test(JSON.stringify(persisted)));
  check('the real credits consumed DO survive sanitization', persisted.creditsConsumed === 4);
  check('an asset record containing a remote URL is rejected',
    validateAssetRecord({
      assetId: 'ast-1', capability: 'background_plate', mimeType: 'image/png',
      storagePath: 'data/assets/a.png', contentHash: 'a'.repeat(64),
      provenance: { promptHash: 'abc', sourceUrl: 'https://tempfile.kie.ai/x/y.png' },
    }).valid === false);

  // ── Secret safety ────────────────────────────────────────────────────────
  section('Secret safety');

  check('no API key is hardcoded in the adapter', !/sk-|KIE_API_KEY\s*=\s*['"][^'"]+['"]/.test(ADAPTER_CODE));
  check('the key is read only from server-side env', !/NEXT_PUBLIC/.test(ADAPTER_SRC));
  check('.env.example documents the key without a value',
    /^KIE_API_KEY=$/m.test(fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8')));
  check('no real key is committed in .env.example',
    !/^KIE_API_KEY=.+$/m.test(fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8')));

  const leakSurfaces = [];
  const health = await withTransport(() => response({ code: 200, data: 350 }), () => kieAdapter.healthCheck());
  leakSurfaces.push(JSON.stringify(health.value));
  const okSub = await withTransport(() => response({ code: 200, data: { taskId: 't1' } }), () => kieAdapter.submit({ job: job(GOOD_INPUT) }));
  leakSurfaces.push(JSON.stringify(okSub.value));
  const authFail = await withTransport(() => response({ code: 401, msg: 'Unauthorized' }, 401), () => kieAdapter.submit({ job: job(GOOD_INPUT) }));
  leakSurfaces.push(JSON.stringify(authFail.value));
  const pollOut = await withTransport(() => response({ code: 200, data: { state: 'generating' } }), () => kieAdapter.poll({ providerJobId: 't1' }));
  leakSurfaces.push(JSON.stringify(pollOut.value));
  check('the API key never appears in any adapter return value',
    leakSurfaces.every(s => !s.includes(SENTINEL_KEY)));
  check('the API key never appears in an error message',
    !String(authFail.value.error).includes(SENTINEL_KEY));
  check('submit metadata records a prompt HASH, not the prompt',
    !JSON.stringify(okSub.value.rawMetadata).includes(GOOD_INPUT.prompt) && !!okSub.value.rawMetadata.promptHash);

  // ── Asset Generation neutrality ──────────────────────────────────────────
  section('Asset Generation stays provider-neutral');

  const assetFiles = fs.readdirSync(ASSETS_DIR).filter(f => f.endsWith('.js'));
  const kieLeaks = assetFiles.filter(f => /\bkie\b/i.test(fs.readFileSync(path.join(ASSETS_DIR, f), 'utf8')));
  check('grep -Ri "kie" lib/production/assets/ finds no provider logic', kieLeaks.length === 0, kieLeaks.join(', '));
  const assetSrc = assetFiles.map(f => fs.readFileSync(path.join(ASSETS_DIR, f), 'utf8')).join('\n');
  check('Asset Generation imports no adapter module', !/from ['"].*adapters?\//.test(assetSrc));
  check('Asset Generation imports no Kie module', !/kie\.adapter/i.test(assetSrc));
  check('only the Diamond Control layer names Kie',
    /providerId: 'kie'/.test(fs.readFileSync(path.join(ROOT, 'lib/diamond/recommendBinding.js'), 'utf8')));

  // ── Ledger compatibility ─────────────────────────────────────────────────
  section('Ledger compatibility');

  const engineSrc = fs.readFileSync(path.join(ROOT, 'lib/production/execution/executionEngine.js'), 'utf8');
  check('the engine Ledger hook names no provider', !/\bkie\b|higgsfield|openart|heygen/i.test(stripComments(engineSrc)));
  check('the Ledger hook reads providerId from the job, not a provider branch',
    /providerId: job\?\.selectedProvider/.test(engineSrc));
  check('the engine needed no change to support Kie', !/\bkie\b/i.test(engineSrc));
  // Kie's estimateType is now carried into the Ledger intact rather than being
  // flattened to a generic term — a catalogue price stays identifiable as one.
  check('the Ledger preserves Kie\'s provisional_catalog type exactly',
    ESTIMATE_TYPES.includes('provisional_catalog'));

  // ── Existing providers unaffected ────────────────────────────────────────
  section('Existing providers unaffected');

  for (const id of ['higgsfield-mcp', 'openart-video', 'heygen-mcp', 'hyperframes', 'manual-export', 'mock-video']) {
    const a = getExecutionAdapter(id);
    check(`${id} is still registered and intact`, !!a && a.id === id && typeof a.submit === 'function');
  }
  check('Kie is absent from the video PROVIDER_CATALOG (it is image-only)',
    !/id: 'kie'/.test(fs.readFileSync(path.join(ROOT, 'lib/production/productionRules.js'), 'utf8')));
  check('the Higgsfield default binding is unchanged',
    recommendBinding({ capability: 'background_plate' }).binding.model === 'soul_cinematic');
  check('Higgsfield can still confirm a cost (its preflight is untouched)',
    /'higgsfield-mcp': higgsfieldMcpAdapter/.test(fs.readFileSync(path.join(ROOT, 'lib/diamond/costPreflight.js'), 'utf8')));
} finally {
  restoreEnv();
  console.log('');
}

const passed = results.filter(r => r.ok).length;
const failed = results.length - passed;
console.log('═'.repeat(64));
console.log(`Kie adapter validation: ${passed}/${results.length} passed, ${failed} failed`);
if (failed) results.filter(r => !r.ok).forEach(r => console.log(`  ✗ ${r.n}${r.d ? ` — ${r.d}` : ''}`));
process.exit(failed ? 1 : 0);
