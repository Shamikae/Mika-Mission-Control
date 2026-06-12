// POST /api/revenue/update
import fs   from 'fs';
import path from 'path';

const ROOT = process.cwd();
const FILE = path.join(ROOT, 'data', 'revenue-items.json');

const UPDATABLE = [
  'laneId', 'sourceType', 'sourceId', 'revenueType',
  'status', 'amount', 'probability', 'expectedCloseDate', 'receivedDate', 'notes',
];

function readJson(fp, fb) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return fb; }
}

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { revenueId, ...updates } = req.body;
  if (!revenueId) return res.status(400).json({ error: 'revenueId required' });

  const store = readJson(FILE, { revenue: [] });
  const idx   = (store.revenue || []).findIndex(r => r.revenueId === revenueId);
  if (idx === -1) return res.status(404).json({ error: 'Revenue item not found' });

  const now     = new Date().toISOString();
  const patched = { ...store.revenue[idx] };

  for (const key of UPDATABLE) {
    if (!(key in updates)) continue;
    if (key === 'amount')      patched.amount      = parseFloat(updates.amount) || 0;
    else if (key === 'probability') patched.probability = Math.min(100, Math.max(0, parseInt(updates.probability) || 0));
    else patched[key] = updates[key];
  }

  if (updates.status === 'received' && !patched.receivedDate) {
    patched.receivedDate = now.split('T')[0];
  }

  patched.updatedAt    = now;
  store.revenue[idx]   = patched;
  fs.writeFileSync(FILE, JSON.stringify({ updatedAt: now, revenue: store.revenue }, null, 2));

  return res.status(200).json({ ok: true, item: patched });
}
