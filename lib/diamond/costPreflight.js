// lib/diamond/costPreflight.js
// SERVER-SIDE ONLY.
//
// Prices an already-bound request WITHOUT creating a Production Job and
// without generating anything.
//
// This lives under lib/diamond/ rather than lib/production/assets/ on purpose:
// pricing requires knowing which provider was bound and how to ask it, and
// Asset Generation must stay provider-blind. Diamond Control already owns
// provider knowledge, so the knowledge stays in one layer.
//
// Adapters expose `estimate({ job })` and read only `job.providerInput`, so a
// synthetic job-shaped object is sufficient — nothing is persisted, no
// Production Job is created, and no credits move.

import higgsfieldMcpAdapter from '../production/execution/adapters/higgsfieldMcp.adapter.js';
import kieAdapter from '../production/execution/adapters/kie.adapter.js';
import { buildProviderInputFromBinding } from '../production/assets/assetRules.js';
import { normalizeCost, unitKeyOf, unitLabel, COST_ESTIMATE_TYPES } from '../cost/costShape.js';

// providerId → adapter. The only place a plan's binding is resolved to code.
//
// Not every entry here can price a request the same way, and that difference is
// preserved rather than flattened: Higgsfield performs a real non-generating
// preflight and can return a confirmed figure, while Kie.ai exposes no
// preflight endpoint at all and can only ever return a provisional catalogue
// price. The estimateType below reports which one happened.
const PREFLIGHT_ADAPTERS = {
  'higgsfield-mcp': higgsfieldMcpAdapter,
  'kie': kieAdapter,
};

/**
 * @param {object} assetRequest the concrete request (prompt, aspect, counts)
 * @param {object} binding      the opaque binding Diamond Control returned
 * @returns {Promise<{ok, amount, currency, estimateType, confirmed, note}>}
 */
export async function preflightCost(assetRequest, binding) {
  const adapter = PREFLIGHT_ADAPTERS[binding?.providerId];
  if (!adapter || typeof adapter.estimate !== 'function') {
    return {
      ok: false, cost: normalizeCost({ estimateType: 'unknown' }),
      amount: null, currency: null, estimateType: 'unknown', confirmed: false, isLowerBound: false,
      note: `No cost preflight is available for the bound provider — the estimate stays unknown rather than guessed.`,
    };
  }

  // Synthetic, never persisted. Mirrors exactly what the engine would carry.
  const syntheticJob = {
    id: `preflight-${assetRequest.requestId}`,
    selectedProvider: binding.providerId,
    selectedMode: binding.mode,
    providerInput: buildProviderInputFromBinding(assetRequest, binding),
  };

  let estimate;
  try {
    estimate = await adapter.estimate({ job: syntheticJob, pkg: null });
  } catch (e) {
    return {
      ok: false, cost: normalizeCost({ estimateType: 'unknown' }),
      amount: null, currency: null, estimateType: 'unknown', confirmed: false, isLowerBound: false,
      note: `Cost preflight failed: ${e.message}`,
    };
  }

  // An adapter reports a range; a live preflight collapses it to a single
  // figure. A provisional shape is carried through as provisional — never
  // promoted to a confirmed number.
  const min = estimate?.estimatedRange?.min;
  const max = estimate?.estimatedRange?.max;
  const exact = Number.isFinite(min) && Number.isFinite(max) && min === max ? min : null;
  const provisional = estimate?.provisional === true || !Number.isFinite(exact);

  // An adapter may describe HOW it arrived at a provisional figure (a published
  // catalogue price, say, versus a live call that failed). That distinction is
  // preserved rather than flattened to one word — but only when the adapter
  // offers something more specific than the generic "provisional".
  const adapterType = typeof estimate?.estimateType === 'string' ? estimate.estimateType : null;
  const provisionalType = adapterType && COST_ESTIMATE_TYPES.includes(adapterType) ? adapterType : 'provisional_adapter';
  const estimateType = provisional ? provisionalType : 'confirmed_provider';

  // An open-ended range (a minimum with no maximum) is a FLOOR, not a price.
  const isLowerBound = estimate?.isLowerBound === true || (Number.isFinite(min) && !Number.isFinite(max));

  // The unit is taken from what the adapter DECLARED, never guessed from the
  // currency string: "higgsfield-credits" sitting in a `currency` field does not
  // make it money. An adapter that declares nothing yields a unitless cost,
  // which aggregation then refuses to add to anything.
  const cost = normalizeCost({
    amount: Number.isFinite(exact) ? exact : (Number.isFinite(min) ? min : null),
    unit: estimate?.unit ?? null,
    currency: estimate?.currency ?? null,
    providerCreditUnit: estimate?.providerCreditUnit ?? null,
    estimateType,
    confirmed: !provisional,
    isLowerBound,
    pricingSource: estimate?.pricingSource ?? null,
    pricedAt: estimate?.pricedAt ?? null,
  });

  return {
    ok: true,
    // Canonical money shape — the field downstream code should read.
    cost,
    // Flattened mirrors, kept so existing readers keep working unchanged.
    amount: cost.amount,
    currency: estimate?.currency || null,
    estimateType: cost.estimateType,
    confirmed: cost.confirmed,
    isLowerBound: cost.isLowerBound,
    note: provisional ? (estimate?.note || 'Provider returned a provisional estimate.') : null,
  };
}

export function isPreflightSupported(providerId) {
  return Object.prototype.hasOwnProperty.call(PREFLIGHT_ADAPTERS, providerId);
}

/**
 * Whether two providers' costs may be compared AT ALL.
 *
 * Deliberately NOT a cheapest-provider router. It answers one narrow question —
 * "is a price comparison meaningful here?" — and refuses in two distinct cases:
 *
 *   1. Different units. No public API documents a rate between provider credits
 *      and dollars, or between two providers' credits. Comparing them would
 *      require inventing one.
 *   2. Insufficient pricing quality. A published catalogue price is not a quote
 *      for THIS request. Ranking a confirmed per-request price against a
 *      marketing figure would let the vendor with the vaguer pricing win by
 *      being vague.
 *
 * When it returns false, cost simply drops out of the decision and other policy
 * dimensions — capability fit, quality, reliability — decide. Price is never the
 * sole criterion even when it IS comparable.
 *
 * @returns {{ costComparable: boolean, reason: string, cheaper?: 'a'|'b'|'equal' }}
 */
export function compareProviderCosts(costA, costB) {
  const a = normalizeCost(costA);
  const b = normalizeCost(costB);

  const ka = unitKeyOf(a);
  const kb = unitKeyOf(b);
  if (ka === null || kb === null) {
    return { costComparable: false, reason: 'At least one estimate does not declare what unit it is denominated in.' };
  }
  if (ka !== kb) {
    return { costComparable: false, reason: `Estimates are in different units (${unitLabel(ka)} vs ${unitLabel(kb)}) and no authoritative conversion exists between them.` };
  }
  if (a.amount === null || b.amount === null) {
    return { costComparable: false, reason: 'At least one estimate has no known amount.' };
  }
  if (a.isLowerBound || b.isLowerBound) {
    return { costComparable: false, reason: 'At least one estimate is a lower bound, so the ordering could reverse once the real price is known.' };
  }
  // Both must be real per-request prices. A catalogue figure is not a quote.
  if (!a.confirmed || !b.confirmed) {
    return { costComparable: false, reason: 'Cost comparison requires a provider-confirmed price for both options; a published catalogue price is not a quote for this request.' };
  }

  return {
    costComparable: true,
    reason: `Both estimates are provider-confirmed in ${unitLabel(ka)}.`,
    cheaper: a.amount === b.amount ? 'equal' : (a.amount < b.amount ? 'a' : 'b'),
  };
}
