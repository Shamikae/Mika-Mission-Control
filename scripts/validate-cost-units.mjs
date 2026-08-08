#!/usr/bin/env node
// scripts/validate-cost-units.mjs
//
// Executable validation for multi-currency cost governance. Real code, real
// filesystem, NO NETWORK, NO SPEND.
//
// The thing being proven: Mika can hold costs in genuinely incomparable units
// (one vendor's credits, another's, real dollars) without ever adding them,
// converting them, or letting a single ceiling govern more than one of them.
//
// Run: node scripts/validate-cost-units.mjs

import fs from 'fs';
import path from 'path';
import {
  COST_UNITS, COST_ESTIMATE_TYPES, ESTIMATE_COMPLETENESS,
  normalizeCost, currencyCost, providerCreditCost, unitKeyOf, parseUnitKey, unitLabel,
  areComparable, isZeroCost, aggregateCosts, normalizeCeilings, checkCeilings,
} from '../lib/cost/costShape.js';
import { summarizePlan, checkApprovalEligibility, planCeilings, planHashSubject } from '../lib/production/assets/assetPlanRules.js';
import { buildLedgerRecord, validateLedgerRecord, ESTIMATE_TYPES } from '../lib/ledger/ledgerRules.js';
import { compareProviderCosts } from '../lib/diamond/costPreflight.js';
import kieAdapter from '../lib/production/execution/adapters/kie.adapter.js';
import higgsfieldAdapter from '../lib/production/execution/adapters/higgsfieldMcp.adapter.js';
import hyperframesAdapter from '../lib/production/execution/adapters/hyperframes.adapter.js';

const ROOT = process.cwd();
const results = [];
function check(n, c, d = '') { results.push({ n, ok: !!c, d }); console.log(`${c ? 'PASS' : 'FAIL'} — ${n}${d && !c ? ` (${d})` : ''}`); }
function section(t) { console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 52 - t.length))}`); }
function stripComments(s) { return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); }

const HIGGS = (amount, extra = {}) => providerCreditCost(amount, 'higgsfield-credits', { estimateType: 'confirmed_provider', confirmed: true, ...extra });
const KIE = (amount, extra = {}) => currencyCost(amount, 'USD', { estimateType: 'provisional_catalog', confirmed: false, ...extra });
const LOCAL_ZERO = currencyCost(0, 'USD', { estimateType: 'confirmed_local', confirmed: true });

const req = (estimate, status = 'awaiting_generation') => ({ status, estimate, sceneIndex: 0, capability: 'background_plate' });

try {
  // ── Shape ────────────────────────────────────────────────────────────────
  section('Provider-neutral money shape');

  check('exactly two units exist', COST_UNITS.join(',') === 'currency,provider_credits');
  check('completeness vocabulary is the agreed four',
    ESTIMATE_COMPLETENESS.join(',') === 'complete,provisional,lower_bound,mixed');

  const h = HIGGS(0.12);
  check('provider credits carry their pool name', h.unit === 'provider_credits' && h.providerCreditUnit === 'higgsfield-credits');
  check('provider credits are NOT given a currency', h.currency === null);
  const k = KIE(0.02);
  check('a currency cost carries its code', k.unit === 'currency' && k.currency === 'USD');
  check('a currency cost has no credit pool', k.providerCreditUnit === null);

  check('a unit is never invented for an undeclared cost', normalizeCost({ amount: 5 }).unit === null);
  check('an undeclared unit yields no unit key', unitKeyOf(normalizeCost({ amount: 5 })) === null);
  check('confirmation cannot be claimed without an amount',
    normalizeCost({ confirmed: true, estimateType: 'confirmed_provider' }).confirmed === false);
  check('confirmation cannot be claimed by a provisional type',
    normalizeCost({ amount: 1, confirmed: true, estimateType: 'provisional_catalog' }).confirmed === false);
  check('a shape cannot hold two denominations at once',
    normalizeCost({ amount: 1, unit: 'currency', currency: 'USD', providerCreditUnit: 'x-credits' }).providerCreditUnit === null);

  check('unit keys distinguish two providers\' credits',
    unitKeyOf(HIGGS(1)) !== unitKeyOf(providerCreditCost(1, 'openart-credits')));
  check('credits and dollars are never the same unit', unitKeyOf(HIGGS(1)) !== unitKeyOf(KIE(1)));
  check('same-unit costs are comparable', areComparable(HIGGS(1), HIGGS(2)));
  check('cross-unit costs are NOT comparable', areComparable(HIGGS(1), KIE(1)) === false);
  check('unitless costs are never comparable to anything',
    areComparable(normalizeCost({ amount: 1 }), normalizeCost({ amount: 1 })) === false);
  check('parseUnitKey round-trips', parseUnitKey('provider_credits:higgsfield-credits').providerCreditUnit === 'higgsfield-credits');
  check('unitLabel reads the denomination', unitLabel('currency:USD') === 'USD');

  // ── Aggregation ──────────────────────────────────────────────────────────
  section('Same-unit aggregation');

  const same = aggregateCosts([HIGGS(0.12), HIGGS(0.12)]);
  check('same-unit costs sum', same.totals.length === 1 && same.totals[0].amount === 0.24);
  check('the sum keeps its unit', same.totals[0].providerCreditUnit === 'higgsfield-credits');
  check('a single-unit plan is comparable', same.comparable === true);
  check('all-confirmed is complete', same.estimateCompleteness === 'complete');
  check('no warning is raised for a clean single-unit plan', same.warnings.length === 0);

  section('Mixed-unit aggregation');

  const mixed = aggregateCosts([HIGGS(0.12), HIGGS(0.12), KIE(0.02), KIE(0.02)]);
  check('mixed units produce TWO totals, never one', mixed.totals.length === 2);
  check('mixed units are not comparable', mixed.comparable === false);
  const hg = mixed.totals.find(t => t.providerCreditUnit === 'higgsfield-credits');
  const ug = mixed.totals.find(t => t.currency === 'USD');
  check('the credit group sums only credits', hg.amount === 0.24);
  check('the dollar group sums only dollars', ug.amount === 0.04);
  check('NO arithmetic crossed the units (0.28 never appears)',
    !mixed.totals.some(t => t.amount === 0.28) && mixed.totals.reduce((n, t) => n + (t.amount === 0.28 ? 1 : 0), 0) === 0);
  check('a warning names the incomparable units', mixed.warnings.some(w => /incomparable units/i.test(w)));
  check('mixed units never expose a single summed field', mixed.total === undefined && mixed.amount === undefined);

  section('Zero-cost handling');

  check('a confirmed zero is unit-neutral', isZeroCost(LOCAL_ZERO) === true);
  check('an unconfirmed zero is NOT unit-neutral', isZeroCost(currencyCost(0, 'USD', { estimateType: 'unknown' })) === false);
  const withZeros = aggregateCosts([LOCAL_ZERO, LOCAL_ZERO, LOCAL_ZERO, HIGGS(0.24)]);
  check('free placeholders do not make a plan look mixed', withZeros.comparable === true && withZeros.totals.length === 1);
  check('free placeholders stay visible in the count', withZeros.zeroCostRequests === 3);
  check('an all-free plan has no totals at all', aggregateCosts([LOCAL_ZERO, LOCAL_ZERO]).totals.length === 0);
  check('an all-free plan is comparable and complete',
    aggregateCosts([LOCAL_ZERO]).comparable === true && aggregateCosts([LOCAL_ZERO]).estimateCompleteness === 'complete');

  // ── Lower bounds ─────────────────────────────────────────────────────────
  section('Lower-bound propagation');

  const floorAgg = aggregateCosts([KIE(0.04, { isLowerBound: true })]);
  check('a lower bound marks its group', floorAgg.totals[0].isLowerBound === true);
  check('a lower bound makes the plan lower_bound, not complete',
    floorAgg.estimateCompleteness !== 'complete');
  check('a lower bound warns explicitly', floorAgg.warnings.some(w => /minimum|from/i.test(w)));

  const confirmedFloor = aggregateCosts([HIGGS(0.5, { isLowerBound: true })]);
  check('a confirmed price that is a floor is still not "complete"',
    confirmedFloor.estimateCompleteness === 'lower_bound');

  check('provisional alone reports provisional', aggregateCosts([KIE(0.02)]).estimateCompleteness === 'provisional');
  check('provisional + lower bound reports mixed',
    aggregateCosts([KIE(0.02), HIGGS(1, { isLowerBound: true })]).estimateCompleteness === 'mixed');

  const unknownAmt = aggregateCosts([HIGGS(0.12), providerCreditCost(null, 'higgsfield-credits', { estimateType: 'unknown' })]);
  check('an unknown amount turns its group into a floor', unknownAmt.totals[0].isLowerBound === true);
  check('an unknown amount reports mixed completeness', unknownAmt.estimateCompleteness === 'mixed');
  check('an unknown amount is counted', unknownAmt.unknownAmountRequests === 1);

  const noUnit = aggregateCosts([HIGGS(0.12), normalizeCost({ amount: 9, estimateType: 'unknown' })]);
  check('a unitless cost joins NO total', noUnit.totals.length === 1 && noUnit.totals[0].amount === 0.12);
  check('a unitless cost breaks comparability', noUnit.comparable === false);
  check('a unitless cost is counted and warned', noUnit.unknownUnitRequests === 1 && noUnit.warnings.some(w => /no declared unit/i.test(w)));

  // ── Ceilings ─────────────────────────────────────────────────────────────
  section('Per-unit budget ceilings');

  check('bare currency codes normalize', normalizeCeilings({ USD: 1 })['currency:USD'] === 1);
  check('bare credit pools normalize', normalizeCeilings({ 'higgsfield-credits': 5 })['provider_credits:higgsfield-credits'] === 5);
  check('full unit keys pass through', normalizeCeilings({ 'currency:USD': 2 })['currency:USD'] === 2);
  check('negative ceilings are rejected', Object.keys(normalizeCeilings({ USD: -1 })).length === 0);
  check('a nonsense key is dropped', normalizeCeilings({ 'bogus:thing': 1 })['bogus:thing'] === undefined);

  const mixedTotals = mixed.totals;
  check('a ceiling in ONE unit cannot govern two',
    checkCeilings(mixedTotals, { USD: 100 }).ok === false);
  check('the block names the ungoverned unit',
    checkCeilings(mixedTotals, { USD: 100 }).reasons.some(r => /higgsfield-credits/.test(r)));
  check('ceilings for every unit pass',
    checkCeilings(mixedTotals, { USD: 1, 'higgsfield-credits': 5 }).ok === true);
  check('an exceeded ceiling blocks in its own unit',
    checkCeilings(mixedTotals, { USD: 0.01, 'higgsfield-credits': 5 }).ok === false);
  check('no ceiling at all blocks', checkCeilings(mixedTotals, {}).ok === false);
  check('a plan with no paid spend needs no ceiling', checkCeilings([], {}).ok === true);
  check('a lower-bound total is acknowledgement-gated, not silently passed',
    (checkCeilings(floorAgg.totals, { USD: 1 }).acknowledgeable || []).length === 1);

  // ── No FX anywhere ───────────────────────────────────────────────────────
  section('No conversion logic exists');

  const COST_SRC = stripComments(fs.readFileSync(path.join(ROOT, 'lib/cost/costShape.js'), 'utf8'));
  // Word-bounded: an unanchored /rate/ matches "sepa-rate-ly" and "aggregate",
  // which would make this assertion fire on prose rather than on conversion code.
  check('the money module has no rate table',
    !/\brate\b|\brates\b|\bexchange\b|\bfx\b|\bconvert\w*\b/i.test(COST_SRC));
  check('the money module never multiplies or divides amounts',
    !/amount\s*[*/]|[*/]\s*amount/.test(COST_SRC));
  check('no credit-to-dollar constant exists anywhere in cost/diamond/assets', (() => {
    const files = [
      'lib/cost/costShape.js', 'lib/diamond/costPreflight.js', 'lib/diamond/recommendBinding.js',
      ...fs.readdirSync(path.join(ROOT, 'lib/production/assets')).filter(f => f.endsWith('.js')).map(f => `lib/production/assets/${f}`),
    ];
    return !files.some(f => /0\.005|USD_PER_CREDIT|CREDIT_TO_USD|creditsToUsd|usdPerCredit/i.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  })());

  // ── Plan aggregation ─────────────────────────────────────────────────────
  section('AssetPlan aggregation');

  const singleUnitPlan = summarizePlan([req(HIGGS(0.12)), req(HIGGS(0.12)), req(LOCAL_ZERO, 'placeholder')]);
  check('a single-unit plan still reports one total', singleUnitPlan.estimatedTotal === 0.24);
  check('a single-unit plan is comparable', singleUnitPlan.comparable === true);
  check('a single-unit confirmed plan is complete', singleUnitPlan.estimateCompleteness === 'complete');
  check('a single-unit confirmed plan is not flagged incomplete', singleUnitPlan.totalIsIncomplete === false);

  const mixedPlan = summarizePlan([req(HIGGS(0.12)), req(HIGGS(0.12)), req(KIE(0.02)), req(KIE(0.02)), req(LOCAL_ZERO, 'placeholder')]);
  check('a mixed plan reports grouped totals', mixedPlan.totals.length === 2);
  check('a mixed plan refuses a single total', mixedPlan.estimatedTotal === null);
  check('a mixed plan is NOT comparable', mixedPlan.comparable === false);
  check('a mixed plan is flagged incomplete', mixedPlan.totalIsIncomplete === true);
  check('a mixed plan never reports 0.28 anywhere', !JSON.stringify(mixedPlan).includes('0.28'));
  check('a mixed plan carries a cost warning', mixedPlan.costWarnings.length > 0);
  check('lower-bound requests are counted on the plan',
    summarizePlan([req(KIE(0.04, { isLowerBound: true }))]).lowerBoundRequests === 1);

  // ── Approval gating ──────────────────────────────────────────────────────
  section('Approval gating');

  const planOf = (summary, budget) => ({ status: 'estimated', summary, budget });

  check('a single-unit plan approves with its own ceiling',
    checkApprovalEligibility(planOf(singleUnitPlan, { ceilings: { 'higgsfield-credits': 5 } })).eligible === true);
  check('a single-unit plan is blocked by a ceiling in the WRONG unit',
    checkApprovalEligibility(planOf(singleUnitPlan, { ceilings: { USD: 5 } })).eligible === false);
  check('a mixed plan is blocked with only one unit capped',
    checkApprovalEligibility(planOf(mixedPlan, { ceilings: { USD: 5 } }), { acknowledgeProvisional: true }).eligible === false);
  check('a mixed plan approves only with BOTH ceilings + acknowledgement',
    checkApprovalEligibility(planOf(mixedPlan, { ceilings: { USD: 5, 'higgsfield-credits': 5 } }), { acknowledgeProvisional: true }).eligible === true);
  check('a mixed plan is blocked without acknowledgement',
    checkApprovalEligibility(planOf(mixedPlan, { ceilings: { USD: 5, 'higgsfield-credits': 5 } })).eligible === false);
  check('the mixed-unit block explains itself',
    checkApprovalEligibility(planOf(mixedPlan, { ceilings: { USD: 5, 'higgsfield-credits': 5 } })).reasons.some(r => /more than one unit/i.test(r)));

  const floorPlan = summarizePlan([req(KIE(0.04, { isLowerBound: true }))]);
  check('a from-price plan is blocked without acknowledgement',
    checkApprovalEligibility(planOf(floorPlan, { ceilings: { USD: 5 } })).eligible === false);
  check('the from-price block says the charge may be higher',
    checkApprovalEligibility(planOf(floorPlan, { ceilings: { USD: 5 } })).reasons.some(r => /may be higher/i.test(r)));
  check('a from-price plan approves once acknowledged',
    checkApprovalEligibility(planOf(floorPlan, { ceilings: { USD: 5 } }), { acknowledgeProvisional: true }).eligible === true);

  const unitlessPlan = summarizePlan([req(normalizeCost({ amount: 9, estimateType: 'unknown' }))]);
  check('an unpriced-unit plan can NEVER be approved, even acknowledged',
    checkApprovalEligibility(planOf(unitlessPlan, { ceilings: { USD: 99 } }), { acknowledgeProvisional: true }).eligible === false);

  check('a legacy single ceiling still governs its one unit',
    planCeilings({ budget: { ceilingAmount: 1, currency: 'higgsfield-credits' } })['provider_credits:higgsfield-credits'] === 1);
  check('a legacy ceiling never governs a second unit',
    checkApprovalEligibility(planOf(mixedPlan, { ceilingAmount: 99, currency: 'higgsfield-credits' }), { acknowledgeProvisional: true }).eligible === false);

  // ── Content hash ─────────────────────────────────────────────────────────
  section('Approval binds to units and ceilings');

  const base = { budget: { ceilings: { USD: 1 } }, requests: [req(KIE(0.02))] };
  const subj = JSON.stringify(planHashSubject(base));
  check('the hash subject carries per-unit ceilings', subj.includes('currency:USD'));
  check('the hash subject carries each request unit key', subj.includes('"unitKey"') || /currency:USD/.test(subj));
  check('changing a ceiling changes the subject',
    subj !== JSON.stringify(planHashSubject({ ...base, budget: { ceilings: { USD: 2 } } })));
  check('changing only the UNIT changes the subject',
    subj !== JSON.stringify(planHashSubject({ ...base, requests: [req(HIGGS(0.02))] })));
  check('flipping isLowerBound changes the subject',
    subj !== JSON.stringify(planHashSubject({ ...base, requests: [req(KIE(0.02, { isLowerBound: true }))] })));

  // ── Ledger ───────────────────────────────────────────────────────────────
  section('Ledger preserves units exactly');

  const ledgerOf = est => buildLedgerRecord({
    id: 'led-1', event: 'execution_started', actor: 'system',
    division: 'asset-generation', capability: 'background_plate', estimate: est,
  });

  const hRec = ledgerOf({ amount: 0.12, unit: 'provider_credits', providerCreditUnit: 'higgsfield-credits', estimateType: 'confirmed_provider', confirmed: true });
  check('higgsfield-credits is NOT truncated', hRec.estimate.currency === 'higgsfield-credits');
  check('the credit pool is preserved separately', hRec.estimate.providerCreditUnit === 'higgsfield-credits');
  check('the unit kind is preserved', hRec.estimate.unit === 'provider_credits');
  check('the amount is untouched', hRec.estimate.amount === 0.12);
  check('a credits estimate is never rewritten as dollars', !/USD|\$/.test(JSON.stringify(hRec.estimate)));

  const kRec = ledgerOf({ amount: 0.02, unit: 'currency', currency: 'USD', estimateType: 'provisional_catalog', confirmed: false });
  check('a USD estimate stays USD', kRec.estimate.currency === 'USD' && kRec.estimate.unit === 'currency');
  check('USD is never converted to provider credits', kRec.estimate.providerCreditUnit === null);
  check('provisional_catalog survives into the Ledger', kRec.estimate.estimateType === 'provisional_catalog');
  check('provisional_catalog is a valid Ledger type', ESTIMATE_TYPES.includes('provisional_catalog'));
  check('the Ledger and money module share ONE vocabulary',
    ESTIMATE_TYPES.join(',') === COST_ESTIMATE_TYPES.join(','));
  check('a lower-bound flag survives into the Ledger',
    ledgerOf({ amount: 1, unit: 'currency', currency: 'USD', estimateType: 'provisional_catalog', isLowerBound: true }).estimate.isLowerBound === true);

  const actualRec = buildLedgerRecord({
    id: 'led-2', event: 'execution_completed', actor: 'system', division: 'asset-generation', capability: 'background_plate',
    estimate: { amount: 0.02, unit: 'currency', currency: 'USD', estimateType: 'provisional_catalog' },
    actual: { amount: 4, unit: 'provider_credits', providerCreditUnit: 'kie-credits', confirmed: true },
  });
  check('kie-credits is NOT truncated in the actual', actualRec.actual.currency === 'kie-credits');
  check('an actual in credits may differ in unit from a USD estimate',
    actualRec.estimate.currency === 'USD' && actualRec.actual.providerCreditUnit === 'kie-credits');
  check('the record still validates', validateLedgerRecord(actualRec).valid === true, validateLedgerRecord(actualRec).errors.join('; '));
  check('an unknown actual stays unknown', ledgerOf({ amount: 1, unit: 'currency', currency: 'USD', estimateType: 'confirmed_provider', confirmed: true }).actual.amount === null);

  const ENGINE_SRC = fs.readFileSync(path.join(ROOT, 'lib/production/execution/executionEngine.js'), 'utf8');
  check('the engine passes the unit through to the Ledger', /unit: budget\.unit/.test(ENGINE_SRC));
  check('the engine never infers a unit from the currency string',
    !/unit:\s*budget\.currency|currency\.includes\('credits'\)/.test(ENGINE_SRC));
  check('the engine still names no provider', !/higgsfield|openart|heygen|\bkie\b/i.test(stripComments(ENGINE_SRC)));

  const LEDGER_SRC = stripComments(fs.readFileSync(path.join(ROOT, 'lib/ledger/ledgerRules.js'), 'utf8'));
  check('the Ledger contains no conversion logic', !/convert|exchange|\brate\b/i.test(LEDGER_SRC));
  check('the Ledger no longer clamps a unit to 8 characters', !/currency,\s*8\)/.test(LEDGER_SRC));

  // ── Adapters ─────────────────────────────────────────────────────────────
  section('Adapters declare their units');

  const kEst = kieAdapter.estimate({ job: { providerInput: { mediaType: 'image', model: 'google/nano-banana', prompt: 'x', outputCount: 1 } } });
  check('Kie declares currency', kEst.unit === 'currency' && kEst.currency === 'USD');
  check('Kie is never provider_credits at estimate time', kEst.providerCreditUnit === undefined || kEst.providerCreditUnit === null);
  check('Kie carries pricing provenance', !!kEst.pricingSource && !!kEst.pricedAt);
  const kFloor = kieAdapter.estimate({ job: { providerInput: { mediaType: 'image', model: 'nano-banana-2', prompt: 'x', outputCount: 1 } } });
  check('Kie marks a from-price as a lower bound', kFloor.isLowerBound === true);
  check('Kie declares NO unit when it has no price',
    kieAdapter.estimate({ job: { providerInput: { mediaType: 'image', prompt: 'x' } } }).unit === null);

  const hfSrc = fs.readFileSync(path.join(ROOT, 'lib/production/execution/adapters/higgsfieldMcp.adapter.js'), 'utf8');
  check('Higgsfield declares provider credits', /providerCreditUnit: 'higgsfield-credits'/.test(hfSrc));
  check('Higgsfield never declares a currency unit', !/unit: 'currency'/.test(hfSrc));
  const oaSrc = fs.readFileSync(path.join(ROOT, 'lib/production/execution/adapters/openartVideoMcp.adapter.js'), 'utf8');
  check('OpenArt declares its own separate credit pool', /providerCreditUnit: 'openart-credits'/.test(oaSrc));

  const hfEst = await hyperframesAdapter.estimate();
  check('HyperFrames is a confirmed zero in real money',
    hfEst.unit === 'currency' && hfEst.currency === 'USD' && hfEst.estimatedRange.min === 0 && hfEst.estimateType === 'confirmed_local');
  check('HyperFrames $0 is unit-neutral in a total',
    isZeroCost(currencyCost(0, 'USD', { estimateType: 'confirmed_local', confirmed: true })) === true);
  check('Higgsfield adapter still exposes estimate()', typeof higgsfieldAdapter.estimate === 'function');

  // ── Diamond Control ──────────────────────────────────────────────────────
  section('Diamond Control comparison rule');

  check('cross-unit comparison is refused', compareProviderCosts(HIGGS(0.12), KIE(0.02)).costComparable === false);
  check('the refusal cites the missing conversion',
    /no authoritative conversion/i.test(compareProviderCosts(HIGGS(0.12), KIE(0.02)).reason));
  check('a catalogue price is not a quote',
    compareProviderCosts(KIE(0.02), KIE(0.05)).costComparable === false);
  check('two confirmed same-unit prices ARE comparable',
    compareProviderCosts(HIGGS(0.12), HIGGS(0.20)).costComparable === true);
  check('the cheaper of two comparable prices is identified',
    compareProviderCosts(HIGGS(0.12), HIGGS(0.20)).cheaper === 'a');
  check('a lower bound blocks comparison',
    compareProviderCosts(HIGGS(0.12, { isLowerBound: true }), HIGGS(0.20)).costComparable === false);
  check('an unknown amount blocks comparison',
    compareProviderCosts(providerCreditCost(null, 'higgsfield-credits'), HIGGS(0.2)).costComparable === false);

  const DIAMOND_SRC = stripComments(fs.readFileSync(path.join(ROOT, 'lib/diamond/costPreflight.js'), 'utf8'));
  check('Diamond Control does no automatic routing', !/cheapest|selectProvider|autoRoute|pickProvider/i.test(DIAMOND_SRC));
  check('Diamond Control has no conversion table', !/exchangeRate|USD_PER|toUSD|convertCost/i.test(DIAMOND_SRC));

  // ── Asset Generation neutrality ──────────────────────────────────────────
  section('Asset Generation stays provider-neutral');

  const ASSETS_DIR = path.join(ROOT, 'lib/production/assets');
  const assetFiles = fs.readdirSync(ASSETS_DIR).filter(f => f.endsWith('.js'));
  const tokens = ['higgsfield', 'openart', 'heygen', 'hyperframes'];
  const leaks = assetFiles.filter(f => {
    const s = fs.readFileSync(path.join(ASSETS_DIR, f), 'utf8');
    return tokens.some(t => new RegExp(t, 'i').test(s)) || /\bkie\b/i.test(s);
  });
  check('no provider token under lib/production/assets', leaks.length === 0, leaks.join(', '));
  const assetSrc = assetFiles.map(f => fs.readFileSync(path.join(ASSETS_DIR, f), 'utf8')).join('\n');
  check('Asset Generation imports no adapter', !/from ['"].*adapters?\//.test(assetSrc));
  check('Asset Generation hardcodes no credit unit', !/-credits'/.test(stripComments(assetSrc)));
  // Checked over RAW source, comments included. A provider named even in prose
  // here tells the next reader to go looking for a vendor-specific branch.
  const COST_RAW = fs.readFileSync(path.join(ROOT, 'lib/cost/costShape.js'), 'utf8');
  check('the shared money module names no provider, not even in a comment',
    !tokens.some(t => new RegExp(t, 'i').test(COST_RAW)) && !/\bkie\b/i.test(COST_RAW));
} finally {
  console.log('');
}

const passed = results.filter(r => r.ok).length;
const failed = results.length - passed;
console.log('═'.repeat(64));
console.log(`Cost-unit governance validation: ${passed}/${results.length} passed, ${failed} failed`);
if (failed) results.filter(r => !r.ok).forEach(r => console.log(`  ✗ ${r.n}${r.d ? ` — ${r.d}` : ''}`));
process.exit(failed ? 1 : 0);
