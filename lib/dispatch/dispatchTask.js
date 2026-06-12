// lib/dispatch/dispatchTask.js
// Central dispatch decision engine for MIKA AGENTIC OS.
//
// Accepts a normalized task, reads routing rules + agent registry,
// and returns a dispatch decision object. Does NOT execute the task.
// Execution remains through existing OpenClaw/Hermes adapters.
//
// Governance: agents that are staged or not live-connected are never
// marked executableNow=true. All decisions are logged by the caller.

import fs   from 'fs';
import path from 'path';
import { getRouteForTaskType, validateRouteAgainstAgentRegistry, getFallbackAgent } from '../routing/loadTaskRouting';
import { getAgentById } from '../agents/loadAgentRegistry';
import { getAdapterStatus, listAdapters } from '../adapters/loadAdapter';
import { loadAdapterHealth } from '../adapters/adapterHealth';
import { resolveAgentRuntimeHealth } from '../agents/resolveRuntimeHealth';

// Agents that can execute right now (live + connected)
const EXECUTABLE_AGENT_IDS = new Set(['openclaw', 'hermes', 'recovery', 'mika', 'diamond', 'medbot', 'cannabot', 'hookr', 'twin', 'sentinel']);

const ACTIVATION_FILE = path.join(process.cwd(), 'data', 'adapter-activation-state.json');

function loadActivationOverrides() {
  try { return JSON.parse(fs.readFileSync(ACTIVATION_FILE, 'utf8')).overrides || {}; }
  catch { return {}; }
}

function resolveAgentSummary(agent, runtime) {
  if (!agent) return null;
  return {
    id: agent.id,
    displayName: agent.displayName,
    department: agent.department,
    role: agent.role,
    status: agent.status,
    executionMode: agent.executionMode,
    runtimeStatus: runtime?.runtimeStatus || 'unknown',
    liveConnected: runtime?.liveConnected === true,
    requiresApproval: agent.requiresApproval,
  };
}

function isAgentExecutable(agent, runtime) {
  if (!agent) return false;
  if (agent.status === 'deprecated') return false;
  if (runtime?.runtimeStatus !== 'available') return false;
  return EXECUTABLE_AGENT_IDS.has(agent.id);
}

/**
 * Compute a dispatch decision for a task.
 *
 * @param {object} task
 * @param {string} task.taskId
 * @param {string} task.taskType
 * @param {string} task.laneId
 * @param {string} task.title
 * @param {string} task.instructions
 * @param {string} [task.priority]
 *
 * @returns {object} dispatchDecision
 */
export function dispatchTask(task) {
  const { taskId, taskType, laneId, title, instructions, priority = 'Normal' } = task;

  const warnings = [];
  const adapters = Object.fromEntries(listAdapters().map(adapter => [adapter.adapterId, adapter]));
  const healthStore = loadAdapterHealth();
  const activationOverrides = loadActivationOverrides();

  function runtimeFor(agent) {
    if (!agent) return null;
    const adapterId = agent.adapterId || agent.id;
    const activated = activationOverrides[adapterId]?.status === 'active';
    return resolveAgentRuntimeHealth({
      agent: activated ? { ...agent, status: 'active' } : agent,
      adapter: adapters[adapterId] || null,
      evidence: healthStore.adapters?.[adapterId] || null,
    });
  }

  // ── 1. Look up route ──────────────────────────────────────────────
  const route = getRouteForTaskType(taskType);

  if (!route) {
    return {
      taskId,
      taskType,
      laneId,
      selectedAgent: null,
      fallbackAgent: null,
      route: null,
      approvalRequired: true,
      executableNow: false,
      reason: `No routing rule found for task type "${taskType}". Task cannot be auto-dispatched.`,
      warnings: [`Unknown task type: "${taskType}". Add a route to /routing/task-routing.json.`],
      nextAction: 'MANUAL_REVIEW',
      decidedAt: new Date().toISOString(),
    };
  }

  // ── 2. Validate route against registry ───────────────────────────
  const validation = validateRouteAgainstAgentRegistry(route);
  warnings.push(...validation.warnings);

  const primaryAgent = getAgentById(route.primaryAgentId);
  const fallbackAgent = route.fallbackAgentId ? getAgentById(route.fallbackAgentId) : null;
  const primaryRuntime = runtimeFor(primaryAgent);
  const fallbackRuntime = runtimeFor(fallbackAgent);

  // ── 3. Select best agent ─────────────────────────────────────────
  // Primary preferred. If primary is not executable, check fallback.
  let selectedAgent = primaryAgent;
  let selectedRuntime = primaryRuntime;
  let usingFallback = false;

  if (!isAgentExecutable(primaryAgent, primaryRuntime) && isAgentExecutable(fallbackAgent, fallbackRuntime)) {
    selectedAgent = fallbackAgent;
    selectedRuntime = fallbackRuntime;
    usingFallback = true;
    warnings.push(
      `Primary agent "${route.primaryAgentId}" is not executable now. Routing to fallback "${route.fallbackAgentId}".`
    );
  }

  // ── 4. Determine executableNow ───────────────────────────────────
  const executableNow = isAgentExecutable(selectedAgent, selectedRuntime);

  // ── 5. Determine approval requirement ────────────────────────────
  // Route-level approval OR agent-level requiresApproval
  const approvalRequired =
    route.requiresApproval ||
    (selectedAgent?.requiresApproval === true) ||
    priority === 'High';

  // ── 6. Build reason string ───────────────────────────────────────
  let reason = '';
  if (!primaryAgent) {
    reason = `No agent found for ID "${route.primaryAgentId}". Task cannot proceed.`;
  } else if (executableNow && !usingFallback) {
    reason = `Routed to ${primaryAgent.displayName} (${primaryAgent.role}) — primary agent for "${taskType}" tasks, execution mode: ${primaryAgent.executionMode}.`;
  } else if (executableNow && usingFallback) {
    reason = `Primary agent ${route.primaryAgentId} is staged. Routed to fallback ${fallbackAgent.displayName} (${fallbackAgent.role}).`;
  } else if (!executableNow && primaryAgent?.status === 'staged') {
    reason = `${primaryAgent.displayName} is staged and not yet live-connected. Task queued for when agent is activated.`;
  } else if (!executableNow && primaryRuntime?.runtimeStatus !== 'available') {
    reason = `${primaryAgent?.displayName || route.primaryAgentId} has no fresh reachable runtime evidence. Manual dispatch required.`;
  } else {
    reason = `Task type "${taskType}" has a route but no executable agent is available right now.`;
  }

  // ── 7. Determine next action ─────────────────────────────────────
  let nextAction = '';
  if (!executableNow) {
    if (selectedAgent?.status === 'staged') {
      nextAction = 'STAGED_DISPLAY_ONLY';
    } else if (approvalRequired) {
      nextAction = 'AWAIT_APPROVAL';
    } else {
      nextAction = 'MANUAL_REVIEW';
    }
  } else if (approvalRequired) {
    nextAction = 'AWAIT_APPROVAL';
  } else {
    nextAction = 'READY_TO_DISPATCH';
  }

  // ── 8. Resolve adapter info ──────────────────────────────────────
  const adapterId     = selectedAgent?.adapterId ?? null;
  const adapterStatus = adapterId ? getAdapterStatus(adapterId) : null;

  return {
    taskId,
    taskType,
    laneId,
    priority,
    title,
    adapterId,
    adapterStatus,
    selectedAgent: resolveAgentSummary(selectedAgent, selectedRuntime),
    fallbackAgent: usingFallback
      ? resolveAgentSummary(primaryAgent, primaryRuntime)
      : resolveAgentSummary(fallbackAgent, fallbackRuntime),
    route: {
      taskType:             route.taskType,
      primaryAgentId:       route.primaryAgentId,
      fallbackAgentId:      route.fallbackAgentId,
      requiresApproval:     route.requiresApproval,
      allowedExecutionModes: route.allowedExecutionModes,
      maxRuntimeSeconds:    route.maxRuntimeSeconds,
      costTier:             route.costTier,
      notes:                route.notes,
    },
    usingFallback,
    approvalRequired,
    executableNow,
    reason,
    warnings,
    nextAction,
    governanceNote: 'Governance enforced through task routing, approval, and execution-mode controls.',
    decidedAt: new Date().toISOString(),
  };
}
