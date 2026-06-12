// pages/api/workflows/viral-content/status.js
// GET ?briefId=<id> OR ?workflowId=<id>
// Returns the workflow instance enriched with live task statuses.

import fs from 'fs';
import path from 'path';
import { loadWorkflowByBriefId, loadWorkflowInstance, saveWorkflowInstance } from '../../../../lib/workflows/loadViralContentWorkflow';

const TASKS_FILE = path.join(process.cwd(), 'data', 'tasks.json');

function loadTasks() {
  try {
    const d = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf-8'));
    return Array.isArray(d) ? d : (d.tasks || []);
  } catch { return []; }
}

function enrichWorkflow(workflow) {
  if (!workflow?.stages?.length) return workflow;
  const tasks = loadTasks();
  const tasksByStage = {};
  for (const t of tasks) {
    if (t.workflowId === workflow.workflowId && t.stageId) {
      tasksByStage[t.stageId] = t;
    }
  }

  let changed = false;
  const stages = workflow.stages.map(stage => {
    const task = tasksByStage[stage.stageId];
    if (!task) return stage;

    const newStatus = task.status === 'complete' ? 'complete'
      : task.status === 'failed' ? 'failed'
      : (task.status === 'running' || task.status === 'dispatched') ? 'in_progress'
      : (task.status === 'queued' || task.status === 'pending') ? 'dispatched'
      : stage.status;

    if (newStatus !== stage.status || stage.childTaskId !== task.id) {
      changed = true;
      return {
        ...stage,
        status: newStatus,
        childTaskId: task.id,
        completedAt: task.completedAt || stage.completedAt,
        updatedAt: new Date().toISOString(),
      };
    }
    return stage;
  });

  if (changed) {
    const updated = { ...workflow, stages, updatedAt: new Date().toISOString() };
    saveWorkflowInstance(updated);
    return updated;
  }
  return workflow;
}

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { briefId, workflowId } = req.query;

  if (!briefId && !workflowId) {
    return res.status(400).json({ error: 'briefId or workflowId is required' });
  }

  let workflow = null;
  if (workflowId) {
    workflow = loadWorkflowInstance(workflowId);
  } else if (briefId) {
    workflow = loadWorkflowByBriefId(briefId);
  }

  if (!workflow) {
    return res.status(404).json({ exists: false, workflow: null });
  }

  return res.status(200).json({ exists: true, workflow: enrichWorkflow(workflow) });
}
