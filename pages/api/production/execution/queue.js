// GET /api/production/execution/queue
// Sanitized view of the current execution queue (FIFO order).

import { listQueue } from '../../../../lib/production/execution/executionQueue';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const items = listQueue().map((item, i) => ({
    productionJobId: item.productionJobId,
    position: i + 1,
    enqueuedAt: item.enqueuedAt,
    maxAttempts: item.maxAttempts,
    userNote: item.userNote,
  }));
  return res.status(200).json({ ok: true, items, total: items.length });
}
