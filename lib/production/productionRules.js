// lib/production/productionRules.js
// Pure functions — no I/O, no fs, no network. Safe to import from both server
// routes and the browser bundle (same convention as
// lib/content/contentPipelineRules.js). This is the ONLY place production
// mode/provider/readiness/budget/eligibility rules are defined — server and
// client always agree.
//
// Production Router v1 is ORCHESTRATION ONLY. Nothing here ever calls a
// provider API or generates a video. It decides eligibility, recommends a
// mode/provider, scores asset readiness, and derives a governed production
// plan that a future provider-adapter milestone can execute.

// ── IDs ──────────────────────────────────────────────────────────────────────

const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]{3,100}$/;

export function isValidId(id) {
  return typeof id === 'string' && SAFE_ID_PATTERN.test(id);
}

// ── Production modes ─────────────────────────────────────────────────────────

export const PRODUCTION_MODES = [
  { id: 'avatar_video',    label: 'Avatar Video' },
  { id: 'cinematic_broll', label: 'Cinematic B-Roll' },
  { id: 'product_demo',    label: 'Product Demo' },
  { id: 'faceless_social', label: 'Faceless Social' },
  { id: 'talking_head',    label: 'Talking Head' },
  { id: 'image_to_video',  label: 'Image to Video' },
  { id: 'slideshow',       label: 'Slideshow' },
  { id: 'custom',          label: 'Custom' },
];

export const PRODUCTION_MODE_IDS = PRODUCTION_MODES.map(m => m.id);

export function isValidMode(mode) {
  return PRODUCTION_MODE_IDS.includes(mode);
}

export function modeLabel(mode) {
  return PRODUCTION_MODES.find(m => m.id === mode)?.label || mode;
}

// ── Job states ────────────────────────────────────────────────────────────────

export const JOB_STATES = [
  'draft', 'blocked', 'needs_assets', 'needs_approval', 'ready',
  'queued', 'executing', 'completed', 'failed', 'cancelled',
];

// States Production Router v1 actually produces. queued/executing/completed/
// failed/draft are reserved for a future provider-execution milestone.
export const V1_TERMINAL_STATES = ['blocked', 'needs_assets', 'needs_approval', 'ready', 'cancelled'];

export function isValidJobState(state) {
  return JOB_STATES.includes(state);
}

// ── Provider catalog (staged providers only — no execution in v1) ────────────
// `status` here is the honest DEFAULT. The only entry ever patched at runtime
// is openart-video, whose status is re-resolved from live OpenArt MCP tool
// discovery + auth health (lib/production/openartVideoAvailability.js) —
// every other provider's status is a fixed, documented governance decision:
// heygen/higgsfield have adapter *files* but their execute() unconditionally
// throws (staged placeholders); hyperframes has no adapter at all.

export const PROVIDER_CATALOG = [
  {
    id: 'heygen',
    displayName: 'HeyGen',
    status: 'staged',
    supportedModes: ['avatar_video', 'talking_head'],
    requiredInputs: ['script', 'avatarId', 'voiceId'],
    optionalInputs: ['backgroundImage', 'captionBurnIn'],
    supportsAvatar: true,
    supportsReferenceImage: false,
    supportsVoice: true,
    supportsCaptions: true,
    supportsProjectFiles: false,
    estimatedCostTier: 'medium',
    executionType: 'api_staged',
    activationRequirements: [
      'Set HEYGEN_API_KEY and HEYGEN_ENABLED=true',
      'Select an avatar ID and voice ID from your HeyGen account',
      'adapters/heygen.adapter.js execute() is currently a stub that throws — a real implementation is required before activation',
    ],
  },
  {
    id: 'heygen-mcp',
    displayName: 'HeyGen (MCP)',
    status: 'staged', // live-patched from real OAuth/tool-discovery health — see resolveLiveCatalog() in buildProductionPlan.js, same pattern as openart-video
    supportedModes: ['avatar_video', 'talking_head'],
    requiredInputs: ['script', 'avatarId', 'voiceId'],
    optionalInputs: ['captionBurnIn'],
    supportsAvatar: true,
    supportsReferenceImage: false,
    supportsVoice: true,
    supportsCaptions: true,
    supportsProjectFiles: false,
    estimatedCostTier: 'variable', // no cost/estimate/credit tool exists on the live HeyGen MCP account — never a fabricated figure
    executionType: 'mcp-oauth',
    activationRequirements: [
      'Set HEYGEN_MCP_ENABLED=true and complete OAuth connect in the HeyGen (MCP) Connection panel',
      'Select an avatar and voice from the live HeyGen discovery list in HeyGen Setup',
    ],
  },
  {
    id: 'higgsfield',
    displayName: 'Higgsfield',
    status: 'staged',
    supportedModes: ['cinematic_broll', 'product_demo', 'image_to_video'],
    requiredInputs: ['visualBrief'],
    optionalInputs: ['referenceImage', 'style', 'durationSeconds'],
    supportsAvatar: false,
    supportsReferenceImage: true,
    supportsVoice: false,
    supportsCaptions: false,
    supportsProjectFiles: false,
    estimatedCostTier: 'medium',
    executionType: 'api_staged',
    activationRequirements: [
      'Set HIGGSFIELD_API_KEY and HIGGSFIELD_ENABLED=true',
      'adapters/higgsfield.adapter.js execute() is currently a stub that throws — a real implementation is required before activation',
    ],
  },
  {
    id: 'hyperframes',
    displayName: 'HyperFrames',
    status: 'staged',
    supportedModes: ['cinematic_broll', 'product_demo'],
    requiredInputs: ['productImage'],
    optionalInputs: ['brandAssets', 'style'],
    supportsAvatar: false,
    supportsReferenceImage: true,
    supportsVoice: false,
    supportsCaptions: false,
    supportsProjectFiles: true,
    estimatedCostTier: 'medium',
    executionType: 'not_implemented',
    activationRequirements: [
      'No HyperFrames adapter exists yet under adapters/ — requires implementation plus API credentials before activation',
    ],
  },
  {
    id: 'openart-video',
    displayName: 'OpenArt Video',
    status: 'unavailable',
    supportedModes: ['image_to_video', 'slideshow'],
    requiredInputs: ['referenceImage'],
    optionalInputs: ['motionBrief'],
    supportsAvatar: false,
    supportsReferenceImage: true,
    supportsVoice: false,
    supportsCaptions: false,
    supportsProjectFiles: false,
    estimatedCostTier: 'variable',
    executionType: 'mcp_tool_pending',
    activationRequirements: [
      'OpenArt MCP session must be authenticated (OPENART_ENABLED=true + completed OAuth connect)',
      'A video-capable tool must appear in the live openart_* listTools() result — none exist as of the current (image-generation-only) OpenArt MCP integration',
    ],
  },
  {
    id: 'manual-export',
    displayName: 'Manual Export',
    status: 'active',
    supportedModes: ['avatar_video', 'cinematic_broll', 'product_demo', 'faceless_social', 'talking_head', 'image_to_video', 'slideshow', 'custom'],
    requiredInputs: ['script'],
    optionalInputs: ['sceneplan', 'thumbnail', 'referenceImage', 'avatar', 'voice', 'music', 'captionPlan', 'productImage', 'brandAssets'],
    supportsAvatar: true,
    supportsReferenceImage: true,
    supportsVoice: true,
    supportsCaptions: true,
    supportsProjectFiles: true,
    estimatedCostTier: 'free',
    executionType: 'manual',
    activationRequirements: [],
  },
];

export function getProvider(catalog, id) {
  return (catalog || PROVIDER_CATALOG).find(p => p.id === id) || null;
}

// Maps a provider's declared requiredInputs/optionalInputs vocabulary onto the
// same asset-key vocabulary used by ASSET_CHECKS below. Fields with no real
// "asset" concept (style, durationSeconds, motionBrief, backgroundImage,
// captionBurnIn) are provider parameters, not assets, and are intentionally
// left unmapped — they never affect readiness.
const PROVIDER_ASSET_ALIAS = {
  script: 'script',
  sceneplan: 'sceneplan',
  avatarId: 'avatar',
  voiceId: 'voice',
  productImage: 'productImage',
  referenceImage: 'referenceImage',
  visualBrief: 'visualBrief',
};

// ── Eligibility ───────────────────────────────────────────────────────────────

/**
 * A package is eligible for production only when it exists, has passed
 * Review/Approved in the pipeline, carries an approved status, and has the
 * minimum written content (script + at least one scene) plus platform/brand.
 * Never mutates package approval or pipeline stage to bypass a gate.
 */
export function checkPackageEligibility(pkg) {
  if (!pkg) return { eligible: false, reasons: ['Package not found.'] };

  const reasons = [];
  const stage = pkg.pipeline?.stage;

  if (stage !== 'approved' && stage !== 'production') {
    reasons.push(`Pipeline stage must be "approved" or "production" (current: "${stage || 'research'}").`);
  }
  if (pkg.status !== 'approved') {
    reasons.push(`Package status must be "approved" (current: "${pkg.status}").`);
  }
  if (!(pkg.script?.fullText || '').trim()) {
    reasons.push('script.fullText is empty — a full script is required.');
  }
  if (!Array.isArray(pkg.scenes) || pkg.scenes.length === 0) {
    reasons.push('At least one scene is required.');
  }
  if (!(pkg.platform || '').trim()) {
    reasons.push('platform is required.');
  }
  if (!(pkg.brand || '').trim()) {
    reasons.push('brand is required.');
  }

  return { eligible: reasons.length === 0, reasons };
}

// ── Mode recommendation (deterministic keyword scoring — NOT AI-based) ───────

const MODE_KEYWORD_RULES = [
  { mode: 'avatar_video',    pattern: /\bavatar\b|ai presenter|virtual host|digital human|synthetic presenter/i },
  { mode: 'talking_head',    pattern: /talking head|to camera|face cam|presenter explains|host explains|vlog style/i },
  { mode: 'product_demo',    pattern: /product demo|unboxing|how to use|feature walkthrough|product review|demo video/i },
  { mode: 'cinematic_broll', pattern: /cinematic|b-roll|broll|brand film|lifestyle shots|aesthetic footage|mood film/i },
  { mode: 'image_to_video',  pattern: /animate (this|the|our) image|bring .* to life|photo animation|still to video/i },
  { mode: 'slideshow',       pattern: /slideshow|carousel|listicle|photo dump|slide deck/i },
];

/**
 * Deterministic, local, rule-based mode recommendation — explicitly labeled
 * as such so job metadata never implies an LLM was consulted. Mirrors the
 * "deterministic-local" labeling convention already used for OpenArt prompt
 * polishing (lib/openart/openartMcpClient.js).
 */
export function recommendProductionMode(pkg) {
  const intentText = [
    pkg.topic, pkg.goal, pkg.tone, pkg.offer, pkg.cta,
    pkg.metadata?.instructions, pkg.thumbnail?.visualBrief,
  ].filter(Boolean).join(' ');

  for (const rule of MODE_KEYWORD_RULES) {
    if (rule.pattern.test(intentText)) {
      return {
        recommendedMode: rule.mode,
        modeReason: `Deterministic keyword match for "${modeLabel(rule.mode)}" in package copy (topic/goal/tone/offer/CTA/instructions/visual brief). Engine: deterministic-keyword-scoring, not AI-based.`,
      };
    }
  }

  return {
    recommendedMode: 'faceless_social',
    modeReason: 'Deterministic default — no avatar, product, cinematic, image-animation, or slideshow signal detected in package copy. Short-form faceless format assumed. Engine: deterministic-keyword-scoring, not AI-based.',
  };
}

// ── Asset readiness ──────────────────────────────────────────────────────────
// Never invents assets. The content package schema has no dedicated fields
// for avatar/voice/music/productImage/brandAssets — those are always
// reported missing. The only real visual asset in the schema is the
// generated thumbnail, which doubles as "reference image" evidence.

const ASSET_CHECKS = {
  script:        { label: 'Script',                check: pkg => !!(pkg.script?.fullText || '').trim() },
  sceneplan:     { label: 'Scene plan',             check: pkg => Array.isArray(pkg.scenes) && pkg.scenes.length > 0 },
  thumbnail:     { label: 'Thumbnail image',        check: pkg => pkg.thumbnail?.status === 'completed' && !!pkg.thumbnail?.artifactUrl },
  referenceImage:{ label: 'Reference image',        check: pkg => pkg.thumbnail?.status === 'completed' && !!pkg.thumbnail?.artifactUrl },
  productImage:  { label: 'Product image',          check: () => false },
  avatar:        { label: 'Avatar reference',       check: () => false },
  voice:         { label: 'Voice reference',        check: () => false },
  music:         { label: 'Music track',            check: () => false },
  brandAssets:   { label: 'Brand assets',           check: () => false },
  captionPlan:   { label: 'On-screen caption plan', check: pkg => Array.isArray(pkg.scenes) && pkg.scenes.some(s => (s.onScreenText || '').trim()) },
  visualBrief:   { label: 'Visual brief',           check: pkg => !!(pkg.thumbnail?.visualBrief || '').trim() },
  socialCaption: { label: 'Social caption',         check: pkg => !!(pkg.caption || '').trim() },
};

export function assetLabel(key) {
  return ASSET_CHECKS[key]?.label || key;
}

const MODE_ASSET_REQUIREMENTS = {
  avatar_video:    { required: ['script', 'avatar', 'voice'],        optional: ['captionPlan', 'music'] },
  talking_head:    { required: ['script', 'avatar'],                 optional: ['voice', 'captionPlan'] },
  product_demo:    { required: ['script', 'sceneplan', 'productImage'], optional: ['thumbnail', 'music', 'captionPlan'] },
  cinematic_broll: { required: ['sceneplan', 'visualBrief'],         optional: ['referenceImage', 'music', 'brandAssets'] },
  image_to_video:  { required: ['referenceImage'],                  optional: ['music', 'visualBrief'] },
  slideshow:       { required: ['sceneplan', 'referenceImage'],      optional: ['music', 'captionPlan'] },
  faceless_social: { required: ['script', 'sceneplan'],              optional: ['thumbnail', 'captionPlan', 'voice', 'music'] },
  custom:          { required: ['script'],                          optional: ['sceneplan', 'thumbnail', 'referenceImage', 'avatar', 'voice', 'music', 'captionPlan', 'productImage', 'brandAssets'] },
};

// heygen-mcp is the only provider with a real, server-managed avatar/voice
// SOURCE (job.providerInput, set via PATCH /api/production/jobs/[id]/provider-input
// — see lib/production/execution/adapters/heygenMcp.adapter.js). Every other
// provider's avatar/voice remain honestly "always missing" per ASSET_CHECKS
// above (the Content Package schema has no such fields) — this override is
// scoped to providerId === 'heygen-mcp' only and is a no-op (falls through
// to the unchanged ASSET_CHECKS lookup) for every other provider or when no
// providerInput is supplied, so no other provider's readiness is affected.
function isAssetAvailable(key, pkg, providerId, providerInput) {
  if (providerId === 'heygen-mcp' && providerInput) {
    if (key === 'avatar') return !!providerInput.avatarId;
    if (key === 'voice') return !!providerInput.voiceId;
  }
  return ASSET_CHECKS[key] ? ASSET_CHECKS[key].check(pkg) : false;
}

/**
 * Readiness is mode-driven (authoritative requirement set) plus any
 * additional provider-declared requiredInputs mapped onto the same asset
 * vocabulary — so "missing assets" honors both the selected mode and the
 * selected provider, never guesses beyond what the schema actually carries.
 *
 * @param {object|null} providerInput — server-managed HeyGen setup (avatarId/
 *   voiceId/...), only ever consulted when providerId === 'heygen-mcp'.
 * @returns {{ ready: boolean, score: number, available: string[], missingRequired: string[], missingOptional: string[], warnings: string[] }}
 */
export function evaluateAssetReadiness(pkg, { mode, providerId, catalog = PROVIDER_CATALOG, providerInput = null }) {
  const modeReq = MODE_ASSET_REQUIREMENTS[mode] || MODE_ASSET_REQUIREMENTS.custom;
  const provider = getProvider(catalog, providerId);
  const providerRequiredKeys = (provider?.requiredInputs || []).map(k => PROVIDER_ASSET_ALIAS[k]).filter(Boolean);
  const providerOptionalKeys = (provider?.optionalInputs || []).map(k => PROVIDER_ASSET_ALIAS[k]).filter(Boolean);

  const requiredKeys = [...new Set([...modeReq.required, ...providerRequiredKeys])];
  const optionalKeys = [...new Set([...modeReq.optional, ...providerOptionalKeys])].filter(k => !requiredKeys.includes(k));

  const available = [];
  const missingRequired = [];
  const missingOptional = [];
  const warnings = [];

  for (const key of requiredKeys) {
    if (!ASSET_CHECKS[key]) continue;
    if (isAssetAvailable(key, pkg, providerId, providerInput)) available.push(key); else missingRequired.push(key);
  }
  for (const key of optionalKeys) {
    if (!ASSET_CHECKS[key]) continue;
    if (isAssetAvailable(key, pkg, providerId, providerInput)) { if (!available.includes(key)) available.push(key); } else missingOptional.push(key);
  }

  if (providerId === 'manual-export' && missingRequired.length) {
    warnings.push('Manual export path — missing required assets must be sourced manually before a human executes this production.');
  }
  if (provider && provider.status !== 'active' && providerId !== 'manual-export') {
    warnings.push(`${provider.displayName} cannot execute yet (${provider.status}) — this plan is preparatory only.`);
  }

  const reqTotal = requiredKeys.length || 1;
  const optTotal = optionalKeys.length || 1;
  const reqScore = ((requiredKeys.length - missingRequired.length) / reqTotal) * 70;
  const optScore = ((optionalKeys.length - missingOptional.length) / optTotal) * 30;

  return {
    ready: missingRequired.length === 0,
    score: Math.round(reqScore + optScore),
    available,
    missingRequired,
    missingOptional,
    warnings,
  };
}

// ── Provider recommendation ──────────────────────────────────────────────────

function scoreProviderCandidate(provider, { mode, readinessAvailable }) {
  if (!provider.supportedModes.includes(mode)) return { score: -1, matchesMode: false };

  let score = 0;
  if (provider.status === 'active') score += 50;

  const capBonus = {
    avatar_video: provider.supportsAvatar ? 15 : 0,
    talking_head: provider.supportsAvatar ? 15 : 0,
    product_demo: provider.supportsReferenceImage ? 10 : 0,
    cinematic_broll: provider.supportsReferenceImage ? 10 : 0,
    image_to_video: provider.supportsReferenceImage ? 15 : 0,
    slideshow: provider.supportsReferenceImage ? 10 : 0,
    faceless_social: 5,
    custom: 0,
  }[mode] || 0;
  score += capBonus;

  const inputOverlap = provider.requiredInputs.filter(k => readinessAvailable.includes(PROVIDER_ASSET_ALIAS[k])).length;
  score += inputOverlap * 5;

  if (provider.id === 'manual-export') score += 1; // stable last-resort presence, never wins over a real active match

  return { score, matchesMode: true };
}

/**
 * Orders every mode-matching provider best→worst. Only `status: 'active'`
 * providers are ever treated as executable — staged/unavailable providers
 * are ranked and shown, but never recommended as if they can run now.
 * If no live provider is available, recommends manual-export and preserves
 * the best staged candidate as preferredFutureProvider.
 */
export function recommendProviders(pkg, { mode, readiness, catalog = PROVIDER_CATALOG }) {
  const candidates = catalog
    .map(provider => {
      const { score, matchesMode } = scoreProviderCandidate(provider, { mode, readinessAvailable: readiness.available });
      return {
        id: provider.id,
        displayName: provider.displayName,
        status: provider.status,
        matchesMode,
        executable: provider.status === 'active',
        score: matchesMode ? score : null,
      };
    })
    .filter(c => c.matchesMode)
    .sort((a, b) => b.score - a.score);

  const unavailableReasons = {};
  for (const c of candidates) {
    if (c.executable) continue;
    const provider = getProvider(catalog, c.id);
    unavailableReasons[c.id] = provider.status === 'staged'
      ? `${c.displayName} is staged — not yet configured or verified for execution.`
      : provider.status === 'unavailable'
        ? `${c.displayName} is unavailable — ${c.id === 'openart-video' ? 'no video-capable MCP tool is currently discoverable.' : 'no verified execution path.'}`
        : `${c.displayName} cannot execute yet.`;
  }

  const executableCandidate = candidates.find(c => c.executable && c.id !== 'manual-export');
  const manualExport = candidates.find(c => c.id === 'manual-export');
  const recommendedProvider = executableCandidate?.id || manualExport?.id || null;
  const preferredFutureProvider = candidates.find(c => !c.executable)?.id || null;
  const preferredFutureCatalogEntry = preferredFutureProvider ? getProvider(catalog, preferredFutureProvider) : null;

  return {
    recommendedProvider,
    providerCandidates: candidates,
    unavailableReasons,
    preferredFutureProvider,
    missingActivationRequirements: preferredFutureCatalogEntry?.activationRequirements || [],
    recommendationReason: executableCandidate
      ? `${executableCandidate.displayName} is the highest-scoring executable provider for mode "${modeLabel(mode)}".`
      : `No live executable provider currently supports mode "${modeLabel(mode)}" other than Manual Export.${preferredFutureCatalogEntry ? ` Preferred future provider: ${preferredFutureCatalogEntry.displayName}.` : ''}`,
  };
}

// ── Output spec (deterministic platform defaults) ────────────────────────────

const PLATFORM_OUTPUT_SPECS = {
  default_vertical:   { aspectRatio: '9:16',  resolution: '1080x1920', frameRate: 30, captionBurnIn: true,  safeAreaNotes: 'Keep key text within the center-safe 80% — avoid platform UI overlap (captions, buttons, profile chrome).', fileFormat: 'mp4' },
  default_horizontal: { aspectRatio: '16:9',  resolution: '1920x1080', frameRate: 30, captionBurnIn: false, safeAreaNotes: 'Standard 16:9 title-safe area.', fileFormat: 'mp4' },
  default_square:     { aspectRatio: '1:1',   resolution: '1080x1080', frameRate: 30, captionBurnIn: true,  safeAreaNotes: 'Center-weighted composition for feed and profile-grid display.', fileFormat: 'mp4' },
  default_portrait:   { aspectRatio: '4:5',   resolution: '1080x1350', frameRate: 30, captionBurnIn: true,  safeAreaNotes: 'Feed-safe portrait crop — keep subject centered.', fileFormat: 'mp4' },
};

function classifyPlatform(platform) {
  const p = (platform || '').toLowerCase();
  if (/tiktok|reels|shorts|snapchat/.test(p)) return 'default_vertical';
  if (/youtube/.test(p) && !/shorts/.test(p)) return 'default_horizontal';
  if (/linkedin|blog|podcast/.test(p)) return 'default_horizontal';
  if (/pinterest/.test(p)) return 'default_portrait';
  if (/instagram/.test(p)) return 'default_square';
  if (/twitter|\bx\b/.test(p)) return 'default_square';
  return 'default_vertical'; // short-form-first default bias
}

export function buildOutputSpec(pkg) {
  const base = PLATFORM_OUTPUT_SPECS[classifyPlatform(pkg.platform)];
  return {
    platform: pkg.platform || 'Unspecified',
    targetDuration: pkg.videoDuration || 'Not specified',
    ...base,
  };
}

// ── Budget governance ────────────────────────────────────────────────────────
// Real provider pricing is not integrated. Heygen/Higgsfield already ship
// static, labeled "staged estimate" per-unit figures in their own adapters
// (adapters/heygen.adapter.js, adapters/higgsfield.adapter.js) — mirrored
// here as provisional ranges. Everything else is tier-only, never a
// fabricated dollar figure.

export function estimateProviderBudget(providerId, { maxEstimatedCost, currency = 'USD', approvalRequiredAbove, catalog = PROVIDER_CATALOG } = {}) {
  const provider = getProvider(catalog, providerId);
  const costTier = provider?.estimatedCostTier || 'variable';

  let estimateType = 'provisional_tier';
  let estimatedRange = null;

  if (providerId === 'heygen') {
    estimatedRange = { min: 0.20, max: 0.35, currency: 'USD', unit: 'per minute of generated video' };
    estimateType = 'provisional_adapter_estimate';
  } else if (providerId === 'higgsfield') {
    estimatedRange = { min: 0.40, max: 0.65, currency: 'USD', unit: 'per generation' };
    estimateType = 'provisional_adapter_estimate';
  } else if (providerId === 'manual-export') {
    estimatedRange = { min: 0, max: 0, currency: 'USD', unit: 'no provider API spend' };
  }
  // openart-video / hyperframes: no numeric estimate exists — tier only.

  let approvalRequired;
  let approvalReason;

  if (providerId === 'manual-export') {
    approvalRequired = false;
    approvalReason = 'Manual export has no provider API cost.';
  } else if (maxEstimatedCost != null && estimatedRange && estimatedRange.max > Number(maxEstimatedCost)) {
    approvalRequired = true;
    approvalReason = `Estimated cost range ($${estimatedRange.min}–$${estimatedRange.max} ${estimatedRange.unit}) may exceed the configured maximum ($${maxEstimatedCost}).`;
  } else if (provider && provider.status !== 'active') {
    approvalRequired = true;
    approvalReason = `${provider.displayName} is not yet an executable, verified provider — any future spend requires human approval before activation.`;
  } else {
    approvalRequired = true;
    approvalReason = 'All non-manual production spend requires explicit human approval before execution.';
  }

  return {
    estimateType,
    estimatedRange,
    costTier,
    approvalRequired,
    approvalReason,
    maxEstimatedCost: maxEstimatedCost != null && Number.isFinite(Number(maxEstimatedCost)) ? Number(maxEstimatedCost) : null,
    currency,
    approvalRequiredAbove: approvalRequiredAbove ?? null,
  };
}

// ── Job status derivation ─────────────────────────────────────────────────────

export function computeJobStatus({ eligibility, readiness, budget }) {
  if (!eligibility.eligible) return 'blocked';
  if (!readiness.ready) return 'needs_assets';
  if (budget.approvalRequired) return 'needs_approval';
  return 'ready';
}

// ── Derived plan fragments (metadata only — never duplicates package content) ─

export function buildScenesSummary(pkg) {
  const scenes = Array.isArray(pkg.scenes) ? pkg.scenes : [];
  return {
    count: scenes.length,
    totalDurationSeconds: scenes.reduce((sum, s) => sum + (Number(s.durationSeconds) || 0), 0) || null,
    orderedSegments: scenes.map(s => ({
      order: s.order,
      durationSeconds: s.durationSeconds ?? null,
      hasVisual: !!(s.visual || '').trim(),
      hasVoiceover: !!(s.voiceover || '').trim(),
      hasOnScreenText: !!(s.onScreenText || '').trim(),
    })),
  };
}

export function buildVoiceoverScriptSummary(pkg) {
  const text = (pkg.script?.fullText || '').trim();
  const wordCount = text ? text.split(/\s+/).length : 0;
  return {
    available: !!text,
    wordCount,
    estimatedDurationSeconds: wordCount ? Math.round((wordCount / 150) * 60) : null,
  };
}

export function buildCaptionPlanSummary(pkg) {
  const scenes = Array.isArray(pkg.scenes) ? pkg.scenes : [];
  const segmentsWithText = scenes.filter(s => (s.onScreenText || '').trim()).length;
  return { source: segmentsWithText ? 'scenes.onScreenText' : 'none', segmentsWithText, totalSegments: scenes.length };
}

export function buildVisualAssetPlanSummary(pkg) {
  const hasThumb = pkg.thumbnail?.status === 'completed' && !!pkg.thumbnail?.artifactUrl;
  return {
    thumbnailAvailable: hasThumb,
    thumbnailArtifactId: hasThumb ? (pkg.thumbnail?.artifactId || null) : null,
    referenceImageAvailable: hasThumb,
    productImageAvailable: false,
    brandAssetsAvailable: false,
  };
}

export function buildAudioPlanSummary(pkg, mode) {
  const modeReq = MODE_ASSET_REQUIREMENTS[mode] || MODE_ASSET_REQUIREMENTS.custom;
  return {
    voiceoverNeeded: modeReq.required.includes('voice') || modeReq.optional.includes('voice'),
    voiceoverAvailable: false,
    musicNeeded: modeReq.required.includes('music') || modeReq.optional.includes('music'),
    musicAvailable: false,
  };
}

// ── Activity history ──────────────────────────────────────────────────────────

export const ACTIVITY_EVENT_TYPES = [
  'job_created', 'eligibility_checked', 'mode_recommended', 'provider_recommended',
  'readiness_evaluated', 'plan_refreshed', 'approval_requested', 'approved',
  'rejected', 'cancelled', 'package_stale_detected', 'manual_exported',
  'output_approved', 'output_rejected',
];

export function makeActivityEvent(type, { actor = 'system', note = null, metadata = null } = {}) {
  return { type, at: new Date().toISOString(), actor, note, metadata: metadata || null };
}
