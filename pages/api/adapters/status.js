// GET /api/adapters/status
// Runs and persists the same sanitized evidence used by dispatch.
// Slow — pings real services. Use on-demand only (not on page load).

import {
  runAllAdapterHealthChecks,
  persistHealthResults,
  getAdapterHealthSummary,
} from '../../../lib/adapters/adapterHealth';
import { sanitizeAdapterHealthResult } from '../../../lib/security/sanitizeHealth';
import fs   from 'fs';
import path from 'path';

const ROOT = process.cwd();
function readJson(fp, fb) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return fb; }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const adapterMaint = readJson(path.join(ROOT, 'data', 'adapter-maintenance.json'), { maintenance: {} });

  const results = await runAllAdapterHealthChecks();
  const store = persistHealthResults(results);

  // Merge maintenance state into results
  const enriched = results.map(r => ({
    ...sanitizeAdapterHealthResult(r),
    inMaintenance: adapterMaint.maintenance?.[r.adapterId]?.active === true,
    maintenanceReason: adapterMaint.maintenance?.[r.adapterId]?.reason || null,
  }));

  const summary = getAdapterHealthSummary(store);

  return res.status(200).json({ results: enriched, summary, checkedAt: store.checkedAt });
}
