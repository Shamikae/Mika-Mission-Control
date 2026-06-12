// pages/api/dispatch/route-task.js
// POST — compute and return a dispatch decision for a task.
// Does NOT execute the task. Returns the decision and appends to dispatch log.
//
// Input:  { taskId, taskType, laneId, title, instructions, priority }
// Output: dispatch decision object from dispatchTask.js

import { dispatchTask } from '../../../lib/dispatch/dispatchTask';
import { appendDispatchLog } from '../../../lib/dispatch/dispatchLog';
import { validateSkill } from '../../../lib/agents/loadSkill';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { taskId, taskType, laneId, title, instructions, priority } = req.body || {};

  if (!taskType) {
    return res.status(400).json({ error: 'taskType is required' });
  }

  try {
    const decision = dispatchTask({
      taskId:       taskId       || `preview-${Date.now()}`,
      taskType:     taskType.trim(),
      laneId:       laneId       || null,
      title:        title        || taskType,
      instructions: instructions || '',
      priority:     priority     || 'Normal',
    });

    // ── Augment decision with skill info ─────────────────────────────────────
    // The intended specialist is: when usingFallback, the fallbackAgent (the
    // staged agent Hermes stands in for); otherwise the selectedAgent itself.
    const intendedAgentId = decision.usingFallback
      ? decision.fallbackAgent?.id
      : decision.selectedAgent?.id;

    const skillValidation = validateSkill(intendedAgentId);
    decision.skillInfo = {
      intendedAgentId: intendedAgentId || null,
      skillId:         skillValidation.skillId,
      skillLoaded:     skillValidation.exists,
      executionEngine: decision.executableNow
        ? (decision.selectedAgent?.id || null)
        : null,
    };

    // Append compact log entry
    appendDispatchLog({
      timestamp:       decision.decidedAt,
      taskId:          decision.taskId,
      taskType:        decision.taskType,
      laneId:          decision.laneId,
      selectedAgentId: decision.selectedAgent?.id || null,
      fallbackAgentId: decision.fallbackAgent?.id || null,
      executableNow:   decision.executableNow,
      approvalRequired: decision.approvalRequired,
      decisionReason:  decision.reason,
    });

    return res.status(200).json({
      ok: true,
      decision,
    });
  } catch (err) {
    console.error('[dispatch/route-task]', err);
    return res.status(500).json({ error: err.message || 'Dispatch decision failed' });
  }
}
