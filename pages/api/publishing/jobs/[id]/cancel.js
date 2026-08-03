// POST /api/publishing/jobs/[id]/cancel
// Cancels a non-terminal publish job. Never touches the underlying
// production job/artifact.

import { isValidId, isValidPublishTransition, makeActivityEvent } from '../../../../../lib/publishing/publishingRules';
import { getPublishJob, updatePublishJob } from '../../../../../lib/publishing/publishJobStore';

export const config = {
  api: { bodyParser: { sizeLimit: '4kb' } },
};

const MAX_NOTE_CHARS = 500;

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

  if (!isValidPublishTransition(job.status, 'cancelled')) {
    return res.status(409).json({ ok: false, error: `Cannot cancel from status "${job.status}".` });
  }

  const { note } = req.body || {};
  if (note !== undefined && (typeof note !== 'string' || note.length > MAX_NOTE_CHARS)) {
    return res.status(400).json({ ok: false, error: `note must be a string of ${MAX_NOTE_CHARS} characters or fewer.` });
  }

  const updated = updatePublishJob(id, {
    status: 'cancelled',
    activityHistory: [...job.activityHistory, makeActivityEvent('cancelled', { actor: 'user', note: note || null })],
  });

  return res.status(200).json({ ok: true, job: updated });
}
