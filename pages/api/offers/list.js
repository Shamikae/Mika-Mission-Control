// GET /api/offers/list
// Returns all offers with summary stats + lead counts per offer

import fs   from 'fs';
import path from 'path';

const ROOT        = process.cwd();
const OFFERS_FILE = path.join(ROOT, 'data', 'offers.json');
const LEADS_FILE  = path.join(ROOT, 'data', 'leads.json');

function readJson(p, fallback) {
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(raw) ? raw : (raw.offers || raw.leads || fallback);
  } catch { return fallback; }
}

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const offers = readJson(OFFERS_FILE, []);
  const leads  = readJson(LEADS_FILE,  []);

  // Count active leads per offer
  const leadCounts = {};
  for (const lead of leads) {
    if (lead.interestedOfferId && lead.status !== 'archived' && lead.status !== 'lost') {
      leadCounts[lead.interestedOfferId] = (leadCounts[lead.interestedOfferId] || 0) + 1;
    }
  }

  // Attach lead count to each offer
  const enriched = offers.map(o => ({ ...o, leadCount: leadCounts[o.offerId] || 0 }));
  const visible  = enriched.filter(o => o.status !== 'archived');

  const summary = {
    total:         visible.length,
    idea:          visible.filter(o => o.status === 'idea').length,
    validating:    visible.filter(o => o.status === 'validating').length,
    building:      visible.filter(o => o.status === 'building').length,
    ready:         visible.filter(o => o.status === 'ready').length,
    selling:       visible.filter(o => o.status === 'selling').length,
    archived:      enriched.filter(o => o.status === 'archived').length,
    highRevenue:   visible.filter(o => o.revenuePotential === 'high').length,
    lowEffort:     visible.filter(o => o.effortLevel === 'low').length,
    sweetSpot:     visible.filter(o => o.revenuePotential === 'high' && o.effortLevel === 'low').length,
    totalLeads:    leads.filter(l => l.status !== 'archived').length,
  };

  return res.status(200).json({
    generatedAt: new Date().toISOString(),
    offers: enriched,
    summary,
  });
}
