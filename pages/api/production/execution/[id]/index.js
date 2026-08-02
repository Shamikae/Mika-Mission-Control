// GET /api/production/execution/[id]
// Sanitized execution status for a Production Job. If no execution record
// exists yet, synthesizes a 'ready' | 'not_eligible' view instead of 404ing,
// so the UI can render an honest pre-queue state.

import { getExecutionView } from '../../../../../lib/production/execution/executionEngine';
import { isValidId } from '../../../../../lib/production/productionRules';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string' || !isValidId(id)) {
    return res.status(400).json({ ok: false, error: 'Invalid job id.' });
  }

  const result = await getExecutionView(id);
  if (!result.ok) {
    return res.status(result.status || 404).json({ ok: false, error: result.error });
  }
  return res.status(200).json(result);
}
