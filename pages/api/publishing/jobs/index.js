// GET  /api/publishing/jobs — list publish jobs (filters: productionJobId, platform, status)
// POST /api/publishing/jobs — create a new draft Publish Job
//
// The review gate is never bypassed here: a Production Job may only become
// a Publish Job when review.status === 'approved'. Publishing Router never
// generates content, edits media, or reruns a provider — it only
// references an existing production artifact.

import { getProductionJob } from '../../../../lib/production/productionJobStore';
import { normalizeArtifactList } from '../../../../lib/artifacts/normalizeArtifact';
import {
  isValidId, isValidPlatform, getPlatform, checkPublishEligibility, makeActivityEvent,
} from '../../../../lib/publishing/publishingRules';
import {
  generatePublishJobId, createPublishJob, listPublishJobs,
} from '../../../../lib/publishing/publishJobStore';

export const config = {
  api: { bodyParser: { sizeLimit: '16kb' } },
};

const MAX_CAPTION_CHARS = 5000;
const MAX_HASHTAGS = 50;
const MAX_HASHTAG_CHARS = 60;
const MAX_COMMENT_CHARS = 2000;

function sanitizeHashtags(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter(h => typeof h === 'string' && h.trim())
    .slice(0, MAX_HASHTAGS)
    .map(h => h.trim().replace(/^#/, '').slice(0, MAX_HASHTAG_CHARS));
}

export default function handler(req, res) {
  if (req.method === 'GET') {
    const { productionJobId, platform, status } = req.query;
    let jobs = listPublishJobs();
    if (productionJobId) jobs = jobs.filter(j => j.productionJobId === productionJobId);
    if (platform) jobs = jobs.filter(j => j.platform === platform);
    if (status) jobs = jobs.filter(j => j.status === status);
    return res.status(200).json({ ok: true, jobs, total: jobs.length });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { productionJobId, platform, artifactId, caption, hashtags, firstComment } = req.body || {};

  if (!productionJobId || !isValidId(productionJobId)) {
    return res.status(400).json({ ok: false, error: 'A valid productionJobId is required.' });
  }
  if (!platform || !isValidPlatform(platform)) {
    return res.status(400).json({ ok: false, error: 'A valid platform is required.' });
  }
  if (caption !== undefined && (typeof caption !== 'string' || caption.length > MAX_CAPTION_CHARS)) {
    return res.status(400).json({ ok: false, error: `caption must be a string of ${MAX_CAPTION_CHARS} characters or fewer.` });
  }
  if (firstComment !== undefined && (typeof firstComment !== 'string' || firstComment.length > MAX_COMMENT_CHARS)) {
    return res.status(400).json({ ok: false, error: `firstComment must be a string of ${MAX_COMMENT_CHARS} characters or fewer.` });
  }

  const productionJob = getProductionJob(productionJobId);
  if (!productionJob) {
    return res.status(404).json({ ok: false, error: `Production job "${productionJobId}" not found.` });
  }

  // ── THE GATE — never bypassed ──────────────────────────────────────────
  const eligibility = checkPublishEligibility(productionJob);
  if (!eligibility.eligible) {
    return res.status(409).json({ ok: false, error: 'Production job is not eligible for publishing.', reasons: eligibility.reasons });
  }

  const artifacts = normalizeArtifactList(productionJob.execution?.outputs, { job: productionJob });
  if (artifacts.length === 0) {
    return res.status(409).json({ ok: false, error: 'This production job has no previewable local artifact to publish.' });
  }
  const artifact = artifactId ? artifacts.find(a => a.artifactId === artifactId) : artifacts[0];
  if (!artifact) {
    return res.status(400).json({ ok: false, error: `Artifact "${artifactId}" was not found on this production job.` });
  }

  const platformDef = getPlatform(platform);
  const now = new Date().toISOString();
  const id = generatePublishJobId();

  const job = {
    id,
    productionJobId,
    packageId: productionJob.packageId,
    artifactId: artifact.artifactId,
    platform,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    scheduledFor: null,
    publishedAt: null,
    caption: typeof caption === 'string' ? caption : '',
    hashtags: sanitizeHashtags(hashtags),
    firstComment: typeof firstComment === 'string' ? firstComment.slice(0, MAX_COMMENT_CHARS) : '',
    metadata: { createdBy: 'user' },
    platformMetadata: {},
    lastValidation: null,
    activityHistory: [
      makeActivityEvent('publish_created', { actor: 'user', note: `Created from production job ${productionJobId}.` }),
      makeActivityEvent('platform_selected', { actor: 'user', note: platformDef.displayName }),
    ],
    publishResult: null,
  };

  createPublishJob(job);
  return res.status(201).json({ ok: true, job });
}
