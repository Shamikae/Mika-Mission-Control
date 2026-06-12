// POST /api/clients/create
// Body: { leadId, proposalId, company (required), contactName, laneId, offerId,
//         status, contractValue, onboardingStatus, deliveryStatus, nextMilestone }

import fs             from 'fs';
import path           from 'path';
import { randomBytes } from 'crypto';

const CLIENTS_FILE = path.join(process.cwd(), 'data', 'clients.json');

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

  const {
    leadId, proposalId, company, contactName, laneId, offerId,
    status, contractValue, onboardingStatus, deliveryStatus, nextMilestone,
  } = req.body || {};

  if (!company?.trim()) return res.status(400).json({ error: 'company is required' });

  const now      = new Date().toISOString();
  const clientId = `client-${Date.now()}-${randomBytes(3).toString('hex')}`;

  const client = {
    clientId,
    leadId:           leadId           || null,
    proposalId:       proposalId       || null,
    company:          company.trim(),
    contactName:      contactName      || '',
    laneId:           laneId           || 'digital-diamond',
    offerId:          offerId          || null,
    status:           status           || 'onboarding',
    contractValue:    typeof contractValue === 'number' ? contractValue : (parseFloat(contractValue) || 0),
    onboardingStatus: onboardingStatus || 'pending',
    deliveryStatus:   deliveryStatus   || 'pending',
    nextMilestone:    nextMilestone    || '',
    createdAt:        now,
    updatedAt:        now,
  };

  const store = readStore();
  store.clients = [client, ...(store.clients || [])];
  writeStore(store);

  return res.status(200).json({ ok: true, clientId, client });
}
