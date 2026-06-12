// GET /api/revenue/list
// Returns all revenue items enriched with source labels + computed summary.

import fs   from 'fs';
import path from 'path';

const ROOT = process.cwd();

function readJson(fp, fb) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return fb; }
}

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { status, lane, type } = req.query;

  const revenue   = readJson(path.join(ROOT, 'data', 'revenue-items.json'), {}).revenue || [];
  const proposals = readJson(path.join(ROOT, 'data', 'proposals.json'),     {}).proposals || [];
  const clients   = readJson(path.join(ROOT, 'data', 'clients.json'),       {}).clients   || [];
  const offers    = readJson(path.join(ROOT, 'data', 'offers.json'),        {}).offers    || [];
  const leads     = readJson(path.join(ROOT, 'data', 'leads.json'),         {}).leads     || [];

  const proposalMap = Object.fromEntries(proposals.map(p => [p.proposalId, p]));
  const clientMap   = Object.fromEntries(clients.map(c => [c.clientId, c]));
  const offerMap    = Object.fromEntries(offers.map(o => [o.offerId, o]));
  const leadMap     = Object.fromEntries(leads.map(l => [l.leadId, l]));

  let enriched = revenue.map(r => {
    let sourceLabel = null;
    if (r.sourceType === 'proposal' && proposalMap[r.sourceId]) sourceLabel = proposalMap[r.sourceId].title;
    else if (r.sourceType === 'client' && clientMap[r.sourceId]) sourceLabel = clientMap[r.sourceId].company;
    else if (r.sourceType === 'offer'  && offerMap[r.sourceId])  sourceLabel = offerMap[r.sourceId].title;
    else if (r.sourceType === 'lead'   && leadMap[r.sourceId])   sourceLabel = leadMap[r.sourceId].fullName;
    return { ...r, sourceLabel };
  });

  if (status) enriched = enriched.filter(r => r.status === status);
  if (lane)   enriched = enriched.filter(r => r.laneId === lane);
  if (type)   enriched = enriched.filter(r => r.revenueType === type);

  enriched.sort((a, b) => {
    const da = a.expectedCloseDate || a.createdAt || '';
    const db = b.expectedCloseDate || b.createdAt || '';
    return da.localeCompare(db);
  });

  const all = revenue;
  const summary = {
    total:          all.length,
    projected:      all.filter(r => r.status === 'projected').length,
    pending:        all.filter(r => r.status === 'pending').length,
    won:            all.filter(r => r.status === 'won').length,
    received:       all.filter(r => r.status === 'received').length,
    lost:           all.filter(r => r.status === 'lost').length,
    pipelineValue:  all.filter(r => !['lost', 'received'].includes(r.status)).reduce((s, r) => s + (r.amount || 0), 0),
    receivedAmount: all.filter(r => r.status === 'received').reduce((s, r) => s + (r.amount || 0), 0),
    pendingAmount:  all.filter(r => r.status === 'pending' || r.status === 'won').reduce((s, r) => s + (r.amount || 0), 0),
    lostAmount:     all.filter(r => r.status === 'lost').reduce((s, r) => s + (r.amount || 0), 0),
    weightedForecast: all
      .filter(r => r.status !== 'received' && r.status !== 'lost')
      .reduce((s, r) => s + (r.amount || 0) * ((r.probability || 50) / 100), 0),
  };

  return res.status(200).json({ revenue: enriched, summary });
}
