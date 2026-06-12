// POST /api/leads/create
// Body: { fullName (required), company, email, source, laneId, interestedOfferId,
//         status, leadScore, notes, nextAction, assignedAgent }

import fs             from 'fs';
import path           from 'path';
import { randomBytes } from 'crypto';

const LEADS_FILE = path.join(process.cwd(), 'data', 'leads.json');

function readStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
    return Array.isArray(raw) ? { leads: raw } : raw;
  } catch {
    return { leads: [] };
  }
}

function writeStore(store) {
  fs.writeFileSync(LEADS_FILE, JSON.stringify({ ...store, updatedAt: new Date().toISOString() }, null, 2));
}

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    fullName, company, email, source, laneId, interestedOfferId,
    status, leadScore, notes, nextAction, assignedAgent,
  } = req.body || {};

  if (!fullName?.trim()) return res.status(400).json({ error: 'fullName is required' });

  const now    = new Date().toISOString();
  const leadId = `lead-${Date.now()}-${randomBytes(3).toString('hex')}`;

  const lead = {
    leadId,
    fullName:          fullName.trim(),
    company:           company          || '',
    email:             email            || '',
    source:            source           || 'manual',
    laneId:            laneId           || 'digital-diamond',
    interestedOfferId: interestedOfferId || null,
    status:            status           || 'new',
    leadScore:         typeof leadScore === 'number' ? Math.min(100, Math.max(0, leadScore)) : 50,
    notes:             notes            || '',
    nextAction:        nextAction       || '',
    assignedAgent:     assignedAgent    || null,
    createdAt:         now,
    updatedAt:         now,
  };

  const store = readStore();
  store.leads = [lead, ...(store.leads || [])];
  writeStore(store);

  return res.status(200).json({ ok: true, leadId, lead });
}
