// GET  /api/content/pack/[id] — load a single package
// PATCH /api/content/pack/[id] — save content edits and/or an explicit
//   status transition. Edited fields are re-sanitized with the same rules
//   as synthesis output — never trust client JSON blindly either.
//
// Input (PATCH):
//   { edits?: { hooks, script, scenes, caption, cta, hashtags, keywords, thumbnail: { headline, visualBrief } },
//     status?: 'draft' | 'needs_review' | 'approved' | 'rejected' }
//
// Output: { ok: true, package } | { ok: false, error }

import { loadPackage, savePackage } from '../../../../lib/content/contentPackageStore';
import { sanitizeEditPatch, PACKAGE_STATUSES } from '../../../../lib/content/contentPackageSchema';

export const config = {
  api: { bodyParser: { sizeLimit: '512kb' } },
};

export default function handler(req, res) {
  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ ok: false, error: 'Invalid package id.' });
  }

  if (req.method === 'GET') {
    const pkg = loadPackage(id);
    if (!pkg) return res.status(404).json({ ok: false, error: `Package "${id}" not found.` });
    return res.status(200).json({ ok: true, package: pkg });
  }

  if (req.method === 'PATCH') {
    const pkg = loadPackage(id);
    if (!pkg) return res.status(404).json({ ok: false, error: `Package "${id}" not found.` });

    const { edits, status } = req.body || {};

    if (status !== undefined) {
      if (!PACKAGE_STATUSES.includes(status)) {
        return res.status(400).json({ ok: false, error: `Invalid status. Valid: ${PACKAGE_STATUSES.join(', ')}.` });
      }
      pkg.status = status; // approval is always this explicit, user-triggered action — never automatic
    }

    if (edits !== undefined) {
      if (!edits || typeof edits !== 'object') {
        return res.status(400).json({ ok: false, error: 'edits must be an object.' });
      }
      const sanitized = sanitizeEditPatch(edits);
      // `production` is server-managed metadata written only by
      // lib/production/buildProductionPlan.js's applyProductionRefToPackage —
      // never editable through this route, regardless of what a client sends.
      // sanitizeEditPatch already never copies unknown fields, so this is
      // belt-and-suspenders, made explicit and testable.
      delete sanitized.production;
      if (sanitized.thumbnail) {
        pkg.thumbnail = { ...pkg.thumbnail, ...sanitized.thumbnail };
        delete sanitized.thumbnail;
      }
      Object.assign(pkg, sanitized);
    }

    pkg.metadata.updatedAt = new Date().toISOString();
    savePackage(pkg);
    return res.status(200).json({ ok: true, package: pkg });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
