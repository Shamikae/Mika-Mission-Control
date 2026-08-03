// POST /api/publishing/jobs/[id]/schedule
// Transitions ready -> scheduled. Schedule METADATA ONLY — no background
// scheduler, no automatic execution. scheduledFor is simply stored and
// displayed; nothing in this app ever wakes up and publishes it.
//
// Input: { scheduledFor: ISO date string }

import { isValidId, isValidPublishTransition, makeActivityEvent } from '../../../../../lib/publishing/publishingRules';
import { getPublishJob, updatePublishJob } from '../../../../../lib/publishing/publishJobStore';

export const config = {
  api: { bodyParser: { sizeLimit: '4kb' } },
};

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const { id } = req.query;
  if (!id || !isValidId(id)) {
    return res.status(400).json({ ok: false, error: 'Invalid publish job id.' });
  }
  const job = getPublishJob(id);
  if (!job) return res.status(404).json({ ok: false, error: `Publish job "${id}" not found.` });

  if (!isValidPublishTransition(job.status, 'scheduled')) {
    return res.status(409).json({ ok: false, error: `Cannot schedule from status "${job.status}".` });
  }

  const { scheduledFor } = req.body || {};
  const parsed = typeof scheduledFor === 'string' ? new Date(scheduledFor) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    return res.status(400).json({ ok: false, error: 'scheduledFor must be a valid ISO date string.' });
  }

  const updated = updatePublishJob(id, {
    status: 'scheduled',
    scheduledFor: parsed.toISOString(),
    activityHistory: [...job.activityHistory, makeActivityEvent('scheduled', { actor: 'user', note: parsed.toISOString() })],
  });

  return res.status(200).json({ ok: true, job: updated });
}
