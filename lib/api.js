// lib/api.js
// ─────────────────────────────────────────────────────────────────
// API layer. Functions that have live proxy routes call them directly.
// MOCK_MODE only applies to legacy gateway-direct calls not yet proxied.
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
  try {
    const res = await fetch('/api/openclaw/status');
    if (!res.ok) throw new Error(res.status);
    const d = await res.json();
    return {
      online:        d.status === 'LIVE',
      mode:          d.source === 'openclaw' ? 'VPS' : d.source || 'UNKNOWN',
      vpsUrl:        null,
      latencyMs:     d.latencyMs ?? null,
      uptime:        d.uptime   ?? null,
      version:       d.version  ?? null,
      lastPing:      d.lastChecked,
      cpu:           null,
      ram:           null,
      disk:          null,
      activeSessions:null,
      activeAgents:  null,
      queueDepth:    null,
    };
  } catch {
    return mock.gatewayStatus;
  }
}

export async function fetchOpenClawStatus() {
  const res = await fetch('/api/openclaw/status');
  if (!res.ok) throw new Error(`OpenClaw status proxy error ${res.status}`);
  return res.json();
}

export async function fetchSubmittedTasks() {
  const res = await fetch('/api/tasks/list');
  if (!res.ok) throw new Error(`Tasks list error ${res.status}`);
  return res.json();
}

export async function submitTask(payload) {
  const res = await fetch('/api/tasks/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Task submit error ${res.status}`);
  return body;
}

export async function deleteTask(taskId) {
  const res = await fetch('/api/tasks/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Task delete error ${res.status}`);
  return body;
}

export async function fetchQueue() {
  try {
    const res = await fetch('/api/queue');
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

export async function approveQueueItem(queueId) {
  const res = await fetch('/api/queue/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Approve error ${res.status}`);
  return body;
}

export async function updateQueueItemStatus(queueId, status) {
  const res = await fetch('/api/queue/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId, status }),
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

export async function previewDispatch({ taskId, taskType, laneId, title, priority }) {
  const res = await fetch('/api/dispatch/route-task', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, taskType, laneId, title, priority }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Dispatch preview error ${res.status}`);
  return body; // { ok, decision }
}

export async function executeViaDispatch(taskId) {
  const res = await fetch('/api/dispatch/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Execute dispatch error ${res.status}`);
  return body; // { ok, executionStatus, executionTarget, output, error, decision, task }
}

// ── Content Brief ─────────────────────────────────────────────────────

export async function createContentBrief(payload) {
  const res = await fetch('/api/content/brief/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Content brief error ${res.status}`);
  return body; // { taskId, task, queueId, dispatchPreview }
}

export async function fetchContentBriefs(limit = 20) {
  try {
    const res = await fetch('/api/tasks/list');
    if (!res.ok) return [];
    const all = await res.json();
    return all.filter(t => t.source === 'content-brief').slice(0, limit);
  } catch { return []; }
}

export async function fetchLaneMemory(laneId) {
  if (!laneId) return [];
  try {
    const res = await fetch(`/api/memory/lane?lane=${encodeURIComponent(laneId)}`);
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

export async function fetchHermesHttpStatus() {
  try {
    const res = await fetch('/api/hermes/http-status');
    if (!res.ok) return { online: false, mode: 'cli', configured: false };
    return res.json();
  } catch { return { online: false, mode: 'cli', configured: false }; }
}

export async function sendHermesChat(message, laneId) {
  const res = await fetch('/api/hermes/chat', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ message, laneId }),
  });
  const body = await res.json().catch(() => ({}));
  return body; // { ok, reply, session, error } — never throws
}

export async function fetchHermesChatSessions() {
  try {
    const res = await fetch('/api/hermes/sessions');
    if (!res.ok) return {};
    return res.json();
  } catch { return {}; }
}

export async function clearHermesChatSession(laneId) {
  const res = await fetch('/api/hermes/sessions', {
    method:  'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ laneId }),
  });
  return res.json().catch(() => ({}));
}

export async function sendOpenClawChat(message, lane) {
  const res = await fetch('/api/openclaw/chat', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ message, lane }),
  });
  const body = await res.json().catch(() => ({}));
  return body; // { ok, reply, error } — never throws
}

export async function fetchHermesStatus() {
  try {
    const res = await fetch('/api/hermes/status');
    if (!res.ok) return { status: 'OFFLINE' };
    return res.json();
  } catch { return { status: 'OFFLINE' }; }
}

export async function dispatchTaskToHermes(taskId) {
  const res = await fetch('/api/hermes/task', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ taskId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Hermes dispatch error ${res.status}`);
  return body;
}

export async function synthesizeWithOpenClaw(taskId) {
  const res = await fetch('/api/openclaw/synthesize', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ taskId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Synthesis error ${res.status}`);
  return body;
}

export async function fetchTelegramStatus() {
  try {
    const res = await fetch('/api/telegram/status');
    if (!res.ok) return { enabled: false };
    return res.json();
  } catch { return { enabled: false }; }
}

export async function dispatchTaskToOpenClaw(taskId) {
  const res = await fetch('/api/openclaw/task', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Dispatch error ${res.status}`);
  return body;
}

// ── Agents ────────────────────────────────────────────────────────

export async function fetchActiveAgents() {
  try {
    const res = await fetch('/api/agents/registry');
    if (!res.ok) throw new Error(res.status);
    const agents = await res.json();
    return agents.map(a => ({
      id:          a.id,
      label:       a.displayName || a.id,
      status:      a.status || 'idle',
      project:     a.project || null,
      task:        null,
      model:       a.model || null,
      tokens:      null,
      description: a.description || null,
      schedule:    a.schedule || null,
      memory:      null,
      liveConnected: a.liveConnected || false,
    }));
  } catch {
    return mock.activeAgents;
  }
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
  try {
    const [qRes, tRes] = await Promise.all([
      fetch('/api/queue'),
      fetch('/api/tasks/list'),
    ]);
    const queue = qRes.ok ? await qRes.json() : [];
    const tasks = tRes.ok ? await tRes.json() : [];
    const taskMap = Object.fromEntries(tasks.map(t => [t.id, t]));

    return queue
      .filter(q => !q.approved && (q.status === 'pending' || q.status === 'queued'))
      .map(q => {
        const task = taskMap[q.taskId] || {};
        return {
          id:        q.queueId,
          agent:     task.lane ? task.lane.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'OpenClaw',
          project:   q.laneId || task.lane || null,
          action:    task.taskType || 'dispatch',
          summary:   task.title || q.title || '(no title)',
          content:   task.description || null,
          createdAt: q.createdAt,
          priority:  q.priority || 'Normal',
          channel:   task.platform || null,
        };
      });
  } catch {
    return mock.pendingApprovals;
  }
}

export async function approveTask(taskId, note = '') {
  const res = await fetch('/api/queue/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: taskId, note }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, error: body.error };
  return { success: true, taskId, action: 'approved' };
}

export async function rejectTask(taskId, reason = '') {
  const res = await fetch('/api/queue/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: taskId, status: 'rejected', reason }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, error: body.error };
  return { success: true, taskId, action: 'rejected' };
}

// ── Mission Queue ─────────────────────────────────────────────────

export async function fetchMissionQueue() {
  try {
    const res = await fetch('/api/tasks/list');
    if (!res.ok) throw new Error(res.status);
    const tasks = await res.json();
    return tasks.slice(0, 10).map(t => ({
      id:      t.id,
      time:    t.createdAt ? new Date(t.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—',
      status:  t.status === 'complete' ? 'done' : t.status === 'failed' ? 'failed' : t.status === 'running' ? 'running' : 'pending',
      label:   t.title || t.taskType || '(task)',
      project: t.lane || null,
    }));
  } catch {
    return mock.missionQueue;
  }
}

// ── Task Outputs ──────────────────────────────────────────────────

export async function fetchTaskOutputs() {
  try {
    const res = await fetch('/api/tasks/list');
    if (!res.ok) throw new Error(res.status);
    const tasks = await res.json();
    return tasks
      .filter(t => t.openclawReply || t.status === 'complete')
      .slice(0, 10)
      .map(t => ({
        id:      t.id,
        agent:   t.lane ? t.lane.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'OpenClaw',
        project: t.lane || null,
        type:    t.taskType || 'output',
        title:   t.title || '(output)',
        preview: t.openclawReply ? t.openclawReply.slice(0, 200) : null,
        ts:      t.completedAt || t.updatedAt,
        status:  t.status === 'complete' ? 'ready_for_review' : t.status,
      }));
  } catch {
    return mock.taskOutputs;
  }
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
  try {
    const res = await fetch('/api/revenue');
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    return data.daily || mock.weeklyMetrics;
  } catch {
    return mock.weeklyMetrics;
  }
}

export async function fetchRevenueBrands() {
  try {
    const res = await fetch('/api/revenue');
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    return data.brands || [];
  } catch {
    return [];
  }
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

// ── Viral Content Workflow ────────────────────────────────────────

export async function startViralContentWorkflow(contentBriefTaskId) {
  const res = await fetch('/api/workflows/viral-content/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentBriefTaskId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Workflow creation error ${res.status}`);
  return body; // { ok, workflowId, stageCount, workflow, childTasks }
}

export async function fetchViralWorkflowByBrief(briefId) {
  try {
    const res = await fetch(`/api/workflows/viral-content/status?briefId=${encodeURIComponent(briefId)}`);
    if (!res.ok) return { exists: false, workflow: null };
    return res.json();
  } catch { return { exists: false, workflow: null }; }
}

// ── Content Artifacts ─────────────────────────────────────────────

export async function fetchArtifactWorkflows(laneId) {
  try {
    const url = laneId
      ? `/api/content-artifacts/list?laneId=${encodeURIComponent(laneId)}`
      : '/api/content-artifacts/list';
    const res = await fetch(url);
    if (!res.ok) return { workflows: [], count: 0 };
    return res.json();
  } catch { return { workflows: [], count: 0 }; }
}

export async function fetchWorkflowArtifacts(laneId, workflowId) {
  try {
    const res = await fetch(
      `/api/content-artifacts/get?laneId=${encodeURIComponent(laneId)}&workflowId=${encodeURIComponent(workflowId)}`
    );
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

export async function fetchSingleArtifact(laneId, workflowId, artifactType) {
  try {
    const res = await fetch(
      `/api/content-artifacts/get?laneId=${encodeURIComponent(laneId)}&workflowId=${encodeURIComponent(workflowId)}&artifact=${encodeURIComponent(artifactType)}`
    );
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

// ── Video Router ──────────────────────────────────────────────────

export async function generateVideoPromptPack({ laneId, workflowId, budgetMode, contentFormat }) {
  const res = await fetch('/api/video-router/generate-pack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ laneId, workflowId, budgetMode, contentFormat }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Video pack error ${res.status}`);
  return body;
}

export async function fetchVideoPromptPack(laneId, workflowId) {
  try {
    const res = await fetch(
      `/api/video-router/get-pack?laneId=${encodeURIComponent(laneId)}&workflowId=${encodeURIComponent(workflowId)}`
    );
    if (!res.ok) return { exists: false, pack: null };
    return res.json();
  } catch { return { exists: false, pack: null }; }
}

export async function fetchProviderProfiles() {
  try {
    const res = await fetch('/api/video-router/get-pack?profilesOnly=true');
    if (!res.ok) return { providers: [], budgetModes: {}, contentFormatRouting: {} };
    return res.json();
  } catch { return { providers: [], budgetModes: {}, contentFormatRouting: {} }; }
}
