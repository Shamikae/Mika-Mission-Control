// pages/api/dispatch/execute.js
// Phase D.2 — Dispatch Execution Bridge endpoint.
//
// POST — execute a queued task through the Agent Dispatch Engine.
//
// Input:  { taskId }
// Output: { ok, executionStatus, executionTarget, output, error, decision, task }
//
// Flow: Queue → Dispatch Decision → executeDispatch() → Agent → Memory/Logs/Telegram

import fs from 'fs';
import path from 'path';
import { executeDispatch } from '../../../lib/dispatch/executeDispatch';
import { appendDispatchLog } from '../../../lib/dispatch/dispatchLog';
import { buildMemoryEntry, appendLaneMemory } from '../../../lib/memory/saveLaneMemory';
import { loadLaneMemory } from '../../../lib/memory/loadLaneMemory';
import { sendTelegramMessage } from '../../../lib/telegram/sendTelegramMessage';
import { saveContentArtifact } from '../../../lib/content-artifacts/saveContentArtifact';
import { loadQueue } from '../../../lib/queue/loadQueue';

const DATA_FILE = path.join(process.cwd(), 'data', 'tasks.json');

// ── Task store helpers ────────────────────────────────────────────────────────

function readTasks() {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch { return []; }
}

function updateTask(taskId, patch) {
  const tasks = readTasks();
  const idx   = tasks.findIndex(t => t.id === taskId);
  if (idx === -1) return null;
  tasks[idx] = { ...tasks[idx], ...patch, updatedAt: new Date().toISOString() };
  fs.writeFileSync(DATA_FILE, JSON.stringify(tasks, null, 2));
  return tasks[idx];
}

// ── Telegram message builder ──────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildTelegramMessage(task, result) {
  const laneLabels = {
    'digital-diamond': 'Digital Diamond AI',
    'managed-by-mika': 'Managed by Mika',
    'medai':           'MedAI',
    'cannaops':        'CannaOps',
    'hotel-hooker':    'The Hotel Hooker',
    'ai-twin':         'AI Twin Content Studio',
    'lead-recovery':   'Lead Recovery',
  };
  const laneLabel  = laneLabels[task.lane] || task.lane;
  const agentName  = result.decision?.selectedAgent?.displayName || result.executionTarget || 'Unknown';

  if (result.executionStatus === 'staged') {
    return [
      `<b>Dispatch — Staged Agent</b>`,
      ``,
      `Lane:  ${laneLabel}`,
      `Type:  ${task.taskType}`,
      `Agent: ${agentName}`,
      ``,
      `<i>${escapeHtml(result.error || 'Agent is staged — activation required.')}</i>`,
    ].join('\n');
  }

  if (!result.ok) {
    return [
      `<b>Dispatch Failed</b>`,
      ``,
      `Lane:   ${laneLabel}`,
      `Type:   ${task.taskType}`,
      `Agent:  ${agentName}`,
      `Error:  ${escapeHtml((result.error || 'Unknown error').slice(0, 150))}`,
    ].join('\n');
  }

  const outputPreview = result.outputSummary || '';
  return [
    `<b>Task Dispatched via Engine</b>`,
    ``,
    `Lane:  ${laneLabel}`,
    `Type:  ${task.taskType}`,
    `Agent: ${agentName} (${result.executionTarget})`,
    `Mode:  ${result.executionMode}`,
    ``,
    outputPreview ? `<i>${escapeHtml(outputPreview)}</i>` : '<i>(no output preview)</i>',
  ].join('\n');
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { taskId } = req.body || {};

  if (!taskId) {
    return res.status(400).json({ ok: false, error: 'taskId is required' });
  }

  // ── 1. Load task ──────────────────────────────────────────────────────────
  const tasks = readTasks();
  const task  = tasks.find(t => t.id === taskId);

  if (!task) {
    return res.status(404).json({ ok: false, error: `Task ${taskId} not found` });
  }

  if (task.status !== 'pending') {
    return res.status(409).json({
      ok:    false,
      error: `Task is already "${task.status}" — only pending tasks can be dispatched`,
    });
  }

  // ── 2. Mark running ───────────────────────────────────────────────────────
  const dispatchedAt = new Date().toISOString();
  updateTask(taskId, { status: 'running', dispatchedAt, dispatchMethod: 'engine' });

  // ── 3. Execute via dispatch engine ────────────────────────────────────────
  let result;
  try {
    const approvalGranted = loadQueue().some(entry =>
      entry.taskId === taskId &&
      entry.approved === true &&
      ['approved', 'dispatched', 'completed'].includes(entry.status)
    );
    result = await executeDispatch(task, { approvalGranted });
  } catch (err) {
    updateTask(taskId, { status: 'failed', dispatchError: err.message });
    return res.status(500).json({ ok: false, error: err.message });
  }

  // ── 4. Determine final status and build task patch ────────────────────────
  let finalStatus;
  switch (result.executionStatus) {
    case 'success':         finalStatus = 'complete'; break;
    case 'staged':          finalStatus = 'pending';  break; // revert — not dispatched
    case 'manual_required': finalStatus = 'pending';  break;
    default:                finalStatus = 'failed';
  }

  const taskPatch = {
    status:          finalStatus,
    completedAt:     finalStatus === 'complete' ? new Date().toISOString() : undefined,
    dispatchMethod:  'engine',
    dispatchTarget:  result.executionTarget,
    executionMode:   result.executionMode,
    dispatchError:   result.error || undefined,
    // Preserve existing field conventions
    ...(result.executionTarget === 'openclaw' ? {
      openclawReply:    result.output,
      openclawResponse: result.rawResponse,
      openclawStatus:   result.httpStatus,
      openclawError:    result.error || undefined,
    } : {}),
    ...(result.executionTarget === 'hermes' ? {
      hermesOutput:   result.output,
      hermesResponse: result.rawResponse,
      hermesError:    result.error || undefined,
      hermesStubMode: false,
      dispatchTarget: 'hermes',
    } : {}),
  };

  const updatedTask = updateTask(taskId, taskPatch);

  // ── 5. Persist memory on success ─────────────────────────────────────────
  if (result.ok && result.output && task.lane) {
    try {
      appendLaneMemory(
        task.lane,
        buildMemoryEntry(task, result.output),
        loadLaneMemory(task.lane)
      );
    } catch { /* memory is best-effort */ }
  }

  // ── 5b. Save content artifact for workflow-child tasks ───────────────────
  let artifactSaved = null;
  if (result.ok && result.output && task.source === 'workflow-child' && task.workflowId && task.stageId) {
    try {
      artifactSaved = saveContentArtifact({
        laneId:     task.lane,
        workflowId: task.workflowId,
        stageId:    task.stageId,
        taskId:     task.id,
        content:    result.output,
        metadata: {
          workflowId:   task.workflowId,
          parentBriefId:task.parentBriefId || null,
          platform:     task.platform      || null,
          contentGoal:  task.contentGoal   || null,
          contentType:  task.contentType   || null,
        },
      });
    } catch { /* non-critical — never block execution */ }
  }

  // ── 6. Write dispatch log with execution fields ───────────────────────────
  appendDispatchLog({
    timestamp:        result.timestamp,
    taskId,
    taskType:         task.taskType,
    laneId:           task.lane,
    selectedAgentId:  result.decision?.selectedAgent?.id || null,
    fallbackAgentId:  result.decision?.fallbackAgent?.id || null,
    executableNow:    result.decision?.executableNow || false,
    approvalRequired: result.decision?.approvalRequired || false,
    decisionReason:   result.decision?.reason || '',
    // Execution fields
    executionStatus:  result.executionStatus,
    executionMode:    result.executionMode,
    executionTarget:  result.executionTarget,
    outputSummary:    result.outputSummary,
    errorSummary:     result.errorSummary,
  });

  // ── 7. Telegram notification (fire-and-forget) ────────────────────────────
  sendTelegramMessage(buildTelegramMessage(task, result)).catch(() => {});

  // ── 8. Return result ──────────────────────────────────────────────────────
  return res.status(200).json({
    ok:              result.ok,
    taskId,
    executionStatus: result.executionStatus,
    executionMode:   result.executionMode,
    executionTarget: result.executionTarget,
    selectedSkill:   result.selectedSkill || null,
    output:          result.output,
    outputSummary:   result.outputSummary,
    error:           result.error,
    warnings:        result.decision?.warnings || [],
    decision:        result.decision,
    task:            updatedTask,
    artifactSaved,
    timestamp:       result.timestamp,
  });
}
