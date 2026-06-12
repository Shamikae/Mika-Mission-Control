import fs from 'fs';
import path from 'path';
import { callOpenClaw } from '../../../lib/openclaw/callOpenClaw';
import { loadBusinessLaneContext } from '../../../lib/context/loadBusinessLaneContext';
import { loadLaneMemory } from '../../../lib/memory/loadLaneMemory';
import { buildMemoryEntry, appendLaneMemory } from '../../../lib/memory/saveLaneMemory';
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

  if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
  if (!task.hermesOutput) {
    return res.status(400).json({ success: false, error: 'No Hermes output found — run Hermes dispatch first' });
  }

  const ctx = loadBusinessLaneContext(task.lane);

  const systemContent = [
    ctx ? `LANE: ${ctx.displayName}\nMISSION: ${ctx.mission}\nVOICE: ${ctx.voice}` : '',
    'You are synthesizing research from a specialized research agent (Hermes) into actionable insights.',
    'Review the research output and provide a concise synthesis: key findings, strategic recommendations, and concrete next steps.',
    'Be direct and specific. Align every recommendation with the business lane context above.',
  ].filter(Boolean).join('\n\n');

  const userContent = [
    'SYNTHESIS REQUEST — Mika Mission Control',
    '',
    `Original Task: ${task.description}`,
    `Lane: ${task.lane}    Type: ${task.taskType}`,
    '',
    'HERMES RESEARCH OUTPUT:',
    task.hermesOutput,
    '',
    'Synthesize this into actionable insights for the business lane above.',
  ].join('\n');

  const result = await callOpenClaw({
    messages:   [
      { role: 'system', content: systemContent },
      { role: 'user',   content: userContent   },
    ],
    maxTokens:  800,
    sessionKey: ctx?.sessionKey,
  });

  const reply   = result.body?.choices?.[0]?.message?.content ?? null;
  const success = result.ok && reply !== null;

  const synthError = result.error
    ?? (!result.ok ? `HTTP ${result.httpStatus}` : null)
    ?? (!reply     ? 'No synthesis reply from OpenClaw' : null);

  const updatedTask = updateTask(taskId, {
    openclawSynthesis:      reply,
    openclawSynthesisError: success ? null : synthError,
    openclawSynthesisAt:    new Date().toISOString(),
  });

  // Persist synthesis to lane memory (best-effort)
  if (success && reply) {
    appendLaneMemory(task.lane, buildMemoryEntry(task, reply), loadLaneMemory(task.lane));
    sendTelegramMessage(
      `<b>OpenClaw Synthesis Complete</b>\n\nLane: ${task.lane}\n\n<i>${reply.slice(0, 200)}${reply.length > 200 ? '...' : ''}</i>`
    ).catch(() => {});
  }

  return res.status(200).json({
    success,
    taskId,
    synthesis: reply,
    error:     success ? null : synthError,
    task:      updatedTask,
  });
}
