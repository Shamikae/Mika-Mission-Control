// lib/production/assets/assetCapabilities.js
// Pure — no I/O. Safe on server and client.
//
// ── Mika's capability vocabulary (F5) ────────────────────────────────────
//
// A capability describes WHAT must exist, never WHO makes it. Nothing in this
// file — or anywhere under lib/production/assets/ — may name a provider, a
// model, or a vendor. Resolving a capability to a provider+model binding is
// Diamond Control's job (lib/diamond/recommendBinding.js), and the binding is
// returned as opaque data this division never inspects.
//
// That separation is what lets a provider be replaced without touching a
// division. It is mechanically enforced by scripts/validate-asset-generation-m1.mjs,
// which greps this directory for provider names.
//
// M1 deliberately defines exactly ONE capability. The vocabulary grows as
// real scenes demand it, not speculatively.

export const ASSET_CAPABILITIES = [
  {
    id: 'background_plate',
    label: 'Background plate',
    mediaClass: 'image',
    description: 'A still background image composited behind on-screen text. Carries no legible text of its own.',
  },
];

export const ASSET_CAPABILITY_IDS = ASSET_CAPABILITIES.map(c => c.id);

export function isValidCapability(id) {
  return ASSET_CAPABILITY_IDS.includes(id);
}

export function getCapability(id) {
  return ASSET_CAPABILITIES.find(c => c.id === id) || null;
}

/**
 * Maps a URS scene's declared asset kind to a Mika capability.
 *
 * The storyboard's own vocabulary passes through URS verbatim (e.g. "video"),
 * so translation happens here rather than being coerced upstream.
 *
 * A motion kind IS resolvable in M1 — as a still plate — but that is a real
 * downgrade of the storyboard's intent, so it is reported rather than applied
 * silently. An unrecognised kind resolves to nothing at all; the scene keeps
 * its placeholder. Never guess.
 *
 * @returns {{ capability: string|null, degraded: boolean, reason: string|null }}
 */
export function capabilityForSceneAssetKind(assetKind) {
  const k = String(assetKind || '').toLowerCase().trim();

  if (['image', 'generated_image', 'photo', 'still', 'background_plate'].includes(k)) {
    return { capability: 'background_plate', degraded: false, reason: null };
  }
  if (['video', 'generated_video', 'motion_graphic', 'animation', 'live_action', 'stock'].includes(k)) {
    return {
      capability: 'background_plate',
      degraded: true,
      reason: `Scene asks for "${k}"; this checkpoint resolves a still background plate instead. Motion assets are a later capability.`,
    };
  }
  if (!k || k === 'unspecified') {
    return { capability: 'background_plate', degraded: false, reason: null };
  }
  return { capability: null, degraded: false, reason: `Unrecognised asset kind "${k}" — scene left unresolved.` };
}
