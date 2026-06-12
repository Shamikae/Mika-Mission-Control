// lib/workflows/loadViralContentWorkflow.js
// SERVER-SIDE ONLY — uses fs.
// Loads and queries the viral content workflow definition.

import path from 'path';
import fs from 'fs';

const WORKFLOW_PATH = path.join(process.cwd(), 'workflows', 'viral-content-workflow.json');
const WORKFLOWS_DIR = path.join(process.cwd(), 'data', 'workflows');

let _cache = null;

export function loadViralContentWorkflow() {
  if (_cache) return _cache;
  try {
    _cache = JSON.parse(fs.readFileSync(WORKFLOW_PATH, 'utf-8'));
    return _cache;
  } catch {
    return { stages: [] };
  }
}

export function getWorkflowStages() {
  return loadViralContentWorkflow().stages || [];
}

export function getStageById(stageId) {
  return getWorkflowStages().find(s => s.stageId === stageId) || null;
}

// ── Workflow instance store ────────────────────────────────────────────────────

function ensureDir() {
  if (!fs.existsSync(WORKFLOWS_DIR)) fs.mkdirSync(WORKFLOWS_DIR, { recursive: true });
}

export function saveWorkflowInstance(instance) {
  ensureDir();
  fs.writeFileSync(
    path.join(WORKFLOWS_DIR, `${instance.workflowId}.json`),
    JSON.stringify(instance, null, 2)
  );
}

export function loadWorkflowInstance(workflowId) {
  try {
    const file = path.join(WORKFLOWS_DIR, `${workflowId}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch { return null; }
}

export function loadWorkflowByBriefId(briefId) {
  ensureDir();
  try {
    const files = fs.readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
    for (const file of files) {
      try {
        const wf = JSON.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, file), 'utf-8'));
        if (wf.parentBriefId === briefId) return wf;
      } catch { /* skip */ }
    }
  } catch { /* dir may be empty */ }
  return null;
}

export function updateWorkflowStageStatus(workflowId, stageId, patch) {
  const wf = loadWorkflowInstance(workflowId);
  if (!wf) return null;
  const idx = wf.stages.findIndex(s => s.stageId === stageId);
  if (idx === -1) return null;
  wf.stages[idx] = { ...wf.stages[idx], ...patch, updatedAt: new Date().toISOString() };
  wf.updatedAt = new Date().toISOString();
  saveWorkflowInstance(wf);
  return wf;
}
