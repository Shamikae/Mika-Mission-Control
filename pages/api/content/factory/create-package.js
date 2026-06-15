// POST /api/content/factory/create-package
// Validates input → builds 9-task package plan → persists tasks + queue entries
// Returns package manifest with dispatch previews and approval summary.
// DOES NOT call providers. All execution is through the existing dispatch system.

import fs from 'fs';
import path from 'path';
import { loadQueue } from '../../../../lib/queue/loadQueue';
import { addToQueue } from '../../../../lib/queue/saveQueue';
import { sendTelegramMessage } from '../../../../lib/telegram/sendTelegramMessage';
import { dispatchTask } from '../../../../lib/dispatch/dispatchTask';
import { createContentPackagePlan, PACKAGE_STEP_COUNT } from '../../../../lib/content/createContentPackagePlan';

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
};

const DATA_FILE = path.join(process.cwd(), 'data', 'tasks.json');

const VALID_LANES         = ['digital-diamond', 'managed-by-mika', 'medai', 'cannaops', 'hotel-hooker', 'ai-twin'];
const VALID_PLATFORMS     = ['TikTok', 'Instagram', 'YouTube Shorts', 'LinkedIn', 'Blog'];
const VALID_CONTENT_TYPES = ['educational', 'trend', 'tutorial', 'UGC', 'offer', 'story', 'listicle'];
const VALID_GOALS         = ['awareness', 'engagement', 'lead', 'sale', 'authority'];

const LANE_LABELS = {
  'digital-diamond': 'Digital Diamond AI',
  'managed-by-mika': 'Managed by Mika',
  'medai':           'MedAI',
  'cannaops':        'CannaOps',
  'hotel-hooker':    'The Hotel Hooker',
  'ai-twin':         'AI Twin Studio',
};

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

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { lane, topic, platform, contentType, audience, goal, tone, notes } = req.body || {};

  if (!lane || !VALID_LANES.includes(lane)) {
    return res.status(400).json({ error: `Invalid lane. Valid: ${VALID_LANES.join(', ')}.` });
  }
  if (!topic || typeof topic !== 'string' || !topic.trim()) {
    return res.status(400).json({ error: 'topic is required.' });
  }
  if (topic.trim().length > 500) {
    return res.status(400).json({ error: 'topic must be 500 characters or fewer.' });
  }
  if (!platform || !VALID_PLATFORMS.includes(platform)) {
    return res.status(400).json({ error: `Invalid platform. Valid: ${VALID_PLATFORMS.join(', ')}.` });
  }
  if (!contentType || !VALID_CONTENT_TYPES.includes(contentType)) {
    return res.status(400).json({ error: `Invalid contentType. Valid: ${VALID_CONTENT_TYPES.join(', ')}.` });
  }
  if (!audience || typeof audience !== 'string' || !audience.trim()) {
    return res.status(400).json({ error: 'audience is required.' });
  }
  if (!goal || !VALID_GOALS.includes(goal)) {
    return res.status(400).json({ error: `Invalid goal. Valid: ${VALID_GOALS.join(', ')}.` });
  }
  if (!tone || typeof tone !== 'string' || !tone.trim()) {
    return res.status(400).json({ error: 'tone is required.' });
  }

  const { packageId, taskSpecs } = createContentPackagePlan({
    lane,
    topic:       topic.trim(),
    platform,
    contentType,
    audience:    audience.trim(),
    goal,
    tone:        tone.trim(),
    notes:       typeof notes === 'string' ? notes.trim() : '',
  });

  // Persist tasks — prepend so newest appear first in /api/tasks/list
  const existing = readTasks();
  writeTasks([...taskSpecs, ...existing].slice(0, 500));

  // Queue + dispatch preview each task
  let runningQueue = loadQueue();
  const queueItems       = [];
  const dispatchPreviews = {};

  for (const task of taskSpecs) {
    const qi = addToQueue(task, runningQueue);
    queueItems.push(qi);
    runningQueue = [qi, ...runningQueue];

    try {
      const preview = dispatchTask({
        taskId:       task.id,
        taskType:     task.taskType,
        laneId:       lane,
        title:        task.title,
        instructions: task.description,
        priority:     'Normal',
      });
      dispatchPreviews[task.id] = {
        stepKey:          task.stepKey,
        stepLabel:        task.stepLabel,
        executableNow:    preview.executableNow,
        approvalRequired: preview.approvalRequired,
        nextAction:       preview.nextAction,
        selectedAgent:    preview.selectedAgent
          ? { id: preview.selectedAgent.id, displayName: preview.selectedAgent.displayName }
          : null,
        reason:           preview.reason || null,
      };
    } catch {
      dispatchPreviews[task.id] = {
        stepKey:          task.stepKey,
        stepLabel:        task.stepLabel,
        executableNow:    false,
        approvalRequired: true,
        nextAction:       'MANUAL_REVIEW',
      };
    }
  }

  const previewList = Object.values(dispatchPreviews);
  const approvalSummary = {
    total:            PACKAGE_STEP_COUNT,
    executableNow:    previewList.filter(p => p.executableNow).length,
    requiresApproval: previewList.filter(p => p.approvalRequired).length,
    staged:           previewList.filter(p => p.nextAction === 'STAGED_DISPLAY_ONLY').length,
  };

  const laneLabel = LANE_LABELS[lane] || lane;
  const tgMsg = [
    `<b>📦 Content Factory Package Created</b>`,
    ``,
    `Brand:    ${laneLabel}`,
    `Platform: ${platform}  ·  ${contentType}`,
    `Goal:     ${goal}`,
    ``,
    `<b>${PACKAGE_STEP_COUNT} tasks queued</b>`,
    `${approvalSummary.executableNow} executable · ${approvalSummary.requiresApproval} need approval · ${approvalSummary.staged} staged`,
    ``,
    `<i>${topic.trim().slice(0, 120)}${topic.trim().length > 120 ? '…' : ''}</i>`,
    ``,
    `<code>${packageId}</code>`,
  ].join('\n');
  sendTelegramMessage(tgMsg).catch(() => {});

  return res.status(201).json({
    packageId,
    tasks:           taskSpecs,
    queueItems,
    dispatchPreviews,
    approvalSummary,
  });
}
