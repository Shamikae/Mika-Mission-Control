#!/usr/bin/env node
// scripts/validate-asset-plan-governance.mjs
//
// Executable validation for AssetPlan governance (M3): state machine, the one
// batch approval, budget ceilings, content-hash binding, and Ledger records.
// Real filesystem, no dev server, no spend — nothing here dispatches.
//
// Run: node scripts/validate-asset-plan-governance.mjs

import fs from 'fs';
import path from 'path';
import { buildRenderSpec } from '../lib/production/renderSpec/buildRenderSpec.js';
import { buildPlan, planContentHash, refreshPlan } from '../lib/production/assets/assetPlanner.js';
import { savePlan, getPlan, ASSET_PLAN_DIR, generatePlanId } from '../lib/production/assets/assetPlanStore.js';
import {
  canTransition, checkApprovalEligibility, PLAN_STATES, makePlanEvent,
} from '../lib/production/assets/assetPlanRules.js';
import { approvePlan, rejectPlan } from '../lib/production/assets/assetPlanService.js';
import { LEDGER_EVENTS, OUTCOME_STATUSES } from '../lib/ledger/ledgerRules.js';
import { listLedgerEntries, LEDGER_DIR } from '../lib/ledger/ledgerStore.js';

const ROOT = process.cwd();
const REAL_PACKAGE = 'pack-1785960819732-4ed2d0.json';

const results = [];
const cleanup = [];
function check(n, c, d = '') { results.push({ n, ok: !!c, d }); console.log(`${c ? 'PASS' : 'FAIL'} — ${n}${d && !c ? ` (${d})` : ''}`); }
function section(t) { console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 52 - t.length))}`); }

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'content-packages', REAL_PACKAGE), 'utf8'));
const { spec } = buildRenderSpec(pkg, { mode: 'faceless_social' });

const ledgerBefore = new Set(fs.existsSync(LEDGER_DIR) ? fs.readdirSync(LEDGER_DIR) : []);

/** Persists a priced fixture plan so governance can be exercised without spend. */
function makePricedPlan({ ceilingAmount = null, confirmed = true } = {}) {
  // Ceilings are per-unit now: a bare number cannot say which unit it governs.
  const ceilings = ceilingAmount === null ? {} : { 'higgsfield-credits': ceilingAmount };
  const p = buildPlan(spec, { packageId: pkg.id, brandId: spec.source?.brand, actor: 'validator', ceilings });
  const requests = p.requests.map(r => r.status === 'awaiting_generation'
    // Mirrors exactly what costPreflight now emits: the unit is DECLARED, never
    // inferred from the currency string.
    ? { ...r, estimate: { amount: 0.12, unit: 'provider_credits', providerCreditUnit: 'higgsfield-credits', currency: null, estimateType: confirmed ? 'confirmed_provider' : 'provisional_adapter', confirmed, isLowerBound: false } }
    : r);
  let plan = refreshPlan({ ...p, requests, status: 'estimated' });
  plan.contentHash = planContentHash(plan);
  plan.planId = generatePlanId();
  const saved = savePlan(plan);
  if (saved.ok) cleanup.push(() => fs.rmSync(path.join(ASSET_PLAN_DIR, `${plan.planId}.json`), { force: true }));
  return saved.plan;
}

try {
  // ── State machine ────────────────────────────────────────────────────────
  section('State machine');

  check('all six states declared', PLAN_STATES.join(',') === 'draft,estimated,awaiting_approval,approved,rejected,invalidated');
  check('draft cannot jump straight to approved', !canTransition('draft', 'approved'));
  check('estimated can await approval', canTransition('estimated', 'awaiting_approval'));
  check('awaiting_approval can be approved', canTransition('awaiting_approval', 'approved'));
  check('approved is terminal except for invalidation',
    canTransition('approved', 'invalidated') && !canTransition('approved', 'estimated') && !canTransition('approved', 'rejected'));
  check('rejected is terminal', PLAN_STATES.every(s => !canTransition('rejected', s)));
  check('invalidated is terminal', PLAN_STATES.every(s => !canTransition('invalidated', s)));

  // ── Budget ceiling ───────────────────────────────────────────────────────
  section('Budget ceiling');

  const noCeiling = makePricedPlan({ ceilingAmount: null });
  const noCeilingCheck = checkApprovalEligibility(noCeiling, { acknowledgeProvisional: true });
  check('a plan without a ceiling cannot be approved', noCeilingCheck.eligible === false);
  check('the missing ceiling is named', noCeilingCheck.reasons.some(r => /ceiling is required/i.test(r)));

  const noCeilingApprove = approvePlan(noCeiling.planId, { actor: 'validator', acknowledgeProvisional: true });
  check('the approve service refuses without a ceiling', noCeilingApprove.ok === false && noCeilingApprove.status === 422);

  const lowCeiling = makePricedPlan({ ceilingAmount: 0.01 });
  const lowResult = approvePlan(lowCeiling.planId, { actor: 'validator', ceilings: { 'higgsfield-credits': 0.01 } });
  check('a ceiling below the total blocks approval', lowResult.ok === false, String(lowResult.status));
  // The overrun message now names the UNIT alongside both figures, so that
  // "0.24 exceeds 0.01" can never be read as dollars when it is vendor credits.
  // The expected total is DERIVED from the plan, not hardcoded: how many scenes
  // are paid misses depends on live Asset Library contents and legitimately
  // changes as assets accumulate.
  const expectedTotal = lowCeiling.summary.totals[0]?.amount;
  check('the overrun is explained with both numbers AND the unit',
    Number.isFinite(expectedTotal)
    && (lowResult.reasons || []).some(r => /exceeds the/i.test(r) && r.includes(String(expectedTotal)) && /0\.01/.test(r) && /higgsfield-credits/.test(r)),
    JSON.stringify(lowResult.reasons));
  check('a blocked plan is NOT left approved', getPlan(lowCeiling.planId).status !== 'approved');

  // ── Provisional acknowledgement ──────────────────────────────────────────
  section('Provisional estimates');

  const prov = makePricedPlan({ ceilingAmount: 5, confirmed: false });
  const provBlocked = approvePlan(prov.planId, { actor: 'validator', ceilings: { 'higgsfield-credits': 5 } });
  check('provisional estimates block approval without acknowledgement', provBlocked.ok === false);
  check('the acknowledgement requirement is explained',
    (provBlocked.reasons || []).some(r => /provisional/i.test(r)));
  const provOk = approvePlan(prov.planId, { actor: 'validator', ceilings: { 'higgsfield-credits': 5 }, acknowledgeProvisional: true });
  check('explicit acknowledgement permits approval', provOk.ok === true, provOk.error);
  check('acknowledgement is recorded on the plan', getPlan(prov.planId).approval.acknowledgedProvisional === true);

  // ── One batch approval ───────────────────────────────────────────────────
  section('One batch approval');

  const plan = makePricedPlan({ ceilingAmount: 5 });
  const approved = approvePlan(plan.planId, { actor: 'validator', ceilings: { 'higgsfield-credits': 5 } });
  check('a priced plan within its ceiling approves', approved.ok === true, approved.error);
  check('one approvalRef covers the whole batch', !!approved.approvalRef && approved.approvalRef === `apr-${plan.planId}`);

  const stored = getPlan(plan.planId);
  check('plan status is approved', stored.status === 'approved');
  check('actor attribution is recorded', stored.approval.approvedBy === 'validator');
  check('approval binds to the exact content hash', stored.approval.contentHashAtApproval === stored.contentHash);
  check('there is exactly ONE approval record on the plan',
    stored.activityHistory.filter(e => e.type === 'asset_plan_approved').length === 1);
  check('no per-scene approval exists on any request',
    stored.requests.every(r => !('approval' in r) && !('approvalRef' in r)));
  check('every scene shares the single batch approval', !!stored.approval.approvalRef);

  // ── Modification invalidates approval ────────────────────────────────────
  section('Modification invalidates approval');

  const tampered = refreshPlan({
    ...stored,
    requests: stored.requests.map((r, i) => i === 1 ? { ...r, estimate: { ...r.estimate, amount: 9.99 } } : r),
  });
  check('changing a price invalidates the approval', tampered.status === 'invalidated');
  check('the approvalRef is cleared', tampered.approval.approvalRef === null);

  const hashMismatch = approvePlan(plan.planId, {
    actor: 'validator', ceilings: { 'higgsfield-credits': 5 },
    expectedContentHash: 'a'.repeat(64),
  });
  check('approving against a stale content hash is refused', hashMismatch.ok === false && hashMismatch.status === 409);
  check('the refusal returns the current hash so the UI can re-read', /^[0-9a-f]{64}$/.test(hashMismatch.contentHash || ''));

  // ── Rejection ────────────────────────────────────────────────────────────
  section('Rejection');

  const toReject = makePricedPlan({ ceilingAmount: 5 });
  const rejected = rejectPlan(toReject.planId, { actor: 'validator', reason: 'not needed' });
  check('a plan can be rejected', rejected.ok === true, rejected.error);
  check('rejected plans carry no approval', getPlan(toReject.planId).approval.approvalRef === null);
  check('rejection is terminal', rejectPlan(toReject.planId, { actor: 'validator' }).ok === false);

  // ── Ledger ───────────────────────────────────────────────────────────────
  section('Ledger plan events');

  for (const ev of ['asset_plan_created', 'asset_plan_estimated', 'asset_plan_approval_requested', 'asset_plan_approved', 'asset_plan_rejected', 'asset_plan_invalidated']) {
    check(`ledger vocabulary includes ${ev}`, LEDGER_EVENTS.includes(ev));
  }
  check('planned/estimated/invalidated are valid outcomes',
    ['planned', 'estimated', 'invalidated'].every(s => OUTCOME_STATUSES.includes(s)));

  const planEntries = listLedgerEntries({ division: 'asset-generation', limit: 200 })
    .filter(e => e.source?.planId === plan.planId);
  check('an approval ledger record was written', planEntries.some(e => e.event === 'asset_plan_approved'));
  const approvalEntry = planEntries.find(e => e.event === 'asset_plan_approved');
  check('exactly one approval ledger record', planEntries.filter(e => e.event === 'asset_plan_approved').length === 1);
  check('ledger capability is asset_batch', approvalEntry?.capability === 'asset_batch');
  check('ledger carries planId', approvalEntry?.source?.planId === plan.planId);
  check('ledger carries packageId and renderSpecId',
    approvalEntry?.source?.packageId === pkg.id && approvalEntry?.source?.renderSpecId === spec.specId);
  check('ledger carries the estimated total', Number.isFinite(approvalEntry?.estimate?.amount));
  check('ledger records confirmed/provisional honestly',
    typeof approvalEntry?.estimate?.confirmed === 'boolean');
  check('ledger carries the approvalRef', approvalEntry?.approval?.approvalRef === approved.approvalRef);
  check('ledger carries actor attribution', approvalEntry?.actor?.id === 'validator');
  check('ledger note carries request/hit/paid counts', /requests=\d+ hits=\d+ paid=\d+/.test(approvalEntry?.metadata?.note || ''));

  // No prompts, ever.
  const promptText = spec.scenes[1]?.visual?.generationPrompt || '';
  const allPlanEntries = listLedgerEntries({ division: 'asset-generation', limit: 500 });
  check('no raw prompt appears in any ledger entry',
    !allPlanEntries.some(e => promptText && JSON.stringify(e).includes(promptText.slice(0, 40))));

  // ── No dispatch before approval ──────────────────────────────────────────
  section('No dispatch');

  check('no dispatch route exists', !fs.existsSync(path.join(ROOT, 'pages/api/production/assets/plans/[id]/dispatch.js')));
  const svc = fs.readFileSync(path.join(ROOT, 'lib/production/assets/assetPlanService.js'), 'utf8');
  check('the plan service never creates a Production Job', !/buildProductionJob|createProductionJob/.test(svc));
  check('the plan service never enqueues', !/enqueue|runNextExecution/.test(svc));
  check('no plan request holds a Production Job', stored.requests.every(r => r.productionJobId === null));

  // ── Store safety ─────────────────────────────────────────────────────────
  section('Store safety');

  check('traversal plan id is refused', savePlan({ planId: '../evil', requests: [] }).ok === false);
  check('no staging files left behind',
    !fs.existsSync(ASSET_PLAN_DIR) || fs.readdirSync(ASSET_PLAN_DIR).filter(f => f.startsWith('.tmp-')).length === 0);
  check('plan records contain no absolute path', !JSON.stringify(stored).includes('/Users/'));
} finally {
  for (const fn of cleanup.reverse()) { try { fn(); } catch { /* ignore */ } }
  // Remove only ledger entries this validator created.
  if (fs.existsSync(LEDGER_DIR)) {
    for (const f of fs.readdirSync(LEDGER_DIR)) {
      if (ledgerBefore.has(f)) continue;
      try {
        const e = JSON.parse(fs.readFileSync(path.join(LEDGER_DIR, f), 'utf8'));
        if (e.actor?.id === 'validator') fs.rmSync(path.join(LEDGER_DIR, f), { force: true });
      } catch { /* ignore */ }
    }
  }
  console.log(`\ncleaned up ${cleanup.length} fixture plan(s) and validator ledger entries`);
}

const passed = results.filter(r => r.ok).length;
const failed = results.length - passed;
console.log('═'.repeat(64));
console.log(`Asset plan governance validation: ${passed}/${results.length} passed, ${failed} failed`);
if (failed) results.filter(r => !r.ok).forEach(r => console.log(`  ✗ ${r.n}${r.d ? ` — ${r.d}` : ''}`));
process.exit(failed ? 1 : 0);
