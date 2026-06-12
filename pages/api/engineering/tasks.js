export const config = { api: { responseLimit: false, bodyParser: true } };
export const maxDuration = 300;

// pages/api/engineering/tasks.js
// GET  — list engineering tasks (all types or filtered by taskType)
// POST — create and dispatch a new engineering analysis task

import fs   from 'fs';
import path from 'path';
import { executeDispatch } from '../../../lib/dispatch/executeDispatch';
import { appendDispatchLog } from '../../../lib/dispatch/dispatchLog';

const DATA_FILE = path.join(process.cwd(), 'data', 'engineering-tasks.json');

const ENGINEERING_TASK_TYPES = ['code_architecture', 'code_review', 'refactor_plan', 'bug_diagnosis'];

const TASK_TYPE_LABELS = {
  code_architecture: 'Architecture Review',
  code_review:       'Code Review',
  refactor_plan:     'Refactor Plan',
  bug_diagnosis:     'Bug Diagnosis',
};

// ── File helpers ──────────────────────────────────────────────────────────────

function readTasks() {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return Array.isArray(raw) ? raw : (raw.tasks || []);
  } catch { return []; }
}

function writeTasks(tasks) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ tasks }, null, 2));
}

function generateId() {
  return `eng-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── Structured output prompt wrapper ─────────────────────────────────────────
// Appended to user instructions to request structured JSON from Claude Code.

function wrapWithStructuredPrompt(instructions, taskType) {
  return [
    instructions,
    '',
    '---',
    'Respond with valid JSON in exactly this format (no markdown, no code fences):',
    '{',
    '  "recommendation": "2-3 sentence main finding and recommendation",',
    '  "risks": ["risk or concern 1", "risk or concern 2"],',
    '  "architecture_notes": ["notable observation 1", "notable observation 2"],',
    `  "estimated_effort": "Small",`,
    '  "confidence_score": 80',
    '}',
    '',
    'estimated_effort values: Small | Medium | Large | XLarge',
    'confidence_score: integer 0-100',
  ].join('\n');
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleGet(req, res) {
  const { taskType, status, limit = 50 } = req.query;
  let tasks = readTasks();

  if (taskType && ENGINEERING_TASK_TYPES.includes(taskType)) {
    tasks = tasks.filter(t => t.taskType === taskType);
  }
  if (status) {
    tasks = tasks.filter(t => t.status === status);
  }

  const sorted = [...tasks].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return res.status(200).json({
    ok:    true,
    tasks: sorted.slice(0, Number(limit)),
    total: tasks.length,
    taskTypes: ENGINEERING_TASK_TYPES.map(t => ({ id: t, label: TASK_TYPE_LABELS[t] })),
  });
}

async function handlePost(req, res) {
  const { taskType, instructions, priority = 'Normal', title } = req.body || {};

  if (!taskType || !ENGINEERING_TASK_TYPES.includes(taskType)) {
    return res.status(400).json({
      ok: false,
      error: `Invalid taskType. Must be one of: ${ENGINEERING_TASK_TYPES.join(', ')}`,
    });
  }

  if (!instructions || !instructions.trim()) {
    return res.status(400).json({ ok: false, error: 'instructions is required' });
  }

  const taskId  = generateId();
  const now     = new Date().toISOString();
  const label   = TASK_TYPE_LABELS[taskType];
  const firstLine = instructions.trim().split('\n')[0].replace(/[^a-zA-Z0-9\s\-–—.,()]/g, '').trim().slice(0, 60);
  const taskTitle = title?.trim() || (firstLine.length > 8 ? `${label} — ${firstLine}` : `${label} — ${now.split('T')[0]}`);

  const task = {
    id:           taskId,
    taskType,
    title:        taskTitle,
    instructions: wrapWithStructuredPrompt(instructions.trim(), taskType),
    rawInstructions: instructions.trim(),
    priority,
    status:       'running',
    createdAt:    now,
    updatedAt:    now,
    result:       null,
    output:       null,
    parsedOutput: null,
    error:        null,
    executionMode: null,
    executionTarget: null,
    costUsd:      null,
    durationMs:   null,
  };

  // ── Persist as running ────────────────────────────────────────────────────
  const allTasks = readTasks();
  allTasks.unshift(task);
  writeTasks(allTasks);

  // ── Execute via dispatch ──────────────────────────────────────────────────
  let executionResult;
  try {
    executionResult = await executeDispatch(task);
  } catch (e) {
    executionResult = {
      ok: false,
      executionStatus: 'failed',
      error: e.message,
      output: null,
      rawResponse: null,
    };
  }

  // ── Try to parse structured JSON from output ──────────────────────────────
  let parsedOutput = null;
  const rawOutput = executionResult.output;
  if (rawOutput) {
    try {
      // Claude sometimes wraps JSON in markdown — strip it
      const cleaned = rawOutput.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
      parsedOutput = JSON.parse(cleaned);
    } catch {
      parsedOutput = null;
    }
  }

  // ── Update task record ────────────────────────────────────────────────────
  const finalStatus = executionResult.ok ? 'complete' : 'failed';
  const patch = {
    status:          finalStatus,
    updatedAt:       new Date().toISOString(),
    completedAt:     finalStatus === 'complete' ? new Date().toISOString() : null,
    output:          rawOutput || null,
    parsedOutput,
    error:           executionResult.error || null,
    executionMode:   executionResult.executionMode || null,
    executionTarget: executionResult.executionTarget || null,
    costUsd:         executionResult.rawResponse?.costUsd  || null,
    durationMs:      executionResult.rawResponse?.durationMs || null,
    decision:        executionResult.decision || null,
  };

  const current = readTasks();
  const idx     = current.findIndex(t => t.id === taskId);
  if (idx !== -1) {
    current[idx] = { ...current[idx], ...patch };
    writeTasks(current);
  }

  // ── Append dispatch log ───────────────────────────────────────────────────
  if (executionResult.decision) {
    appendDispatchLog({
      timestamp:       new Date().toISOString(),
      taskId,
      taskType,
      laneId:          'engineering',
      selectedAgentId: executionResult.decision.selectedAgent?.id || null,
      fallbackAgentId: executionResult.decision.fallbackAgent?.id || null,
      executableNow:   executionResult.decision.executableNow,
      approvalRequired: executionResult.decision.approvalRequired,
      decisionReason:  executionResult.decision.reason || '',
      executionStatus: executionResult.executionStatus || null,
      executionMode:   executionResult.executionMode   || null,
      executionTarget: executionResult.executionTarget || null,
      outputSummary:   executionResult.outputSummary   || null,
      errorSummary:    executionResult.errorSummary    || null,
    });
  }

  return res.status(200).json({
    ok:             executionResult.ok,
    task:           { ...task, ...patch },
    executionStatus: executionResult.executionStatus,
    executionTarget: executionResult.executionTarget,
    output:          rawOutput,
    parsedOutput,
    error:           executionResult.error || null,
    decision:        executionResult.decision || null,
  });
}

// ── Route ─────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method === 'GET')  return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}
