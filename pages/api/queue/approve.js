import { loadQueue } from '../../../lib/queue/loadQueue';
import { approveQueueItem } from '../../../lib/queue/saveQueue';
import { sendTelegramMessage } from '../../../lib/telegram/sendTelegramMessage';
import { formatApprovedMessage } from '../../../lib/telegram/formatMessages';

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { queueId } = req.body || {};
  if (!queueId) return res.status(400).json({ error: 'queueId required' });

  const queue   = loadQueue();
  const updated = approveQueueItem(queueId, queue);

  if (!updated) return res.status(404).json({ error: `Queue item ${queueId} not found` });

  sendTelegramMessage(formatApprovedMessage(updated)).catch(() => {});

  return res.status(200).json({ success: true, entry: updated });
}
