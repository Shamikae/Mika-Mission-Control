// POST /api/production/jobs/[id]/approve
// Explicit human approval. Moves needs_approval -> ready ONLY if the job's
// readiness check passes. Never auto-approves — this is the only path that
// sets approval.approvedAt.

import { getProductionJob, updateProductionJob } from '../../../../../lib/production/productionJobStore';
import { applyProductionRefToPackage } from '../../../../../lib/production/buildProductionPlan';
import { isValidId, makeActivityEvent } from '../../../../../lib/production/productionRules';
import { sanitizeExecutionForResponse } from '../../../../../lib/production/execution/executionRules';
import { appendLedgerEntry } from '../../../../../lib/ledger/ledgerStore';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string' || !isValidId(id)) {
    return res.status(400).json({ ok: false, error: 'Invalid job id.' });
  }

  const job = getProductionJob(id);
  if (!job) return res.status(404).json({ ok: false, error: `Job "${id}" not found.` });

  if (job.status !== 'needs_approval') {
    return res.status(409).json({ ok: false, error: `Job is "${job.status}" — approval only applies to jobs in "needs_approval".` });
  }
  if (!job.readiness?.ready) {
    return res.status(409).json({ ok: false, error: 'Readiness check does not pass — cannot approve until required assets are available.' });
  }

  const now = new Date().toISOString();
  const updated = updateProductionJob(id, {
    status: 'ready',
    approval: { ...job.approval, approvedAt: now, approvedBy: 'user' },
    activityHistory: [...job.activityHistory, makeActivityEvent('approved', { actor: 'user', note: 'Explicit human approval granted.' })],
  });
  applyProductionRefToPackage(updated);

  // Approval is the one governed event that happens OUTSIDE the Execution
  // Engine, so it is recorded here rather than in the engine's single hook.
  // Every other lifecycle event (started/completed/failed/cancelled) is
  // emitted by executionEngine.js — adapters never touch the Ledger.
  const budget = updated.budget || {};
  appendLedgerEntry({
    event: 'approval_granted',
    actor: { type: 'human', id: 'user' },
    division: updated.metadata?.division || 'content',
    capability: updated.metadata?.capability || updated.selectedMode || 'video_render',
    source: {
      packageId: updated.packageId || null,
      productionJobId: updated.id,
      assetRequestId: updated.metadata?.assetRequestId || null,
      renderSpecId: updated.metadata?.renderSpecId || null,
      sceneId: updated.metadata?.sceneId ?? null,
    },
    binding: {
      providerId: updated.selectedProvider || null,
      model: updated.providerInput?.model || null,
    },
    estimate: {
      amount: budget.estimatedRange?.min ?? (budget.costTier === 'free' ? 0 : null),
      currency: budget.currency || 'USD',
      estimateType: budget.costTier === 'free' ? 'confirmed_local' : 'provisional_tier',
      confirmed: budget.costTier === 'free',
    },
    approval: { required: true, approvalRef: updated.id, approvedAt: now, approvedBy: 'user' },
    outcome: { status: 'approved' },
  });

  return res.status(200).json({ ok: true, job: { ...updated, execution: sanitizeExecutionForResponse(updated.execution) } });
}
