// lib/diamond/recommendBinding.js
// SERVER-SIDE. Diamond Control's policy decision point (PDP).
//
// ── The seam this file exists to prove (F4) ──────────────────────────────
//
// Asset Generation asks: "who should perform capability X?"
// This answers with a ProviderBinding — opaque data the caller forwards to the
// Execution Engine without inspecting.
//
//     AssetRequest { capability, ... }  →  recommendBinding()  →  ProviderBinding
//
// Policy DECIDES. It never dispatches, never executes, never spends. Work does
// not flow through Diamond Control; only questions do. That is what keeps this
// thin enough to serve every future division.
//
// ── M1 status: deliberately a stub ───────────────────────────────────────
//
// The bindings below are HARDCODED. That is the point of M1: it proves the
// SEAM, not the intelligence. Because Asset Generation treats the result as
// opaque and imports no provider module, a later milestone replaces the body
// of this function — with a live capability/model catalog, brand policy, cost
// tiering and fallbacks — and nothing else in the system moves.
//
// This is the ONLY layer permitted to name a provider or a model.

export const POLICY_VERSION = 'm1-stub-1';

// Capability → binding. Provider and model names appear here and nowhere else
// outside the provider layer itself.
const M1_BINDINGS = {
  background_plate: {
    providerId: 'higgsfield-mcp',
    // Selected mode must be one the chosen provider's adapter supports; the
    // adapter validates it, this file does not duplicate that check.
    mode: 'cinematic_broll',
    // A stub DEFAULT, not an invented identifier: this model id was verified
    // present in the provider's live catalog and supports the 9:16 output this
    // capability needs. An operator may still override it per request. When a
    // real routing policy replaces this stub, only this table changes.
    model: 'soul_cinematic',
    executionType: 'mcp',
    params: { mediaType: 'image' },
    // Which OPTIONAL request fields this binding's provider actually accepts.
    // Asset Generation consults this rather than learning provider schemas:
    // it never discovers that a particular vendor lacks negative prompting,
    // it only honours what the binding declares. A field declared false is
    // dropped AND reported — never silently discarded.
    supports: { negativePrompt: false },
  },
};

// ── Explicit, opt-in alternative providers ───────────────────────────────
//
// Kie.ai is registered as a real execution adapter but is NOT a default and is
// NOT part of any automatic cost routing. It is reachable only when a caller
// names it explicitly (providerOverride: 'kie'), so a Kie generation can never
// happen because policy quietly preferred it.
//
// Choosing between Kie and Higgsfield on price is a genuine routing decision
// and is deliberately NOT implemented here: their estimates are not yet
// comparable (Higgsfield prices a request live in its own credits; Kie has no
// preflight at all and publishes USD prices with no documented credit
// conversion). Routing on incomparable numbers would be worse than not routing.
const OVERRIDE_BINDINGS = {
  kie: {
    background_plate: {
      providerId: 'kie',
      mode: 'cinematic_broll',
      // Verified present in Kie's official model documentation and in the
      // adapter's v1 allowlist. Both are text-to-image; this is the low-cost one.
      model: 'google/nano-banana',
      executionType: 'direct-api',
      params: { mediaType: 'image', outputFormat: 'png' },
      // Declared from the model's REAL documented schema. None of these four
      // parameters exists on the allowlisted Kie image models, so Asset
      // Generation drops them upstream and reports the drop — it never
      // discovers the absence by having the provider reject a submission.
      supports: { negativePrompt: false, width: false, height: false, multipleOutputs: false },
    },
  },
};

const OVERRIDE_POLICY_VERSIONS = { kie: 'kie-v1-test' };

/**
 * @param {object} request  an AssetRequest (capability + dimensions + brand)
 * @param {object} [options]
 * @param {string} [options.modelOverride] operator-selected model from the live catalog
 * @param {string} [options.providerOverride] operator-selected provider; opt-in only, never a default
 * @returns {{ ok: boolean, binding?: object, error?: string, rationale?: string }}
 */
export function recommendBinding(request, { modelOverride = null, providerOverride = null } = {}) {
  if (!request || typeof request !== 'object') {
    return { ok: false, error: 'An asset request is required.' };
  }

  if (providerOverride) {
    const table = OVERRIDE_BINDINGS[providerOverride];
    if (!table) {
      return { ok: false, error: `No policy binding is defined for provider "${providerOverride}".` };
    }
    const overrideBase = table[request.capability];
    if (!overrideBase) {
      return { ok: false, error: `Provider "${providerOverride}" has no binding for capability "${request.capability}".` };
    }
    const overrideModel = modelOverride || overrideBase.model;
    if (!overrideModel) {
      return { ok: false, error: `No model is configured for "${request.capability}" on provider "${providerOverride}".` };
    }
    return {
      ok: true,
      binding: {
        ...overrideBase,
        model: overrideModel,
        policyVersion: OVERRIDE_POLICY_VERSIONS[providerOverride] || `${providerOverride}-override`,
        rationale: `Explicit operator override: capability "${request.capability}" was routed to "${providerOverride}" by request, not by policy preference.`,
        confidence: 'operator_override',
        fallbacks: [],
      },
    };
  }

  const base = M1_BINDINGS[request.capability];
  if (!base) {
    return { ok: false, error: `No policy binding is defined for capability "${request.capability}".` };
  }

  // A model is never invented. M1 requires the operator to choose one from the
  // provider's live catalog, so the binding always reflects a model that
  // genuinely exists rather than a guessed identifier.
  const model = modelOverride || base.model;
  if (!model) {
    return {
      ok: false,
      error: `Policy has no model configured for "${request.capability}". Select one from the provider's live catalog and pass it explicitly.`,
    };
  }

  return {
    ok: true,
    binding: {
      ...base,
      model,
      policyVersion: POLICY_VERSION,
      // Stated so the decision is auditable rather than implicit.
      rationale: `M1 stub policy: capability "${request.capability}" is bound to a still-image generation provider. Not a live routing decision.`,
      confidence: 'stub',
      fallbacks: [],
    },
  };
}

/** Advisory ceiling. The Execution Engine's own budget/approval remain authoritative. */
export function budgetCeilingFor(request) {
  return { amount: null, currency: 'USD', basis: 'M1 stub — no policy ceiling configured; engine approval governs.' };
}
