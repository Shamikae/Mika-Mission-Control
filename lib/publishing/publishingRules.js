// lib/publishing/publishingRules.js
// Pure functions — no I/O, no fs, no network. Safe to import from both server
// routes and the browser bundle (same convention as
// lib/production/productionRules.js and lib/production/execution/executionRules.js).
//
// Publishing Router v1 is PREPARATION AND MANUAL PUBLISHING ONLY. Nothing
// here ever calls a platform API, uploads media, or edits a video. It
// governs eligibility (review.status === 'approved'), validates a chosen
// artifact against a platform's known limits, and tracks publish state —
// exactly as Production Router governs mode/provider/readiness without ever
// executing a provider itself.

import { isValidId as isValidProductionId, makeActivityEvent } from '../production/productionRules';

export const isValidId = isValidProductionId;
export { makeActivityEvent };

// ── Publish states ───────────────────────────────────────────────────────
// 'publishing' is reserved for a future real-API-publishing milestone —
// v1's "publish now" is a single synchronous manual attestation
// (ready|scheduled -> published), so it never actually persists a job in
// the 'publishing' state, but the state is defined now so a later adapter
// can use it without a schema change (same pattern as
// productionRules.js's V1_TERMINAL_STATES).

export const PUBLISH_STATES = ['draft', 'ready', 'scheduled', 'publishing', 'published', 'failed', 'cancelled'];
export const V1_PUBLISH_STATES = ['draft', 'ready', 'scheduled', 'published', 'failed', 'cancelled'];
export const TERMINAL_PUBLISH_STATES = ['published', 'failed', 'cancelled'];

export function isValidPublishState(state) {
  return PUBLISH_STATES.includes(state);
}

const PUBLISH_TRANSITIONS = {
  draft: ['ready', 'cancelled'],
  ready: ['scheduled', 'published', 'draft', 'cancelled', 'failed'],
  scheduled: ['published', 'failed', 'cancelled'],
  publishing: ['published', 'failed'],
  published: [],
  failed: ['cancelled'],
  cancelled: [],
};

export function isValidPublishTransition(from, to) {
  if (!isValidPublishState(from) || !isValidPublishState(to)) return false;
  return (PUBLISH_TRANSITIONS[from] || []).includes(to);
}

// ── Activity ──────────────────────────────────────────────────────────────

export const PUBLISH_ACTIVITY_EVENT_TYPES = [
  'publish_created', 'platform_selected', 'fields_updated', 'marked_ready',
  'scheduled', 'export_generated', 'published_manually', 'cancelled', 'failed',
];

// ── Platform registry (v1 — every platform is manual-export only) ───────
// Duration/aspect-ratio figures are honest public GUIDANCE (as of this
// writing), not hard platform-API-verified limits — validatePublishJob()
// only ever WARNS on them, never blocks. Caption length and required-media
// are the only hard (blocking) checks, since those are unambiguous.

export const PLATFORM_CATALOG = [
  {
    id: 'tiktok',
    displayName: 'TikTok',
    adapterId: 'manual-tiktok',
    supportedMimeTypes: ['video/mp4', 'video/webm'],
    durationSeconds: { min: 3, max: 600 },
    aspectRatioGuidance: '9:16 preferred (also supports 1:1, 16:9)',
    preferredAspectRatios: ['9:16'],
    captionMaxChars: 2200,
    captionRequired: true,
    status: 'manual-export',
  },
  {
    id: 'instagram-reels',
    displayName: 'Instagram Reels',
    adapterId: 'manual-instagram',
    supportedMimeTypes: ['video/mp4'],
    durationSeconds: { min: 3, max: 90 },
    aspectRatioGuidance: '9:16 required',
    preferredAspectRatios: ['9:16'],
    captionMaxChars: 2200,
    captionRequired: true,
    status: 'manual-export',
  },
  {
    id: 'youtube-shorts',
    displayName: 'YouTube Shorts',
    adapterId: 'manual-youtube',
    supportedMimeTypes: ['video/mp4'],
    durationSeconds: { min: 1, max: 180 },
    aspectRatioGuidance: '9:16 preferred (vertical or square)',
    preferredAspectRatios: ['9:16', '1:1'],
    captionMaxChars: 5000,
    captionRequired: true,
    status: 'manual-export',
  },
  {
    id: 'linkedin',
    displayName: 'LinkedIn',
    adapterId: 'manual-linkedin',
    supportedMimeTypes: ['video/mp4'],
    durationSeconds: { min: 3, max: 600 },
    aspectRatioGuidance: '16:9 or 1:1 preferred',
    preferredAspectRatios: ['16:9', '1:1'],
    captionMaxChars: 3000,
    captionRequired: true,
    status: 'manual-export',
  },
  {
    id: 'pinterest',
    displayName: 'Pinterest',
    adapterId: 'manual-pinterest',
    supportedMimeTypes: ['video/mp4', 'image/png', 'image/jpeg'],
    durationSeconds: { min: 4, max: 900 },
    aspectRatioGuidance: '9:16 or 2:3 preferred for video pins',
    preferredAspectRatios: ['9:16', '2:3'],
    captionMaxChars: 500,
    captionRequired: true,
    status: 'manual-export',
  },
  {
    id: 'x',
    displayName: 'X (Twitter)',
    adapterId: 'manual-x',
    supportedMimeTypes: ['video/mp4'],
    durationSeconds: { min: 1, max: 140 },
    aspectRatioGuidance: '16:9 or 1:1 preferred',
    preferredAspectRatios: ['16:9', '1:1'],
    captionMaxChars: 280,
    captionRequired: false,
    status: 'manual-export',
  },
  {
    id: 'facebook-reels',
    displayName: 'Facebook Reels',
    adapterId: 'manual-facebook',
    supportedMimeTypes: ['video/mp4'],
    durationSeconds: { min: 3, max: 90 },
    aspectRatioGuidance: '9:16 required',
    preferredAspectRatios: ['9:16'],
    captionMaxChars: 2200,
    captionRequired: true,
    status: 'manual-export',
  },
];

export function getPlatform(platformId) {
  return PLATFORM_CATALOG.find(p => p.id === platformId) || null;
}

export function isValidPlatform(platformId) {
  return PLATFORM_CATALOG.some(p => p.id === platformId);
}

// ── Publishing adapter registry ──────────────────────────────────────────
// Manual adapters only — no API calls, no OAuth, no uploads. Mirrors
// PROVIDER_CATALOG's role in production (a registry describing WHAT is
// available, never the execution itself).

export const PUBLISHING_ADAPTERS = PLATFORM_CATALOG.map(p => ({
  id: p.adapterId,
  displayName: `Manual — ${p.displayName}`,
  platformId: p.id,
  executionType: 'manual_export',
  status: 'active',
}));

export function getAdapter(adapterId) {
  return PUBLISHING_ADAPTERS.find(a => a.id === adapterId) || null;
}

// ── Aspect ratio helpers ──────────────────────────────────────────────────

function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }

export function computeAspectRatio(width, height) {
  if (!width || !height) return null;
  const d = gcd(width, height) || 1;
  return `${Math.round(width / d)}:${Math.round(height / d)}`;
}

function aspectRatioValue(width, height) {
  if (!width || !height) return null;
  return width / height;
}

const KNOWN_RATIO_VALUES = { '9:16': 9 / 16, '16:9': 16 / 9, '1:1': 1, '2:3': 2 / 3, '4:5': 4 / 5 };

function matchesAnyPreferredRatio(width, height, preferred, tolerance = 0.06) {
  const value = aspectRatioValue(width, height);
  if (value == null) return null; // unknown — no claim either way
  return preferred.some((label) => {
    const target = KNOWN_RATIO_VALUES[label];
    return target != null && Math.abs(value - target) <= tolerance;
  });
}

// ── Publish eligibility (the review gate) ────────────────────────────────
// Never bypassed: a Production Job may enter Publishing ONLY when
// review.status === 'approved'.

export function checkPublishEligibility(productionJob) {
  const reasons = [];
  if (!productionJob) return { eligible: false, reasons: ['Production job not found.'] };
  if (productionJob.execution?.status !== 'completed') {
    reasons.push('Production job has not completed execution yet.');
  }
  if (productionJob.review?.status !== 'approved') {
    reasons.push(`Output review must be "approved" before publishing (current: "${productionJob.review?.status || 'unreviewed'}").`);
  }
  return { eligible: reasons.length === 0, reasons };
}

// ── Platform/artifact validation ──────────────────────────────────────────
// Returns { ok, warnings: [{ severity: 'blocking'|'warning', message }] }.
// Never silently modifies media or caption — only ever reports.

export function validatePublishJob({ platform, artifact, caption, hashtags }) {
  const warnings = [];
  const push = (severity, message) => warnings.push({ severity, message });

  if (!platform) {
    push('blocking', 'No platform selected.');
    return { ok: false, warnings };
  }
  if (!artifact) {
    push('blocking', 'No artifact selected — a production output must be attached before publishing.');
  } else {
    if (!platform.supportedMimeTypes.includes(artifact.mimeType)) {
      push('blocking', `${platform.displayName} does not accept "${artifact.mimeType}" — supported: ${platform.supportedMimeTypes.join(', ')}.`);
    }
    if (artifact.duration != null && platform.durationSeconds) {
      if (artifact.duration < platform.durationSeconds.min) {
        push('warning', `Duration (${artifact.duration}s) is shorter than ${platform.displayName}'s typical minimum (${platform.durationSeconds.min}s).`);
      } else if (artifact.duration > platform.durationSeconds.max) {
        push('warning', `Duration (${artifact.duration}s) exceeds ${platform.displayName}'s typical maximum (${platform.durationSeconds.max}s) — it may be trimmed or rejected on upload.`);
      }
    }
    if (artifact.width && artifact.height && platform.preferredAspectRatios?.length) {
      const matches = matchesAnyPreferredRatio(artifact.width, artifact.height, platform.preferredAspectRatios);
      if (matches === false) {
        const actual = computeAspectRatio(artifact.width, artifact.height);
        push('warning', `Aspect ratio ${actual || `${artifact.width}x${artifact.height}`} does not match ${platform.displayName}'s guidance (${platform.aspectRatioGuidance}).`);
      }
    }
  }

  const trimmedCaption = typeof caption === 'string' ? caption.trim() : '';
  if (platform.captionRequired && !trimmedCaption) {
    push('blocking', `${platform.displayName} requires a caption.`);
  }
  if (trimmedCaption && platform.captionMaxChars && trimmedCaption.length > platform.captionMaxChars) {
    push('blocking', `Caption is ${trimmedCaption.length} characters — ${platform.displayName}'s limit is ${platform.captionMaxChars}.`);
  }
  if (Array.isArray(hashtags) && hashtags.length > 30) {
    push('warning', `${hashtags.length} hashtags attached — most platforms ignore or penalize excessive hashtags beyond ~30.`);
  }

  const ok = !warnings.some(w => w.severity === 'blocking');
  return { ok, warnings };
}

// ── Platform checklist (UI helper — human-readable, not enforcement) ─────

export function buildPlatformChecklist(platform) {
  if (!platform) return [];
  return [
    `Media type: ${platform.supportedMimeTypes.join(', ')}`,
    `Duration: ${platform.durationSeconds.min}s – ${platform.durationSeconds.max}s`,
    `Aspect ratio: ${platform.aspectRatioGuidance}`,
    `Caption limit: ${platform.captionMaxChars} characters${platform.captionRequired ? ' (required)' : ' (optional)'}`,
    `Publishing: manual export only — no automatic upload in v1.`,
  ];
}
