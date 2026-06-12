// POST /api/clients/queue-action
// Body: { clientId, action: 'onboarding-plan'|'delivery-plan'|'progress-review'|'upsell-opportunity' }

import fs             from 'fs';
import path           from 'path';
import { randomBytes } from 'crypto';
import { loadQueue }          from '../../../lib/queue/loadQueue';
import { addToQueue }         from '../../../lib/queue/saveQueue';
import { sendTelegramMessage }from '../../../lib/telegram/sendTelegramMessage';
import { dispatchTask }       from '../../../lib/dispatch/dispatchTask';

const ROOT           = process.cwd();
const CLIENTS_FILE   = path.join(ROOT, 'data', 'clients.json');
const OFFERS_FILE    = path.join(ROOT, 'data', 'offers.json');
const PROPOSALS_FILE = path.join(ROOT, 'data', 'proposals.json');
const TASKS_FILE     = path.join(ROOT, 'data', 'tasks.json');

const LANE_LABELS = {
  'digital-diamond': 'Digital Diamond AI', 'managed-by-mika': 'Managed by Mika',
  'medai': 'MedAI', 'cannaops': 'CannaOps', 'hotel-hooker': 'The Hotel Hooker',
  'ai-twin': 'AI Twin Studio', 'lead-recovery': 'Lead Recovery',
};

const ACTION_META = {
  'onboarding-plan': {
    label:    'Onboarding Plan',
    taskType: 'Content Strategy',
    nextMilestone: 'Onboarding plan being prepared',
    prompt: (c, offer, proposal) => [
      `CLIENT ONBOARDING PLAN`,
      `═══════════════════════════════════════════════════`,
      ``,
      `Client:         ${c.company}`,
      `Contact:        ${c.contactName || '—'}`,
      `Brand:          ${LANE_LABELS[c.laneId] || c.laneId}`,
      `Contract Value: $${c.contractValue?.toLocaleString() || '0'}`,
      offer    ? `Offer:          ${offer.title} (${offer.offerType})` : '',
      proposal ? `Proposal:       ${proposal.title}` : '',
      offer?.deliverables?.length
        ? `\nDeliverables:\n${offer.deliverables.map((d, i) => `  ${i + 1}. ${d}`).join('\n')}`
        : '',
      ``,
      `TASK: Create a comprehensive client onboarding plan.`,
      ``,
      `Deliverables:`,
      `  1. Welcome email (warm, professional, sets tone)`,
      `  2. Onboarding checklist — what we need from the client in week 1 (with due dates)`,
      `  3. Kickoff call agenda (30-min structure — intro, expectations, first milestone)`,
      `  4. Communication plan (channel, cadence, point of contact for each party)`,
      `  5. Week 1–2 quick wins — small, fast deliverables to build confidence`,
      `  6. 30-60-90 day roadmap overview`,
      `  7. Success metrics — how both sides will measure progress`,
      ``,
      `Tone: Warm but professional. Make them feel taken care of from day one.`,
      ``,
      `[ MIKA AGENTIC OS™ · Client Onboarding · ${new Date().toLocaleDateString()} ]`,
    ].filter(Boolean).join('\n'),
  },

  'delivery-plan': {
    label:    'Delivery Plan',
    taskType: 'Content Strategy',
    nextMilestone: 'Delivery plan being created',
    prompt: (c, offer, proposal) => [
      `DELIVERY PLAN`,
      `═══════════════════════════════════════════════════`,
      ``,
      `Client:         ${c.company}`,
      `Brand:          ${LANE_LABELS[c.laneId] || c.laneId}`,
      `Contract Value: $${c.contractValue?.toLocaleString() || '0'}`,
      `Status:         ${c.status} · Delivery: ${c.deliveryStatus}`,
      offer    ? `Offer:          ${offer.title}` : '',
      c.nextMilestone ? `Next Milestone: ${c.nextMilestone}` : '',
      offer?.deliverables?.length
        ? `\nDeliverables:\n${offer.deliverables.map((d, i) => `  ${i + 1}. ${d}`).join('\n')}`
        : '',
      ``,
      `TASK: Create a detailed, week-by-week delivery roadmap for this client engagement.`,
      ``,
      `Structure:`,
      `  1. Project overview — the transformation from current to desired state`,
      `  2. Phase breakdown (e.g., Discovery → Build → Launch → Optimize)`,
      `  3. Week-by-week schedule with specific deliverables for each week`,
      `  4. Dependencies — what needs to happen before what`,
      `  5. Client review gates — when we pause and confirm direction`,
      `  6. Risk register — top 3 risks and mitigation plan for each`,
      `  7. Definition of done — what does successful completion look like?`,
      ``,
      `[ MIKA AGENTIC OS™ · Delivery Plan · ${new Date().toLocaleDateString()} ]`,
    ].filter(Boolean).join('\n'),
  },

  'progress-review': {
    label:    'Progress Review',
    taskType: 'Content Strategy',
    nextMilestone: 'Progress review in queue',
    prompt: (c, offer, proposal) => [
      `PROGRESS REVIEW BRIEF`,
      `═══════════════════════════════════════════════════`,
      ``,
      `Client:         ${c.company}`,
      `Contact:        ${c.contactName || '—'}`,
      `Brand:          ${LANE_LABELS[c.laneId] || c.laneId}`,
      `Status:         ${c.status}`,
      `Delivery:       ${c.deliveryStatus}`,
      `Onboarding:     ${c.onboardingStatus}`,
      `Next Milestone: ${c.nextMilestone || '—'}`,
      offer ? `Offer: ${offer.title}` : '',
      ``,
      `TASK: Write a client progress review document.`,
      ``,
      `Structure:`,
      `  1. Period summary — what timeframe this review covers`,
      `  2. What was accomplished — specific deliverables completed (be concrete)`,
      `  3. Key wins — 2–3 highlights the client should celebrate`,
      `  4. What's coming next — next 2 weeks of deliverables`,
      `  5. Metrics / proof points — any numbers, results, or evidence of progress`,
      `  6. Open items — anything pending from client or our side`,
      `  7. Questions for client — 1–2 targeted questions to keep engagement high`,
      ``,
      `Tone: Confident, clear, positive but honest. Not a status report — a proof of value.`,
      ``,
      `[ MIKA AGENTIC OS™ · Progress Review · ${new Date().toLocaleDateString()} ]`,
    ].filter(Boolean).join('\n'),
  },

  'upsell-opportunity': {
    label:    'Upsell Opportunity',
    taskType: 'Content Strategy',
    nextMilestone: 'Upsell research in queue',
    prompt: (c, offer, proposal) => [
      `UPSELL OPPORTUNITY BRIEF`,
      `═══════════════════════════════════════════════════`,
      ``,
      `Client:         ${c.company}`,
      `Contact:        ${c.contactName || '—'}`,
      `Brand:          ${LANE_LABELS[c.laneId] || c.laneId}`,
      `Status:         ${c.status}`,
      `Contract Value: $${c.contractValue?.toLocaleString() || '0'}`,
      offer ? `Current Offer: ${offer.title} (${offer.offerType})` : '',
      ``,
      `TASK: Research and draft an upsell opportunity for this client.`,
      ``,
      `Deliverables:`,
      `  1. What's working — specific results/wins from the current engagement`,
      `  2. The natural next step — what logical service/product extends the value`,
      `  3. Upsell offer concept — title, 1-sentence promise, key deliverables`,
      `  4. Why now? — the timing argument (window of opportunity for this client)`,
      `  5. ROI story — how the upsell pays for itself (or amplifies current results)`,
      `  6. Conversation script — how to introduce the upsell naturally in a check-in call`,
      `  7. Price range recommendation for the upsell`,
      ``,
      `Rule: The best upsell is one that helps them get more from what they're already doing.`,
      ``,
      `[ MIKA AGENTIC OS™ · Upsell · ${new Date().toLocaleDateString()} ]`,
    ].filter(Boolean).join('\n'),
  },
};

function readJson(p, fallback) {
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (p === CLIENTS_FILE)   return Array.isArray(raw) ? raw : raw.clients   || [];
    if (p === OFFERS_FILE)    return Array.isArray(raw) ? raw : raw.offers    || [];
    if (p === PROPOSALS_FILE) return Array.isArray(raw) ? raw : raw.proposals || [];
    return raw;
  } catch { return fallback; }
}

function writeStore(store) {
  fs.writeFileSync(CLIENTS_FILE, JSON.stringify({ ...store, updatedAt: new Date().toISOString() }, null, 2));
}

function writeJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { clientId, action } = req.body || {};
  if (!clientId)              return res.status(400).json({ error: 'clientId is required' });
  if (!ACTION_META[action])   return res.status(400).json({ error: `Unknown action: ${action}` });

  const clients   = readJson(CLIENTS_FILE,   []);
  const offers    = readJson(OFFERS_FILE,    []);
  const proposals = readJson(PROPOSALS_FILE, []);

  const cIdx = clients.findIndex(c => c.clientId === clientId);
  if (cIdx === -1) return res.status(404).json({ error: 'Client not found' });

  const client   = clients[cIdx];
  const offer    = client.offerId    ? offers.find(o    => o.offerId    === client.offerId)    : null;
  const proposal = client.proposalId ? proposals.find(p => p.proposalId === client.proposalId) : null;
  const meta     = ACTION_META[action];
  const now      = new Date().toISOString();
  const taskId   = `client-${action}-${Date.now()}-${randomBytes(3).toString('hex')}`;

  const description = meta.prompt(client, offer, proposal);

  const task = {
    id:               taskId,
    source:           'client-delivery',
    lane:             client.laneId || 'digital-diamond',
    taskType:         meta.taskType,
    title:            `[Client] ${meta.label}: ${client.company}`,
    description,
    clientId:         client.clientId,
    clientAction:     action,
    priority:         (client.contractValue || 0) >= 1000 || client.status === 'at-risk' ? 'High' : 'Normal',
    approvalRequired: true,
    status:           'pending',
    createdAt:        now,
    updatedAt:        now,
  };

  const tasks = readJson(path.join(ROOT, 'data', 'tasks.json'), []);
  tasks.unshift(task);
  writeJson(TASKS_FILE, tasks.slice(0, 200));

  const queueEntry = addToQueue(task, loadQueue());

  let dispatchPreview = null;
  try {
    dispatchPreview = dispatchTask({
      taskId, taskType: meta.taskType, laneId: client.laneId || 'digital-diamond',
      title: task.title, instructions: description, priority: task.priority,
    });
  } catch {}

  sendTelegramMessage([
    `<b>Client Action Queued: ${meta.label}</b>`,
    ``,
    `${client.company}${client.contactName ? ` · ${client.contactName}` : ''}`,
    `Brand: ${LANE_LABELS[client.laneId] || client.laneId} · Value: $${client.contractValue?.toLocaleString() || '0'}`,
    ``,
    `<i>Open Mission Control → Agent Dispatch → Approve</i>`,
  ].filter(Boolean).join('\n')).catch(() => {});

  clients[cIdx] = { ...client, nextMilestone: meta.nextMilestone, updatedAt: now };
  writeStore({ clients, updatedAt: now });

  return res.status(200).json({ ok: true, taskId, queueId: queueEntry.queueId, dispatchPreview, client: clients[cIdx] });
}
