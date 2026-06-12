// POST /api/proposals/update
// Body: { proposalId, ...fieldsToUpdate }

import fs   from 'fs';
import path from 'path';

const PROPOSALS_FILE = path.join(process.cwd(), 'data', 'proposals.json');

const UPDATABLE = [
  'leadId', 'offerId', 'laneId', 'title', 'status', 'value',
  'summary', 'deliverables', 'timeline', 'nextAction',
];

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

  const { proposalId, ...updates } = req.body || {};
  if (!proposalId) return res.status(400).json({ error: 'proposalId is required' });

  const store = readStore();
  const idx   = (store.proposals || []).findIndex(p => p.proposalId === proposalId);
  if (idx === -1) return res.status(404).json({ error: 'Proposal not found' });

  const patch = {};
  for (const key of UPDATABLE) {
    if (updates[key] !== undefined) patch[key] = updates[key];
  }
  if (patch.value !== undefined) patch.value = parseFloat(patch.value) || 0;

  store.proposals[idx] = { ...store.proposals[idx], ...patch, updatedAt: new Date().toISOString() };
  writeStore(store);

  return res.status(200).json({ ok: true, proposal: store.proposals[idx] });
}
