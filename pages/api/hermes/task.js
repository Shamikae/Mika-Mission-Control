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
  return res.status(410).json({
    success: false,
    code: 'governed_dispatch_required',
    error: 'Direct Hermes task dispatch is retired. Use POST /api/dispatch/execute.',
  });
}
