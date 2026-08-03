// GET /api/publishing/platforms
// Lists the v1 platform registry (manual-export only) and the publishing
// adapter registry that backs it.

import { PLATFORM_CATALOG, PUBLISHING_ADAPTERS } from '../../../lib/publishing/publishingRules';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  return res.status(200).json({ ok: true, platforms: PLATFORM_CATALOG, adapters: PUBLISHING_ADAPTERS });
}
