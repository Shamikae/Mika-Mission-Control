// adapters/openclaw.adapter.js
// Active adapter — routes tasks through the OpenClaw VPS gateway.
// This is the default execution target for all content and orchestration tasks.

import { callOpenClaw }            from '../lib/openclaw/callOpenClaw.js';
import { loadBusinessLaneContext } from '../lib/context/loadBusinessLaneContext.js';
import { loadLaneMemory, formatMemoryBlock } from '../lib/memory/loadLaneMemory.js';

const LANE_LABELS = {
  'digital-diamond': 'Digital Diamond AI',
  'managed-by-mika': 'Managed by Mika',
  'medai':           'MedAI',
  'cannaops':        'CannaOps',
  'hotel-hooker':    'The Hotel Hooker',
  'ai-twin':         'AI Twin Content Studio',
  'lead-recovery':   'Lead Recovery',
};

function buildMessages(task) {
  const laneId    = task.lane || task.laneId;
  const laneLabel = LANE_LABELS[laneId] || laneId || 'General';
  const ctx       = loadBusinessLaneContext(laneId);
  const memory    = loadLaneMemory(laneId);
  const memBlock  = formatMemoryBlock(memory, 5);

  let systemContent = 'You are an AI agent operating within Mika Mission Control. Process the following task and respond with your plan, key actions, and expected outcome. Be concise and structured.';

  if (ctx) {
    const ctxBlock = [
      `LANE: ${ctx.displayName}`,
      `MISSION: ${ctx.mission}`,
      `VOICE: ${ctx.voice}`,
      `FOCUS: ${ctx.contentFocus}`,
      ctx.operatingInstructions?.length ? `RULES: ${ctx.operatingInstructions.join(' | ')}` : '',
    ].filter(Boolean).join('\n');
    systemContent = `${ctxBlock}\n\n${systemContent}`;
  }

  if (memBlock) systemContent = `${systemContent}\n\n${memBlock}`;

  const userContent = [
    'TASK DISPATCH — Mika Mission Control',
    '',
    `Lane:              ${laneLabel}`,
    `Type:              ${task.taskType}`,
    `Priority:          ${task.priority || 'Normal'}`,
    `Task ID:           ${task.id || task.taskId || 'unknown'}`,
    `Dispatched via:    OpenClaw Adapter`,
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

const openclawAdapter = {
  adapterId:         'openclaw',
  displayName:       'OpenClaw Gateway',
  status:            'active',
  supportedTaskTypes: [
    'health_check', 'monitor', 'route_task', 'orchestrate', 'failover',
    'Content Strategy', 'Revenue Strategy', 'trend_discovery', 'viral_research',
    'competitor_analysis', 'opportunity_scoring', 'content_brief', 'content_creation',
    'social_media_post', 'email_draft', 'research', 'kanban_update',
  ],

  async healthCheck() {
    const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL || '';
    if (!gatewayUrl || gatewayUrl.includes('YOUR_VPS_IP')) {
      return { ok: false, status: 'misconfigured', error: 'OPENCLAW_GATEWAY_URL not set or is placeholder' };
    }
    const t0 = Date.now();
    try {
      const statusPath = process.env.OPENCLAW_STATUS_PATH || '/health';
      const apiToken   = process.env.OPENCLAW_API_TOKEN   || '';
      const res = await fetch(gatewayUrl.replace(/\/$/, '') + statusPath, {
        headers:  apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
        signal:   AbortSignal.timeout(4000),
      });
      const latencyMs = Date.now() - t0;
      return { ok: res.ok, latencyMs, status: res.ok ? 'active' : 'degraded', adapterId: 'openclaw' };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t0, status: 'offline', error: e.message, adapterId: 'openclaw' };
    }
  },

  async execute(task, decision) {
    const laneId   = task.lane || task.laneId;
    const ctx      = loadBusinessLaneContext(laneId);
    const messages = buildMessages(task);
    const model    = process.env.OPENCLAW_MODEL || 'gpt-4o';
    const result   = await callOpenClaw({ messages, model, maxTokens: 600, sessionKey: ctx?.sessionKey });

    const reply    = result.body?.choices?.[0]?.message?.content ?? null;
    const ok       = result.ok && reply !== null;
    const errorMsg = result.error ?? (!result.ok ? `HTTP ${result.httpStatus}` : null) ?? (!reply ? 'No reply in response choices' : null);

    return {
      ok,
      executionStatus: ok ? 'success' : 'failed',
      executionMode:   'gateway',
      executionTarget: 'openclaw',
      adapterId:       'openclaw',
      selectedSkill:   null,
      output:          reply,
      outputSummary:   reply ? reply.slice(0, 150) + (reply.length > 150 ? '…' : '') : null,
      error:           ok ? null : errorMsg,
      errorSummary:    errorMsg ? errorMsg.slice(0, 120) : null,
      httpStatus:      result.httpStatus,
      rawResponse:     result.body,
      decision,
      timestamp:       new Date().toISOString(),
    };
  },

  validateInput(task) {
    const errors = [];
    if (!task.taskId && !task.id) errors.push('taskId is required');
    if (!task.taskType)           errors.push('taskType is required');
    return { valid: errors.length === 0, errors };
  },

  estimateCost(task) {
    // GPT-4o: ~$0.005 per 1k input tokens + $0.015 per 1k output tokens
    // Rough estimate: 800 token prompt + 600 token output ≈ $0.013
    return { estimatedCost: 0.013, currency: 'USD', tier: 'low', note: 'Approx GPT-4o cost per task dispatch' };
  },
};

export default openclawAdapter;
