// lib/cost/costEngine.js
// Cost Intelligence engine for Mika Agentic OS.
//
// Architecture principle: estimates only — no live billing API connections.
// All costs are derived from dispatch logs + configurable cost models.
// Purpose: understand economic impact BEFORE activating paid providers.

import fs   from 'fs';
import path from 'path';

const ROOT          = process.cwd();
const COST_FILE     = path.join(ROOT, 'data', 'cost-intelligence.json');
const DISPATCH_LOG  = path.join(ROOT, 'logs', 'dispatch-log.json');
const AGENT_REG     = path.join(ROOT, 'agents', 'agent-registry.json');
const TASKS_FILE    = path.join(ROOT, 'data', 'tasks.json');

// ── Cost model per adapter ────────────────────────────────────────────────────
// All values are estimates. Adjust via ADAPTER_COST_OVERRIDES in env or config.

export const ADAPTER_COST_MODEL = {
  'openclaw': {
    perDispatch:  0.013,
    tier:         'low',
    currency:     'USD',
    basis:        'per-dispatch',
    note:         '~GPT-4o: 800 input + 600 output tokens',
    activationRisk: 'low',
  },
  'hermes': {
    perDispatch:  0.000,
    tier:         'free',
    currency:     'USD',
    basis:        'per-dispatch',
    note:         'Self-hosted VPS — compute cost only, no API fee',
    activationRisk: 'none',
  },
  'claude-code': {
    perDispatch:  0.025,
    tier:         'variable',
    currency:     'USD',
    basis:        'per-dispatch',
    note:         'Estimate: ~2k tokens at Anthropic Sonnet rates',
    activationRisk: 'medium',
  },
  'codex': {
    perDispatch:  0.020,
    tier:         'low',
    currency:     'USD',
    basis:        'per-dispatch',
    note:         'Estimate: code tasks at GPT-4o pricing',
    activationRisk: 'low',
  },
  'heygen': {
    perDispatch:  0.250,
    tier:         'medium',
    currency:     'USD',
    basis:        'per-video-minute',
    note:         'Estimate: ~1 min avatar video at $0.25/min',
    activationRisk: 'high',
  },
  'higgsfield': {
    perDispatch:  0.500,
    tier:         'high',
    currency:     'USD',
    basis:        'per-generation',
    note:         'Estimate: cinematic video generation per job',
    activationRisk: 'high',
  },
  'openart': {
    perDispatch:  0.005,
    tier:         'low',
    currency:     'USD',
    basis:        'per-image',
    note:         'Estimate: ~$0.005 per generated image',
    activationRisk: 'low',
  },
  'wan': {
    perDispatch:  0.100,
    tier:         'variable',
    currency:     'USD',
    basis:        'per-generation',
    note:         'Estimate: self-hosted GPU compute or cloud API',
    activationRisk: 'medium',
  },
  'comfyui': {
    perDispatch:  0.000,
    tier:         'free',
    currency:     'USD',
    basis:        'per-generation',
    note:         'Self-hosted local GPU — no per-call API fee',
    activationRisk: 'none',
  },
};

// Adapter display names for reporting
const ADAPTER_LABELS = {
  'openclaw':   'OpenClaw Gateway',
  'hermes':     'Hermes Agent',
  'claude-code':'Claude Code',
  'codex':      'Codex',
  'heygen':     'HeyGen',
  'higgsfield': 'Higgsfield',
  'openart':    'OpenArt',
  'wan':        'Wan',
  'comfyui':    'ComfyUI',
};

// ── File helpers ──────────────────────────────────────────────────────────────

function readJson(fp, fb) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return fb; }
}

function writeJson(fp, data) {
  fs.writeFileSync(fp, JSON.stringify(data, null, 2));
}

// ── Data loaders ──────────────────────────────────────────────────────────────

function loadDispatchLog() {
  return readJson(DISPATCH_LOG, []);
}

function loadAgentRegistry() {
  const raw = readJson(AGENT_REG, []);
  return Array.isArray(raw) ? raw : (raw.agents || []);
}

function loadTasks() {
  const raw = readJson(TASKS_FILE, []);
  return Array.isArray(raw) ? raw : [];
}

function buildAgentAdapterMap(agents) {
  const map = {};
  for (const a of agents) {
    map[a.id] = {
      adapterId:   a.adapterId,
      displayName: a.displayName,
      department:  a.department,
      status:      a.status,
    };
  }
  return map;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function todayStr()   { return new Date().toISOString().split('T')[0]; }
function daysAgoIso(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function isToday(ts)   { return ts?.startsWith(todayStr()); }
function isInLast(ts, days) {
  if (!ts) return false;
  return new Date(ts) >= new Date(daysAgoIso(days));
}

// ── Core cost estimator ───────────────────────────────────────────────────────

export function estimateDispatchCost(record, agentAdapterMap) {
  if (!record) return 0;
  const agentInfo = agentAdapterMap?.[record.selectedAgentId];
  const adapterId = agentInfo?.adapterId || null;
  if (!adapterId) return 0;
  const model = ADAPTER_COST_MODEL[adapterId];
  if (!model) return 0;
  return model.perDispatch ?? 0;
}

// ── Per-workflow cost ─────────────────────────────────────────────────────────

export function estimateWorkflowCost(workflowId) {
  const tasks       = loadTasks();
  const log         = loadDispatchLog();
  const agents      = loadAgentRegistry();
  const adapterMap  = buildAgentAdapterMap(agents);

  const workflowTasks = tasks.filter(t => t.workflowId === workflowId);
  if (workflowTasks.length === 0) return { workflowId, taskCount: 0, estimatedCost: 0, dispatches: 0 };

  const taskIdSet = new Set(workflowTasks.map(t => t.id));
  const dispatches = log.filter(r => taskIdSet.has(r.taskId));
  const cost = dispatches.reduce((s, r) => s + estimateDispatchCost(r, adapterMap), 0);

  return {
    workflowId,
    taskCount:     workflowTasks.length,
    dispatches:    dispatches.length,
    estimatedCost: +cost.toFixed(4),
  };
}

// ── Per-agent cost ────────────────────────────────────────────────────────────

export function estimateAgentCost(agentId, log, agentAdapterMap) {
  const agentDispatches = log.filter(r => r.selectedAgentId === agentId);
  const totalCost = agentDispatches.reduce((s, r) => s + estimateDispatchCost(r, agentAdapterMap), 0);
  const avgCost   = agentDispatches.length > 0 ? totalCost / agentDispatches.length : 0;

  const todayDispatches = agentDispatches.filter(r => isToday(r.timestamp));
  const weekDispatches  = agentDispatches.filter(r => isInLast(r.timestamp, 7));
  const monthDispatches = agentDispatches.filter(r => isInLast(r.timestamp, 30));

  const info = agentAdapterMap?.[agentId];

  return {
    agentId,
    displayName:      info?.displayName || agentId,
    department:       info?.department || '—',
    adapterId:        info?.adapterId || null,
    status:           info?.status || 'unknown',
    totalDispatches:  agentDispatches.length,
    todayDispatches:  todayDispatches.length,
    weekDispatches:   weekDispatches.length,
    monthDispatches:  monthDispatches.length,
    estimatedCostTotal: +totalCost.toFixed(4),
    estimatedCostToday: +(todayDispatches.reduce((s, r) => s + estimateDispatchCost(r, agentAdapterMap), 0)).toFixed(4),
    estimatedCostWeek:  +(weekDispatches.reduce((s, r)  => s + estimateDispatchCost(r, agentAdapterMap), 0)).toFixed(4),
    estimatedCostMonth: +(monthDispatches.reduce((s, r) => s + estimateDispatchCost(r, agentAdapterMap), 0)).toFixed(4),
    avgCostPerDispatch: +avgCost.toFixed(4),
  };
}

// ── Per-adapter cost ──────────────────────────────────────────────────────────

export function estimateAdapterCost(adapterId, log, agentAdapterMap) {
  const adapterDispatches = log.filter(r => agentAdapterMap?.[r.selectedAgentId]?.adapterId === adapterId);
  const totalCost = adapterDispatches.reduce((s, r) => s + estimateDispatchCost(r, agentAdapterMap), 0);

  const todayDispatches = adapterDispatches.filter(r => isToday(r.timestamp));
  const weekDispatches  = adapterDispatches.filter(r => isInLast(r.timestamp, 7));
  const monthDispatches = adapterDispatches.filter(r => isInLast(r.timestamp, 30));

  const model = ADAPTER_COST_MODEL[adapterId] || {};

  // Project monthly: if we have 7+ days of data, extrapolate; else use total as base
  const dataWindowDays = Math.min(30, 7); // default 7-day window for projection
  const projectedMonthlyDispatches = weekDispatches.length > 0
    ? Math.round((weekDispatches.length / 7) * 30)
    : Math.round((adapterDispatches.length / Math.max(1, 30)) * 30);
  const projectedMonthlyCost = projectedMonthlyDispatches * (model.perDispatch || 0);

  return {
    adapterId,
    displayName:               ADAPTER_LABELS[adapterId] || adapterId,
    tier:                      model.tier || 'unknown',
    basis:                     model.basis || 'per-dispatch',
    perDispatch:               model.perDispatch ?? 0,
    note:                      model.note || '',
    activationRisk:            model.activationRisk || 'unknown',
    totalDispatches:           adapterDispatches.length,
    todayDispatches:           todayDispatches.length,
    weekDispatches:            weekDispatches.length,
    monthDispatches:           monthDispatches.length,
    estimatedCostTotal:        +totalCost.toFixed(4),
    estimatedCostToday:        +(todayDispatches.reduce((s, r) => s + estimateDispatchCost(r, agentAdapterMap), 0)).toFixed(4),
    estimatedCostWeek:         +(weekDispatches.reduce((s, r)  => s + estimateDispatchCost(r, agentAdapterMap), 0)).toFixed(4),
    estimatedCostMonth:        +(monthDispatches.reduce((s, r) => s + estimateDispatchCost(r, agentAdapterMap), 0)).toFixed(4),
    projectedMonthlyDispatches,
    projectedMonthlyCost:      +projectedMonthlyCost.toFixed(4),
  };
}

// ── Per-lane cost ─────────────────────────────────────────────────────────────

export function estimateLaneCost(laneId, log, agentAdapterMap) {
  const key = laneId === null ? 'none' : laneId;
  const laneDispatches = log.filter(r => {
    const rl = r.laneId || 'none';
    return rl === key;
  });
  const totalCost   = laneDispatches.reduce((s, r) => s + estimateDispatchCost(r, agentAdapterMap), 0);
  const weekDisp    = laneDispatches.filter(r => isInLast(r.timestamp, 7));
  const monthDisp   = laneDispatches.filter(r => isInLast(r.timestamp, 30));

  const LANE_LABELS = {
    'digital-diamond': 'Digital Diamond AI',
    'managed-by-mika': 'Managed by Mika',
    'medai':           'MedAI',
    'cannaops':        'CannaOps',
    'hotel-hooker':    'The Hotel Hooker',
    'ai-twin':         'AI Twin Studio',
    'lead-recovery':   'Lead Recovery',
    'none':            'General / No Lane',
  };

  return {
    laneId:             key,
    displayName:        LANE_LABELS[key] || key,
    totalDispatches:    laneDispatches.length,
    weekDispatches:     weekDisp.length,
    monthDispatches:    monthDisp.length,
    estimatedCostTotal: +totalCost.toFixed(4),
    estimatedCostWeek:  +(weekDisp.reduce((s, r) => s + estimateDispatchCost(r, agentAdapterMap), 0)).toFixed(4),
    estimatedCostMonth: +(monthDisp.reduce((s, r) => s + estimateDispatchCost(r, agentAdapterMap), 0)).toFixed(4),
  };
}

// ── Workflow type averages ────────────────────────────────────────────────────

function computeWorkflowAverages(log, agentAdapterMap) {
  const tasks = loadTasks();

  // Build taskId → workflowId map
  const taskWorkflowMap = {};
  const workflowTypes   = {};
  for (const t of tasks) {
    if (t.workflowId) {
      taskWorkflowMap[t.id] = t.workflowId;
      workflowTypes[t.workflowId] = t.workflowType || 'unknown';
    }
  }

  // Group dispatch costs by workflow
  const workflowCosts = {};
  for (const r of log) {
    const wfId = taskWorkflowMap[r.taskId];
    if (!wfId) continue;
    if (!workflowCosts[wfId]) workflowCosts[wfId] = { type: workflowTypes[wfId], totalCost: 0, dispatches: 0 };
    workflowCosts[wfId].totalCost += estimateDispatchCost(r, agentAdapterMap);
    workflowCosts[wfId].dispatches++;
  }

  // Average by workflow type
  const typeAverages = {};
  for (const [wfId, data] of Object.entries(workflowCosts)) {
    const t = data.type;
    if (!typeAverages[t]) typeAverages[t] = { type: t, totalCost: 0, workflowCount: 0, totalDispatches: 0 };
    typeAverages[t].totalCost      += data.totalCost;
    typeAverages[t].workflowCount  += 1;
    typeAverages[t].totalDispatches += data.dispatches;
  }

  return Object.values(typeAverages).map(t => ({
    workflowType:      t.type,
    workflowCount:     t.workflowCount,
    totalDispatches:   t.totalDispatches,
    estimatedCostTotal: +t.totalCost.toFixed(4),
    avgCostPerWorkflow: +(t.totalCost / t.workflowCount).toFixed(4),
    avgDispatchesPerWorkflow: Math.round(t.totalDispatches / t.workflowCount),
  }));
}

// ── Projected activation costs ────────────────────────────────────────────────
// For staged adapters: show cost impact if activated at estimated dispatch rates.

function computeActivationProjections(agents, log, agentAdapterMap) {
  const AVG_MONTHLY_DISPATCHES = 30; // conservative baseline per agent

  const stagedAdapters = new Set(
    agents.filter(a => a.status === 'staged').map(a => a.adapterId).filter(Boolean)
  );

  const projections = [];
  for (const adapterId of stagedAdapters) {
    const model = ADAPTER_COST_MODEL[adapterId];
    if (!model) continue;
    const projectedCost = AVG_MONTHLY_DISPATCHES * (model.perDispatch || 0);
    projections.push({
      adapterId,
      displayName:          ADAPTER_LABELS[adapterId] || adapterId,
      perDispatch:          model.perDispatch ?? 0,
      tier:                 model.tier,
      activationRisk:       model.activationRisk,
      projectedMonthlyDispatches: AVG_MONTHLY_DISPATCHES,
      projectedMonthlyCost: +projectedCost.toFixed(4),
      projectedAnnualCost:  +(projectedCost * 12).toFixed(4),
      note:                 model.note,
    });
  }

  return projections.sort((a, b) => b.projectedMonthlyCost - a.projectedMonthlyCost);
}

// ── Alerts ────────────────────────────────────────────────────────────────────

function computeAlerts(agentCosts, adapterCosts, agents) {
  const alerts = [];

  // High-cost staged adapters
  const HIGH_COST_THRESHOLD = 0.10; // $0.10/dispatch is high
  for (const a of adapterCosts) {
    if (a.perDispatch >= HIGH_COST_THRESHOLD) {
      const agentCount = agents.filter(ag => ag.adapterId === a.adapterId && ag.status === 'staged').length;
      if (agentCount > 0) {
        alerts.push({
          type:     'high-cost-staged',
          severity: 'warning',
          adapterId: a.adapterId,
          title:    `${a.displayName} is staged — ${agentCount} agent${agentCount > 1 ? 's' : ''} waiting`,
          detail:   `At $${a.perDispatch}/dispatch, 30 dispatches/month = $${(a.perDispatch * 30).toFixed(2)}/mo. Activate only when needed.`,
          cost:     a.perDispatch,
        });
      }
    }
  }

  // Unused active adapters (zero dispatches ever)
  for (const a of adapterCosts) {
    if (a.totalDispatches === 0 && agents.find(ag => ag.adapterId === a.adapterId && ag.status === 'active')) {
      alerts.push({
        type:     'unused-active',
        severity: 'info',
        adapterId: a.adapterId,
        title:    `${a.displayName} is active but has 0 dispatches`,
        detail:   'Active adapter with no dispatch history. Confirm it is reachable via health check.',
        cost:     null,
      });
    }
  }

  // Hermes free tier — flag how much it's saving
  const hermesData = adapterCosts.find(a => a.adapterId === 'hermes');
  if (hermesData && hermesData.totalDispatches > 0) {
    const openclawData = adapterCosts.find(a => a.adapterId === 'openclaw');
    const openclawRate = ADAPTER_COST_MODEL['openclaw'].perDispatch;
    const savingsIfOpenClaw = hermesData.totalDispatches * openclawRate;
    alerts.push({
      type:     'hermes-savings',
      severity: 'info',
      adapterId: 'hermes',
      title:    `Hermes running ${hermesData.totalDispatches} dispatches free`,
      detail:   `Self-hosted advantage — equivalent OpenClaw cost would be $${savingsIfOpenClaw.toFixed(2)} total.`,
      cost:     0,
    });
  }

  return alerts;
}

// ── Optimization opportunities ────────────────────────────────────────────────

function computeOpportunities(agentCosts, adapterCosts, agents) {
  const opportunities = [];

  // Route content tasks to Hermes instead of OpenClaw where possible
  const openclawData = adapterCosts.find(a => a.adapterId === 'openclaw');
  if (openclawData && openclawData.totalDispatches > 0) {
    opportunities.push({
      type:         'route-to-hermes',
      title:        'Route content tasks to Hermes',
      detail:       `Hermes handles the same task types as OpenClaw at $0 cost. ${openclawData.totalDispatches} OpenClaw dispatches could partially route to Hermes.`,
      potentialSaving: +(openclawData.estimatedCostTotal * 0.4).toFixed(4), // 40% est. moveable
      action:       'Review task routing rules in dispatchTask.js — some content tasks can prefer hermes adapter',
      priority:     'medium',
    });
  }

  // Use ComfyUI instead of OpenArt for image tasks (local vs. paid API)
  const openartAgents = agents.filter(a => a.adapterId === 'openart');
  if (openartAgents.length > 0) {
    opportunities.push({
      type:         'use-comfyui',
      title:        'Use ComfyUI (free) instead of OpenArt ($0.005/image)',
      detail:       `ComfyUI is self-hosted and free. At 100 images/month, OpenArt costs $0.50/mo. ComfyUI is already in the adapter registry.`,
      potentialSaving: +(100 * 0.005).toFixed(4),
      action:       'Assign visual-designer to comfyui adapter; activate ComfyUI locally first',
      priority:     'low',
    });
  }

  // Stagger HeyGen activations — only activate when content pipeline is ready
  const heygenAgents = agents.filter(a => a.adapterId === 'heygen');
  if (heygenAgents.length > 0) {
    opportunities.push({
      type:         'stagger-heygen',
      title:        'Delay HeyGen activation until content pipeline is proven',
      detail:       `HeyGen at $0.25/video is the highest API cost in the stack. Prove the content brief → script pipeline first with Hermes before adding video spend.`,
      potentialSaving: +(30 * 0.25).toFixed(4),
      action:       'Keep video-producer staged until OpenClaw + Hermes pipeline is stable',
      priority:     'high',
    });
  }

  // Reuse artifacts — check if same workflow content is dispatched multiple times
  opportunities.push({
    type:         'artifact-reuse',
    title:        'Cache and reuse content artifacts across lanes',
    detail:       `If the same brief or script is dispatched to multiple lanes, cache the artifact and reuse. Reduces repeat dispatches.`,
    potentialSaving: null,
    action:       'Add artifact deduplication check in dispatchTask.js using content hash',
    priority:     'medium',
  });

  return opportunities;
}

// ── Full cost summary ─────────────────────────────────────────────────────────

export function getCostSummary(save = true) {
  const log        = loadDispatchLog();
  const agents     = loadAgentRegistry();
  const adapterMap = buildAgentAdapterMap(agents);
  const now        = new Date();
  const today      = todayStr();

  // Time-windowed dispatch subsets
  const todayLog  = log.filter(r => isToday(r.timestamp));
  const weekLog   = log.filter(r => isInLast(r.timestamp, 7));
  const monthLog  = log.filter(r => isInLast(r.timestamp, 30));

  const sumCost = (subset) => +subset.reduce((s, r) => s + estimateDispatchCost(r, adapterMap), 0).toFixed(4);

  const costToday = sumCost(todayLog);
  const costWeek  = sumCost(weekLog);
  const costMonth = sumCost(monthLog);

  // Projected month: extrapolate from last 7 days
  const dailyRate    = weekLog.length / 7;
  const projDisp     = Math.round(dailyRate * 30);
  const avgCostPerD  = weekLog.length > 0 ? sumCost(weekLog) / weekLog.length : 0;
  const projCost     = +(projDisp * avgCostPerD).toFixed(4);

  const summary = {
    today:          { dispatches: todayLog.length,  estimatedCost: costToday },
    week:           { dispatches: weekLog.length,   estimatedCost: costWeek  },
    month:          { dispatches: monthLog.length,  estimatedCost: costMonth  },
    allTime:        { dispatches: log.length,       estimatedCost: sumCost(log) },
    projectedMonth: { dispatches: projDisp,         estimatedCost: projCost   },
    avgCostPerDispatch: +(log.length > 0 ? sumCost(log) / log.length : 0).toFixed(4),
  };

  // Per-agent
  const allAgentIds = [...new Set(log.map(r => r.selectedAgentId).filter(Boolean))];
  const byAgent = allAgentIds.map(id => estimateAgentCost(id, log, adapterMap))
    .sort((a, b) => b.estimatedCostTotal - a.estimatedCostTotal);

  // Per-adapter (all registered adapters, not just ones with dispatches)
  const allAdapterIds = Object.keys(ADAPTER_COST_MODEL);
  const byAdapter = allAdapterIds.map(id => estimateAdapterCost(id, log, adapterMap))
    .sort((a, b) => b.estimatedCostTotal - a.estimatedCostTotal);

  // Per-lane
  const allLaneIds = [...new Set(log.map(r => r.laneId || 'none'))];
  const byLane = allLaneIds.map(id => estimateLaneCost(id === 'none' ? null : id, log, adapterMap))
    .sort((a, b) => b.estimatedCostTotal - a.estimatedCostTotal);

  // Workflow averages
  const workflowAverages = computeWorkflowAverages(log, adapterMap);

  // Activation projections
  const activationProjections = computeActivationProjections(agents, log, adapterMap);

  // Alerts + opportunities
  const alerts        = computeAlerts(byAgent, byAdapter, agents);
  const opportunities = computeOpportunities(byAgent, byAdapter, agents);

  // Highlights for Executive Intelligence
  const highestCostAgent   = byAgent[0] || null;
  const highestCostAdapter = byAdapter.filter(a => a.estimatedCostTotal > 0)[0] || null;

  const result = {
    updatedAt: now.toISOString(),
    summary,
    byAgent,
    byAdapter,
    byLane,
    workflowAverages,
    activationProjections,
    alerts,
    opportunities,
    highlights: {
      highestCostAgent:   highestCostAgent   ? { agentId: highestCostAgent.agentId,   displayName: highestCostAgent.displayName,   estimatedCostTotal: highestCostAgent.estimatedCostTotal,   adapterId: highestCostAgent.adapterId }   : null,
      highestCostAdapter: highestCostAdapter ? { adapterId: highestCostAdapter.adapterId, displayName: highestCostAdapter.displayName, estimatedCostTotal: highestCostAdapter.estimatedCostTotal } : null,
      costToday:  costToday,
      costMonth:  costMonth,
      projCost:   projCost,
    },
  };

  if (save) {
    try { writeJson(COST_FILE, result); } catch {}
  }

  return result;
}

export function loadCostIntelligence() {
  return readJson(COST_FILE, null);
}
