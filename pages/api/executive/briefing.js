// GET /api/executive/briefing
// Aggregates all live system state into a single CEO-level snapshot.
// Reads from files directly — no circular API calls except for live services.

import fs   from 'fs';
import path from 'path';
import { listAdapters } from '../../../lib/adapters/loadAdapter';
import { loadAdapterHealth, getAdapterHealthSummary } from '../../../lib/adapters/adapterHealth';
import { resolveAgentRuntimeHealth } from '../../../lib/agents/resolveRuntimeHealth';
import { getCostSummary } from '../../../lib/cost/costEngine';
import { getPendingRequests } from '../../../lib/activation/activationGate';
import { getHermesHealthSummary } from '../../../lib/hermes/health';

const ROOT = process.cwd();

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function scanWorkflowInstances() {
  const dir = path.join(ROOT, 'data', 'workflows');
  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => readJson(path.join(dir, f), null))
      .filter(Boolean);
  } catch { return []; }
}

function scanArtifacts() {
  const base = path.join(ROOT, 'content-artifacts');
  const results = [];
  try {
    const lanes = fs.readdirSync(base);
    for (const lane of lanes) {
      const laneDir = path.join(base, lane);
      if (!fs.statSync(laneDir).isDirectory()) continue;
      const workflows = fs.readdirSync(laneDir);
      for (const wfId of workflows) {
        const meta = readJson(path.join(laneDir, wfId, 'metadata.json'), null);
        if (meta) results.push({ laneId: lane, ...meta });
      }
    }
  } catch {}
  return results;
}

function scanVideoPromptPacks() {
  const base = path.join(ROOT, 'content-artifacts');
  let count = 0;
  try {
    const lanes = fs.readdirSync(base);
    for (const lane of lanes) {
      const laneDir = path.join(base, lane);
      if (!fs.statSync(laneDir).isDirectory()) continue;
      for (const wfId of fs.readdirSync(laneDir)) {
        const packPath = path.join(laneDir, wfId, 'video-prompt-pack.json');
        if (fs.existsSync(packPath)) count++;
      }
    }
  } catch {}
  return count;
}

async function fetchOpenClawStatus() {
  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL || '';
  const statusPath = process.env.OPENCLAW_STATUS_PATH || '/health';
  const apiToken   = process.env.OPENCLAW_API_TOKEN || '';
  if (!gatewayUrl) return { status: 'UNCONFIGURED', latencyMs: null };
  const t0 = Date.now();
  try {
    const res = await fetch(gatewayUrl.replace(/\/$/, '') + statusPath, {
      headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
      signal: AbortSignal.timeout(4000),
    });
    const latencyMs = Date.now() - t0;
    const text = await res.text().catch(() => '');
    let payload = null;
    try { payload = JSON.parse(text); } catch {}
    const ok = res.ok && (payload?.ok !== false);
    return { status: ok ? 'LIVE' : 'DEGRADED', latencyMs };
  } catch {
    return { status: 'OFFLINE', latencyMs: Date.now() - t0 };
  }
}

async function fetchHermesStatus() {
  return getHermesHealthSummary({ checkHttp: true });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const generatedAt = new Date().toISOString();
  const today = generatedAt.split('T')[0];

  // ── Raw data reads ────────────────────────────────────────────────
  const tasks      = readJson(path.join(ROOT, 'data', 'tasks.json'), []);
  const videoJobStore = readJson(path.join(ROOT, 'data', 'video-jobs.json'), { jobs: [] });
  const videoJobs  = videoJobStore.jobs || [];
  const queue    = readJson(path.join(ROOT, 'queue', 'tasks-queue.json'), []);
  const agents   = readJson(path.join(ROOT, 'agents', 'agent-registry.json'), []);
  const agentList = Array.isArray(agents) ? agents : (agents.agents || []);
  const dispatchLog = readJson(path.join(ROOT, 'logs', 'dispatch-log.json'), []);
  const workflows = scanWorkflowInstances();
  const artifacts = scanArtifacts();
  const promptPacks = scanVideoPromptPacks();
  const engStore       = readJson(path.join(ROOT, 'data', 'engineering-tasks.json'), { tasks: [] });
  const engTasks       = Array.isArray(engStore) ? engStore : (engStore.tasks || []);
  const proposals      = readJson(path.join(ROOT, 'data', 'proposals.json'),       {}).proposals || [];
  const clients        = readJson(path.join(ROOT, 'data', 'clients.json'),         {}).clients   || [];
  const revenueItems   = readJson(path.join(ROOT, 'data', 'revenue-items.json'),   {}).revenue   || [];
  const controlState   = readJson(path.join(ROOT, 'data', 'agent-control-state.json'), { overrides: {} });
  const adapterMaint   = readJson(path.join(ROOT, 'data', 'adapter-maintenance.json'), { maintenance: {} });
  const adapters          = listAdapters();
  const adapterHealthStore = loadAdapterHealth();
  const adapterHealthSummary = getAdapterHealthSummary(adapterHealthStore);

  // ── Live service status ───────────────────────────────────────────
  const [openclaw, hermes] = await Promise.all([
    fetchOpenClawStatus(),
    fetchHermesStatus(),
  ]);

  // ── System Health ─────────────────────────────────────────────────
  const pendingQueue  = queue.filter(q => !q.approved && q.status === 'pending');
  const failedDispatches = dispatchLog.filter(d => d.executionStatus === 'failed');

  const systemHealth = {
    openclaw: {
      status:    openclaw.status,
      latencyMs: openclaw.latencyMs,
      healthy:   openclaw.status === 'LIVE',
    },
    hermes: {
      status:     hermes.status,
      configured: hermes.configured,
      mode:       hermes.mode,
      healthy:    hermes.verified && hermes.reachable,
    },
    queue: {
      depth:   queue.length,
      pending: pendingQueue.length,
      healthy: failedDispatches.length === 0,
    },
    dispatch: {
      total:        dispatchLog.length,
      failedCount:  failedDispatches.length,
      lastDispatch: dispatchLog.length > 0 ? dispatchLog[dispatchLog.length - 1]?.timestamp : null,
      healthy:      failedDispatches.length === 0,
    },
  };

  // ── Workforce ─────────────────────────────────────────────────────
  const overrides = controlState.overrides || {};
  const maintCount = Object.values(overrides).filter(o => o.maintenance).length;
  const disabledCount = Object.values(overrides).filter(o => o.disabled && !o.maintenance).length;

  const maintAdapters = Object.values(adapterMaint.maintenance || {}).filter(m => m.active).length;
  const activeAdapters = adapters.filter(a => a.status === 'active').length;
  const stagedAdapters = adapters.filter(a => a.status === 'staged').length;
  const adapterMap = Object.fromEntries(adapters.map(adapter => [adapter.adapterId, adapter]));
  const runtimeAgents = agentList.map(agent => resolveAgentRuntimeHealth({
    agent,
    adapter: adapterMap[agent.adapterId] || null,
    evidence: adapterHealthStore.adapters?.[agent.adapterId] || null,
    override: overrides[agent.id] || null,
    maintenance: adapterMaint.maintenance?.[agent.adapterId] || null,
  }));

  const workforce = {
    total:          agentList.length,
    active:         agentList.filter(a => a.status === 'active').length,
    staged:         agentList.filter(a => a.status === 'staged').length,
    inactive:       agentList.filter(a => a.status === 'inactive').length,
    executable:     runtimeAgents.filter(a => a.liveConnected).length,
    healthy:        runtimeAgents.filter(a => a.runtimeStatus === 'available').length,
    reachable:      runtimeAgents.filter(a => a.runtimeStatus === 'reachable').length,
    degraded:       runtimeAgents.filter(a => a.runtimeStatus === 'degraded').length,
    offline:        runtimeAgents.filter(a => a.runtimeStatus === 'offline').length,
    unknown:        runtimeAgents.filter(a => a.runtimeStatus === 'unknown').length,
    maintenance:    maintCount,
    disabled:       disabledCount,
    adapterTotal:   adapters.length,
    adapterActive:  activeAdapters,
    adapterStaged:  stagedAdapters,
    adapterMaint:   maintAdapters,
    // Live health data (from last health check run)
    adapterHealthy:       adapterHealthSummary.healthy,
    adapterOffline:       adapterHealthSummary.offline,
    adapterMisconfigured: adapterHealthSummary.misconfigured,
    adapterAuthFailed:    adapterHealthSummary.auth_failed,
    adapterWarning:       adapterHealthSummary.warning,
    adapterLastCheckedAt: adapterHealthSummary.lastCheckedAt,
    adapterNeverChecked:  adapterHealthSummary.neverChecked,
    adapterFailed:        adapterHealthSummary.failed,
    adapterConfiguredButStaged: adapterHealthSummary.configuredButStaged,
    pendingActivations: getPendingRequests().length,
  };

  // ── Operations ────────────────────────────────────────────────────
  const completedToday = tasks.filter(t =>
    t.status === 'complete' && t.completedAt && t.completedAt.startsWith(today)
  );

  const operations = {
    tasksPending:        tasks.filter(t => t.status === 'pending').length,
    tasksRunning:        tasks.filter(t => t.status === 'running').length,
    tasksCompletedToday: completedToday.length,
    tasksCompleted:      tasks.filter(t => t.status === 'complete').length,
    tasksFailed:         tasks.filter(t => t.status === 'failed').length,
    pendingApprovals:    pendingQueue.length,
    proposalsDraft:      proposals.filter(p => p.status === 'draft').length,
    proposalsSent:       proposals.filter(p => p.status === 'sent' || p.status === 'reviewing').length,
    proposalsAccepted:   proposals.filter(p => p.status === 'accepted').length,
    proposalValue:       proposals.filter(p => p.status !== 'rejected').reduce((s, p) => s + (p.value || 0), 0),
    activeClients:       clients.filter(c => c.status === 'active' || c.status === 'onboarding').length,
    contractValue:       clients.filter(c => c.status === 'active' || c.status === 'onboarding').reduce((s, c) => s + (c.contractValue || 0), 0),
    projectedRevenue:    revenueItems.filter(r => !['lost', 'received'].includes(r.status)).reduce((s, r) => s + (r.amount || 0), 0),
    weightedForecast:    revenueItems.filter(r => r.status !== 'received' && r.status !== 'lost').reduce((s, r) => s + (r.amount || 0) * ((r.probability || 50) / 100), 0),
    receivedRevenue:     revenueItems.filter(r => r.status === 'received').reduce((s, r) => s + (r.amount || 0), 0),
  };

  // ── Content Factory ───────────────────────────────────────────────
  const activeWorkflows = workflows.filter(w => w.status === 'active' || w.status === 'running');
  const totalArtifactFiles = artifacts.reduce((s, a) => s + (a.artifactFiles?.length || 0), 0);

  const contentFactory = {
    briefsCreated:        tasks.filter(t => t.source === 'content-brief').length,
    activeWorkflows:      activeWorkflows.length,
    totalWorkflows:       workflows.length,
    artifactsGenerated:   totalArtifactFiles,
    artifactWorkflows:    artifacts.length,
    promptPacksGenerated: promptPacks,
    videoJobsTotal:       videoJobs.length,
    videoJobsPending:     videoJobs.filter(j => j.status === 'pending').length,
    videoJobsApproved:    videoJobs.filter(j => j.status === 'approved').length,
    videoJobsComplete:    videoJobs.filter(j => j.status === 'complete').length,
    videoJobsFailed:      videoJobs.filter(j => j.status === 'failed').length,
  };

  // ── Needs Attention ───────────────────────────────────────────────
  const nowMs = Date.now();
  const twentyFourHours = 24 * 60 * 60 * 1000;

  const needsAttention = [];

  tasks
    .filter(t => t.status === 'failed')
    .slice(0, 5)
    .forEach(t => needsAttention.push({
      type:     'failed-task',
      severity: 'high',
      title:    t.title || t.taskType || 'Failed task',
      detail:   t.openclawError || 'Task failed without error detail',
      id:       t.id,
      lane:     t.lane,
      ts:       t.updatedAt || t.createdAt,
    }));

  pendingQueue
    .slice(0, 5)
    .forEach(q => needsAttention.push({
      type:     'pending-approval',
      severity: 'medium',
      title:    q.title || 'Task awaiting approval',
      detail:   `Priority: ${q.priority || 'Normal'} · Lane: ${q.laneId || '—'}`,
      id:       q.queueId,
      lane:     q.laneId,
      ts:       q.createdAt,
    }));

  activeWorkflows
    .filter(w => {
      const updatedAt = w.updatedAt || w.createdAt;
      return updatedAt && (nowMs - new Date(updatedAt).getTime()) > twentyFourHours;
    })
    .forEach(w => needsAttention.push({
      type:     'stuck-workflow',
      severity: 'medium',
      title:    `Workflow stalled — ${w.laneId || w.id}`,
      detail:   `No progress in >24h`,
      id:       w.id,
      lane:     w.laneId,
      ts:       w.updatedAt,
    }));

  failedDispatches
    .slice(-3)
    .forEach(d => needsAttention.push({
      type:     'failed-dispatch',
      severity: 'high',
      title:    `Dispatch failed — ${d.taskType || d.taskId}`,
      detail:   d.errorSummary || d.decisionReason || 'No detail',
      id:       d.taskId,
      lane:     d.laneId,
      ts:       d.timestamp,
    }));

  // ── Quick Wins ────────────────────────────────────────────────────
  const quickWins = [];

  tasks
    .filter(t => t.status === 'complete' && t.openclawReply)
    .slice(0, 4)
    .forEach(t => quickWins.push({
      type:   'content-ready',
      title:  t.title || t.taskType,
      detail: t.openclawReply.slice(0, 120) + (t.openclawReply.length > 120 ? '…' : ''),
      id:     t.id,
      lane:   t.lane,
      ts:     t.completedAt || t.updatedAt,
    }));

  queue
    .filter(q => q.approved && !q.dispatched && q.status !== 'failed')
    .slice(0, 3)
    .forEach(q => quickWins.push({
      type:   'approved-ready',
      title:  q.title || 'Approved task ready',
      detail: `Approved · Lane: ${q.laneId || '—'} · Priority: ${q.priority || 'Normal'}`,
      id:     q.queueId,
      lane:   q.laneId,
      ts:     q.updatedAt || q.createdAt,
    }));

  artifacts
    .filter(a => {
      const completedStages = a.stagesCompleted || [];
      return completedStages.includes('script_generation') || completedStages.includes('visual_prompting');
    })
    .slice(0, 3)
    .forEach(a => quickWins.push({
      type:   'video-ready',
      title:  `Video assets ready — ${a.laneId}`,
      detail: `Workflow: ${a.workflowId} · Artifacts: ${a.artifactFiles?.length || 0} files`,
      id:     a.workflowId,
      lane:   a.laneId,
      ts:     a.updatedAt,
    }));

  // ── Cost Intelligence ─────────────────────────────────────────────
  const costData = getCostSummary(true);
  const costIntelligence = {
    estimatedCostToday:   costData.highlights?.costToday  || 0,
    estimatedCostMonth:   costData.highlights?.costMonth  || 0,
    projectedCostMonth:   costData.highlights?.projCost   || 0,
    highestCostAgent:     costData.highlights?.highestCostAgent   || null,
    highestCostAdapter:   costData.highlights?.highestCostAdapter || null,
    totalDispatches:      costData.summary?.allTime?.dispatches   || 0,
    avgCostPerDispatch:   costData.summary?.avgCostPerDispatch    || 0,
    alertCount:           (costData.alerts || []).filter(a => a.severity !== 'info').length,
  };

  // ── Engineering Intelligence ──────────────────────────────────────
  const completedEng = engTasks.filter(t => t.status === 'complete');
  const engineering = {
    total:                    engTasks.length,
    architectureReviews:      completedEng.filter(t => t.taskType === 'code_architecture').length,
    codeReviews:              completedEng.filter(t => t.taskType === 'code_review').length,
    refactorReviews:          completedEng.filter(t => t.taskType === 'refactor_plan').length,
    bugInvestigations:        completedEng.filter(t => t.taskType === 'bug_diagnosis').length,
    recommendationsGenerated: completedEng.length,
    pending:                  engTasks.filter(t => t.status === 'pending' || t.status === 'running').length,
    failed:                   engTasks.filter(t => t.status === 'failed').length,
  };

  return res.status(200).json({
    generatedAt,
    systemHealth,
    workforce,
    operations,
    contentFactory,
    engineering,
    needsAttention,
    quickWins,
    costIntelligence,
  });
}
