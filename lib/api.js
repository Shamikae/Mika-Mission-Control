// lib/api.js
// ─────────────────────────────────────────────────────────────────
// API layer — currently returns mock data.
// To connect live: set NEXT_PUBLIC_VPS_GATEWAY_URL in .env.local
// and replace each function body with the fetch() call shown.
// ─────────────────────────────────────────────────────────────────

import * as mock from './mock-data';
import config from './config';

const VPS_URL   = config.gateway?.vpsUrl || '';
const LOCAL_URL = config.gateway?.localUrl || '';
const API_KEY   = config.gateway?.apiKey || '';

const MOCK_MODE = !VPS_URL || VPS_URL.includes('YOUR_VPS_IP');

// ── Internal fetch helper ─────────────────────────────────────────

async function gw(path, options = {}) {
  const base = VPS_URL || LOCAL_URL;
  const url  = `${base}${path}`;
  const res  = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type':  'application/json',
      ...options.headers,
    },
    ...options,
  });
  if (!res.ok) throw new Error(`Gateway error ${res.status}: ${path}`);
  return res.json();
}

// ── Gateway ───────────────────────────────────────────────────────

export async function fetchGatewayStatus() {
  if (MOCK_MODE) return mock.gatewayStatus;
  // LIVE: return gw('/api/status');
}

export async function fetchOpenClawStatus() {
  const res = await fetch('/api/openclaw/status');
  if (!res.ok) throw new Error(`OpenClaw status proxy error ${res.status}`);
  return res.json();
}

// ── Agents ────────────────────────────────────────────────────────

export async function fetchActiveAgents() {
  if (MOCK_MODE) return mock.activeAgents;
  // LIVE: return gw('/api/agents');
}

export async function restartAgent(agentId) {
  if (MOCK_MODE) return { success: true, agentId };
  return gw(`/api/agents/${agentId}/restart`, { method: 'POST' });
}

export async function stopAgent(agentId) {
  if (MOCK_MODE) return { success: true, agentId };
  return gw(`/api/agents/${agentId}/stop`, { method: 'POST' });
}

// ── Approvals ─────────────────────────────────────────────────────

export async function fetchPendingApprovals() {
  if (MOCK_MODE) return mock.pendingApprovals;
  // LIVE: return gw('/api/approvals/pending');
}

export async function approveTask(taskId, note = '') {
  if (MOCK_MODE) return { success: true, taskId, action: 'approved' };
  return gw(`/api/approvals/${taskId}/approve`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
}

export async function rejectTask(taskId, reason = '') {
  if (MOCK_MODE) return { success: true, taskId, action: 'rejected' };
  return gw(`/api/approvals/${taskId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

// ── Mission Queue ─────────────────────────────────────────────────

export async function fetchMissionQueue() {
  if (MOCK_MODE) return mock.missionQueue;
  // LIVE: return gw('/api/missions/today');
}

// ── Task Outputs ──────────────────────────────────────────────────

export async function fetchTaskOutputs() {
  if (MOCK_MODE) return mock.taskOutputs;
  // LIVE: return gw('/api/tasks/outputs?limit=20');
}

// ── Goals ─────────────────────────────────────────────────────────

export async function fetchGoals() {
  if (MOCK_MODE) return mock.goals;
  // LIVE: fetch from Obsidian vault or Google Drive
}

export async function updateGoalProgress(goalId, current) {
  if (MOCK_MODE) return { success: true };
  return gw(`/api/goals/${goalId}`, {
    method: 'PATCH',
    body: JSON.stringify({ current }),
  });
}

// ── Journal ───────────────────────────────────────────────────────

export async function fetchJournalEntries() {
  if (MOCK_MODE) return mock.journalEntries;
  // LIVE: read from Obsidian vault JSON export
}

export async function createJournalEntry(entry) {
  if (MOCK_MODE) return { success: true, id: `j-${Date.now()}` };
  return gw('/api/journal', { method: 'POST', body: JSON.stringify(entry) });
}

// ── Memory Vault ──────────────────────────────────────────────────

export async function fetchMemoryVault(query = '') {
  if (MOCK_MODE) {
    if (!query) return mock.memoryVault;
    return mock.memoryVault.filter(m =>
      m.title.toLowerCase().includes(query.toLowerCase()) ||
      m.content.toLowerCase().includes(query.toLowerCase())
    );
  }
  // LIVE: return gw(`/api/memory?q=${encodeURIComponent(query)}`);
}

// ── Prompts ───────────────────────────────────────────────────────

export async function fetchPrompts() {
  if (MOCK_MODE) return mock.prompts;
  // LIVE: return gw('/api/prompts');
}

// ── Content Tasks ─────────────────────────────────────────────────

export async function fetchContentTasks() {
  if (MOCK_MODE) return mock.contentTasks;
  // LIVE: return gw('/api/content/tasks');
}

// ── Metrics ───────────────────────────────────────────────────────

export async function fetchWeeklyMetrics() {
  if (MOCK_MODE) return mock.weeklyMetrics;
  // LIVE: return gw('/api/analytics/weekly');
}

export async function fetchLeadMetrics() {
  if (MOCK_MODE) return mock.leadMetrics;
}

export async function fetchCannaOpsData() {
  if (MOCK_MODE) return mock.cannaOpsData;
}

export async function fetchMedAIData() {
  if (MOCK_MODE) return mock.medAIData;
}
