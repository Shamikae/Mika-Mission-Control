// GET /api/adapters/status
// Runs live healthCheck() on every registered adapter.
// Slow — pings real services. Use on-demand only (not on page load).

import { healthCheckAll, listAdapters } from '../../../lib/adapters/loadAdapter';
import fs   from 'fs';
import path from 'path';

const ROOT = process.cwd();
function readJson(fp, fb) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return fb; }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const adapterMaint = readJson(path.join(ROOT, 'data', 'adapter-maintenance.json'), { maintenance: {} });

  const results = await healthCheckAll();

  // Merge maintenance state into results
  const enriched = results.map(r => ({
    ...r,
    inMaintenance: adapterMaint.maintenance?.[r.adapterId]?.active === true,
    maintenanceReason: adapterMaint.maintenance?.[r.adapterId]?.reason || null,
  }));

  const summary = {
    total:         enriched.length,
    healthy:       enriched.filter(r => r.ok && !r.inMaintenance).length,
    failed:        enriched.filter(r => !r.ok && r.status !== 'staged' && r.status !== 'disabled').length,
    staged:        enriched.filter(r => r.status === 'staged').length,
    maintenance:   enriched.filter(r => r.inMaintenance).length,
    misconfigured: enriched.filter(r => r.status === 'misconfigured').length,
  };

  return res.status(200).json({ results: enriched, summary, checkedAt: new Date().toISOString() });
}
