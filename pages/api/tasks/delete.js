import fs from 'fs';
import path from 'path';

const TASKS_FILE = path.join(process.cwd(), 'data', 'tasks.json');
const QUEUE_FILE = path.join(process.cwd(), 'queue', 'tasks-queue.json');

function readJsonArray(file) {
  try {
    if (!fs.existsSync(file)) return [];
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeJsonArray(file, entries) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(entries, null, 2));
}

export default function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { taskId } = req.body || {};
  if (!taskId) return res.status(400).json({ error: 'taskId is required' });

  const tasks = readJsonArray(TASKS_FILE);
  const existingTask = tasks.find(task => task.id === taskId);
  if (!existingTask) return res.status(404).json({ error: `Task ${taskId} not found` });

  if (existingTask.status === 'running') {
    return res.status(409).json({ error: 'Running tasks cannot be deleted' });
  }

  const nextTasks = tasks.filter(task => task.id !== taskId);
  writeJsonArray(TASKS_FILE, nextTasks);

  const queue = readJsonArray(QUEUE_FILE);
  const nextQueue = queue.filter(item => item.taskId !== taskId);
  if (nextQueue.length !== queue.length) writeJsonArray(QUEUE_FILE, nextQueue);

  return res.status(200).json({
    success: true,
    taskId,
    removedQueueItems: queue.length - nextQueue.length,
  });
}
