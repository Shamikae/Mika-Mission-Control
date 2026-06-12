// lib/routing/loadTaskRouting.js
// Loads and queries the task routing table from /routing/task-routing.json.
// Used by dispatchTask.js to determine which agent handles which task type.

import path from 'path';
import fs from 'fs';
import { getAgentById, loadAgentRegistry } from '../agents/loadAgentRegistry';

const ROUTING_PATH = path.join(process.cwd(), 'routing', 'task-routing.json');

let _cache = null;

export function loadTaskRouting() {
  if (_cache) return _cache;
  try {
    const raw = fs.readFileSync(ROUTING_PATH, 'utf-8');
    _cache = JSON.parse(raw);
    return _cache;
  } catch {
    return { routes: [] };
  }
}

export function getRouteForTaskType(taskType) {
  if (!taskType) return null;
  const { routes } = loadTaskRouting();
  // Exact match first, then case-insensitive
  return (
    routes.find((r) => r.taskType === taskType) ||
    routes.find((r) => r.taskType.toLowerCase() === taskType.toLowerCase()) ||
    null
  );
}

export function getAllowedAgentsForTask(taskType) {
  const route = getRouteForTaskType(taskType);
  if (!route) return [];
  const ids = [route.primaryAgentId, route.fallbackAgentId].filter(Boolean);
  const registry = loadAgentRegistry();
  return ids.map((id) => registry.find((a) => a.id === id)).filter(Boolean);
}

export function getFallbackAgent(taskType) {
  const route = getRouteForTaskType(taskType);
  if (!route || !route.fallbackAgentId) return null;
  return getAgentById(route.fallbackAgentId);
}

export function validateRouteAgainstAgentRegistry(route) {
  if (!route) return { valid: false, warnings: ['No route provided'] };

  const warnings = [];
  const primaryAgent = getAgentById(route.primaryAgentId);
  const fallbackAgent = route.fallbackAgentId ? getAgentById(route.fallbackAgentId) : null;

  if (!primaryAgent) {
    warnings.push(`Primary agent "${route.primaryAgentId}" not found in registry`);
  } else {
    if (primaryAgent.status === 'staged') {
      warnings.push(`Primary agent "${route.primaryAgentId}" is staged — not yet live`);
    }
    if (primaryAgent.status === 'inactive') {
      warnings.push(`Primary agent "${route.primaryAgentId}" is inactive`);
    }
    if (!primaryAgent.liveConnected) {
      warnings.push(`Primary agent "${route.primaryAgentId}" is not live-connected`);
    }
    const modeAllowed = route.allowedExecutionModes.includes(primaryAgent.executionMode);
    if (!modeAllowed) {
      warnings.push(
        `Primary agent execution mode "${primaryAgent.executionMode}" is not in allowed modes [${route.allowedExecutionModes.join(', ')}]`
      );
    }
  }

  if (route.fallbackAgentId && !fallbackAgent) {
    warnings.push(`Fallback agent "${route.fallbackAgentId}" not found in registry`);
  }

  return {
    valid: warnings.length === 0,
    warnings,
    primaryAgent: primaryAgent || null,
    fallbackAgent: fallbackAgent || null,
  };
}
