// lib/content/createContentPackagePlan.js
// Pure function — no I/O. Takes validated input, returns packageId + task specs.
// All dispatch/persistence is handled by the API route.

import { randomBytes } from 'crypto';

const LANE_LABELS = {
  'digital-diamond': 'Digital Diamond AI',
  'managed-by-mika': 'Managed by Mika',
  'medai':           'MedAI',
  'cannaops':        'CannaOps',
  'hotel-hooker':    'The Hotel Hooker',
  'ai-twin':         'AI Twin Studio',
};

// 9 governed steps in execution order.
// stageId keys match STAGE_TO_FILENAME in saveContentArtifact.js.
// pipelineStage places each task on the ContentPipelineBoard.
export const PACKAGE_STEPS = [
  { key: 'research',  label: 'Research Brief',       taskType: 'Research',         stageId: 'trend_research',     pipelineStage: 'brief'  },
  { key: 'hooks',     label: 'Hook Options',          taskType: 'Hook Creation',    stageId: 'hook_generation',    pipelineStage: 'script' },
  { key: 'script',    label: 'Short-Form Script',     taskType: 'Script Creation',  stageId: 'script_generation',  pipelineStage: 'script' },
  { key: 'caption',   label: 'Caption',               taskType: 'Content',          stageId: 'caption_generation', pipelineStage: 'script' },
  { key: 'cta',       label: 'CTA Copy',              taskType: 'Content',          stageId: 'cta_creation',       pipelineStage: 'script' },
  { key: 'thumbnail', label: 'Thumbnail Prompt',      taskType: 'Image Generation', stageId: 'thumbnail_generation', pipelineStage: 'review' },
  { key: 'video',     label: 'Video Prompt',          taskType: 'Video Prompting',  stageId: 'visual_prompting',   pipelineStage: 'review' },
  { key: 'repurpose', label: 'Repurpose Ideas',       taskType: 'Repurposing',      stageId: 'repurposing',        pipelineStage: 'review' },
  { key: 'checklist', label: 'Publishing Checklist',  taskType: 'Content Strategy', stageId: 'content_strategy',   pipelineStage: 'review' },
];

export const PACKAGE_STEP_COUNT = PACKAGE_STEPS.length; // 9

/**
 * Build a content package plan from validated inputs.
 * Returns packageId and an array of task specs (not yet persisted).
 */
export function createContentPackagePlan({ lane, topic, platform, contentType, audience, goal, tone, notes = '' }) {
  const laneLabel = LANE_LABELS[lane] || lane;
  const packageId = `pkg-${Date.now()}-${randomBytes(3).toString('hex')}`;
  const now       = new Date().toISOString();
  const dateStr   = new Date().toLocaleDateString();

  const contextBlock = buildContext({ laneLabel, platform, contentType, topic, audience, goal, tone, notes, dateStr });

  const taskSpecs = PACKAGE_STEPS.map((step, index) => ({
    id:            `${packageId}-${step.key}`,
    source:        'content-factory',
    packageId,
    lane,
    platform,
    contentType,
    contentGoal:   goal,
    taskType:      step.taskType,
    title:         `${step.label} — ${platform} · ${laneLabel}`,
    description:   buildStepDescription(step, index, contextBlock, { platform, goal, contentType }),
    stageId:       step.stageId,
    workflowId:    packageId,
    pipelineStage: step.pipelineStage,
    stepKey:       step.key,
    stepLabel:     step.label,
    stepIndex:     index,
    priority:      'Normal',
    status:        'pending',
    createdAt:     now,
    updatedAt:     now,
  }));

  return { packageId, taskSpecs };
}

function buildContext({ laneLabel, platform, contentType, topic, audience, goal, tone, notes, dateStr }) {
  const lines = [
    `CONTENT FACTORY PACKAGE`,
    `${'─'.repeat(52)}`,
    `Brand:         ${laneLabel}`,
    `Platform:      ${platform}`,
    `Content Type:  ${contentType}`,
    `Topic / Idea:  ${topic}`,
    `Audience:      ${audience}`,
    `Goal:          ${goal}`,
    `Tone:          ${tone}`,
  ];
  if (notes) lines.push(`Notes:         ${notes}`);
  lines.push(``, `[ MIKA AGENTIC OS™ · Content Factory · ${dateStr} ]`);
  return lines.join('\n');
}

const STEP_DIRECTIVES = {
  research:  (_, { platform, contentType }) =>
    `Conduct research on the topic below for a ${contentType} on ${platform}. Provide: key insights, 3–5 relevant trends, statistical hooks, audience pain points, and competitor angles. Output a structured research brief ready for content creation.`,
  hooks:     (_, { platform }) =>
    `Write 4 scroll-stopping hook variations for the content brief below, optimised for ${platform}. Each hook must be under 10 seconds when spoken. Include: a pattern interrupt, a bold claim, a curiosity gap variant, and a story opener. Format each as a standalone line.`,
  script:    (_, { platform, contentType }) =>
    `Write a tight short-form script (under 60 seconds spoken) for ${platform} in ${contentType} format. Structure: 1) Hook, 2) Body (3 key points max), 3) CTA. Include timing markers. Keep it punchy — cut every word that doesn't earn its place.`,
  caption:   (_, { platform }) =>
    `Write a compelling caption for ${platform} optimised for reach and saves. Structure: hook sentence (first line pulls the algorithm), body copy, relevant emojis, and a hashtag block (mix of niche + broad tags). Keep within platform character limits.`,
  cta:       (_, { goal }) =>
    `Write 3 CTA (call-to-action) variations driving "${goal}". Vary urgency: soft, medium, and hard CTA. Each CTA must be under 2 sentences and work as a standalone post addition or end-screen text.`,
  thumbnail: (_, { platform }) =>
    `Create a detailed AI image prompt for a ${platform} thumbnail. Specify: composition, subject placement, colour palette (brand-aligned, high contrast for small screens), text overlay suggestion, emotional energy, and style direction (photographic / illustrated / 3D / typographic).`,
  video:     (_, { platform }) =>
    `Create a detailed AI video prompt for a ${platform} short-form video. Specify: opening scene, visual sequence (max 5 beats), on-screen text timing, B-roll suggestions, mood, colour grade, and a one-sentence director's note on pacing.`,
  repurpose: () =>
    `Identify 5 repurposing opportunities for the content below. For each: target platform, format (carousel, reel, newsletter, article, audio clip, etc.), key angle adaptation, estimated effort (S/M/L), and recommended posting window.`,
  checklist: (_, { platform }) =>
    `Create a pre-publish checklist for this content package. Cover: content quality checks, SEO and caption optimisation for ${platform}, scheduling recommendations, platform-specific upload requirements, and 3 post-publish engagement actions to take within the first hour.`,
};

function buildStepDescription(step, index, contextBlock, opts) {
  const directive = STEP_DIRECTIVES[step.key]?.(step, opts)
    ?? `Complete the ${step.label} task for the content package below.`;

  return [
    `TASK: ${step.label.toUpperCase()}`,
    `Step ${index + 1} of ${PACKAGE_STEP_COUNT} in Content Factory Package`,
    ``,
    directive,
    ``,
    `── CONTEXT ─────────────────────────────────────────────────`,
    contextBlock,
  ].join('\n');
}
