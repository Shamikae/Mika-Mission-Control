// GET /api/orchestration/workflow/[packageId]
// Full unified workflow view for ONE Content Package: health, timeline
// (Pack -> Approved -> Production -> Review -> Publishing -> Export),
// context-aware next actions, and a relationship graph (package ->
// production jobs -> artifacts -> publish jobs). Read-only — reuses
// Production Router's and Publishing Router's own stores directly; never a
// duplicate/parallel data model.

import { loadPipelinePackage } from '../../../../lib/content/contentPipelineStore';
import { listProductionJobs } from '../../../../lib/production/productionJobStore';
import { listPublishJobs } from '../../../../lib/publishing/publishJobStore';
import { listQueue } from '../../../../lib/production/execution/executionQueue';
import { normalizeArtifactList } from '../../../../lib/artifacts/normalizeArtifact';
import { sanitizeExecutionForResponse } from '../../../../lib/production/execution/executionRules';
import { isValidId } from '../../../../lib/production/productionRules';
import { buildContentWorkflow } from '../../../../lib/orchestration/workflowRules';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const { packageId } = req.query;
  if (!packageId || !isValidId(packageId)) {
    return res.status(400).json({ ok: false, error: 'Invalid package id.' });
  }

  const pkg = loadPipelinePackage(packageId);
  if (!pkg) return res.status(404).json({ ok: false, error: `Package "${packageId}" not found.` });

  const productionJobs = listProductionJobs().filter(j => j.packageId === packageId);
  const productionJobIds = new Set(productionJobs.map(j => j.id));
  const publishJobs = listPublishJobs().filter(j => productionJobIds.has(j.productionJobId));
  const queue = listQueue();

  const artifactsByJobId = {};
  for (const job of productionJobs) {
    artifactsByJobId[job.id] = normalizeArtifactList(job.execution?.outputs, { job });
  }

  const workflow = buildContentWorkflow(pkg, productionJobs, publishJobs, artifactsByJobId);

  // Sanitized summaries only — never the raw lock token or full execution record.
  const jobSummaries = productionJobs.map(j => ({
    id: j.id, status: j.status, selectedProvider: j.selectedProvider, selectedMode: j.selectedMode,
    review: j.review, execution: sanitizeExecutionForResponse(j.execution),
    queuePosition: queue.findIndex(q => q.productionJobId === j.id) === -1 ? null : queue.findIndex(q => q.productionJobId === j.id) + 1,
    artifacts: artifactsByJobId[j.id],
  }));
  const publishSummaries = publishJobs.map(j => ({
    id: j.id, productionJobId: j.productionJobId, platform: j.platform, status: j.status,
    scheduledFor: j.scheduledFor, publishedAt: j.publishedAt, caption: j.caption,
    activityHistory: j.activityHistory,
  }));

  return res.status(200).json({
    ok: true,
    workflow,
    productionJobs: jobSummaries,
    publishJobs: publishSummaries,
  });
}
