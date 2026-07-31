// lib/dispatch/executeDispatch.js
// Phase D.2 — Dispatch Execution Bridge.
//
// SERVER-SIDE ONLY. Never import from React components.
// This uses Node.js modules (fs, child_process via hermes/chat.js).
//
// Architecture:
//   Queue → dispatchTask() → executeDispatch() → OpenClaw / Hermes adapter
//
// executeDispatch() does NOT update task state or write logs.
// The caller (pages/api/dispatch/execute.js) owns those side-effects.
// This keeps the execution core testable and composable.

import fs   from 'fs';
import path from 'path';
import { dispatchTask } from './dispatchTask';
import { callOpenClaw } from '../openclaw/callOpenClaw';
import { sendHermesChatMessage } from '../hermes/chat';
import { loadBusinessLaneContext } from '../context/loadBusinessLaneContext';
import { loadLaneMemory, formatMemoryBlock } from '../memory/loadLaneMemory';
import { saveImageArtifact } from '../image-artifacts/saveImageArtifact.js';
import openartAdapter from '../../adapters/openart.adapter.js';
import { getSkillPrompt, validateSkill } from '../agents/loadSkill';
import claudeCodeAdapter from '../../adapters/claude-code.adapter.js';

// ── Staged agent guard ────────────────────────────────────────────────────────
// These agents have no live adapter. Attempting to execute them must never
// reach the network layer — the dispatch decision already marks them as
// executableNow:false, but we double-guard here for safety.

const STAGED_AGENT_IDS = new Set([
  'claude-code', 'codex', 'specialist-placeholder',
  'trend-hunter', 'pattern-hunter', 'hook-engineer',
  'creative-director', 'content-architect', 'prompt-engineer',
  'visual-designer', 'video-producer', 'voice-producer',
  'editor', 'publisher', 'analytics-agent',
]);

// Checks adapter-activation-state.json — gate-approved agents bypass staged guard.
function isGateActivated(agentId) {
  try {
    const state = JSON.parse(fs.readFileSync(
      path.join(process.cwd(), 'data', 'adapter-activation-state.json'), 'utf8'
    ));
    return state.overrides?.[agentId]?.status === 'active';
  } catch { return false; }
}

// ── Claude Code execution adapter ────────────────────────────────────────────
// Analysis-only mode: --tools "" disables all tool use. No file writes.

async function executeViaClaudeCode(task, decision) {
  let result;
  try {
    result = await claudeCodeAdapter.execute(task, decision);
  } catch (e) {
    return {
      ok:               false,
      executionStatus:  'failed',
      executionMode:    'local-cli',
      executionTarget:  'claude-code',
      selectedSkill:    { agentId: 'claude-code', skillId: null, loaded: false, engine: 'local-cli' },
      output:           null,
      outputSummary:    null,
      error:            e.message,
      errorSummary:     e.message.slice(0, 120),
      httpStatus:       null,
      rawResponse:      null,
      decision,
      timestamp:        new Date().toISOString(),
    };
  }

  const output   = result.output || null;
  const ok       = result.ok && !!output;
  const errorMsg = ok ? null : (result.error || 'No output from Claude Code');

  return {
    ok,
    executionStatus:  ok ? 'success' : 'failed',
    executionMode:    'local-cli',
    executionTarget:  'claude-code',
    selectedSkill:    { agentId: 'claude-code', skillId: null, loaded: false, engine: 'local-cli' },
    output,
    outputSummary:    output ? output.slice(0, 150) + (output.length > 150 ? '…' : '') : null,
    error:            errorMsg,
    errorSummary:     errorMsg ? errorMsg.slice(0, 120) : null,
    httpStatus:       null,
    rawResponse: {
      costUsd:     result.costUsd    || null,
      durationMs:  result.durationMs || null,
      sessionId:   result.sessionId  || null,
      mode:        result.mode       || null,
      analysisOnly: true,
    },
    decision,
    timestamp:        new Date().toISOString(),
  };
}

// ── Instruction builder (OpenClaw) ────────────────────────────────────────────
// Mirrors the instruction format used in pages/api/openclaw/task.js.
// Lane context and rolling memory are injected into the system message.

const LANE_LABELS = {
  'digital-diamond': 'Digital Diamond AI',
  'managed-by-mika': 'Managed by Mika',
  'medai':           'MedAI',
  'cannaops':        'CannaOps',
  'hotel-hooker':    'The Hotel Hooker',
  'ai-twin':         'AI Twin Content Studio',
  'lead-recovery':   'Lead Recovery',
};

function buildOpenClawMessages(task) {
  const laneId    = task.lane || task.laneId;
  const laneLabel = LANE_LABELS[laneId] || laneId || 'General';

  let systemContent = [
    'You are an AI agent operating within Mika Mission Control.',
    'Process the following task and respond with your plan, key actions, and expected outcome.',
    'Be concise and structured.',
  ].join(' ');

  // Inject lane context
  const ctx = loadBusinessLaneContext(laneId);
  if (ctx) {
    const ctxBlock = [
      `LANE: ${ctx.displayName}`,
      `MISSION: ${ctx.mission}`,
      `VOICE: ${ctx.voice}`,
      `FOCUS: ${ctx.contentFocus}`,
      ctx.operatingInstructions.length
        ? `RULES: ${ctx.operatingInstructions.join(' | ')}`
        : '',
    ].filter(Boolean).join('\n');
    systemContent = `${ctxBlock}\n\n${systemContent}`;
  }

  // Inject rolling memory
  const memory   = loadLaneMemory(laneId);
  const memBlock = formatMemoryBlock(memory, 5);
  if (memBlock) {
    systemContent = `${systemContent}\n\n${memBlock}`;
  }

  const userContent = [
    'TASK DISPATCH — Mika Mission Control',
    '',
    `Lane:              ${laneLabel}`,
    `Type:              ${task.taskType}`,
    `Priority:          ${task.priority || 'Normal'}`,
    `Approval Required: ${task.approvalRequired ? 'Yes' : 'No'}`,
    `Task ID:           ${task.id || task.taskId || 'unknown'}`,
    `Dispatched via:    Agent Dispatch Engine (Phase D.2)`,
    `Dispatched at:     ${new Date().toISOString()}`,
    '',
    'Instructions:',
    task.description || task.instructions || '(no instructions provided)',
  ].join('\n');

  return [
    { role: 'system', content: systemContent },
    { role: 'user',   content: userContent   },
  ];
}

// ── Message builder (Hermes) ──────────────────────────────────────────────────
// Formats a task as a structured chat message for the Hermes SSH bridge.
// When skillPrompt is provided, it is prepended to shape specialist behaviour.

function buildHermesMessage(task, skillPrompt = null) {
  const laneId    = task.lane || task.laneId;
  const laneLabel = LANE_LABELS[laneId] || laneId || 'General';
  const ctx       = loadBusinessLaneContext(laneId);
  const mission   = ctx?.mission ? `\nMission: ${ctx.mission.slice(0, 120)}` : '';

  const taskBlock = [
    `[TASK DISPATCH via Agent Dispatch Engine]`,
    ``,
    `Lane: ${laneLabel}${mission}`,
    `Task Type: ${task.taskType}`,
    `Priority: ${task.priority || 'Normal'}`,
    `Task ID: ${task.id || task.taskId}`,
    ``,
    `Instructions:`,
    task.description || task.instructions || '(no instructions provided)',
    ``,
    `Respond according to the skill context above. Use the specified output format exactly.`,
  ].join('\n');

  // Skill context is prepended so it shapes the entire response
  if (skillPrompt) {
    return `${skillPrompt}\n\n${taskBlock}`;
  }

  // No skill: generic fallback instruction
  return [
    ...taskBlock.split('\n').slice(0, -1), // drop last line
    `Please process this task and provide a structured response with key findings and recommended actions.`,
  ].join('\n');
}

// ── Execution adapters ────────────────────────────────────────────────────────

async function executeViaOpenClaw(task, decision) {
  const laneId     = task.lane || task.laneId;
  const ctx        = loadBusinessLaneContext(laneId);
  const messages   = buildOpenClawMessages(task);
  const model      = process.env.OPENCLAW_MODEL || 'gpt-4o';
  const sessionKey = ctx?.sessionKey;

  const result = await callOpenClaw({ messages, model, maxTokens: 600, sessionKey });

  const reply  = result.body?.choices?.[0]?.message?.content ?? null;
  const ok     = result.ok && reply !== null;
  const output = reply;

  const errorMsg = result.error
    ?? (!result.ok ? `HTTP ${result.httpStatus}` : null)
    ?? (!reply     ? 'No reply in response choices' : null);

  return {
    ok,
    executionStatus:  ok ? 'success' : 'failed',
    executionMode:    decision.selectedAgent?.executionMode || 'gateway',
    executionTarget:  'openclaw',
    selectedSkill:    null,
    output,
    outputSummary:    output ? output.slice(0, 150) + (output.length > 150 ? '…' : '') : null,
    error:            ok ? null : errorMsg,
    errorSummary:     errorMsg ? errorMsg.slice(0, 120) : null,
    httpStatus:       result.httpStatus,
    rawResponse:      result.body,
    decision,
    timestamp:        new Date().toISOString(),
  };
}

async function executeViaHermes(task, decision) {
  // ── Skill injection ─────────────────────────────────────────────────────────
  // Determine the intended specialist agent. When Hermes is executing as a
  // fallback for a staged specialist, the specialist's ID is in fallbackAgent
  // (because usingFallback=true swaps the object fields — see dispatchTask.js).
  // When Hermes is the primary agent, there is no specialist skill to inject.

  const intendedAgentId = decision.usingFallback
    ? decision.fallbackAgent?.id   // the staged specialist Hermes is standing in for
    : decision.selectedAgent?.id;  // hermes itself (no specialist skill needed)

  const skillPrompt     = getSkillPrompt(intendedAgentId) || null;
  const skillValidation = validateSkill(intendedAgentId);

  const selectedSkill = {
    agentId:   intendedAgentId || null,
    skillId:   skillValidation.skillId,
    loaded:    skillValidation.exists && !!skillPrompt,
    engine:    'hermes',
  };

  const message  = buildHermesMessage(task, skillPrompt);
  const chatMode = process.env.HERMES_CHAT_MODE || 'cli';
  const result   = await sendHermesChatMessage(message, { session: null });

  const output  = result.reply || null;
  const ok      = result.ok && !!output;
  const errorMsg = result.error ?? (!output ? 'No output from Hermes' : null);

  return {
    ok,
    executionStatus:  ok ? 'success' : 'failed',
    executionMode:    `ssh-http:${chatMode}`,
    executionTarget:  'hermes',
    selectedSkill,
    output,
    outputSummary:    output ? output.slice(0, 150) + (output.length > 150 ? '…' : '') : null,
    error:            ok ? null : errorMsg,
    errorSummary:     errorMsg ? errorMsg.slice(0, 120) : null,
    httpStatus:       null,
    rawResponse:      { reply: result.reply, sessionId: result.sessionId, stderr: result.stderr },
    decision,
    timestamp:        new Date().toISOString(),
  };
}

// ── OpenArt execution adapter ─────────────────────────────────────────────────
// Calls openartAdapter.execute() (governed MCP generation pipeline) and
// branches on its `status` field. Only 'completed' carries image Buffers —
// prompt_selection_required / budget_exceeded / failed / cancelled / timed_out
// are expected, honest non-success outcomes, not generic failures.
// Note: file writes here are an intentional exception to the no-side-effects rule
// because transporting large image Buffers through the result chain is wasteful.
// Provider CDN/resource URLs never appear in rawResponse — only local
// artifact metadata (filenames, sizes) does, once saveImageArtifact runs.

const OPENART_SKILL = { agentId: 'openart', skillId: null, loaded: false, engine: 'http-api' };

function openArtResult({ ok, executionStatus, error, output, rawResponse, imageFiles, decision }) {
  return {
    ok,
    executionStatus,
    executionMode:  'http-api',
    executionTarget: 'openart',
    selectedSkill:  OPENART_SKILL,
    output:         output || null,
    outputSummary:  output || null,
    error:          error || null,
    errorSummary:   error ? error.slice(0, 120) : null,
    httpStatus:     null,
    rawResponse:    rawResponse || null,
    imageFiles:     imageFiles || [],
    decision,
    timestamp:      new Date().toISOString(),
  };
}

async function executeViaOpenArt(task, decision) {
  const laneId     = task.lane || task.laneId || 'general';
  const workflowId = task.workflowId || task.id || task.taskId;

  let adapterResult;
  try {
    adapterResult = await openartAdapter.execute(task, decision);
  } catch (e) {
    const errMsg        = e.message || 'OpenArt execution failed';
    const isUnconfigured = errMsg.includes('not configured') || errMsg.includes('OPENART_ENABLED');
    return openArtResult({
      ok: false,
      executionStatus: isUnconfigured ? 'staged' : 'failed',
      error: errMsg,
      decision,
    });
  }

  // ── Non-terminal / non-success governance outcomes ─────────────────────────
  // These never reach OpenArt's paid generation step (prompt_selection_required)
  // or intentionally stop before it (budget_exceeded) — never routed to Hermes.

  if (adapterResult.status === 'prompt_selection_required') {
    return openArtResult({
      ok: false,
      executionStatus: 'prompt_selection_required',
      error: 'Prompt selection required before generation. Resubmit with selectedPrompt.',
      rawResponse: {
        originalPrompt:    adapterResult.originalPrompt,
        polishedPromptA:   adapterResult.polishedPromptA,
        polishedPromptB:   adapterResult.polishedPromptB,
        choices:           adapterResult.choices,
        enhancementMethod: adapterResult.enhancementMethod,
      },
      decision,
    });
  }

  if (adapterResult.status === 'budget_exceeded') {
    return openArtResult({
      ok: false,
      executionStatus: 'budget_exceeded',
      error: adapterResult.error,
      rawResponse: {
        estimatedCredits:  adapterResult.estimatedCredits,
        maxOpenArtCredits: adapterResult.maxOpenArtCredits,
        model:             adapterResult.model,
        mode:              adapterResult.mode,
        originalPrompt:    adapterResult.originalPrompt,
        finalPrompt:       adapterResult.finalPrompt,
      },
      decision,
    });
  }

  // ── Generation was submitted (and possibly charged credits) but did not
  // complete successfully. Marked failed with retry-relevant metadata —
  // never silently routed to Hermes now that OpenArt owns this attempt.
  if (adapterResult.status === 'failed' || adapterResult.status === 'cancelled' || adapterResult.status === 'timed_out') {
    return openArtResult({
      ok: false,
      executionStatus: 'failed',
      error: adapterResult.error || `OpenArt generation ${adapterResult.status}.`,
      rawResponse: {
        historyId:         adapterResult.historyId || null,
        model:             adapterResult.model || null,
        mode:              adapterResult.mode || null,
        estimatedCredits:  adapterResult.estimatedCredits ?? null,
        openartStatus:     adapterResult.status,
        originalPrompt:    adapterResult.originalPrompt || null,
        finalPrompt:       adapterResult.finalPrompt || null,
      },
      decision,
    });
  }

  // ── Completed — save image bytes to persistent artifact storage ────────────
  let imageFiles = [];
  try {
    imageFiles = saveImageArtifact({
      laneId,
      workflowId,
      buffers:  adapterResult.imageBuffers,
      mimeType: adapterResult.mimeType || 'image/jpeg',
    });
  } catch (e) {
    const errMsg = `Images generated but could not be saved: ${e.message}`;
    return openArtResult({
      ok: false,
      executionStatus: 'failed',
      error: errMsg,
      rawResponse: {
        historyId: adapterResult.historyId || null,
        model:     adapterResult.model || null,
      },
      decision,
    });
  }

  const count  = imageFiles.length;
  const output = `Generated ${count} image${count !== 1 ? 's' : ''} via OpenArt (model: ${adapterResult.model || 'default'})`;

  return openArtResult({
    ok: true,
    executionStatus: 'success',
    output,
    rawResponse: {
      provider:          'openart-mcp',
      historyId:         adapterResult.historyId,
      model:             adapterResult.model,
      mode:              adapterResult.mode,
      estimatedCredits:  adapterResult.estimatedCredits,
      originalPrompt:    adapterResult.originalPrompt,
      finalPrompt:       adapterResult.finalPrompt,
      promptMode:        adapterResult.promptMode,
      enhancementMethod: adapterResult.enhancementMethod,
      projectId:         adapterResult.projectId || null,
      selectionReason:   adapterResult.selectionReason,
      imageCount:        count,
    },
    imageFiles,
    decision,
  });
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Execute a task through the dispatch engine.
 *
 * Does NOT mutate task state, write logs, or send Telegram notifications.
 * The API handler (pages/api/dispatch/execute.js) owns all side-effects.
 *
 * @param {object} task — task from data/tasks.json
 * @param {object} [options]
 * @param {boolean} [options.approvalGranted=false]
 * @returns {object} executionResult
 */
export async function executeDispatch(task, { approvalGranted = false } = {}) {
  const taskId   = task.id || task.taskId;
  const taskType = task.taskType;
  const laneId   = task.lane || task.laneId;

  // ── 1. Get dispatch decision ───────────────────────────────────────────────
  const decision = dispatchTask({
    taskId,
    taskType,
    laneId,
    title:        task.title || String(task.description || taskType).slice(0, 80),
    instructions: task.description || task.instructions || '',
    priority:     task.priority || 'Normal',
  });
  decision.approvalRequired = task.approvalRequired === true || decision.approvalRequired;
  if (decision.approvalRequired) decision.nextAction = 'AWAIT_APPROVAL';

  if (decision.approvalRequired && !approvalGranted) {
    return {
      ok:               false,
      executionStatus:  'manual_required',
      executionMode:    null,
      executionTarget:  null,
      selectedSkill:    null,
      output:           null,
      outputSummary:    null,
      error:            'Approval is required before this task can be dispatched.',
      errorSummary:     'Approval required',
      httpStatus:       null,
      rawResponse:      null,
      decision,
      timestamp:        new Date().toISOString(),
    };
  }

  // ── 2. Not executable → return staged/manual result ───────────────────────
  if (!decision.executableNow) {
    const agentId   = decision.selectedAgent?.id;
    const isStaged  = STAGED_AGENT_IDS.has(agentId) || decision.selectedAgent?.status === 'staged';
    const agentName = decision.selectedAgent?.displayName || agentId || 'Unknown agent';

    const stagedError = isStaged
      ? `${agentName} is staged. Route preview only. Execution requires adapter activation.`
      : `No executable agent for task type "${taskType}". Next action: ${decision.nextAction}.`;

    return {
      ok:               false,
      executionStatus:  isStaged ? 'staged' : 'manual_required',
      executionMode:    null,
      executionTarget:  null,
      selectedSkill:    null,
      output:           null,
      outputSummary:    null,
      error:            stagedError,
      errorSummary:     stagedError.slice(0, 120),
      httpStatus:       null,
      rawResponse:      null,
      decision,
      timestamp:        new Date().toISOString(),
    };
  }

  // ── 3. Double-check staged guard (gate-activated agents bypass this) ─────────
  const selectedId = decision.selectedAgent?.id;
  if (STAGED_AGENT_IDS.has(selectedId) && !isGateActivated(selectedId)) {
    return {
      ok:               false,
      executionStatus:  'staged',
      executionMode:    null,
      executionTarget:  null,
      selectedSkill:    null,
      output:           null,
      outputSummary:    null,
      error:            `${decision.selectedAgent.displayName} is staged. Execution blocked by governance.`,
      errorSummary:     'Staged agent — execution blocked',
      httpStatus:       null,
      rawResponse:      null,
      decision,
      timestamp:        new Date().toISOString(),
    };
  }

  // ── 4. Route to correct adapter ────────────────────────────────────────────
  const mode = decision.selectedAgent?.executionMode;

  if (mode === 'local-cli') {
    return executeViaClaudeCode(task, decision);
  }

  if (mode === 'gateway' || mode === 'openclaw') {
    return executeViaOpenClaw(task, decision);
  }

  if (mode === 'ssh-http') {
    return executeViaHermes(task, decision);
  }

  if (mode === 'http-api') {
    return executeViaOpenArt(task, decision);
  }

  // ── 5. No adapter for this mode ────────────────────────────────────────────
  return {
    ok:               false,
    executionStatus:  'failed',
    executionMode:    mode || 'unknown',
    executionTarget:  selectedId,
    selectedSkill:    null,
    output:           null,
    outputSummary:    null,
    error:            `Execution mode "${mode}" has no adapter registered in executeDispatch.`,
    errorSummary:     `No adapter for mode: ${mode}`,
    httpStatus:       null,
    rawResponse:      null,
    decision,
    timestamp:        new Date().toISOString(),
  };
}
