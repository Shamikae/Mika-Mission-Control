// lib/cost/costShape.js
// Pure — no I/O, no fs, no network. Safe on server and client.
//
// ── The provider-neutral money shape ─────────────────────────────────────
//
// One representation for every cost Mika handles, whatever produced it. It
// exists because the system spends in genuinely different units:
//
//     0.12  vendor-a-credits   (provider credits)
//     14    vendor-b-credits   (provider credits — a DIFFERENT pool)
//     $0.02                    (real money, published price)
//     $0                       (local compute)
//
// The examples are deliberately anonymous. This module is provider-neutral and
// must stay that way even in its prose: the moment a vendor is named here, the
// next reader reasonably assumes there is a vendor-specific branch to find.
//
// These are NOT interchangeable numbers. No public API documents a
// credit-to-dollar rate for any of them, so this module never converts, never
// infers a rate, and never produces a single blended figure. It groups.
//
// THE RULE: arithmetic is permitted only between costs sharing a unit key.
// Everything else is reported side by side, with `comparable: false`.
//
// This is deliberately not an FX layer. Turning 0.12 of some vendor's credits
// into "$0.12" would be a fabricated number that an operator could approve —
// the precise failure this file exists to prevent.

// ── Units ────────────────────────────────────────────────────────────────
//
// `currency` — real money, denominated by an ISO-ish currency code.
// `provider_credits` — a provider's internal scrip, denominated by the pool it
//   is drawn from. Two providers' credits are never the same unit, which is why
//   the pool name is part of the unit key rather than a label beside it.

export const COST_UNITS = ['currency', 'provider_credits'];

// Shared vocabulary for how a figure was arrived at. `confirmed_*` means the
// number is real; `provisional_*` means it is a guess and must never be
// presented as spend.
export const COST_ESTIMATE_TYPES = [
  'confirmed_local',      // local compute — genuinely zero
  'confirmed_provider',   // the provider priced THIS request before submission
  'provisional_catalog',  // a published price list, not a per-request quote
  'provisional_adapter',  // the adapter's own static estimate
  'provisional_tier',     // a cost tier only, no figure
  'unknown',              // no figure at all
];

const CONFIRMED_TYPES = ['confirmed_local', 'confirmed_provider'];

export function isConfirmedEstimateType(t) { return CONFIRMED_TYPES.includes(t); }

// How trustworthy a plan's total is, taken as a whole.
export const ESTIMATE_COMPLETENESS = ['complete', 'provisional', 'lower_bound', 'mixed'];

function num(v) { return Number.isFinite(v) ? v : null; }
function upper(v) { return typeof v === 'string' ? v.toUpperCase() : v; }
function str(v, max = 60) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

/**
 * Coerces anything cost-shaped into the canonical shape. Never invents a unit:
 * an input that does not say what it is denominated in comes back with
 * `unit: null`, which aggregation treats as un-addable.
 */
export function normalizeCost(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const unit = COST_UNITS.includes(c.unit) ? c.unit : null;
  const estimateType = COST_ESTIMATE_TYPES.includes(c.estimateType) ? c.estimateType : 'unknown';
  const amount = num(c.amount);

  return {
    amount,
    unit,
    // Only the field belonging to the declared unit is kept, so a shape can
    // never carry two contradictory denominations at once.
    //
    // Currency codes are CANONICALISED TO UPPERCASE. Without this, "usd" and
    // "USD" produce different unit keys and the same currency splits into two
    // totals that are never summed — a silent understatement of spend.
    // Provider credit pools are left verbatim: they are vendor-defined
    // identifiers, not codes, and case may be meaningful.
    currency: unit === 'currency' ? upper(str(c.currency, 12)) : null,
    providerCreditUnit: unit === 'provider_credits' ? str(c.providerCreditUnit, 40) : null,
    estimateType,
    // Confirmation is never inferred from the presence of a number. A figure
    // with no amount cannot be confirmed regardless of what the caller claims.
    confirmed: c.confirmed === true && amount !== null && isConfirmedEstimateType(estimateType),
    isLowerBound: c.isLowerBound === true,
    isUpperBound: c.isUpperBound === true,
    pricingSource: str(c.pricingSource, 200),
    pricedAt: str(c.pricedAt, 40),
  };
}

/** Convenience constructors for the two units. */
export function currencyCost(amount, currency, rest = {}) {
  return normalizeCost({ ...rest, amount, unit: 'currency', currency });
}
export function providerCreditCost(amount, providerCreditUnit, rest = {}) {
  return normalizeCost({ ...rest, amount, unit: 'provider_credits', providerCreditUnit });
}

/**
 * The identity that decides whether two costs may be added. Distinct unit keys
 * are never summed.
 * @returns {string|null} null when the cost does not say what it is denominated in
 */
export function unitKeyOf(cost) {
  if (!cost) return null;
  if (cost.unit === 'currency' && cost.currency) return `currency:${cost.currency}`;
  if (cost.unit === 'provider_credits' && cost.providerCreditUnit) return `provider_credits:${cost.providerCreditUnit}`;
  return null;
}

export function parseUnitKey(key) {
  if (typeof key !== 'string') return null;
  const i = key.indexOf(':');
  if (i < 1) return null;
  const unit = key.slice(0, i);
  const denom = key.slice(i + 1);
  if (!COST_UNITS.includes(unit) || !denom) return null;
  return unit === 'currency'
    ? { unit, currency: denom.toUpperCase(), providerCreditUnit: null }
    : { unit, currency: null, providerCreditUnit: denom };
}

/** Human label for a unit key — display only, never used for arithmetic. */
export function unitLabel(key) {
  const p = parseUnitKey(key);
  if (!p) return 'unknown unit';
  return p.unit === 'currency' ? p.currency : p.providerCreditUnit;
}

export function areComparable(a, b) {
  const ka = unitKeyOf(a);
  const kb = unitKeyOf(b);
  return ka !== null && ka === kb;
}

/**
 * A confirmed zero costs nothing in ANY unit, so it is unit-neutral: it joins
 * no group and never makes a plan look mixed.
 *
 * Without this, a plan of six free placeholders plus one paid generation would
 * report two incomparable totals and demand two ceilings — technically true,
 * operationally useless. Zero-cost requests are still counted separately in the
 * aggregate so they stay visible rather than disappearing.
 */
export function isZeroCost(cost) {
  return cost?.amount === 0 && cost?.confirmed === true;
}

/**
 * Groups costs by unit and reports how much the resulting total can be trusted.
 * The ONLY place plan-level cost arithmetic happens.
 *
 * @param {object[]} costs canonical cost shapes
 * @returns {{
 *   totals: Array<{unit, currency, providerCreditUnit, unitKey, amount, isLowerBound, confirmed, contributingRequests}>,
 *   comparable: boolean,
 *   estimateCompleteness: string,
 *   zeroCostRequests: number,
 *   unknownUnitRequests: number,
 *   unknownAmountRequests: number,
 *   warnings: string[]
 * }}
 */
export function aggregateCosts(costs) {
  const list = (Array.isArray(costs) ? costs : []).map(normalizeCost);
  const warnings = [];

  const groups = new Map();
  let zeroCostRequests = 0;
  let unknownUnitRequests = 0;
  let unknownAmountRequests = 0;
  let anyProvisional = false;
  let anyLowerBound = false;

  for (const cost of list) {
    if (isZeroCost(cost)) { zeroCostRequests += 1; continue; }

    if (!cost.confirmed) anyProvisional = true;
    if (cost.isLowerBound) anyLowerBound = true;

    const key = unitKeyOf(cost);
    if (key === null) {
      // No unit means the figure cannot join any total. Counting it as zero
      // would understate the plan; guessing its unit would be worse.
      unknownUnitRequests += 1;
      if (cost.amount === null) unknownAmountRequests += 1;
      continue;
    }

    if (cost.amount === null) {
      // The unit is known but the price is not. The group's total becomes a
      // floor: real spend in this unit is at least what is already counted.
      unknownAmountRequests += 1;
      const g = groups.get(key) || newGroup(key);
      g.isLowerBound = true;
      g.confirmed = false;
      g.contributingRequests += 1;
      groups.set(key, g);
      continue;
    }

    const g = groups.get(key) || newGroup(key);
    g.amount = round(g.amount + cost.amount);
    if (cost.isLowerBound) g.isLowerBound = true;
    if (!cost.confirmed) g.confirmed = false;
    g.contributingRequests += 1;
    groups.set(key, g);
  }

  const totals = [...groups.values()];
  // Comparable means "one number could honestly describe this plan's spend".
  const comparable = totals.length <= 1 && unknownUnitRequests === 0;

  if (totals.length > 1) {
    warnings.push(`This plan contains costs in incomparable units (${totals.map(t => unitLabel(t.unitKey)).join(', ')}). They are reported separately and are never added together.`);
  }
  if (unknownUnitRequests > 0) {
    warnings.push(`${unknownUnitRequests} request(s) carry a cost with no declared unit and are excluded from every total.`);
  }
  if (unknownAmountRequests > 0) {
    warnings.push(`${unknownAmountRequests} request(s) have no known price — the totals below are lower bounds, not the amount that will be charged.`);
  }
  if (anyLowerBound) {
    warnings.push('At least one price is a published minimum ("from" pricing). Actual spend may be higher.');
  }

  return {
    totals,
    comparable,
    estimateCompleteness: completenessOf({ anyProvisional, anyLowerBound, anyUnknown: unknownAmountRequests > 0 || unknownUnitRequests > 0 }),
    zeroCostRequests,
    unknownUnitRequests,
    unknownAmountRequests,
    warnings,
  };
}

function newGroup(unitKey) {
  const p = parseUnitKey(unitKey);
  return {
    unitKey,
    unit: p.unit,
    currency: p.currency,
    providerCreditUnit: p.providerCreditUnit,
    amount: 0,
    isLowerBound: false,
    confirmed: true,
    contributingRequests: 0,
  };
}

function round(n) { return Math.round(n * 10000) / 10000; }

function completenessOf({ anyProvisional, anyLowerBound, anyUnknown }) {
  // An unknown amount is never confirmed, so it always implies provisional too.
  const flags = [anyProvisional || anyUnknown, anyLowerBound].filter(Boolean).length;
  if (flags === 0) return 'complete';
  if (anyUnknown) return 'mixed';
  if (flags > 1) return 'mixed';
  return anyLowerBound ? 'lower_bound' : 'provisional';
}

// ── Ceilings ─────────────────────────────────────────────────────────────

/**
 * Accepts ceilings keyed either by full unit key ("currency:USD") or by bare
 * denomination ("USD", "<vendor>-credits") and returns the canonical form.
 *
 * The bare form is resolved by shape, not by a provider list: a 3-letter
 * all-caps code is a currency, anything else is a provider credit pool. That
 * keeps this file free of provider names while still accepting the shorthand an
 * operator would naturally type.
 */
export function normalizeCeilings(input) {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;

  for (const [rawKey, rawValue] of Object.entries(input)) {
    const amount = num(typeof rawValue === 'string' ? Number(rawValue) : rawValue);
    if (amount === null || amount < 0) continue;

    let key = null;
    if (rawKey.includes(':')) {
      key = parseUnitKey(rawKey) ? rawKey : null;
    } else if (/^[A-Za-z]{3}$/.test(rawKey)) {
      key = `currency:${rawKey.toUpperCase()}`;
    } else if (rawKey.trim()) {
      key = `provider_credits:${rawKey.trim()}`;
    }
    if (key) out[key] = amount;
  }
  return out;
}

/**
 * Every unit the plan will actually spend in must have its own ceiling, and no
 * group may exceed it. A single number can never govern two units, so an
 * unmatched unit blocks rather than falling back to some default.
 *
 * @returns {{ ok: boolean, reasons: string[] }}
 */
export function checkCeilings(totals, ceilings) {
  const reasons = [];
  const normalized = normalizeCeilings(ceilings);
  const list = Array.isArray(totals) ? totals : [];

  if (list.length === 0) {
    return { ok: true, reasons: [] };
  }
  if (Object.keys(normalized).length === 0) {
    reasons.push('A budget ceiling is required before approval, and none is set.');
    return { ok: false, reasons };
  }

  for (const t of list) {
    const ceiling = normalized[t.unitKey];
    if (ceiling === undefined) {
      reasons.push(`No ceiling is set for ${unitLabel(t.unitKey)} — a ceiling in a different unit cannot govern this spend.`);
      continue;
    }
    if (t.amount > ceiling) {
      reasons.push(`Estimated ${t.amount} ${unitLabel(t.unitKey)} exceeds the ${ceiling} ${unitLabel(t.unitKey)} ceiling.`);
    } else if (t.isLowerBound) {
      // Not a block on its own — acknowledgement is handled by the caller —
      // but the ceiling cannot be said to hold when the total is a floor.
      reasons.push(`__ACK__The ${unitLabel(t.unitKey)} total is a lower bound, so the ${ceiling} ${unitLabel(t.unitKey)} ceiling cannot be guaranteed.`);
    }
  }

  // Entries prefixed __ACK__ are acknowledgement-gated, not hard failures; the
  // caller decides. Split here so this function stays a pure predicate.
  const hard = reasons.filter(r => !r.startsWith('__ACK__'));
  return { ok: hard.length === 0, reasons: hard, acknowledgeable: reasons.filter(r => r.startsWith('__ACK__')).map(r => r.slice(7)) };
}

/** Unit keys a set of totals will spend in — what a ceiling set must cover. */
export function requiredCeilingUnits(totals) {
  return (Array.isArray(totals) ? totals : []).map(t => t.unitKey);
}
