// POST /api/adapters/maintenance
// Body: { adapterId, maintenance: boolean, reason?: string }
// Sets or clears maintenance mode for a registered adapter.

import fs   from 'fs';
import path from 'path';
import { getAdapter } from '../../../lib/adapters/loadAdapter';

const ROOT = process.cwd();
const FILE = path.join(ROOT, 'data', 'adapter-maintenance.json');

function readJson(fp, fb) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return fb; }
}

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { adapterId, maintenance, reason } = req.body;
  if (!adapterId)              return res.status(400).json({ error: 'adapterId required' });
  if (maintenance == null)     return res.status(400).json({ error: 'maintenance (boolean) required' });

  const adapter = getAdapter(adapterId);
  if (!adapter) return res.status(404).json({ error: `Adapter "${adapterId}" is not registered` });

  const state = readJson(FILE, { maintenance: {} });
  const now   = new Date().toISOString();

  state.maintenance[adapterId] = maintenance
    ? { active: true,  reason: reason || 'Manual maintenance', setAt: now }
    : { active: false, clearedAt: now };

  state.updatedAt = now;
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2));

  return res.status(200).json({
    ok:        true,
    adapterId,
    maintenance,
    adapter:   { adapterId: adapter.adapterId, displayName: adapter.displayName, status: adapter.status },
    state:     state.maintenance[adapterId],
  });
}
