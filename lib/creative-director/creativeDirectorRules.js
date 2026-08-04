// lib/creative-director/creativeDirectorRules.js
// Pure functions — no I/O, no fs, no network. Safe to import from both
// server routes and the browser bundle (same convention as
// lib/production/productionRules.js, lib/publishing/publishingRules.js,
// lib/orchestration/workflowRules.js).
//
// IMPORTANT: the Creative Director is NOT a provider and NOT another
// production/execution engine. It never calls an AI model. "Generate a
// structured production brief" means a DETERMINISTIC, rule-based transform
// of the Content Request's own fields into the Content Package's shape — a
// project-brief outline, not real creative copy. Real creative work is
// explicitly reserved for the six future agents (Research, Script Writer,
// Storyboard, Prompt Engineer, Thumbnail Designer, Caption Writer), which
// are honest placeholder stages in v1 — no AI generation implemented yet.

import { isValidId as isValidProductionId, makeActivityEvent } from '../production/productionRules';

export const isValidId = isValidProductionId;
export { makeActivityEvent };

// ── Content Request lifecycle ────────────────────────────────────────────

export const CONTENT_REQUEST_STATES = [
  'draft', 'submitted', 'brief_generated', 'package_created', 'completed', 'cancelled', 'rejected',
];

const TRANSITIONS = {
  draft: ['submitted', 'cancelled'],
  submitted: ['brief_generated', 'rejected', 'cancelled'],
  brief_generated: ['package_created', 'cancelled'],
  package_created: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
  rejected: [],
};

export function isValidRequestState(state) {
  return CONTENT_REQUEST_STATES.includes(state);
}

export function isValidRequestTransition(from, to) {
  if (!isValidRequestState(from) || !isValidRequestState(to)) return false;
  return (TRANSITIONS[from] || []).includes(to);
}

export const REQUEST_STATE_META = {
  draft:            { label: 'Draft',            color: '#a78bfa' },
  submitted:        { label: 'Submitted',        color: '#60a5fa' },
  brief_generated:  { label: 'Brief Generated',  color: '#60a5fa' },
  package_created:  { label: 'Package Created',  color: '#4ade80' },
  completed:        { label: 'Completed',        color: 'var(--gold, #c9a84c)' },
  cancelled:        { label: 'Cancelled',        color: '#5d6c86' },
  rejected:         { label: 'Rejected',         color: '#f87171' },
};

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
export const PRIORITY_META = {
  low:    { label: 'Low',    color: '#5d6c86' },
  normal: { label: 'Normal', color: '#60a5fa' },
  high:   { label: 'High',   color: '#f59e0b' },
  urgent: { label: 'Urgent', color: '#f87171' },
};

export const AVATAR_PREFERENCES = ['avatar', 'faceless', 'either'];
export const AVATAR_PREFERENCE_LABELS = {
  avatar: 'On-camera avatar/talent',
  faceless: 'Faceless (B-roll/voiceover/motion)',
  either: 'No preference',
};

// ── Future agent stages (placeholders — no AI generation yet) ───────────

export const AGENT_STAGES = [
  { id: 'research', label: 'Research Agent', description: 'Audience/topic/competitive research.' },
  { id: 'scriptWriter', label: 'Script Writer', description: 'Full script and hooks.' },
  { id: 'storyboard', label: 'Storyboard Agent', description: 'Scene-by-scene shot plan.' },
  { id: 'promptEngineer', label: 'Prompt Engineer', description: 'Provider-specific generation prompts.' },
  { id: 'thumbnailDesigner', label: 'Thumbnail Designer', description: 'Thumbnail concept and visual brief.' },
  { id: 'captionWriter', label: 'Caption Writer', description: 'Platform caption, hashtags, CTA copy.' },
];
export const AGENT_STAGE_IDS = AGENT_STAGES.map(a => a.id);

/** Every request starts with all six agent stages honestly "not_started" — v1 never advances them. */
export function defaultAgentStages() {
  return Object.fromEntries(AGENT_STAGE_IDS.map(id => [id, {
    status: 'not_started', output: null,
    note: 'Reserved for Phase 4B — no AI generation implemented yet.',
  }]));
}

// ── Validation ────────────────────────────────────────────────────────────

const MAX = {
  brand: 200, platform: 100, goal: 300, topic: 500, targetAudience: 300,
  style: 200, cta: 300, desiredRuntime: 50, note: 2000,
};

export function validateContentRequest(input) {
  const errors = [];
  if (!input?.brand || !String(input.brand).trim()) errors.push('Brand is required.');
  if (!input?.platform || !String(input.platform).trim()) errors.push('Platform is required.');
  if (!input?.goal || !String(input.goal).trim()) errors.push('Goal is required.');
  if (!input?.topic || !String(input.topic).trim()) errors.push('Topic is required.');
  if (input?.priority && !PRIORITIES.includes(input.priority)) errors.push(`priority must be one of: ${PRIORITIES.join(', ')}.`);
  if (input?.avatarPreference && !AVATAR_PREFERENCES.includes(input.avatarPreference)) errors.push(`avatarPreference must be one of: ${AVATAR_PREFERENCES.join(', ')}.`);
  return { ok: errors.length === 0, errors };
}

function clampStr(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** Sanitizes raw request input into the exact stored field shape. */
export function sanitizeContentRequestInput(input) {
  return {
    brand: clampStr(input?.brand, MAX.brand),
    platform: clampStr(input?.platform, MAX.platform),
    goal: clampStr(input?.goal, MAX.goal),
    topic: clampStr(input?.topic, MAX.topic),
    targetAudience: clampStr(input?.targetAudience, MAX.targetAudience),
    style: clampStr(input?.style, MAX.style),
    cta: clampStr(input?.cta, MAX.cta),
    desiredRuntime: clampStr(input?.desiredRuntime, MAX.desiredRuntime),
    avatarPreference: AVATAR_PREFERENCES.includes(input?.avatarPreference) ? input.avatarPreference : 'either',
    priority: PRIORITIES.includes(input?.priority) ? input.priority : 'normal',
  };
}

// ── Structured production brief (deterministic — NEVER an AI/model call) ──

/**
 * Builds a "synthesized"-shaped object matching what
 * lib/content/contentPackageSchema.js's buildContentPackage() expects
 * (hooks/script/scenes/caption/cta/hashtags/keywords/thumbnail) — but every
 * field here is a rule-based transform of the request's own fields, clearly
 * labeled as a brief/outline. This is the ONLY thing that ever fills in the
 * package's written content in v1; real creative copy is Phase 4B's job.
 */
export function buildProductionBrief(request) {
  const avatarNote = AVATAR_PREFERENCE_LABELS[request.avatarPreference] || AVATAR_PREFERENCE_LABELS.either;
  const briefLines = [
    'PRODUCTION BRIEF — generated by the Creative Director',
    '(a structured outline, not final creative copy — see Agent Status for what still needs to be written)',
    '',
    `Goal: ${request.goal}`,
    `Topic: ${request.topic}`,
    `Target audience: ${request.targetAudience || 'Not specified'}`,
    `Style: ${request.style || 'Not specified'}`,
    `CTA: ${request.cta || 'Not specified'}`,
    `Desired runtime: ${request.desiredRuntime || 'Not specified'}`,
    `Presentation: ${avatarNote}`,
    `Priority: ${PRIORITY_META[request.priority]?.label || request.priority}`,
    '',
    `Created from Content Request ${request.id}. Real script content is written by the Script Writer agent (Phase 4B).`,
  ];

  return {
    hooks: [
      { text: `[Placeholder — Script Writer agent to draft] Hook for: ${request.topic}`, angle: request.style || 'general' },
    ],
    script: {
      opening: '[Reserved for Script Writer agent]',
      body: '[Reserved for Script Writer agent]',
      cta: request.cta || '',
      fullText: briefLines.join('\n'),
    },
    scenes: [],
    caption: `[Draft caption placeholder for "${request.topic}" — Caption Writer agent to finalize]`,
    cta: request.cta || '',
    hashtags: [],
    keywords: [],
    thumbnail: {
      headline: request.topic.slice(0, 150),
      visualBrief: `[Reserved for Thumbnail Designer agent] Style: ${request.style || 'not specified'}.`,
    },
  };
}
