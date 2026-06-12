// POST /api/offers/update
// Body: { offerId, ...fieldsToUpdate }

import fs   from 'fs';
import path from 'path';

const OFFERS_FILE = path.join(process.cwd(), 'data', 'offers.json');

const UPDATABLE = [
  'title', 'laneId', 'offerType', 'targetAudience', 'problemSolved', 'promise',
  'deliverables', 'priceRange', 'effortLevel', 'revenuePotential', 'status',
  'relatedArtifacts', 'nextAction',
];

function readStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(OFFERS_FILE, 'utf8'));
    return Array.isArray(raw) ? { offers: raw } : raw;
  } catch {
    return { offers: [] };
  }
}

function writeStore(store) {
  fs.writeFileSync(OFFERS_FILE, JSON.stringify({ ...store, updatedAt: new Date().toISOString() }, null, 2));
}

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { offerId, ...updates } = req.body || {};
  if (!offerId) return res.status(400).json({ error: 'offerId is required' });

  const store = readStore();
  const idx   = (store.offers || []).findIndex(o => o.offerId === offerId);
  if (idx === -1) return res.status(404).json({ error: 'Offer not found' });

  const patch = {};
  for (const key of UPDATABLE) {
    if (updates[key] !== undefined) patch[key] = updates[key];
  }

  store.offers[idx] = { ...store.offers[idx], ...patch, updatedAt: new Date().toISOString() };
  writeStore(store);

  return res.status(200).json({ ok: true, offer: store.offers[idx] });
}
