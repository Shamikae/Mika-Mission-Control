// POST /api/production/execution/[id]/cancel
// Cancels a queued or actively-executing job, invoking the provider's own
// cancel() when a provider job is in flight, and always releasing the lock.
//
// Input:  { note? }
// Output: { ok: true, job } | { ok: false, error }

import { cancelExecutionForJob } from '../../../../../lib/production/execution/executionEngine';
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

  const { note } = req.body || {};
  if (note !== undefined && (typeof note !== 'string' || note.length > 300)) {
    return res.status(400).json({ ok: false, error: 'note must be a string of 300 characters or fewer.' });
  }

  const result = await cancelExecutionForJob(id, { actor: 'user', note });
  if (!result.ok) {
    return res.status(result.status || 409).json({ ok: false, error: result.error });
  }
  return res.status(200).json({ ok: true, job: { ...result.job, execution: sanitizeExecutionForResponse(result.job.execution) } });
}
