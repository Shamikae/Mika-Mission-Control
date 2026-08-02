// POST /api/content/pack/thumbnail
// Generates or regenerates a package's thumbnail through the existing,
// unmodified OpenArt MCP dispatch pipeline (lib/content/generatePackageThumbnail.js).
// A thumbnail failure only ever touches package.thumbnail — the written
// package (hooks/script/scenes/etc.) is never affected.
//
// Input:  { packageId, maxImageCredits, headline?, visualBrief? }
//   headline/visualBrief override the package's stored values for this
//   generation only (e.g. after the user edits them) — the package itself
//   is updated with whatever was actually used.
// Output: { ok: true, package } | { ok: false, error }

import { loadPackage, savePackage } from '../../../../lib/content/contentPackageStore';
import { generatePackageThumbnail, applyThumbnailResultToPackage } from '../../../../lib/content/generatePackageThumbnail';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { packageId, maxImageCredits, headline, visualBrief } = req.body || {};

  if (!packageId || typeof packageId !== 'string') {
    return res.status(400).json({ ok: false, error: 'packageId is required.' });
  }
  const maxCredits = Number(maxImageCredits);
  if (!Number.isFinite(maxCredits) || maxCredits <= 0) {
    return res.status(400).json({ ok: false, error: 'maxImageCredits (a positive number) is required.' });
  }

  const pkg = loadPackage(packageId);
  if (!pkg) return res.status(404).json({ ok: false, error: `Package "${packageId}" not found.` });

  const useHeadline    = typeof headline === 'string' && headline.trim() ? headline.trim().slice(0, 150) : pkg.thumbnail.headline;
  const useVisualBrief = typeof visualBrief === 'string' && visualBrief.trim() ? visualBrief.trim().slice(0, 1000) : pkg.thumbnail.visualBrief;

  pkg.thumbnail.headline    = useHeadline;
  pkg.thumbnail.visualBrief = useVisualBrief;

  let thumbResult;
  try {
    thumbResult = await generatePackageThumbnail({
      packageId,
      brand:       pkg.brand,
      platform:    pkg.platform,
      headline:    useHeadline,
      visualBrief: useVisualBrief,
      maxCredits,
    });
  } catch (err) {
    thumbResult = { ok: false, executionStatus: 'failed', error: err.message, result: null };
  }

  applyThumbnailResultToPackage(pkg, thumbResult);
  pkg.metadata.updatedAt = new Date().toISOString();
  savePackage(pkg);

  return res.status(200).json({ ok: true, package: pkg });
}
