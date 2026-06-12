// adapters/hermes.adapter.js
// Active adapter — routes tasks through the Hermes SSH/HTTP bridge on the VPS.
// Handles content execution and acts as execution fallback for staged specialist agents.

import { sendHermesChatMessage }  from '../lib/hermes/chat.js';
import { loadBusinessLaneContext } from '../lib/context/loadBusinessLaneContext.js';
import { getSkillPrompt, validateSkill } from '../lib/agents/loadSkill.js';

const LANE_LABELS = {
  'digital-diamond': 'Digital Diamond AI',
  'managed-by-mika': 'Managed by Mika',
  'medai':           'MedAI',
  'cannaops':        'CannaOps',
  'hotel-hooker':    'The Hotel Hooker',
  'ai-twin':         'AI Twin Content Studio',
  'lead-recovery':   'Lead Recovery',
};

function buildMessage(task, skillPrompt = null) {
  const laneId    = task.lane || task.laneId;
  const laneLabel = LANE_LABELS[laneId] || laneId || 'General';
  const ctx       = loadBusinessLaneContext(laneId);
  const mission   = ctx?.mission ? `\nMission: ${ctx.mission.slice(0, 120)}` : '';

  const taskBlock = [
    `[TASK DISPATCH via Hermes Adapter]`,
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

  return skillPrompt ? `${skillPrompt}\n\n${taskBlock}` : [
    ...taskBlock.split('\n').slice(0, -1),
    `Please process this task and provide a structured response with key findings and recommended actions.`,
  ].join('\n');
}

const hermesAdapter = {
  adapterId:         'hermes',
  displayName:       'Hermes Agent',
  status:            'active',
  supportedTaskTypes: [
    'send_message', 'broadcast', 'route_comms', 'translate', 'summarize_thread',
    'draft_reply', 'research', 'kanban_update',
    'trend_discovery', 'viral_research', 'competitor_analysis', 'platform_scan', 'opportunity_scoring',
    'hook_writing', 'angle_generation', 'format_selection', 'trend_synthesis',
    'content_brief', 'content_creation', 'social_media_post', 'email_draft',
    'image_generation', 'video_generation', 'audio_transcription', 'specialized_task',
    'Content Strategy', 'Revenue Strategy',
  ],

  async healthCheck() {
    const enabled = process.env.HERMES_ENABLED === 'true';
    const apiUrl  = process.env.HERMES_API_URL || '';
    if (!enabled) {
      return { ok: false, status: 'disabled', error: 'HERMES_ENABLED is not set to true', adapterId: 'hermes' };
    }
    if (!apiUrl) {
      return { ok: false, status: 'misconfigured', error: 'HERMES_API_URL not set', adapterId: 'hermes' };
    }
    const t0 = Date.now();
    try {
      const res = await fetch(`${apiUrl.replace(/\/$/, '')}/health`, {
        signal: AbortSignal.timeout(4000),
      });
      const latencyMs = Date.now() - t0;
      return { ok: res.ok, latencyMs, status: res.ok ? 'active' : 'degraded', adapterId: 'hermes' };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t0, status: 'offline', error: e.message, adapterId: 'hermes' };
    }
  },

  async execute(task, decision) {
    // Resolve intended specialist agent for skill injection (when Hermes executes as fallback)
    const intendedAgentId = decision.usingFallback
      ? decision.fallbackAgent?.id
      : decision.selectedAgent?.id;

    const skillPrompt     = getSkillPrompt(intendedAgentId) || null;
    const skillValidation = validateSkill(intendedAgentId);

    const selectedSkill = {
      agentId: intendedAgentId || null,
      skillId: skillValidation.skillId,
      loaded:  skillValidation.exists && !!skillPrompt,
      engine:  'hermes',
    };

    const message  = buildMessage(task, skillPrompt);
    const chatMode = process.env.HERMES_CHAT_MODE || 'cli';
    const result   = await sendHermesChatMessage(message, { session: null });

    const output   = result.reply || null;
    const ok       = result.ok && !!output;
    const errorMsg = result.error ?? (!output ? 'No output from Hermes' : null);

    return {
      ok,
      executionStatus: ok ? 'success' : 'failed',
      executionMode:   `ssh-http:${chatMode}`,
      executionTarget: 'hermes',
      adapterId:       'hermes',
      selectedSkill,
      output,
      outputSummary:   output ? output.slice(0, 150) + (output.length > 150 ? '…' : '') : null,
      error:           ok ? null : errorMsg,
      errorSummary:    errorMsg ? errorMsg.slice(0, 120) : null,
      httpStatus:      null,
      rawResponse:     { reply: result.reply, sessionId: result.sessionId, stderr: result.stderr },
      decision,
      timestamp:       new Date().toISOString(),
    };
  },

  validateInput(task) {
    const errors = [];
    if (!task.taskId && !task.id) errors.push('taskId is required');
    if (!task.taskType)           errors.push('taskType is required');
    if (!task.instructions && !task.description) errors.push('instructions or description is required');
    return { valid: errors.length === 0, errors };
  },

  estimateCost(task) {
    // Hermes runs on self-hosted VPS — compute cost only, no per-token fee
    return { estimatedCost: 0, currency: 'USD', tier: 'free', note: 'Self-hosted VPS compute — no per-call fee' };
  },
};

export default hermesAdapter;
