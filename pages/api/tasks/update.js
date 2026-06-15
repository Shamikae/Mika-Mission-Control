// PATCH /api/tasks/update
// Updates pipelineStage on a task record.
// Allowed stages are the 5 Phase-B pipeline columns only.
// Body: { id: string, pipelineStage: string }

import fs   from 'fs';
import path from 'path';

const DATA_FILE     = path.join(process.cwd(), 'data', 'tasks.json');
const ALLOWED_STAGES = new Set(['inbox', 'brief', 'script', 'review', 'published']);

export default function handler(req, res) {
  if (req.method !== 'PATCH') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id, pipelineStage } = req.body || {};

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'id is required' });
  }
  if (!pipelineStage || !ALLOWED_STAGES.has(pipelineStage)) {
    return res.status(400).json({
      error: `pipelineStage must be one of: ${[...ALLOWED_STAGES].join(', ')}`,
    });
  }

  try {
    if (!fs.existsSync(DATA_FILE)) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const raw   = fs.readFileSync(DATA_FILE, 'utf8');
    const tasks = JSON.parse(raw);

    if (!Array.isArray(tasks)) {
      return res.status(500).json({ error: 'Task store corrupted' });
    }

    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Task not found' });
    }

    tasks[idx] = {
      ...tasks[idx],
      pipelineStage,
      updatedAt: new Date().toISOString(),
    };

    fs.writeFileSync(DATA_FILE, JSON.stringify(tasks, null, 2));

    return res.status(200).json({ ok: true, task: tasks[idx] });
  } catch {
    return res.status(500).json({ error: 'Failed to update task' });
  }
}
