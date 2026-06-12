import { loadQueue } from '../../../lib/queue/loadQueue';
import { addToQueue } from '../../../lib/queue/saveQueue';

export default function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json(loadQueue());
  }

  if (req.method === 'POST') {
    const { task } = req.body || {};
    if (!task?.id) return res.status(400).json({ error: 'task object with id required' });
    const existing = loadQueue();
    const entry = addToQueue(task, existing);
    return res.status(201).json({ queueId: entry.queueId, entry });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
