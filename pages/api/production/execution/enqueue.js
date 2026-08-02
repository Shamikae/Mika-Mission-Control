// POST /api/production/execution/enqueue
// Validates execution eligibility and queues a ready Production Job for
// execution. Never bypasses Router-owned readiness/approval gates.
//
// Input:  { productionJobId, maxAttempts?, userNote? }
// Output: { ok: true, job, queuePosition } | { ok: false, error, reasons? }

import { enqueueExecutionForJob } from '../../../../lib/production/execution/executionEngine';
import { isValidId } from '../../../../lib/production/productionRules';
import { sanitizeExecutionForResponse } from '../../../../lib/production/execution/executionRules';

export const config = {
  api: { bodyParser: { sizeLimit: '16kb' } },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { productionJobId, maxAttempts, userNote } = req.body || {};

  if (!productionJobId || typeof productionJobId !== 'string' || !isValidId(productionJobId)) {
    return res.status(400).json({ ok: false, error: 'A valid productionJobId is required.' });
  }
  if (userNote !== undefined && (typeof userNote !== 'string' || userNote.length > 500)) {
    return res.status(400).json({ ok: false, error: 'userNote must be a string of 500 characters or fewer.' });
  }

  const result = await enqueueExecutionForJob(productionJobId, { maxAttempts, userNote, actor: 'user' });
  if (!result.ok) {
    return res.status(result.status || 409).json({ ok: false, error: result.error, reasons: result.reasons });
  }

  return res.status(200).json({
    ok: true,
    queuePosition: result.queuePosition,
    job: { ...result.job, execution: sanitizeExecutionForResponse(result.job.execution) },
  });
}
