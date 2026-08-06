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
    model: null, // resolved live from the provider's own catalog — see below
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

/**
 * @param {object} request  an AssetRequest (capability + dimensions + brand)
 * @param {object} [options]
 * @param {string} [options.modelOverride] operator-selected model from the live catalog
 * @returns {{ ok: boolean, binding?: object, error?: string, rationale?: string }}
 */
export function recommendBinding(request, { modelOverride = null } = {}) {
  if (!request || typeof request !== 'object') {
    return { ok: false, error: 'An asset request is required.' };
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
      error: `Policy has no default model for "${request.capability}". Select one from the provider's live model catalog and pass it explicitly.`,
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
