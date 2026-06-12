// pages/api/content/brief/create.js
// Phase E.1 — Content Brief API
//
// POST — create a structured content task from a content brief form.
//
// Unlike /api/tasks/create, this endpoint:
//  • Accepts content-specific task types (Trend Research, Script Creation, etc.)
//  • Stores platform, contentGoal, contentType as structured fields
//  • Calls dispatchTask() to attach a preview route decision
//  • Tags the task with source: 'content-brief' for filtering
//
// Input:
//   { lane, platform, contentGoal, contentType, audience, tone, urgency,
//     primaryOffer, instructions, approvalRequired }
//
// Output:
//   { taskId, task, queueId, dispatchPreview }

import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { loadQueue } from '../../../../lib/queue/loadQueue';
import { addToQueue } from '../../../../lib/queue/saveQueue';
import { sendTelegramMessage } from '../../../../lib/telegram/sendTelegramMessage';
import { dispatchTask } from '../../../../lib/dispatch/dispatchTask';

const DATA_FILE = path.join(process.cwd(), 'data', 'tasks.json');

// ── Task type mapping ─────────────────────────────────────────────────────────
// Maps content form type → dispatch task type (used by routing/task-routing.json)

const CONTENT_TYPE_TO_TASK_TYPE = {
  'Trend post':       'Trend Research',
  'Educational post': 'Script Creation',
  'Storytelling post':'Content Strategy',
  'AI twin video':    'Video Prompting',
  'UGC ad concept':   'Hook Creation',
  'Carousel':         'Script Creation',
  'Short-form video': 'Script Creation',
  'Long-form script': 'Script Creation',
  'Repurposing pack': 'Repurposing',
};

const VALID_LANES = [
  'digital-diamond', 'managed-by-mika', 'medai',
  'cannaops', 'hotel-hooker', 'ai-twin',
];

const VALID_PLATFORMS = ['TikTok', 'Instagram', 'LinkedIn', 'YouTube', 'Pinterest', 'X / Twitter', 'Blog', 'Podcast'];

const VALID_CONTENT_TYPES = Object.keys(CONTENT_TYPE_TO_TASK_TYPE);

const VALID_PRIORITIES = ['Low', 'Normal', 'High'];

const LANE_LABELS = {
  'digital-diamond': 'Digital Diamond AI',
  'managed-by-mika': 'Managed by Mika',
  'medai':           'MedAI',
  'cannaops':        'CannaOps',
  'hotel-hooker':    'The Hotel Hooker',
  'ai-twin':         'AI Twin Studio',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function buildDescription({ lane, platform, contentGoal, contentType, audience, tone, primaryOffer, instructions }) {
  const laneLabel = LANE_LABELS[lane] || lane;
  const taskType  = CONTENT_TYPE_TO_TASK_TYPE[contentType] || 'Content';
  const sep       = '─'.repeat(52);

  const lines = [
    `CONTENT BRIEF — ${platform} · ${laneLabel}`,
    sep,
    '',
    `Platform:          ${platform}`,
    `Brand:             ${laneLabel}`,
    `Goal:              ${contentGoal}`,
    `Content Type:      ${contentType}`,
    `Task Route:        ${taskType}`,
  ];

  if (audience?.trim()) lines.push(`Target Audience:   ${audience.trim()}`);
  if (tone?.trim())     lines.push(`Tone:              ${tone.trim()}`);
  if (primaryOffer?.trim()) {
    lines.push('');
    lines.push(`Primary Offer:     ${primaryOffer.trim()}`);
  }
  if (instructions?.trim()) {
    lines.push('');
    lines.push('Instructions:');
    lines.push(instructions.trim());
  }

  lines.push('');
  lines.push(`[ MIKA AGENTIC OS™ · Content Brief · ${new Date().toLocaleDateString()} ]`);

  return lines.join('\n');
}

function buildTelegramMessage(task, dispatchPreview) {
  const laneLabel  = LANE_LABELS[task.lane] || task.lane;
  const agentName  = dispatchPreview?.selectedAgent?.displayName || 'routing...';
  const executable = dispatchPreview?.executableNow ? 'EXECUTABLE NOW' : 'STAGED / PENDING ACTIVATION';

  return [
    `<b>Content Brief Queued</b>`,
    ``,
    `Brand:    ${laneLabel}`,
    `Platform: ${task.platform}`,
    `Type:     ${task.contentType}`,
    `Goal:     ${task.contentGoal}`,
    `Agent:    ${agentName} · ${executable}`,
    ``,
    `<i>Open Mission Control → Agent Dispatch → Approve</i>`,
  ].join('\n');
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    lane, platform, contentGoal, contentType, audience,
    tone, urgency, primaryOffer, instructions, approvalRequired,
  } = req.body || {};

  // ── Validate ──────────────────────────────────────────────────────────────
  if (!lane || !VALID_LANES.includes(lane)) {
    return res.status(400).json({ error: 'Invalid or missing lane' });
  }
  if (!platform || !VALID_PLATFORMS.includes(platform)) {
    return res.status(400).json({ error: 'Invalid or missing platform' });
  }
  if (!contentGoal?.trim()) {
    return res.status(400).json({ error: 'contentGoal is required' });
  }
  if (!contentType || !VALID_CONTENT_TYPES.includes(contentType)) {
    return res.status(400).json({ error: `Invalid contentType. Valid: ${VALID_CONTENT_TYPES.join(', ')}` });
  }

  const priority = VALID_PRIORITIES.includes(urgency) ? urgency : 'Normal';
  const taskType = CONTENT_TYPE_TO_TASK_TYPE[contentType];

  // ── Build task ────────────────────────────────────────────────────────────
  const id          = `brief-${Date.now()}-${randomBytes(3).toString('hex')}`;
  const now         = new Date().toISOString();
  const description = buildDescription({ lane, platform, contentGoal, contentType, audience, tone, primaryOffer, instructions });

  const laneLabel   = LANE_LABELS[lane] || lane;
  const briefTitle  = `${contentType} — ${platform} · ${laneLabel}`;

  const task = {
    id,
    source:          'content-brief',
    lane,
    taskType,
    title:           briefTitle,
    platform,
    contentGoal,
    contentType,
    audience:        audience?.trim()      || '',
    tone:            tone?.trim()          || '',
    primaryOffer:    primaryOffer?.trim()  || '',
    instructions:    instructions?.trim()  || '',
    priority,
    approvalRequired: approvalRequired === true || approvalRequired === 'true',
    description,
    status:          'pending',
    createdAt:       now,
    updatedAt:       now,
  };

  // ── Persist ───────────────────────────────────────────────────────────────
  const tasks = readTasks();
  tasks.unshift(task);
  writeTasks(tasks.slice(0, 200));

  const queueEntry = addToQueue(task, loadQueue());

  // ── Dispatch preview (sync, non-blocking on error) ─────────────────────
  let dispatchPreview = null;
  try {
    dispatchPreview = dispatchTask({
      taskId:       id,
      taskType,
      laneId:       lane,
      title:        `${contentType} — ${platform} · ${LANE_LABELS[lane] || lane}`,
      instructions: description,
      priority,
    });
  } catch { /* non-critical */ }

  // ── Telegram (fire-and-forget) ────────────────────────────────────────────
  sendTelegramMessage(buildTelegramMessage(task, dispatchPreview)).catch(() => {});

  return res.status(201).json({
    taskId:          id,
    task,
    queueId:         queueEntry.queueId,
    dispatchPreview,
  });
}
