import { loadQueue } from '../../../lib/queue/loadQueue';
import { updateQueueStatus } from '../../../lib/queue/saveQueue';

const VALID_STATUSES = ['queued', 'approved', 'rejected', 'dispatched', 'completed', 'failed'];

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { queueId, status } = req.body || {};
  if (!queueId) return res.status(400).json({ error: 'queueId required' });
  if (!status || !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  const patch = {
    status,
    dispatched: status === 'dispatched' || status === 'completed' || status === 'failed',
    completed:  status === 'completed',
  };

  const queue   = loadQueue();
  const updated = updateQueueStatus(queueId, patch, queue);

  if (!updated) return res.status(404).json({ error: `Queue item ${queueId} not found` });
  return res.status(200).json({ success: true, entry: updated });
}
