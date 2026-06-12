// GET /api/clients/list
// Returns clients joined with proposal + offer data, grouped by status, with summary

import fs   from 'fs';
import path from 'path';

const ROOT           = process.cwd();
const CLIENTS_FILE   = path.join(ROOT, 'data', 'clients.json');
const PROPOSALS_FILE = path.join(ROOT, 'data', 'proposals.json');
const OFFERS_FILE    = path.join(ROOT, 'data', 'offers.json');

function readJson(p, fallback) {
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (p === CLIENTS_FILE)   return Array.isArray(raw) ? raw : raw.clients   || [];
    if (p === PROPOSALS_FILE) return Array.isArray(raw) ? raw : raw.proposals || [];
    if (p === OFFERS_FILE)    return Array.isArray(raw) ? raw : raw.offers    || [];
    return raw;
  } catch { return fallback; }
}

const STATUS_ORDER = ['onboarding','active','at-risk','completed'];

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const clients   = readJson(CLIENTS_FILE,   []);
  const proposals = readJson(PROPOSALS_FILE, []);
  const offers    = readJson(OFFERS_FILE,    []);

  const proposalsById = Object.fromEntries(proposals.map(p => [p.proposalId, p]));
  const offersById    = Object.fromEntries(offers.map(o    => [o.offerId,    o]));

  const enriched = clients.map(c => {
    const proposal = c.proposalId ? proposalsById[c.proposalId] : null;
    const offer    = c.offerId    ? offersById[c.offerId]        : null;
    return {
      ...c,
      proposalTitle: proposal?.title    || null,
      offerTitle:    offer?.title       || null,
      offerType:     offer?.offerType   || null,
    };
  });

  enriched.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const active    = enriched.filter(c => c.status !== 'archived' && c.status !== 'completed');
  const allActive = enriched.filter(c => c.status !== 'archived');

  const summary = {
    total:         allActive.length,
    onboarding:    enriched.filter(c => c.status === 'onboarding').length,
    active:        enriched.filter(c => c.status === 'active').length,
    atRisk:        enriched.filter(c => c.status === 'at-risk').length,
    completed:     enriched.filter(c => c.status === 'completed').length,
    activeCount:   active.length,
    totalContractValue: allActive.reduce((s, c) => s + (c.contractValue || 0), 0),
    activeContractValue: active.reduce((s, c) => s + (c.contractValue || 0), 0),
    deliveryHealth: active.filter(c => c.deliveryStatus === 'at-risk').length === 0 ? 'healthy' : 'at-risk',
  };

  const byStatus = {};
  for (const s of STATUS_ORDER) byStatus[s] = [];
  for (const c of enriched) {
    if (c.status !== 'archived' && STATUS_ORDER.includes(c.status)) {
      byStatus[c.status].push(c);
    }
  }

  return res.status(200).json({
    generatedAt: new Date().toISOString(),
    clients: enriched,
    byStatus,
    summary,
  });
}
