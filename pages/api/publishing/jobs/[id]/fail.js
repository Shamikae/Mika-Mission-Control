// POST /api/publishing/jobs/[id]/fail
// Manually marks a ready/scheduled publish job as failed — e.g. the
// platform rejected the manual upload. Requires a reason; never inferred.

import { isValidId, isValidPublishTransition, makeActivityEvent } from '../../../../../lib/publishing/publishingRules';
import { getPublishJob, updatePublishJob } from '../../../../../lib/publishing/publishJobStore';

export const config = {
  api: { bodyParser: { sizeLimit: '4kb' } },
};

const MAX_REASON_CHARS = 500;

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

  if (!isValidPublishTransition(job.status, 'failed')) {
    return res.status(409).json({ ok: false, error: `Cannot mark failed from status "${job.status}".` });
  }

  const { reason } = req.body || {};
  if (typeof reason !== 'string' || !reason.trim()) {
    return res.status(400).json({ ok: false, error: 'A reason is required to mark a publish job as failed.' });
  }
  const clampedReason = reason.trim().slice(0, MAX_REASON_CHARS);

  const updated = updatePublishJob(id, {
    status: 'failed',
    publishResult: { confirmedBy: 'user', reason: clampedReason, at: new Date().toISOString() },
    activityHistory: [...job.activityHistory, makeActivityEvent('failed', { actor: 'user', note: clampedReason })],
  });

  return res.status(200).json({ ok: true, job: updated });
}
