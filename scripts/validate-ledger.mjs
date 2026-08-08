#!/usr/bin/env node
// scripts/validate-ledger.mjs
//
// Executable validation for the Ledger (F2). Project convention: real code,
// real filesystem, no mocking. Pure/fs-level checks run without a dev server;
// the Execution Engine integration is asserted by source inspection because
// executionEngine.js uses extensionless imports that only resolve under
// Next's bundler (a pre-existing condition, not introduced here).
//
// Run: node scripts/validate-ledger.mjs

import fs from 'fs';
import path from 'path';
import {
  buildLedgerRecord, validateLedgerRecord, buildCorrectionRecord, findForbiddenContent,
  isPaidExecution, isValidLedgerId, LEDGER_SCHEMA_VERSION, ACTOR_TYPES, ESTIMATE_TYPES,
} from '../lib/ledger/ledgerRules.js';
import { appendLedgerEntry, getLedgerEntry, listLedgerEntries, getLedgerTrailForJob, generateLedgerId, LEDGER_DIR } from '../lib/ledger/ledgerStore.js';

const ROOT = process.cwd();
const results = [];
const created = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${detail && !cond ? ` (${detail})` : ''}`);
}
function section(t) { console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 54 - t.length))}`); }

const base = {
  event: 'execution_started',
  actor: { type: 'human', id: 'validator' },
  division: 'asset-generation',
  capability: 'background_plate',
  estimate: { amount: 0, currency: 'USD', estimateType: 'confirmed_local', confirmed: true },
  outcome: { status: 'started' },
};

try {
  // ── Shape + required fields ──────────────────────────────────────────────
  section('Record shape and required fields');

  const rec = buildLedgerRecord({ id: 'led-shape-1', ...base });
  check('valid record passes validation', validateLedgerRecord(rec).valid, JSON.stringify(validateLedgerRecord(rec).errors));
  check('schemaVersion stamped', rec.schemaVersion === LEDGER_SCHEMA_VERSION);
  check('timestamp is ISO', !Number.isNaN(Date.parse(rec.timestamp)));

  check('actor required', !validateLedgerRecord(buildLedgerRecord({ ...base, id: 'x1', actor: { type: 'nope', id: '' } })).valid);
  check('division required', !validateLedgerRecord(buildLedgerRecord({ ...base, id: 'x2', division: null })).valid);
  check('capability required', !validateLedgerRecord(buildLedgerRecord({ ...base, id: 'x3', capability: null })).valid);
  check('event must be known', !validateLedgerRecord(buildLedgerRecord({ ...base, id: 'x4', event: 'not_an_event' })).valid);
  check('id must be safe', !validateLedgerRecord(buildLedgerRecord({ ...base, id: '../escape' })).valid);
  check('all actor types accepted', ACTOR_TYPES.every(t =>
    validateLedgerRecord(buildLedgerRecord({ ...base, id: `led-a-${t}`, actor: { type: t, id: t } })).valid));
  check('string actor is widened (engine compatibility)', buildLedgerRecord({ ...base, id: 'led-s', actor: 'system' }).actor.type === 'system');

  // ── Estimate / actual honesty ────────────────────────────────────────────
  section('Estimate and actual honesty');

  check('estimate and actual are separate fields', rec.estimate && rec.actual && rec.estimate !== rec.actual);
  const unknownActual = buildLedgerRecord({ ...base, id: 'led-u1' });
  check('unknown actual stays unknown, not copied from estimate',
    unknownActual.actual.amount === null && unknownActual.actual.confirmed === false);
  check('confirmed estimate must carry an amount',
    !validateLedgerRecord(buildLedgerRecord({ ...base, id: 'led-u2', estimate: { estimateType: 'confirmed_provider', confirmed: true } })).valid);
  check('confirmed actual must carry an amount',
    !validateLedgerRecord(buildLedgerRecord({ ...base, id: 'led-u3', actual: { confirmed: true } })).valid);
  check('provisional is a distinct estimateType', ESTIMATE_TYPES.includes('provisional_tier') && ESTIMATE_TYPES.includes('confirmed_local'));
  check('unknown estimateType degrades to "unknown"',
    buildLedgerRecord({ ...base, id: 'led-u4', estimate: { estimateType: 'made_up' } }).estimate.estimateType === 'unknown');

  // ── Forbidden content ────────────────────────────────────────────────────
  section('Forbidden content');

  check('clean record has no findings', findForbiddenContent(rec).length === 0);
  check('absolute unix path rejected', findForbiddenContent({ a: '/Users/someone/file' }).includes('absolute_path'));
  check('bearer token rejected', findForbiddenContent({ a: 'Bearer abcdefghijklmnopqrstuvwxyz0123' }).includes('bearer_token'));
  check('api key rejected', findForbiddenContent({ a: 'sk-live-abcdefghijklmnopqrstuvwxyz' }).includes('api_key'));
  check('aws key rejected', findForbiddenContent({ a: 'AKIAIOSFODNN7EXAMPLE' }).includes('aws_key'));
  check('private key rejected', findForbiddenContent({ a: 'BEGIN RSA PRIVATE KEY' }).includes('private_key'));
  check('oauth payload rejected', findForbiddenContent({ raw: '{"access_token": "x"}' }).includes('oauth_token'));
  check('base64 data uri rejected', findForbiddenContent({ a: 'data:image/png;base64,AAAA' }).includes('data_uri'));
  check('record carrying a secret fails validation',
    !validateLedgerRecord(buildLedgerRecord({ ...base, id: 'led-f1', metadata: { note: 'Bearer abcdefghijklmnopqrstuvwxyz0123' } })).valid);
  check('record carrying an absolute path fails validation',
    !validateLedgerRecord(buildLedgerRecord({ ...base, id: 'led-f2', metadata: { note: '/Users/x/y' } })).valid);

  // ── Append-only persistence ──────────────────────────────────────────────
  section('Append-only persistence');

  const id1 = generateLedgerId();
  const w1 = appendLedgerEntry({ id: id1, ...base });
  created.push(id1);
  check('entry appends', w1.ok, w1.error || JSON.stringify(w1.errors));
  check('entry is readable', getLedgerEntry(id1)?.id === id1);

  const dup = appendLedgerEntry({ id: id1, ...base });
  check('re-writing an existing id is refused (append-only)', dup.ok === false && /append-only/i.test(dup.error));

  const before = JSON.stringify(getLedgerEntry(id1));
  appendLedgerEntry({ id: generateLedgerId(), ...base, division: 'other' });
  check('existing entry is unchanged by later writes', JSON.stringify(getLedgerEntry(id1)) === before);

  const invalid = appendLedgerEntry({ id: generateLedgerId(), ...base, division: null });
  check('invalid record is never persisted', invalid.ok === false && Array.isArray(invalid.errors));

  check('traversal id refused', appendLedgerEntry({ id: '../../evil', ...base }).ok === false);
  check('absolute id refused', appendLedgerEntry({ id: '/etc/passwd', ...base }).ok === false);
  check('isValidLedgerId rejects unsafe ids', !isValidLedgerId('../x') && !isValidLedgerId('a/b') && !isValidLedgerId(''));

  // Atomic write: no staging file may survive.
  check('no staging (.tmp-) files left behind',
    !fs.existsSync(LEDGER_DIR) || fs.readdirSync(LEDGER_DIR).filter(f => f.startsWith('.tmp-')).length === 0);

  // Concurrency: unique ids, all persisted, none lost.
  const burst = Array.from({ length: 25 }, () => generateLedgerId());
  const bursts = burst.map(id => { created.push(id); return appendLedgerEntry({ id, ...base, capability: 'burst_test' }); });
  check('25 concurrent-style writes all persist', bursts.every(b => b.ok));
  check('all 25 are individually readable', burst.every(id => getLedgerEntry(id)?.id === id));
  check('ids are unique', new Set(burst).size === 25);

  // ── Correction records ───────────────────────────────────────────────────
  section('Corrections');

  const corr = buildCorrectionRecord({
    id: 'led-corr-1', correctsEntryId: id1, actor: { type: 'human', id: 'validator' },
    division: 'asset-generation', capability: 'background_plate',
    actual: { amount: 0.04, currency: 'USD', confirmed: true }, note: 'Confirmed actual cost.',
  });
  check('correction record is valid', validateLedgerRecord(corr).valid, JSON.stringify(validateLedgerRecord(corr).errors));
  check('correction links to the corrected entry', corr.metadata.correctsEntryId === id1);
  check('correction without a link is invalid',
    !validateLedgerRecord(buildLedgerRecord({ ...base, id: 'led-corr-2', event: 'correction' })).valid);
  const corrId = generateLedgerId();
  created.push(corrId);
  appendLedgerEntry({ ...corr, id: corrId });
  check('original is still intact after a correction', JSON.stringify(getLedgerEntry(id1)) === before);

  // ── Query surface ────────────────────────────────────────────────────────
  section('Query surface');

  const jobId = `pr-ledger-validator-${Date.now()}`;
  const trail = ['approval_granted', 'execution_started', 'execution_completed'];
  for (const ev of trail) {
    const lid = generateLedgerId(); created.push(lid);
    appendLedgerEntry({ id: lid, ...base, event: ev, source: { productionJobId: jobId }, outcome: { status: ev === 'approval_granted' ? 'approved' : ev === 'execution_started' ? 'started' : 'completed' } });
  }
  const jobTrail = getLedgerTrailForJob(jobId);
  check('job trail returns all lifecycle entries', jobTrail.length === 3, String(jobTrail.length));
  check('job trail is chronological', jobTrail.map(e => e.event).join(',') === trail.join(','), jobTrail.map(e => e.event).join(','));
  check('filter by division works', listLedgerEntries({ division: 'asset-generation', limit: 5 }).every(e => e.division === 'asset-generation'));
  check('filter by capability works', listLedgerEntries({ capability: 'burst_test', limit: 50 }).every(e => e.capability === 'burst_test'));

  // ── Engine integration (source-level) ────────────────────────────────────
  section('Execution Engine integration');

  const engine = fs.readFileSync(path.join(ROOT, 'lib/production/execution/executionEngine.js'), 'utf8');
  check('engine imports the ledger store', engine.includes("ledger/ledgerStore.js"));
  check('engine has a single recordLedger helper', (engine.match(/function recordLedger\(/g) || []).length === 1);
  check('engine records execution_started', engine.includes("'execution_started'"));
  check('engine records execution_completed', engine.includes("'execution_completed'"));
  check('engine records execution_failed', engine.includes("'execution_failed'"));
  check('engine records execution_cancelled', engine.includes("'execution_cancelled'"));
  check('paid execution is blocked when the ledger write fails', /startLedger\.blocking/.test(engine));
  check('free execution degrades rather than blocking', /degraded \(free execution\)/.test(engine));
  check('approval is recorded at the approval site', fs.readFileSync(path.join(ROOT, 'pages/api/production/jobs/[id]/approve.js'), 'utf8').includes('approval_granted'));

  // Adapters must contain zero ledger LOGIC — no import of the ledger modules
  // and no call into them. Checked over RAW source (comments included) for the
  // import/call forms, which is what actually constitutes a violation.
  //
  // This deliberately tests behaviour rather than the mere word "ledger": an
  // adapter may legitimately explain in a comment which system owns the
  // permanent record (kie.adapter.js does, by design), and banning the word
  // would force adapters to be vague about the very boundary being enforced.
  const LEDGER_LOGIC = /from\s+['"][^'"]*ledger[^'"]*['"]|require\(\s*['"][^'"]*ledger|\b(appendLedgerEntry|buildLedgerRecord|validateLedgerRecord|buildCorrectionRecord|recordLedger|generateLedgerId)\s*\(/i;
  const adapterDir = path.join(ROOT, 'lib/production/execution/adapters');
  const adapterHits = fs.readdirSync(adapterDir).filter(f => f.endsWith('.js'))
    .filter(f => LEDGER_LOGIC.test(fs.readFileSync(path.join(adapterDir, f), 'utf8')));
  check('no provider adapter contains ledger logic', adapterHits.length === 0, adapterHits.join(','));
  // The rule must still bite: prove the detector catches a real violation.
  check('the ledger-logic detector actually catches an import',
    LEDGER_LOGIC.test("import { appendLedgerEntry } from '../../../ledger/ledgerStore.js';"));
  check('the ledger-logic detector actually catches a call',
    LEDGER_LOGIC.test('const r = appendLedgerEntry({ event: "x" });'));
  check('the ledger-logic detector ignores an explanatory comment',
    !LEDGER_LOGIC.test('// Mika\'s permanent record is Production Job -> Ledger -> Asset Library.'));

  // ── Spend policy ─────────────────────────────────────────────────────────
  section('Spend policy');

  check('free tier is not paid', isPaidExecution({ costTier: 'free' }) === false);
  check('confirmed_local is not paid', isPaidExecution({ estimateType: 'confirmed_local' }) === false);
  check('variable tier is paid', isPaidExecution({ costTier: 'variable', estimateType: 'provisional_tier' }) === true);
  check('confirmed provider zero is not paid', isPaidExecution({ costTier: 'variable', estimateType: 'confirmed_provider', amount: 0 }) === false);
} finally {
  for (const id of created) {
    try { fs.rmSync(path.join(LEDGER_DIR, `${id}.json`), { force: true }); } catch { /* ignore */ }
  }
  console.log(`\ncleaned up ${created.length} validator ledger entr(ies)`);
}

const passed = results.filter(r => r.ok).length;
const failed = results.length - passed;
console.log('═'.repeat(64));
console.log(`Ledger validation: ${passed}/${results.length} passed, ${failed} failed`);
if (failed) results.filter(r => !r.ok).forEach(r => console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ''}`));
process.exit(failed ? 1 : 0);
