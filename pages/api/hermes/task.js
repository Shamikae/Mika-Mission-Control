import fs from 'fs';
import path from 'path';
import { loadBusinessLaneContext } from '../../../lib/context/loadBusinessLaneContext';
import { createAgentHandoff } from '../../../lib/agents/createAgentHandoff';
import { sendTaskToHermes, getHermesConfig } from '../../../lib/hermes/sendTaskToHermes';
import { sendTelegramMessage } from '../../../lib/telegram/sendTelegramMessage';

const DATA_FILE = path.join(process.cwd(), 'data', 'tasks.json');

function readTasks() {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch { return []; }
}

function updateTask(taskId, patch) {
  const tasks = readTasks();
  const idx = tasks.findIndex(t => t.id === taskId);
  if (idx === -1) return null;
  tasks[idx] = { ...tasks[idx], ...patch, updatedAt: new Date().toISOString() };
  fs.writeFileSync(DATA_FILE, JSON.stringify(tasks, null, 2));
  return tasks[idx];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { taskId } = req.body || {};
  if (!taskId) return res.status(400).json({ success: false, error: 'taskId is required' });

  const tasks = readTasks();
  const task  = tasks.find(t => t.id === taskId);

  if (!task) return res.status(404).json({ success: false, error: `Task ${taskId} not found` });

  if (task.taskType !== 'Research') {
    return res.status(400).json({ success: false, error: 'Only Research tasks can be dispatched to Hermes' });
  }

  if (task.status !== 'pending') {
    return res.status(409).json({
      success: false,
      error:   `Task is already ${task.status} — only pending tasks can be dispatched`,
    });
  }

  const cfg            = getHermesConfig();
  const ctx            = loadBusinessLaneContext(task.lane);
  const contextSummary = ctx ? `${ctx.displayName}: ${ctx.mission.slice(0, 120)}` : '';

  const handoff = createAgentHandoff({
    targetAgent:    cfg.agentId,
    businessLane:   task.lane,
    taskType:       task.taskType,
    instructions:   task.description,
    contextSummary,
    expectedOutput: 'Structured research summary with key findings and recommended actions',
    returnToOpenClaw: process.env.AGENT_HANDOFF_ENABLED !== 'false',
  });

  // Mark running
  updateTask(taskId, {
    status:        'running',
    dispatchedAt:  new Date().toISOString(),
    dispatchTarget: 'hermes',
  });

  const result = await sendTaskToHermes(handoff);

  // Extract output — support various response shapes
  const output = result.body?.output
    ?? result.body?.result
    ?? result.body?.content
    ?? result.body?.choices?.[0]?.message?.content
    ?? null;

  const success     = result.ok && output !== null;
  const finalStatus = success ? 'complete' : 'failed';

  const hermesError = result.error
    ?? (!result.ok   ? `HTTP ${result.httpStatus}` : null)
    ?? (!output      ? 'No output in Hermes response' : null);

  const updatedTask = updateTask(taskId, {
    status:          finalStatus,
    hermesOutput:    output,
    hermesHandoff:   handoff,
    hermesResponse:  result.body,
    hermesStatus:    result.httpStatus,
    hermesError,
    hermesStubMode:  result.stubMode ?? false,
    dispatchTarget:  'hermes',
    completedAt:     new Date().toISOString(),
  });

  // Telegram (fire-and-forget)
  if (success && output) {
    const preview = output.slice(0, 150) + (output.length > 150 ? '...' : '');
    sendTelegramMessage(
      `<b>Hermes Research Complete</b>\n\nLane: ${task.lane}\nTask: ${task.description.slice(0, 60)}\n\n<i>${preview}</i>\n\nOpen Mission Control to synthesize with OpenClaw.`
    ).catch(() => {});
  } else if (hermesError && !result.stubMode) {
    sendTelegramMessage(
      `<b>Hermes Research Failed</b>\n\nLane: ${task.lane}\nError: ${hermesError.slice(0, 150)}`
    ).catch(() => {});
  }

  return res.status(200).json({
    success,
    taskId,
    status:      finalStatus,
    hermesOutput: output,
    hermesError,
    hermesStubMode: result.stubMode ?? false,
    handoffId:   handoff.handoffId,
    task:        updatedTask,
  });
}
