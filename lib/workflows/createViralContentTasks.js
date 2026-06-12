// lib/workflows/createViralContentTasks.js
// SERVER-SIDE ONLY.
//
// Given an approved content brief task, creates 7 child tasks — one per
// workflow stage — and enqueues each one. Returns the full workflow instance.
//
// Each child task:
//   • Has parentBriefId and workflowId for traceability
//   • Routes through the Dispatch Engine (dispatch preview attached)
//   • Starts as status: 'pending' — never auto-executed
//   • Requires human approval before dispatch (or follows stage approvalRequired)

import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { getWorkflowStages, saveWorkflowInstance } from './loadViralContentWorkflow';
import { loadQueue } from '../queue/loadQueue';
import { addToQueue } from '../queue/saveQueue';
import { dispatchTask } from '../dispatch/dispatchTask';

const DATA_FILE = path.join(process.cwd(), 'data', 'tasks.json');

// ── Task store helpers ────────────────────────────────────────────────────────

function readTasks() {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch { return []; }
}

function writeTasks(tasks) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(tasks, null, 2));
}

function updateParentTask(briefTaskId, patch, tasks) {
  const idx = tasks.findIndex(t => t.id === briefTaskId);
  if (idx !== -1) {
    tasks[idx] = { ...tasks[idx], ...patch, updatedAt: new Date().toISOString() };
  }
}

// ── Brief context extractor ───────────────────────────────────────────────────

const LANE_LABELS = {
  'digital-diamond': 'Digital Diamond AI',
  'managed-by-mika': 'Managed by Mika',
  'medai':           'MedAI',
  'cannaops':        'CannaOps',
  'hotel-hooker':    'The Hotel Hooker',
  'ai-twin':         'AI Twin Studio',
};

function extractBriefContext(briefTask) {
  return {
    brand:        LANE_LABELS[briefTask.lane] || briefTask.lane,
    lane:         briefTask.lane,
    platform:     briefTask.platform     || 'TikTok',
    contentGoal:  briefTask.contentGoal  || 'Grow audience',
    contentType:  briefTask.contentType  || 'Short-form video',
    audience:     briefTask.audience     || '',
    tone:         briefTask.tone         || '',
    primaryOffer: briefTask.primaryOffer || '',
    priority:     briefTask.priority     || 'Normal',
  };
}

// ── Child task description builders ──────────────────────────────────────────
// Each builder produces a structured description that agents can act on.
// Context from the parent brief is embedded so agents have full background.

function buildContext(ctx, briefId) {
  const lines = [
    `Parent Brief: ${briefId}`,
    `Brand: ${ctx.brand}`,
    `Platform: ${ctx.platform}`,
    `Goal: ${ctx.contentGoal}`,
    `Content Type: ${ctx.contentType}`,
  ];
  if (ctx.audience)     lines.push(`Audience: ${ctx.audience}`);
  if (ctx.tone)         lines.push(`Tone: ${ctx.tone}`);
  if (ctx.primaryOffer) lines.push(`Primary Offer: ${ctx.primaryOffer}`);
  return lines.join('\n');
}

const DESCRIPTION_BUILDERS = {
  trend_research: (ctx, briefId) => [
    `VIRAL WORKFLOW — TREND RESEARCH`,
    buildContext(ctx, briefId),
    ``,
    `TASK: Research current trending topics, sounds, content patterns, and viral formats on ${ctx.platform} relevant to "${ctx.contentGoal}" for ${ctx.brand}.`,
    ``,
    `Expected Output:`,
    `• 5-10 trending topics with engagement signals`,
    `• Recommended viral formats and sounds for ${ctx.platform}`,
    `• Opportunity analysis — which trends fit ${ctx.brand} voice`,
    `• Competitor content examples to reference`,
  ].join('\n'),

  hook_generation: (ctx, briefId) => [
    `VIRAL WORKFLOW — HOOK SET GENERATION`,
    buildContext(ctx, briefId),
    ``,
    `TASK: Generate 10 scroll-stopping hooks for ${ctx.platform} content targeting "${ctx.audience || ctx.contentGoal}" for ${ctx.brand}.`,
    ``,
    `Expected Output:`,
    `• 10 hooks designed to capture attention within 3 seconds`,
    `• A/B variants for top 3 hooks`,
    `• Pattern interrupts and curiosity-gap techniques`,
    `• Tone: ${ctx.tone || 'authentic and engaging'}`,
  ].join('\n'),

  content_strategy: (ctx, briefId) => [
    `VIRAL WORKFLOW — CONTENT STRATEGY`,
    buildContext(ctx, briefId),
    ``,
    `TASK: Develop the strategic direction for this content piece. Define how to best achieve "${ctx.contentGoal}" for ${ctx.brand} on ${ctx.platform}.`,
    ``,
    `Expected Output:`,
    `• Primary content angle and series concept`,
    `• Brand voice alignment notes for ${ctx.tone || 'the established brand voice'}`,
    `• Publishing cadence recommendation`,
    `• CTA strategy aligned to: ${ctx.primaryOffer || ctx.contentGoal}`,
    `• Repurposing opportunity brief`,
  ].join('\n'),

  script_generation: (ctx, briefId) => [
    `VIRAL WORKFLOW — SCRIPT GENERATION`,
    buildContext(ctx, briefId),
    ``,
    `TASK: Write a full content script for ${ctx.platform} using the approved hook and strategy. Format for ${ctx.contentType}.`,
    ``,
    `Expected Output:`,
    `• Opening hook (3-second grab)`,
    `• Body content — structured for ${ctx.platform} retention patterns`,
    `• Closing CTA driving to: ${ctx.primaryOffer || ctx.contentGoal}`,
    `• Platform-specific formatting (captions, pauses, visual cues)`,
    `• Word/time estimate`,
  ].join('\n'),

  visual_prompting: (ctx, briefId) => [
    `VIRAL WORKFLOW — VIDEO PROMPT GENERATION`,
    buildContext(ctx, briefId),
    ``,
    `TASK: Generate AI video and image generation prompts for this content piece. Prompts should be ready for Higgsfield, HeyGen, Veo, or Kling when those providers are activated.`,
    ``,
    `Expected Output:`,
    `• 3-5 AI video generation prompts (detailed, provider-agnostic)`,
    `• Visual direction brief (style, mood, colour palette)`,
    `• B-roll concept list`,
    `• Thumbnail/cover image prompt`,
    `• Brand aesthetic notes for ${ctx.brand}`,
    ``,
    `Note: Video generation providers not yet connected. These prompts are ready for activation.`,
  ].join('\n'),

  caption_generation: (ctx, briefId) => [
    `VIRAL WORKFLOW — CAPTION GENERATION`,
    buildContext(ctx, briefId),
    ``,
    `TASK: Write a platform-optimised caption for this ${ctx.platform} post for ${ctx.brand}.`,
    ``,
    `Expected Output:`,
    `• Primary caption (optimised for ${ctx.platform} algorithm)`,
    `• 3 caption variants (A/B testing)`,
    `• 3-5 hashtag sets`,
    String(ctx.platform || '').toLowerCase() === 'tiktok'
      ? `• CTA: comment-based lead capture guided by TikTok caption skill rules.`
      : `• CTA variants: ${ctx.primaryOffer ? `drive to "${ctx.primaryOffer}"` : 'engagement-focused'}`,
    `• Alt text if applicable`,
  ].join('\n'),

  repurposing: (ctx, briefId) => [
    `VIRAL WORKFLOW — REPURPOSING PACK`,
    buildContext(ctx, briefId),
    ``,
    `TASK: Repurpose this ${ctx.platform} content across all secondary platforms for ${ctx.brand}.`,
    ``,
    `Expected Output:`,
    `• LinkedIn: thought leadership version (reframe as insight)`,
    `• Twitter/X: thread format (5-7 tweets)`,
    `• Blog: long-form article outline (SEO-focused)`,
    `• Pinterest: pin copy + concept (5 pins)`,
    `• Podcast: segment outline or show notes`,
    `• Instagram: reel concept + carousel outline`,
  ].join('\n'),
};

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Create workflow child tasks for a content brief.
 * Writes tasks + queue entries + workflow instance file.
 * Does NOT execute any task automatically.
 *
 * @param {object} briefTask — task object from data/tasks.json
 * @returns {object} workflowInstance
 */
export function createViralContentTasks(briefTask) {
  const briefId    = briefTask.id;
  const ctx        = extractBriefContext(briefTask);
  const stages     = getWorkflowStages();
  const workflowId = `wf-viral-${Date.now()}-${randomBytes(3).toString('hex')}`;
  const now        = new Date().toISOString();

  const tasks   = readTasks();
  let   queue   = loadQueue();
  const stageResults = [];

  for (const stage of stages) {
    const taskId    = `wf-${stage.stageId.replace('_', '-')}-${Date.now()}-${randomBytes(3).toString('hex')}`;
    const descBuilder = DESCRIPTION_BUILDERS[stage.stageId];
    const description = descBuilder
      ? descBuilder(ctx, briefId)
      : `VIRAL WORKFLOW — ${stage.displayName.toUpperCase()}\nParent: ${briefId}\nBrand: ${ctx.brand} · Platform: ${ctx.platform}`;

    const topic = ctx.primaryOffer
      ? ctx.primaryOffer.slice(0, 40).trim()
      : ctx.contentGoal?.slice(0, 40).trim() || ctx.platform;
    const title = `${stage.displayName} — ${topic} · ${ctx.brand}`;

    const childTask = {
      id:              taskId,
      source:          'workflow-child',
      workflowId,
      workflowType:    'viral-content',
      parentBriefId:   briefId,
      stageId:         stage.stageId,
      stageName:       stage.displayName,
      stageOrder:      stage.order,
      lane:            ctx.lane,
      taskType:        stage.mappedTaskType,
      platform:        ctx.platform,
      priority:        ctx.priority,
      approvalRequired: stage.approvalRequired,
      description,
      title,
      status:          'pending',
      createdAt:       now,
      updatedAt:       now,
    };

    // Compute dispatch preview (sync, non-fatal)
    let dispatchPreview = null;
    try {
      dispatchPreview = dispatchTask({
        taskId,
        taskType:     stage.mappedTaskType,
        laneId:       ctx.lane,
        title,
        instructions: description,
        priority:     ctx.priority,
      });
    } catch { /* non-critical */ }

    // Add to task store
    tasks.unshift(childTask);

    // Add to queue
    const queueEntry = addToQueue(childTask, queue);
    queue = loadQueue(); // reload after each write

    stageResults.push({
      stageId:         stage.stageId,
      displayName:     stage.displayName,
      icon:            stage.icon,
      order:           stage.order,
      mappedTaskType:  stage.mappedTaskType,
      preferredAgentId: stage.preferredAgentId,
      fallbackAgentId: stage.fallbackAgentId,
      approvalRequired: stage.approvalRequired,
      color:           stage.color,
      taskId,
      queueId:         queueEntry.queueId,
      status:          'pending',
      dispatchPreview,
    });
  }

  // Update parent task with workflowId
  updateParentTask(briefId, { workflowId }, tasks);

  // Persist all tasks in one write (more efficient than per-task writes)
  writeTasks(tasks.slice(0, 500));

  // Build and persist workflow instance
  const workflowInstance = {
    workflowId,
    workflowType:  'viral-content',
    parentBriefId: briefId,
    lane:          ctx.lane,
    platform:      ctx.platform,
    contentGoal:   ctx.contentGoal,
    contentType:   ctx.contentType,
    audience:      ctx.audience,
    tone:          ctx.tone,
    status:        'active',
    stageCount:    stages.length,
    createdAt:     now,
    updatedAt:     now,
    stages:        stageResults,
  };

  saveWorkflowInstance(workflowInstance);

  return workflowInstance;
}
