// POST /api/dispatch/stream
//
// Streams dispatch progress as NDJSON events (one JSON per line, \n-terminated).
// Uses the SAME governance chain as /api/dispatch/execute — no new execution path.
//
// Event sequence:
//   accepted          → task found and validated
//   checking_approval → reading queue approval state
//   approval_required → gate blocked; stream ends
//   resolving_agent   → dispatchTask() ran; routing determined
//   selected_agent    → which agent will execute (or why execution is blocked)
//   executing         → about to call executeDispatch()
//   complete          → execution finished ok
//   error             → gate blocked, staged, or execution failed
//
// SECURITY:
//   • rawResponse is never emitted (contains potential stderr / session IDs)
//   • Errors use result.errorSummary (pre-sanitised via sanitizeHermesError)
//   • No env vars, paths, hostnames, tokens, or usernames are emitted
//   • All execution goes through the existing executeDispatch() — no new engine
//
// GOVERNANCE:
//   • Approval gate:      identical to execute.js — reads loadQueue()
//   • Runtime health:     enforced inside dispatchTask() + executeDispatch()
//   • Staged agent guard: enforced inside executeDispatch()
//   • Status guard:       only 'pending' tasks proceed

import fs   from 'fs';
import path from 'path';
import { dispatchTask }      from '../../../lib/dispatch/dispatchTask';
import { executeDispatch }   from '../../../lib/dispatch/executeDispatch';
import { appendDispatchLog } from '../../../lib/dispatch/dispatchLog';
import { buildMemoryEntry, appendLaneMemory } from '../../../lib/memory/saveLaneMemory';
import { loadLaneMemory }    from '../../../lib/memory/loadLaneMemory';
import { saveContentArtifact } from '../../../lib/content-artifacts/saveContentArtifact';
import { sendTelegramMessage } from '../../../lib/telegram/sendTelegramMessage';
import { loadQueue }         from '../../../lib/queue/loadQueue';

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

// ── Safe NDJSON emitter ───────────────────────────────────────────────────────
// rawResponse is intentionally NEVER emitted — it can contain stderr / sessionId.

function emit(res, event, data) {
  try {
    res.write(JSON.stringify({ event, data, ts: new Date().toISOString() }) + '\n');
  } catch {
    // Client disconnected — silently ignore
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { taskId } = req.body || {};

  if (!taskId || typeof taskId !== 'string') {
    return res.status(400).json({ ok: false, error: 'taskId is required' });
  }

  // ── Set up NDJSON streaming ───────────────────────────────────────────────
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Accel-Buffering', 'no');       // nginx: disable response buffering
  res.setHeader('Transfer-Encoding', 'chunked');

  // Detect client disconnection so subsequent writes are skipped
  let clientGone = false;
  req.on('close', () => { clientGone = true; });

  function safeEmit(event, data) {
    if (clientGone) return;
    emit(res, event, data);
  }

  // ── 1. Load and validate task ─────────────────────────────────────────────
  const tasks = readTasks();
  const task  = tasks.find(t => t.id === taskId);

  if (!task) {
    safeEmit('error', { code: 'not_found', message: `Task ${taskId} not found.` });
    return res.end();
  }

  if (task.status !== 'pending') {
    safeEmit('error', {
      code:    'invalid_status',
      message: `Task status is "${task.status}" — only pending tasks can be dispatched.`,
    });
    return res.end();
  }

  safeEmit('accepted', {
    taskId:   task.id,
    title:    task.title || task.taskType,
    taskType: task.taskType,
    lane:     task.lane,
  });

  // ── 2. Approval gate ──────────────────────────────────────────────────────
  safeEmit('checking_approval', {
    approvalRequired: task.approvalRequired === true,
  });

  const approvalGranted = loadQueue().some(entry =>
    entry.taskId === taskId &&
    entry.approved === true &&
    ['approved', 'dispatched', 'completed'].includes(entry.status)
  );

  if (task.approvalRequired && !approvalGranted) {
    safeEmit('approval_required', {
      reason: 'This task requires human approval before execution. Use the Telegram approval flow.',
    });
    return res.end();
  }

  // ── 3. Routing preview (dispatchTask is read-only — safe to call early) ───
  safeEmit('resolving_agent', { taskType: task.taskType, laneId: task.lane });

  const preview = dispatchTask({
    taskId:       task.id,
    taskType:     task.taskType,
    laneId:       task.lane,
    title:        task.title || String(task.description || task.taskType).slice(0, 80),
    instructions: task.description || task.instructions || '',
    priority:     task.priority || 'Normal',
  });

  if (preview.selectedAgent) {
    safeEmit('selected_agent', {
      agentId:       preview.selectedAgent.id,
      displayName:   preview.selectedAgent.displayName,
      executionMode: preview.selectedAgent.executionMode,
      executableNow: preview.executableNow,
    });
  }

  // If the preview already says not executable, bail before touching task status.
  // executeDispatch will enforce this again — this is an early exit for stream UX.
  if (!preview.executableNow) {
    const isStaged = preview.selectedAgent?.status === 'staged';
    safeEmit('error', {
      code:    isStaged ? 'staged' : 'not_executable',
      message: preview.reason,
    });
    return res.end();
  }

  // ── 4. Mark task running and begin execution ──────────────────────────────
  const dispatchedAt = new Date().toISOString();
  updateTask(taskId, { status: 'running', dispatchedAt, dispatchMethod: 'engine' });

  safeEmit('executing', {
    agentId:       preview.selectedAgent?.id,
    executionMode: preview.selectedAgent?.executionMode,
  });

  // ── 5. Execute via existing dispatch engine ───────────────────────────────
  let result;
  try {
    result = await executeDispatch(task, { approvalGranted });
  } catch (err) {
    updateTask(taskId, { status: 'failed', dispatchError: err.message });
    safeEmit('error', {
      code:    'execution_error',
      message: 'Execution failed unexpectedly. Check dispatch logs for details.',
    });
    return res.end();
  }

  // ── 6. Determine final status and persist ─────────────────────────────────
  let finalStatus;
  switch (result.executionStatus) {
    case 'success':         finalStatus = 'complete'; break;
    case 'staged':          finalStatus = 'pending';  break;
    case 'manual_required': finalStatus = 'pending';  break;
    default:                finalStatus = 'failed';
  }

  const taskPatch = {
    status:         finalStatus,
    completedAt:    finalStatus === 'complete' ? new Date().toISOString() : undefined,
    dispatchMethod: 'engine',
    dispatchTarget: result.executionTarget,
    executionMode:  result.executionMode,
    dispatchError:  result.error || undefined,
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

  updateTask(taskId, taskPatch);

  // ── 7. Best-effort side-effects (identical to execute.js) ─────────────────
  if (result.ok && result.output && task.lane) {
    try {
      appendLaneMemory(
        task.lane,
        buildMemoryEntry(task, result.output),
        loadLaneMemory(task.lane)
      );
    } catch { /* best-effort */ }
  }

  const canSaveArtifact = task.workflowId && task.stageId &&
    (task.source === 'workflow-child' || task.source === 'thumbnail-studio' || task.source === 'content-factory');
  if (result.ok && result.output && canSaveArtifact) {
    try {
      saveContentArtifact({
        laneId:     task.lane,
        workflowId: task.workflowId,
        stageId:    task.stageId,
        taskId:     task.id,
        content:    result.output,
        metadata: {
          workflowId:    task.workflowId,
          parentBriefId: task.parentBriefId || null,
          platform:      task.platform      || null,
          contentGoal:   task.contentGoal   || null,
          contentType:   task.contentType   || null,
          source:        task.source        || null,
          packageId:     task.packageId     || null,
        },
      });
    } catch { /* best-effort */ }
  }

  try {
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
      executionStatus:  result.executionStatus,
      executionMode:    result.executionMode,
      executionTarget:  result.executionTarget,
      outputSummary:    result.outputSummary,
      errorSummary:     result.errorSummary,
      via:              'stream',
    });
  } catch { /* best-effort */ }

  try {
    const agentLabel = result.decision?.selectedAgent?.displayName || result.executionTarget || 'Unknown';
    const tgMsg = result.ok
      ? `<b>Task Dispatched via Stream</b>\n\nType:  ${task.taskType}\nAgent: ${agentLabel}\nMode:  ${result.executionMode}`
      : `<b>Stream Dispatch Failed</b>\n\nType:  ${task.taskType}\nError: ${(result.errorSummary || 'Unknown').slice(0, 100)}`;
    sendTelegramMessage(tgMsg).catch(() => {});
  } catch { /* best-effort */ }

  // ── 8. Final stream event ─────────────────────────────────────────────────
  if (result.ok) {
    safeEmit('complete', {
      executionStatus:  result.executionStatus,
      executionTarget:  result.executionTarget,
      executionMode:    result.executionMode,
      output:           result.output       || null,
      outputSummary:    result.outputSummary || null,
      // rawResponse intentionally omitted — may contain stderr / session IDs
    });
  } else {
    // Use errorSummary: already sanitised by sanitizeHermesError inside the adapters.
    // Never emit result.error directly — rawResponse / full error may contain secrets.
    safeEmit('error', {
      code:    result.executionStatus || 'failed',
      message: result.errorSummary || 'Execution did not succeed.',
    });
  }

  return res.end();
}
