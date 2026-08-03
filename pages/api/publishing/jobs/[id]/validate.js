// POST /api/publishing/jobs/[id]/validate
// Validates the current platform/artifact/caption/hashtags combination.
// Never modifies media or caption — only ever reports honest warnings.
// Persists the result as job.lastValidation for display without re-running.

import { getProductionJob } from '../../../../../lib/production/productionJobStore';
import { normalizeArtifactList } from '../../../../../lib/artifacts/normalizeArtifact';
import { isValidId, getPlatform, validatePublishJob } from '../../../../../lib/publishing/publishingRules';
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

  const platform = getPlatform(job.platform);
  const productionJob = getProductionJob(job.productionJobId);
  const artifacts = normalizeArtifactList(productionJob?.execution?.outputs, { job: productionJob });
  const artifact = artifacts.find(a => a.artifactId === job.artifactId) || null;

  const validation = validatePublishJob({ platform, artifact, caption: job.caption, hashtags: job.hashtags });
  const updated = updatePublishJob(id, { lastValidation: { ...validation, checkedAt: new Date().toISOString() } });

  return res.status(200).json({ ok: true, validation: updated.lastValidation, job: updated });
}
