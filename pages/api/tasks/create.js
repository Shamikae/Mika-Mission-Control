import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { loadQueue } from '../../../lib/queue/loadQueue';
import { addToQueue } from '../../../lib/queue/saveQueue';
import { sendTelegramMessage } from '../../../lib/telegram/sendTelegramMessage';
import { formatQueuedMessage } from '../../../lib/telegram/formatMessages';

const DATA_FILE = path.join(process.cwd(), 'data', 'tasks.json');

const VALID_LANES = [
  'digital-diamond', 'managed-by-mika', 'medai',
  'cannaops', 'hotel-hooker', 'ai-twin',
];

const VALID_TASK_TYPES = [
  'Research', 'Content', 'Lead Recovery',
  'Automation', 'Client Delivery', 'System Maintenance',
];

const VALID_PRIORITIES = ['Low', 'Normal', 'High'];

const LANE_LABELS = {
  'digital-diamond': 'Digital Diamond AI',
  'managed-by-mika': 'Managed by Mika',
  'medai':           'MedAI',
  'cannaops':        'CannaOps',
  'hotel-hooker':    'The Hotel Hooker',
  'ai-twin':         'AI Twin Studio',
};

function autoTitle(taskType, lane) {
  return `${taskType} — ${LANE_LABELS[lane] || lane}`;
}

function readTasks() {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return [];
  }
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

  const { lane, taskType, priority, approvalRequired, description, title } = req.body || {};

  if (!lane || !VALID_LANES.includes(lane)) {
    return res.status(400).json({ error: 'Invalid or missing lane' });
  }
  if (!taskType || !VALID_TASK_TYPES.includes(taskType)) {
    return res.status(400).json({ error: 'Invalid or missing taskType' });
  }
  if (!priority || !VALID_PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: 'Invalid or missing priority' });
  }
  if (!description || !String(description).trim()) {
    return res.status(400).json({ error: 'Description is required' });
  }

  const id = `task-${Date.now()}-${randomBytes(3).toString('hex')}`;
  const now = new Date().toISOString();

  const task = {
    id,
    lane,
    taskType,
    title: (title?.trim()) || autoTitle(taskType, lane),
    priority,
    approvalRequired: approvalRequired === true || approvalRequired === 'true',
    description: String(description).trim(),
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };

  const tasks = readTasks();
  tasks.unshift(task);
  writeTasks(tasks.slice(0, 200));

  const queueEntry = addToQueue(task, loadQueue());

  // Fire-and-forget — never block the response or throw
  sendTelegramMessage(formatQueuedMessage(task)).catch(() => {});

  return res.status(201).json({ taskId: id, task, queueId: queueEntry.queueId });
}
