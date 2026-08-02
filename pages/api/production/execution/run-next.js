// POST /api/production/execution/run-next
// Processes exactly one queued item: dequeues (only after lock acquisition),
// calls the selected adapter's submit(), and persists the resulting state.
// No background worker — this is always an explicit, human-triggered call.
//
// Output: { ok: true, job, message? } | { ok: false, error, job? }

import { runNextExecution } from '../../../../lib/production/execution/executionEngine';
import { sanitizeExecutionForResponse } from '../../../../lib/production/execution/executionRules';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const result = await runNextExecution({ actor: 'user' });
  const job = result.job ? { ...result.job, execution: sanitizeExecutionForResponse(result.job.execution) } : null;

  // ok:false here only ever means a genuine transport-level problem (lock
  // contention, a queued job whose record vanished) — an execution that ran
  // and landed on job.execution.status === 'failed' is still ok:true, same
  // convention as Production Router's "blocked" plan creation.
  if (!result.ok) {
    return res.status(409).json({ ok: false, error: result.error, job });
  }

  return res.status(200).json({ ok: true, message: result.message || null, job });
}
