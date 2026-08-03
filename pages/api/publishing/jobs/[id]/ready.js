// POST /api/publishing/jobs/[id]/ready
// Transitions draft -> ready. Re-validates fresh (never trusts a stale
// cached result) — rejects with the blocking warnings if validation fails.

import { getProductionJob } from '../../../../../lib/production/productionJobStore';
import { normalizeArtifactList } from '../../../../../lib/artifacts/normalizeArtifact';
import {
  isValidId, getPlatform, validatePublishJob, isValidPublishTransition, makeActivityEvent,
} from '../../../../../lib/publishing/publishingRules';
import { getPublishJob, updatePublishJob } from '../../../../../lib/publishing/publishJobStore';

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

  if (!isValidPublishTransition(job.status, 'ready')) {
    return res.status(409).json({ ok: false, error: `Cannot mark ready from status "${job.status}".` });
  }

  const platform = getPlatform(job.platform);
  const productionJob = getProductionJob(job.productionJobId);
  const artifacts = normalizeArtifactList(productionJob?.execution?.outputs, { job: productionJob });
  const artifact = artifacts.find(a => a.artifactId === job.artifactId) || null;
  const validation = validatePublishJob({ platform, artifact, caption: job.caption, hashtags: job.hashtags });

  if (!validation.ok) {
    updatePublishJob(id, { lastValidation: { ...validation, checkedAt: new Date().toISOString() } });
    return res.status(422).json({ ok: false, error: 'Validation failed — resolve blocking issues before marking ready.', validation });
  }

  const updated = updatePublishJob(id, {
    status: 'ready',
    lastValidation: { ...validation, checkedAt: new Date().toISOString() },
    activityHistory: [...job.activityHistory, makeActivityEvent('marked_ready', { actor: 'user' })],
  });

  return res.status(200).json({ ok: true, job: updated, validation });
}
