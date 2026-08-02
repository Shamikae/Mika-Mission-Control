// POST /api/production/jobs/[id]/export
// Generates the Manual Export production brief (JSON or Markdown) by
// combining a freshly-loaded package with the persisted plan. The rendered
// content is returned in the response only — never written into the job
// store, so job storage never duplicates package content (see
// lib/production/productionExport.js).
//
// Input:  { format: 'json' | 'markdown' }
// Output: { ok: true, format, content, job } | { ok: false, error }

import { getProductionJob, updateProductionJob } from '../../../../../lib/production/productionJobStore';
import { loadPackage } from '../../../../../lib/content/contentPackageStore';
import { buildManualExportJson, buildManualExportMarkdown } from '../../../../../lib/production/productionExport';
import { isValidId, makeActivityEvent } from '../../../../../lib/production/productionRules';

export const config = {
  api: { bodyParser: { sizeLimit: '16kb' } },
};

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
  if (job.status === 'blocked') {
    return res.status(409).json({ ok: false, error: 'This job is blocked — the package was not eligible for production, so no brief can be exported.' });
  }

  const pkg = loadPackage(job.packageId);
  if (!pkg) return res.status(404).json({ ok: false, error: `Package "${job.packageId}" not found.` });

  const { format } = req.body || {};
  const fmt = format === 'markdown' ? 'markdown' : 'json';

  const content = fmt === 'markdown'
    ? buildManualExportMarkdown(pkg, job)
    : JSON.stringify(buildManualExportJson(pkg, job), null, 2);

  const updated = updateProductionJob(id, {
    activityHistory: [...job.activityHistory, makeActivityEvent('manual_exported', { actor: 'user', note: `Exported ${fmt} production brief.` })],
  });

  return res.status(200).json({ ok: true, format: fmt, content, job: updated });
}
