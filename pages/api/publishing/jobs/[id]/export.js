// POST /api/publishing/jobs/[id]/export
// Generates the manual publishing bundle (JSON or Markdown) — content is
// returned in the response only, never persisted (same convention as
// pages/api/production/jobs/[id]/export.js).
//
// Input:  { format: 'json' | 'markdown' }
// Output: { ok: true, format, content, job } | { ok: false, error }

import { getProductionJob } from '../../../../../lib/production/productionJobStore';
import { loadPackage } from '../../../../../lib/content/contentPackageStore';
import { normalizeArtifactList } from '../../../../../lib/artifacts/normalizeArtifact';
import { buildPublishJsonBundle, buildPublishMarkdownBrief } from '../../../../../lib/publishing/publishExport';
import { isValidId, getPlatform, makeActivityEvent } from '../../../../../lib/publishing/publishingRules';
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

  const productionJob = getProductionJob(job.productionJobId);
  if (!productionJob) return res.status(404).json({ ok: false, error: 'Source production job no longer exists.' });
  const pkg = loadPackage(job.packageId);
  if (!pkg) return res.status(404).json({ ok: false, error: `Package "${job.packageId}" not found.` });

  const platform = getPlatform(job.platform);
  const artifacts = normalizeArtifactList(productionJob.execution?.outputs, { job: productionJob });
  const artifact = artifacts.find(a => a.artifactId === job.artifactId) || null;

  const { format } = req.body || {};
  const fmt = format === 'markdown' ? 'markdown' : 'json';
  const ctx = { pkg, productionJob, publishJob: job, artifact, platform };
  const content = fmt === 'markdown' ? buildPublishMarkdownBrief(ctx) : JSON.stringify(buildPublishJsonBundle(ctx), null, 2);

  const updated = updatePublishJob(id, {
    activityHistory: [...job.activityHistory, makeActivityEvent('export_generated', { actor: 'user', note: `Exported ${fmt} bundle.` })],
  });

  return res.status(200).json({ ok: true, format: fmt, content, job: updated });
}
