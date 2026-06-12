// POST /api/proposals/create
// Body: { leadId, offerId, laneId, title (required), value, summary, deliverables, timeline, nextAction, status }

import fs             from 'fs';
import path           from 'path';
import { randomBytes } from 'crypto';

const PROPOSALS_FILE = path.join(process.cwd(), 'data', 'proposals.json');

function readStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(PROPOSALS_FILE, 'utf8'));
    return Array.isArray(raw) ? { proposals: raw } : raw;
  } catch { return { proposals: [] }; }
}

function writeStore(store) {
  fs.writeFileSync(PROPOSALS_FILE, JSON.stringify({ ...store, updatedAt: new Date().toISOString() }, null, 2));
}

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    leadId, offerId, laneId, title, value, summary,
    deliverables, timeline, nextAction, status,
  } = req.body || {};

  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });

  const now        = new Date().toISOString();
  const proposalId = `proposal-${Date.now()}-${randomBytes(3).toString('hex')}`;

  const proposal = {
    proposalId,
    leadId:      leadId     || null,
    offerId:     offerId    || null,
    laneId:      laneId     || 'digital-diamond',
    title:       title.trim(),
    status:      status     || 'draft',
    value:       typeof value === 'number' ? value : (parseFloat(value) || 0),
    summary:     summary    || '',
    deliverables: Array.isArray(deliverables)
      ? deliverables
      : (typeof deliverables === 'string' ? deliverables.split('\n').map(s => s.trim()).filter(Boolean) : []),
    timeline:    timeline   || '',
    nextAction:  nextAction || '',
    createdAt:   now,
    updatedAt:   now,
  };

  const store = readStore();
  store.proposals = [proposal, ...(store.proposals || [])];
  writeStore(store);

  return res.status(200).json({ ok: true, proposalId, proposal });
}
