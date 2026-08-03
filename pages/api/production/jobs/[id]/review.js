// POST /api/production/jobs/[id]/review
// Server-managed output-review state for a COMPLETED Production Job.
// Independent of plan approval (job.approval) — this reviews the final
// generated OUTPUT, not the plan. Admin protected automatically
// (middleware.js gates every non-GET route). Never publishes anything —
// Publishing Router is a separate, future milestone.
//
// Input:  { status: "approved" | "rejected", note?: string }
// Output: { ok: true, job } | { ok: false, error }

import { getProductionJob, updateProductionJob } from '../../../../../lib/production/productionJobStore';
import { isValidId, makeActivityEvent } from '../../../../../lib/production/productionRules';
import { sanitizeExecutionForResponse } from '../../../../../lib/production/execution/executionRules';

const MAX_NOTE_CHARS = 500;

function sanitizeJob(job) {
  return job ? { ...job, execution: sanitizeExecutionForResponse(job.execution) } : job;
}

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string' || !isValidId(id)) {
    return res.status(400).json({ ok: false, error: 'Invalid job id.' });
  }

  const job = getProductionJob(id);
  if (!job) return res.status(404).json({ ok: false, error: `Job "${id}" not found.` });

  if (job.execution?.status !== 'completed') {
    return res.status(409).json({ ok: false, error: `Output review only applies to a completed execution (current: "${job.execution?.status || 'none'}").` });
  }

  const { status, note } = req.body || {};
  if (status !== 'approved' && status !== 'rejected') {
    return res.status(400).json({ ok: false, error: 'status must be "approved" or "rejected".' });
  }
  if (note !== undefined && typeof note !== 'string') {
    return res.status(400).json({ ok: false, error: 'note must be a string.' });
  }
  const clampedNote = typeof note === 'string' ? note.slice(0, MAX_NOTE_CHARS) : '';

  // Note: `execution`/`outputs`/`artifactUrl` are never read from the request
  // body above — this route can only ever write job.review, never any
  // execution or artifact field, regardless of what a client sends.
  const now = new Date().toISOString();
  const updated = updateProductionJob(id, {
    review: { status, reviewedAt: now, reviewedBy: 'user', note: clampedNote },
    activityHistory: [...job.activityHistory, makeActivityEvent(status === 'approved' ? 'output_approved' : 'output_rejected', {
      actor: 'user', note: clampedNote || null,
    })],
  });

  return res.status(200).json({ ok: true, job: sanitizeJob(updated) });
}
