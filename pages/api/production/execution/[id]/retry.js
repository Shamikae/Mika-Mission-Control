// POST /api/production/execution/[id]/retry
// Only a "failed" execution with a retryable errorReason and remaining
// attempts may be retried. Requeues safely (never submits a second provider
// job while the first is still active — a job in any active execution
// state can never be "failed", so this can't race with an in-flight attempt).
//
// Output: { ok: true, job } | { ok: false, error }

import { retryExecutionForJob } from '../../../../../lib/production/execution/executionEngine';
import { isValidId } from '../../../../../lib/production/productionRules';
import { sanitizeExecutionForResponse } from '../../../../../lib/production/execution/executionRules';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string' || !isValidId(id)) {
    return res.status(400).json({ ok: false, error: 'Invalid job id.' });
  }

  const result = await retryExecutionForJob(id, { actor: 'user' });
  if (!result.ok) {
    return res.status(result.status || 409).json({ ok: false, error: result.error });
  }
  return res.status(200).json({ ok: true, job: { ...result.job, execution: sanitizeExecutionForResponse(result.job.execution) } });
}
