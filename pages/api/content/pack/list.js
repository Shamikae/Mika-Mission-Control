// GET /api/content/pack/list
// Lists content packages, newest first. No secrets ever live on a package
// record, so no sanitization is needed beyond the store's own shape.

import { listPackages } from '../../../../lib/content/contentPackageStore';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const packages = listPackages().slice(0, 200);
  return res.status(200).json({ ok: true, packages });
}
