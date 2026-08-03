// GET   /api/publishing/jobs/[id] — detail, enriched with the production
//       job, normalized artifact, and platform definition (saves round trips).
// PATCH /api/publishing/jobs/[id] — edit caption/hashtags/firstComment/
//       platform/artifactId while still in "draft" or "ready". Editing a
//       "ready" job reverts it to "draft" (the prior validation may no
//       longer hold) — never silently keeps a stale "ready" status.

import { getProductionJob } from '../../../../../lib/production/productionJobStore';
import { normalizeArtifactList } from '../../../../../lib/artifacts/normalizeArtifact';
import {
  isValidId, isValidPlatform, getPlatform, makeActivityEvent,
} from '../../../../../lib/publishing/publishingRules';
import { getPublishJob, updatePublishJob, appendPublishHistory } from '../../../../../lib/publishing/publishJobStore';

export const config = {
  api: { bodyParser: { sizeLimit: '16kb' } },
};

const MAX_CAPTION_CHARS = 5000;
const MAX_HASHTAGS = 50;
const MAX_HASHTAG_CHARS = 60;
const MAX_COMMENT_CHARS = 2000;

function sanitizeHashtags(input) {
  if (!Array.isArray(input)) return undefined;
  return input
    .filter(h => typeof h === 'string' && h.trim())
    .slice(0, MAX_HASHTAGS)
    .map(h => h.trim().replace(/^#/, '').slice(0, MAX_HASHTAG_CHARS));
}

function enrich(job) {
  const productionJob = getProductionJob(job.productionJobId);
  const artifacts = productionJob ? normalizeArtifactList(productionJob.execution?.outputs, { job: productionJob }) : [];
  const artifact = artifacts.find(a => a.artifactId === job.artifactId) || null;
  return { job, productionJob, artifacts, artifact, platform: getPlatform(job.platform) };
}

export default function handler(req, res) {
  const { id } = req.query;
  if (!id || !isValidId(id)) {
    return res.status(400).json({ ok: false, error: 'Invalid publish job id.' });
  }

  const existing = getPublishJob(id);
  if (!existing) return res.status(404).json({ ok: false, error: `Publish job "${id}" not found.` });

  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, ...enrich(existing) });
  }

  if (req.method !== 'PATCH') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  if (!['draft', 'ready'].includes(existing.status)) {
    return res.status(409).json({ ok: false, error: `Cannot edit a publish job in status "${existing.status}".` });
  }

  const { platform, artifactId, caption, hashtags, firstComment } = req.body || {};
  const patch = {};

  if (platform !== undefined) {
    if (!isValidPlatform(platform)) return res.status(400).json({ ok: false, error: 'Invalid platform.' });
    patch.platform = platform;
  }
  if (artifactId !== undefined) {
    if (typeof artifactId !== 'string' || !artifactId) return res.status(400).json({ ok: false, error: 'Invalid artifactId.' });
    const productionJob = getProductionJob(existing.productionJobId);
    const artifacts = normalizeArtifactList(productionJob?.execution?.outputs, { job: productionJob });
    if (!artifacts.some(a => a.artifactId === artifactId)) {
      return res.status(400).json({ ok: false, error: `Artifact "${artifactId}" was not found on the source production job.` });
    }
    patch.artifactId = artifactId;
  }
  if (caption !== undefined) {
    if (typeof caption !== 'string' || caption.length > MAX_CAPTION_CHARS) {
      return res.status(400).json({ ok: false, error: `caption must be a string of ${MAX_CAPTION_CHARS} characters or fewer.` });
    }
    patch.caption = caption;
  }
  if (hashtags !== undefined) {
    const clean = sanitizeHashtags(hashtags);
    if (clean === undefined) return res.status(400).json({ ok: false, error: 'hashtags must be an array of strings.' });
    patch.hashtags = clean;
  }
  if (firstComment !== undefined) {
    if (typeof firstComment !== 'string' || firstComment.length > MAX_COMMENT_CHARS) {
      return res.status(400).json({ ok: false, error: `firstComment must be a string of ${MAX_COMMENT_CHARS} characters or fewer.` });
    }
    patch.firstComment = firstComment;
  }

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ ok: false, error: 'No valid fields to update.' });
  }

  // Any content edit invalidates a prior "ready" validation.
  if (existing.status === 'ready') {
    patch.status = 'draft';
    patch.lastValidation = null;
  }

  let updated = updatePublishJob(id, patch);
  updated = appendPublishHistory(id, 'fields_updated', { actor: 'user', note: Object.keys(patch).filter(k => k !== 'status' && k !== 'lastValidation').join(', ') });

  return res.status(200).json({ ok: true, ...enrich(updated) });
}
