// POST /api/revenue/create
import fs            from 'fs';
import path          from 'path';
import { randomBytes } from 'crypto';

const ROOT = process.cwd();
const FILE = path.join(ROOT, 'data', 'revenue-items.json');

function readJson(fp, fb) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return fb; }
}

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    laneId,
    sourceType    = 'manual',
    sourceId      = null,
    revenueType   = 'service',
    status        = 'projected',
    amount,
    probability   = 50,
    expectedCloseDate,
    receivedDate,
    notes         = '',
  } = req.body;

  if (!laneId)               return res.status(400).json({ error: 'laneId required' });
  if (amount == null)        return res.status(400).json({ error: 'amount required' });

  const store   = readJson(FILE, { revenue: [] });
  const revenue = store.revenue || [];
  const now     = new Date().toISOString();

  const item = {
    revenueId:         `rev_${randomBytes(5).toString('hex')}`,
    laneId,
    sourceType,
    sourceId:          sourceId || null,
    revenueType,
    status,
    amount:            parseFloat(amount) || 0,
    probability:       Math.min(100, Math.max(0, parseInt(probability) || 50)),
    expectedCloseDate: expectedCloseDate || null,
    receivedDate:      (status === 'received' && !receivedDate) ? now.split('T')[0] : (receivedDate || null),
    notes,
    createdAt:         now,
    updatedAt:         now,
  };

  revenue.push(item);
  fs.writeFileSync(FILE, JSON.stringify({ updatedAt: now, revenue }, null, 2));

  return res.status(200).json({ ok: true, item });
}
