// GET /api/leads/list
// Returns all leads joined with offer data, plus summary stats + pipeline value

import fs   from 'fs';
import path from 'path';

const ROOT        = process.cwd();
const LEADS_FILE  = path.join(ROOT, 'data', 'leads.json');
const OFFERS_FILE = path.join(ROOT, 'data', 'offers.json');

function readJson(p, fallback) {
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (p === OFFERS_FILE) return Array.isArray(raw) ? raw : raw.offers || [];
    if (p === LEADS_FILE)  return Array.isArray(raw) ? raw : raw.leads  || [];
    return raw;
  } catch { return fallback; }
}

const STATUS_ORDER = ['new','contacted','qualified','proposal-sent','negotiating','won','lost'];

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const leads  = readJson(LEADS_FILE,  []);
  const offers = readJson(OFFERS_FILE, []);
  const offersById = Object.fromEntries(offers.map(o => [o.offerId, o]));

  // Join offer data onto each lead
  const enriched = leads.map(lead => {
    const offer = lead.interestedOfferId ? offersById[lead.interestedOfferId] : null;
    return {
      ...lead,
      offerTitle:     offer?.title     || null,
      offerType:      offer?.offerType || null,
      offerPriceMin:  offer?.priceRange?.min || 0,
      offerPriceMax:  offer?.priceRange?.max || 0,
    };
  });

  // Sort: newest first
  enriched.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // Active = not lost, not archived
  const active = enriched.filter(l => l.status !== 'lost' && l.status !== 'archived');

  // Pipeline value (sum of interested offer min prices across active leads)
  const pipelineValue = active.reduce((sum, l) => sum + (l.offerPriceMin || 0), 0);
  const wonValue      = enriched.filter(l => l.status === 'won')
                                .reduce((sum, l) => sum + (l.offerPriceMin || 0), 0);

  const summary = {
    total:         enriched.filter(l => l.status !== 'archived').length,
    new:           enriched.filter(l => l.status === 'new').length,
    contacted:     enriched.filter(l => l.status === 'contacted').length,
    qualified:     enriched.filter(l => l.status === 'qualified').length,
    proposalSent:  enriched.filter(l => l.status === 'proposal-sent').length,
    negotiating:   enriched.filter(l => l.status === 'negotiating').length,
    won:           enriched.filter(l => l.status === 'won').length,
    lost:          enriched.filter(l => l.status === 'lost').length,
    pipelineValue,
    wonValue,
    hotLeads: enriched.filter(l => (l.leadScore || 0) >= 70 && l.status !== 'won' && l.status !== 'lost').length,
  };

  // Group by status for the kanban board
  const byStatus = {};
  for (const s of STATUS_ORDER) byStatus[s] = [];
  for (const lead of enriched) {
    if (lead.status !== 'archived' && STATUS_ORDER.includes(lead.status)) {
      byStatus[lead.status].push(lead);
    }
  }

  return res.status(200).json({
    generatedAt: new Date().toISOString(),
    leads: enriched,
    byStatus,
    summary,
  });
}
