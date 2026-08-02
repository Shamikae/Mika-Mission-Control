// POST /api/production/execution/[id]/poll
// Polls the active provider job. Ingests outputs and completes on success.
//
// Input:  { force? }  — bypass the nextPollAt early-poll guard
// Output: { ok: true, job } | { ok: false, error, job? }

import { pollExecutionForJob } from '../../../../../lib/production/execution/executionEngine';
import { isValidId } from '../../../../../lib/production/productionRules';
import { sanitizeExecutionForResponse } from '../../../../../lib/production/execution/executionRules';

export const config = {
  api: { bodyParser: { sizeLimit: '4kb' } },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string' || !isValidId(id)) {
    return res.status(400).json({ ok: false, error: 'Invalid job id.' });
  }

  const { force } = req.body || {};
  const result = await pollExecutionForJob(id, { force: force === true, actor: 'user' });
  const job = result.job ? { ...result.job, execution: sanitizeExecutionForResponse(result.job.execution) } : null;

  if (!result.ok) {
    return res.status(result.status || 409).json({ ok: false, error: result.error, job });
  }
  return res.status(200).json({ ok: true, job });
}
