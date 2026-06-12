// POST /api/clients/update
// Body: { clientId, ...fieldsToUpdate }

import fs   from 'fs';
import path from 'path';

const CLIENTS_FILE = path.join(process.cwd(), 'data', 'clients.json');

const UPDATABLE = [
  'company', 'contactName', 'laneId', 'offerId', 'status', 'contractValue',
  'onboardingStatus', 'deliveryStatus', 'nextMilestone', 'leadId', 'proposalId',
];

function readStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf8'));
    return Array.isArray(raw) ? { clients: raw } : raw;
  } catch { return { clients: [] }; }
}

function writeStore(store) {
  fs.writeFileSync(CLIENTS_FILE, JSON.stringify({ ...store, updatedAt: new Date().toISOString() }, null, 2));
}

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { clientId, ...updates } = req.body || {};
  if (!clientId) return res.status(400).json({ error: 'clientId is required' });

  const store = readStore();
  const idx   = (store.clients || []).findIndex(c => c.clientId === clientId);
  if (idx === -1) return res.status(404).json({ error: 'Client not found' });

  const patch = {};
  for (const key of UPDATABLE) {
    if (updates[key] !== undefined) patch[key] = updates[key];
  }
  if (patch.contractValue !== undefined) patch.contractValue = parseFloat(patch.contractValue) || 0;

  store.clients[idx] = { ...store.clients[idx], ...patch, updatedAt: new Date().toISOString() };
  writeStore(store);

  return res.status(200).json({ ok: true, client: store.clients[idx] });
}
