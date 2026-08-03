// GET /api/publishing/jobs/[id]/export-zip
// Streams a single ZIP bundle: the media file, caption.txt, hashtags.txt,
// metadata.json, platform-checklist.md, bundle.json, brief.md, and the
// package thumbnail (best-effort — never blocks the export if unavailable).
// A GET download route, same unauthenticated-by-middleware convention as
// /api/production/artifacts/[id] (this app is local/single-user; the id
// itself is the unguessable protection, matching that established pattern).
//
// Never exposes a filesystem path or provider URL — only already-public
// local artifact routes and generated text content.

import { getProductionJob } from '../../../../../lib/production/productionJobStore';
import { loadPackage } from '../../../../../lib/content/contentPackageStore';
import { normalizeArtifactList } from '../../../../../lib/artifacts/normalizeArtifact';
import { getProductionArtifact } from '../../../../../lib/production/execution/productionArtifactStore';
import { buildPublishJsonBundle, buildPublishMarkdownBrief } from '../../../../../lib/publishing/publishExport';
import { buildZip } from '../../../../../lib/publishing/zipBuilder';
import { isValidId, getPlatform, buildPlatformChecklist, makeActivityEvent } from '../../../../../lib/publishing/publishingRules';
import { getPublishJob, updatePublishJob } from '../../../../../lib/publishing/publishJobStore';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
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

  const ctx = { pkg, productionJob, publishJob: job, artifact, platform };
  const entries = [];

  if (artifact) {
    const stored = getProductionArtifact(artifact.filename);
    if (stored?.buffer) entries.push({ name: `media/${artifact.filename}`, data: stored.buffer });
  }

  entries.push({ name: 'caption.txt', data: Buffer.from(job.caption || '', 'utf8') });
  entries.push({ name: 'hashtags.txt', data: Buffer.from((job.hashtags || []).map(h => `#${h}`).join(' '), 'utf8') });
  if (job.firstComment) entries.push({ name: 'first-comment.txt', data: Buffer.from(job.firstComment, 'utf8') });
  entries.push({ name: 'metadata.json', data: Buffer.from(JSON.stringify(buildPublishJsonBundle(ctx), null, 2), 'utf8') });
  entries.push({ name: `platform-checklist-${platform.id}.md`, data: Buffer.from(buildPlatformChecklist(platform).map(c => `- [ ] ${c}`).join('\n'), 'utf8') });
  entries.push({ name: 'bundle.json', data: Buffer.from(JSON.stringify(buildPublishJsonBundle(ctx), null, 2), 'utf8') });
  entries.push({ name: 'brief.md', data: Buffer.from(buildPublishMarkdownBrief(ctx), 'utf8') });

  // Thumbnail — best-effort only, via an internal fetch of the package's own
  // local artifact route (whichever store actually serves it); never blocks
  // the export if it's missing or unreachable.
  if (pkg.thumbnail?.status === 'completed' && typeof pkg.thumbnail?.artifactUrl === 'string' && pkg.thumbnail.artifactUrl.startsWith('/api/')) {
    try {
      const protocol = req.headers['x-forwarded-proto'] || 'http';
      const base = `${protocol}://${req.headers.host}`;
      const thumbRes = await fetch(`${base}${pkg.thumbnail.artifactUrl}`);
      if (thumbRes.ok) {
        const thumbBuf = Buffer.from(await thumbRes.arrayBuffer());
        const ext = (pkg.thumbnail.artifactUrl.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1] || 'jpg').toLowerCase();
        entries.push({ name: `thumbnail.${ext}`, data: thumbBuf });
      }
    } catch { /* thumbnail is optional — never fail the export over it */ }
  }

  const zip = buildZip(entries);

  updatePublishJob(id, {
    activityHistory: [...job.activityHistory, makeActivityEvent('export_generated', { actor: 'user', note: 'Exported ZIP bundle.' })],
  });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `attachment; filename="publish-${id}-${platform.id}.zip"`);
  res.setHeader('Content-Length', String(zip.length));
  return res.status(200).send(zip);
}
