// POST /api/proposals/queue-action
// Body: { proposalId, action: 'draft-proposal'|'revise-proposal'|'prepare-presentation'|'create-scope' }

import fs             from 'fs';
import path           from 'path';
import { randomBytes } from 'crypto';
import { loadQueue }          from '../../../lib/queue/loadQueue';
import { addToQueue }         from '../../../lib/queue/saveQueue';
import { sendTelegramMessage }from '../../../lib/telegram/sendTelegramMessage';
import { dispatchTask }       from '../../../lib/dispatch/dispatchTask';

const ROOT            = process.cwd();
const PROPOSALS_FILE  = path.join(ROOT, 'data', 'proposals.json');
const LEADS_FILE      = path.join(ROOT, 'data', 'leads.json');
const OFFERS_FILE     = path.join(ROOT, 'data', 'offers.json');
const TASKS_FILE      = path.join(ROOT, 'data', 'tasks.json');

const LANE_LABELS = {
  'digital-diamond': 'Digital Diamond AI', 'managed-by-mika': 'Managed by Mika',
  'medai': 'MedAI', 'cannaops': 'CannaOps', 'hotel-hooker': 'The Hotel Hooker',
  'ai-twin': 'AI Twin Studio', 'lead-recovery': 'Lead Recovery',
};

const ACTION_META = {
  'draft-proposal': {
    label:    'Draft Proposal',
    taskType: 'Script Creation',
    nextAction: 'Draft in progress',
    prompt: (p, lead, offer) => [
      `PROPOSAL DRAFT BRIEF`,
      `═══════════════════════════════════════════════════`,
      ``,
      `Proposal: ${p.title}`,
      `Brand:    ${LANE_LABELS[p.laneId] || p.laneId}`,
      `Value:    $${p.value?.toLocaleString() || '0'}`,
      lead ? `Lead:     ${lead.fullName}${lead.company ? ` — ${lead.company}` : ''}` : '',
      offer ? `Offer:    ${offer.title} (${offer.offerType})` : '',
      offer?.promise ? `Promise:  ${offer.promise}` : '',
      p.timeline ? `Timeline: ${p.timeline}` : '',
      p.summary  ? `\nContext:\n${p.summary}` : '',
      offer?.deliverables?.length ? `\nOffer deliverables:\n${offer.deliverables.map((d, i) => `  ${i + 1}. ${d}`).join('\n')}` : '',
      ``,
      `TASK: Write a complete, professional proposal document.`,
      ``,
      `Structure:`,
      `  1. Executive Summary — what you're proposing and why it's the right move (3–4 sentences)`,
      `  2. Understanding — show you understand their specific situation and goals`,
      `  3. Our Approach — how we'll solve their problem (methodology, not just deliverables)`,
      `  4. What You'll Get — deliverables, clearly expanded with what "done" looks like`,
      `  5. Timeline & Milestones — phase breakdown with dates if timeline provided`,
      `  6. Investment — total, what's included, payment expectations (no Stripe links)`,
      `  7. Why Us / Why Now — 2–3 sentences, confident, specific to this client`,
      `  8. Next Step — one clear CTA (e.g., "Reply with questions or reply 'Go' to start")`,
      ``,
      `Tone: Professional, warm, direct. Mika's voice. No corporate filler.`,
      `Length: 500–700 words. Full sentences, no bullet spam.`,
      ``,
      `[ MIKA AGENTIC OS™ · Proposal Draft · ${new Date().toLocaleDateString()} ]`,
    ].filter(Boolean).join('\n'),
  },

  'revise-proposal': {
    label:    'Revise Proposal',
    taskType: 'Script Creation',
    nextAction: 'Revision in progress',
    prompt: (p, lead, offer) => [
      `PROPOSAL REVISION BRIEF`,
      `═══════════════════════════════════════════════════`,
      ``,
      `Proposal: ${p.title}`,
      `Status:   ${p.status}`,
      `Value:    $${p.value?.toLocaleString() || '0'}`,
      lead ? `Lead:     ${lead.fullName}${lead.company ? ` — ${lead.company}` : ''}` : '',
      p.summary ? `\nCurrent summary:\n${p.summary}` : '',
      p.nextAction ? `\nFeedback / reason for revision:\n${p.nextAction}` : '',
      ``,
      `TASK: Revise this proposal to address concerns and strengthen the case.`,
      ``,
      `Focus areas:`,
      `  1. Identify and address the most likely objections (price, scope, timeline)`,
      `  2. Sharpen the ROI story — what's the cost of NOT doing this?`,
      `  3. Add a risk-mitigation section if scope or timeline is a sticking point`,
      `  4. Offer a tiered option if the current price feels like a barrier`,
      `  5. Strengthen the CTA — make it easier to say yes`,
      ``,
      `Output: Full revised proposal (same structure as draft, improved copy).`,
      ``,
      `[ MIKA AGENTIC OS™ · Proposal Revision · ${new Date().toLocaleDateString()} ]`,
    ].filter(Boolean).join('\n'),
  },

  'prepare-presentation': {
    label:    'Prepare Presentation',
    taskType: 'Script Creation',
    nextAction: 'Presentation in queue',
    prompt: (p, lead, offer) => [
      `PROPOSAL PRESENTATION BRIEF`,
      `═══════════════════════════════════════════════════`,
      ``,
      `Proposal: ${p.title}`,
      `Value:    $${p.value?.toLocaleString() || '0'}`,
      lead ? `Presenting to: ${lead.fullName}${lead.company ? ` at ${lead.company}` : ''}` : '',
      offer ? `Offer:    ${offer.title}` : '',
      p.timeline ? `Timeline: ${p.timeline}` : '',
      ``,
      `TASK: Write a presentation script / slide deck outline for pitching this proposal.`,
      ``,
      `Slide structure (8 slides):`,
      `  1. Title slide — proposal name, date, for whom`,
      `  2. Agenda — 4-point agenda (builds trust, sets expectations)`,
      `  3. Their Situation — "Here's what I heard from you…" (validation moment)`,
      `  4. The Gap — current state vs. desired state (the painful gap they're living in)`,
      `  5. Our Solution — the offer, how it bridges the gap, key differentiators`,
      `  6. Deliverables + Timeline — what they get, when, milestone structure`,
      `  7. Investment — total value, what's included, how to get started`,
      `  8. Q&A + Next Steps — transition to discussion, clear single CTA`,
      ``,
      `For each slide: write a speaker note (2–4 sentences) and a headline (7 words or less).`,
      ``,
      `[ MIKA AGENTIC OS™ · Proposal Presentation · ${new Date().toLocaleDateString()} ]`,
    ].filter(Boolean).join('\n'),
  },

  'create-scope': {
    label:    'Create Scope of Work',
    taskType: 'Content Strategy',
    nextAction: 'Scope document in queue',
    prompt: (p, lead, offer) => [
      `SCOPE OF WORK BRIEF`,
      `═══════════════════════════════════════════════════`,
      ``,
      `Project:  ${p.title}`,
      `Brand:    ${LANE_LABELS[p.laneId] || p.laneId}`,
      `Value:    $${p.value?.toLocaleString() || '0'}`,
      lead ? `Client:   ${lead.fullName}${lead.company ? ` — ${lead.company}` : ''}` : '',
      offer ? `Offer:    ${offer.title}` : '',
      offer?.deliverables?.length ? `\nDeliverables listed:\n${offer.deliverables.map((d, i) => `  ${i + 1}. ${d}`).join('\n')}` : '',
      p.timeline ? `Timeline: ${p.timeline}` : '',
      ``,
      `TASK: Write a detailed Scope of Work (SOW) document.`,
      ``,
      `Structure:`,
      `  1. Project Overview — one paragraph summary of what this engagement covers`,
      `  2. Project Goals — 3–5 measurable success criteria`,
      `  3. IN SCOPE — detailed list of exactly what's included`,
      `  4. OUT OF SCOPE — explicit list of what's NOT included (prevents scope creep)`,
      `  5. Deliverables — each deliverable with acceptance criteria (what "done" means)`,
      `  6. Timeline — phase breakdown with estimated durations, not hard dates`,
      `  7. Client Responsibilities — what we need from the client to deliver`,
      `  8. Revision Policy — how many revisions are included, what happens beyond that`,
      `  9. Change Request Process — how to request changes and how they're handled`,
      ``,
      `Tone: Professional, precise, clear. This is a working document, not a sales pitch.`,
      ``,
      `[ MIKA AGENTIC OS™ · Scope of Work · ${new Date().toLocaleDateString()} ]`,
    ].filter(Boolean).join('\n'),
  },
};

function readJson(p, fallback) {
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (p === PROPOSALS_FILE) return Array.isArray(raw) ? raw : raw.proposals || [];
    if (p === LEADS_FILE)     return Array.isArray(raw) ? raw : raw.leads     || [];
    if (p === OFFERS_FILE)    return Array.isArray(raw) ? raw : raw.offers    || [];
    return raw;
  } catch { return fallback; }
}

function writeStore(store) {
  fs.writeFileSync(PROPOSALS_FILE, JSON.stringify({ ...store, updatedAt: new Date().toISOString() }, null, 2));
}

function writeJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { proposalId, action } = req.body || {};
  if (!proposalId)              return res.status(400).json({ error: 'proposalId is required' });
  if (!ACTION_META[action])     return res.status(400).json({ error: `Unknown action: ${action}` });

  const proposals = readJson(PROPOSALS_FILE, []);
  const leads     = readJson(LEADS_FILE,     []);
  const offers    = readJson(OFFERS_FILE,    []);

  const pIdx   = proposals.findIndex(p => p.proposalId === proposalId);
  if (pIdx === -1) return res.status(404).json({ error: 'Proposal not found' });

  const proposal = proposals[pIdx];
  const lead     = proposal.leadId  ? leads.find(l  => l.leadId  === proposal.leadId)  : null;
  const offer    = proposal.offerId ? offers.find(o => o.offerId === proposal.offerId) : null;
  const meta     = ACTION_META[action];
  const now      = new Date().toISOString();
  const taskId   = `proposal-${action}-${Date.now()}-${randomBytes(3).toString('hex')}`;

  const description = meta.prompt(proposal, lead, offer);

  const task = {
    id:               taskId,
    source:           'proposal-center',
    lane:             proposal.laneId || 'digital-diamond',
    taskType:         meta.taskType,
    title:            `[Proposal] ${meta.label}: ${proposal.title}`,
    description,
    proposalId:       proposal.proposalId,
    proposalAction:   action,
    priority:         (proposal.value || 0) >= 1000 ? 'High' : 'Normal',
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
      taskId, taskType: meta.taskType, laneId: proposal.laneId || 'digital-diamond',
      title: task.title, instructions: description, priority: task.priority,
    });
  } catch {}

  sendTelegramMessage([
    `<b>Proposal Action Queued: ${meta.label}</b>`,
    ``,
    `${proposal.title}`,
    `${lead ? `Client: ${lead.fullName}${lead.company ? ` · ${lead.company}` : ''}` : ''}`,
    `Value: $${proposal.value?.toLocaleString() || '0'}`,
    ``,
    `<i>Open Mission Control → Agent Dispatch → Approve</i>`,
  ].filter(Boolean).join('\n')).catch(() => {});

  proposals[pIdx] = { ...proposal, nextAction: meta.nextAction, updatedAt: now };
  writeStore({ proposals, updatedAt: now });

  return res.status(200).json({ ok: true, taskId, queueId: queueEntry.queueId, dispatchPreview, proposal: proposals[pIdx] });
}
