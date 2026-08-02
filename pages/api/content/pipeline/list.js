// GET /api/content/pipeline/list
// Lists every content package with pipeline metadata attached — reads
// through the SAME store Content Pack Generator uses (no duplicate
// persistence). Filtering (brand/platform/stage/search/date) happens
// client-side, matching the convention already used by Thumbnail Studio
// and Content Pack Generator's own library views.

import { listPipelinePackages } from '../../../../lib/content/contentPipelineStore';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const packages = listPipelinePackages().slice(0, 500);
  return res.status(200).json({ ok: true, packages });
}
