// POST /api/publishing/jobs/[id]/publish
// "Publish now" — v1 has no real platform API, so this is an explicit
// MANUAL ATTESTATION: the user confirms they uploaded the media themselves
// (e.g. via the manual export bundle) and this simply records that fact.
// Transitions ready|scheduled -> published. Requires { confirm: true } so a
// stray click can never silently mark something published.

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

  if (!isValidPublishTransition(job.status, 'published')) {
    return res.status(409).json({ ok: false, error: `Cannot publish from status "${job.status}".` });
  }

  const { confirm, note } = req.body || {};
  if (confirm !== true) {
    return res.status(400).json({ ok: false, error: 'Set confirm: true to attest this was manually published — Publishing Router v1 never uploads on your behalf.' });
  }
  if (note !== undefined && (typeof note !== 'string' || note.length > MAX_NOTE_CHARS)) {
    return res.status(400).json({ ok: false, error: `note must be a string of ${MAX_NOTE_CHARS} characters or fewer.` });
  }

  const now = new Date().toISOString();
  const updated = updatePublishJob(id, {
    status: 'published',
    publishedAt: now,
    publishResult: { confirmedBy: 'user', note: note || null, at: now },
    activityHistory: [...job.activityHistory, makeActivityEvent('published_manually', { actor: 'user', note: note || null })],
  });

  return res.status(200).json({ ok: true, job: updated });
}
