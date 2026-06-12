// POST /api/offers/create
// Body: offer fields (title required). Optional: sourceOpportunityId to link from an opportunity.

import fs             from 'fs';
import path           from 'path';
import { randomBytes } from 'crypto';

const OFFERS_FILE = path.join(process.cwd(), 'data', 'offers.json');

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

  const {
    title, laneId, offerType, targetAudience, problemSolved, promise,
    deliverables, priceRange, effortLevel, revenuePotential, status,
    sourceOpportunityId, relatedArtifacts, nextAction,
  } = req.body || {};

  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });

  const now     = new Date().toISOString();
  const offerId = `offer-${Date.now()}-${randomBytes(3).toString('hex')}`;

  const offer = {
    offerId,
    title:               title.trim(),
    laneId:              laneId              || 'digital-diamond',
    offerType:           offerType           || 'service',
    targetAudience:      targetAudience      || '',
    problemSolved:       problemSolved       || '',
    promise:             promise             || '',
    deliverables:        Array.isArray(deliverables) ? deliverables : [],
    priceRange:          priceRange          || { min: 0, max: 0, currency: 'USD' },
    effortLevel:         effortLevel         || 'medium',
    revenuePotential:    revenuePotential    || 'medium',
    status:              status              || 'idea',
    sourceOpportunityId: sourceOpportunityId || null,
    relatedArtifacts:    Array.isArray(relatedArtifacts) ? relatedArtifacts : [],
    nextAction:          nextAction          || '',
    createdAt:           now,
    updatedAt:           now,
  };

  const store = readStore();
  store.offers = [offer, ...(store.offers || [])];
  writeStore(store);

  return res.status(200).json({ ok: true, offerId, offer });
}
