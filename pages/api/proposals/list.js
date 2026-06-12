// GET /api/proposals/list
// Returns proposals joined with lead + offer data, grouped by status, with summary

import fs   from 'fs';
import path from 'path';

const ROOT            = process.cwd();
const PROPOSALS_FILE  = path.join(ROOT, 'data', 'proposals.json');
const LEADS_FILE      = path.join(ROOT, 'data', 'leads.json');
const OFFERS_FILE     = path.join(ROOT, 'data', 'offers.json');

function readJson(p, fallback) {
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (p === PROPOSALS_FILE) return Array.isArray(raw) ? raw : raw.proposals || [];
    if (p === LEADS_FILE)     return Array.isArray(raw) ? raw : raw.leads     || [];
    if (p === OFFERS_FILE)    return Array.isArray(raw) ? raw : raw.offers    || [];
    return raw;
  } catch { return fallback; }
}

const STATUS_ORDER = ['draft','sent','reviewing','accepted','rejected'];

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const proposals = readJson(PROPOSALS_FILE, []);
  const leads     = readJson(LEADS_FILE,     []);
  const offers    = readJson(OFFERS_FILE,    []);

  const leadsById  = Object.fromEntries(leads.map(l  => [l.leadId,   l]));
  const offersById = Object.fromEntries(offers.map(o => [o.offerId,  o]));

  const enriched = proposals.map(p => {
    const lead  = p.leadId  ? leadsById[p.leadId]   : null;
    const offer = p.offerId ? offersById[p.offerId] : null;
    return {
      ...p,
      leadName:    lead?.fullName  || null,
      leadCompany: lead?.company   || null,
      offerTitle:  offer?.title    || null,
      offerType:   offer?.offerType || null,
    };
  });

  enriched.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const active = enriched.filter(p => p.status !== 'rejected' && p.status !== 'archived');

  const summary = {
    total:        enriched.filter(p => p.status !== 'archived').length,
    draft:        enriched.filter(p => p.status === 'draft').length,
    sent:         enriched.filter(p => p.status === 'sent').length,
    reviewing:    enriched.filter(p => p.status === 'reviewing').length,
    accepted:     enriched.filter(p => p.status === 'accepted').length,
    rejected:     enriched.filter(p => p.status === 'rejected').length,
    totalValue:   active.reduce((s, p) => s + (p.value || 0), 0),
    acceptedValue: enriched.filter(p => p.status === 'accepted')
                           .reduce((s, p) => s + (p.value || 0), 0),
  };

  const byStatus = {};
  for (const s of STATUS_ORDER) byStatus[s] = [];
  for (const p of enriched) {
    if (p.status !== 'archived' && STATUS_ORDER.includes(p.status)) {
      byStatus[p.status].push(p);
    }
  }

  return res.status(200).json({
    generatedAt: new Date().toISOString(),
    proposals: enriched,
    byStatus,
    summary,
  });
}
