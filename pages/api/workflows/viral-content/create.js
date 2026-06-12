// pages/api/workflows/viral-content/create.js
// Phase E.2 — Viral Content Workflow creation endpoint.
//
// POST { contentBriefTaskId } → creates 7 workflow child tasks, returns instance.
//
// Guards:
//   • Only accepts tasks with source: 'content-brief'
//   • Refuses to create a second workflow if one already exists for this brief
//   • Never auto-executes child tasks

import fs from 'fs';
import path from 'path';
import { createViralContentTasks } from '../../../../lib/workflows/createViralContentTasks';
import { loadWorkflowByBriefId } from '../../../../lib/workflows/loadViralContentWorkflow';
import { sendTelegramMessage } from '../../../../lib/telegram/sendTelegramMessage';

const DATA_FILE = path.join(process.cwd(), 'data', 'tasks.json');

function readTasks() {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch { return []; }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { contentBriefTaskId } = req.body || {};

  if (!contentBriefTaskId) {
    return res.status(400).json({ error: 'contentBriefTaskId is required' });
  }

  // ── Load parent task ─────────────────────────────────────────────────────
  const tasks      = readTasks();
  const briefTask  = tasks.find(t => t.id === contentBriefTaskId);

  if (!briefTask) {
    return res.status(404).json({ error: `Task "${contentBriefTaskId}" not found` });
  }

  if (briefTask.source !== 'content-brief') {
    return res.status(400).json({
      error: `Task "${contentBriefTaskId}" is not a content brief (source: "${briefTask.source || 'unknown'}"). Viral workflows can only be started from content briefs.`,
    });
  }

  // ── Guard: no duplicate workflow ─────────────────────────────────────────
  const existing = loadWorkflowByBriefId(contentBriefTaskId) || (briefTask.workflowId ? { workflowId: briefTask.workflowId } : null);

  if (existing) {
    return res.status(409).json({
      error:      `A viral content workflow already exists for this brief.`,
      workflowId: existing.workflowId,
      workflow:   existing,
    });
  }

  // ── Create workflow ───────────────────────────────────────────────────────
  let workflowInstance;
  try {
    workflowInstance = createViralContentTasks(briefTask);
  } catch (err) {
    console.error('[viral-content/create]', err);
    return res.status(500).json({ error: err.message || 'Workflow creation failed' });
  }

  // ── Telegram notification (fire-and-forget) ────────────────────────────
  const laneLabels = {
    'digital-diamond': 'Digital Diamond AI', 'managed-by-mika': 'Managed by Mika',
    'medai': 'MedAI', 'cannaops': 'CannaOps',
    'hotel-hooker': 'The Hotel Hooker', 'ai-twin': 'AI Twin Studio',
  };
  const brand = laneLabels[briefTask.lane] || briefTask.lane;
  const executableStages = workflowInstance.stages.filter(s => s.dispatchPreview?.executableNow);

  sendTelegramMessage([
    `<b>Viral Content Workflow Started</b>`,
    ``,
    `Brand:    ${escapeHtml(brand)}`,
    `Platform: ${escapeHtml(workflowInstance.platform)}`,
    `Goal:     ${escapeHtml(workflowInstance.contentGoal)}`,
    `Stages:   ${workflowInstance.stageCount} tasks queued`,
    `Executable now: ${executableStages.length}/${workflowInstance.stageCount} stages`,
    ``,
    `<i>Open Agent Dispatch to approve and execute.</i>`,
  ].join('\n')).catch(() => {});

  return res.status(201).json({
    ok:              true,
    workflowId:      workflowInstance.workflowId,
    parentBriefId:   contentBriefTaskId,
    stageCount:      workflowInstance.stageCount,
    workflow:        workflowInstance,
    childTasks:      workflowInstance.stages.map(s => ({
      stageId:         s.stageId,
      displayName:     s.displayName,
      taskId:          s.taskId,
      queueId:         s.queueId,
      mappedTaskType:  s.mappedTaskType,
      approvalRequired: s.approvalRequired,
      executableNow:   s.dispatchPreview?.executableNow || false,
      selectedAgent:   s.dispatchPreview?.selectedAgent?.displayName || null,
      nextAction:      s.dispatchPreview?.nextAction || null,
    })),
  });
}
