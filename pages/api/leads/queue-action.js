// POST /api/leads/queue-action
// Body: { leadId, action: 'research-lead'|'write-outreach'|'prepare-proposal'|'follow-up'|'create-onboarding-plan' }

import fs             from 'fs';
import path           from 'path';
import { randomBytes } from 'crypto';
import { loadQueue }          from '../../../lib/queue/loadQueue';
import { addToQueue }         from '../../../lib/queue/saveQueue';
import { sendTelegramMessage }from '../../../lib/telegram/sendTelegramMessage';
import { dispatchTask }       from '../../../lib/dispatch/dispatchTask';

const ROOT        = process.cwd();
const LEADS_FILE  = path.join(ROOT, 'data', 'leads.json');
const OFFERS_FILE = path.join(ROOT, 'data', 'offers.json');
const TASKS_FILE  = path.join(ROOT, 'data', 'tasks.json');

const LANE_LABELS = {
  'digital-diamond': 'Digital Diamond AI', 'managed-by-mika': 'Managed by Mika',
  'medai': 'MedAI', 'cannaops': 'CannaOps', 'hotel-hooker': 'The Hotel Hooker',
  'ai-twin': 'AI Twin Studio', 'lead-recovery': 'Lead Recovery',
};

const ACTION_META = {
  'research-lead': {
    label:    'Lead Research',
    taskType: 'Content Strategy',
    nextAction: 'Research task queued',
    prompt: (lead, offer) => [
      `LEAD RESEARCH BRIEF`,
      `═══════════════════════════════════════════════════`,
      ``,
      `Lead:     ${lead.fullName}`,
      `Company:  ${lead.company  || '—'}`,
      `Email:    ${lead.email    || '—'}`,
      `Source:   ${lead.source   || '—'}`,
      `Brand:    ${LANE_LABELS[lead.laneId] || lead.laneId}`,
      offer ? `Offer:    ${offer.title} (${offer.offerType})` : '',
      `Score:    ${lead.leadScore}/100`,
      ``,
      `TASK: Research this lead and prepare a discovery dossier.`,
      `Deliverables:`,
      `  1. Company overview (size, industry, revenue signals, tech stack if visible)`,
      `  2. Decision-maker profile (LinkedIn, role, how long in position)`,
      `  3. Pain point signals (recent posts, job listings, press, reviews)`,
      `  4. Budget signals (funding, team growth, paid tools they use)`,
      `  5. Best outreach angle — what they care about most right now`,
      `  6. Recommended lead score: [0–100] with reasoning`,
      `  7. Verdict: PURSUE / NURTURE / DROP — with one-sentence reason`,
      ``,
      lead.notes ? `Existing notes:\n${lead.notes}` : '',
      ``,
      `[ MIKA AGENTIC OS™ · Lead Research · ${new Date().toLocaleDateString()} ]`,
    ].filter(l => l !== undefined).join('\n'),
  },

  'write-outreach': {
    label:    'Write Outreach',
    taskType: 'Script Creation',
    nextAction: 'Outreach copy in queue',
    prompt: (lead, offer) => [
      `OUTREACH COPY BRIEF — ${lead.fullName}`,
      `═══════════════════════════════════════════════════`,
      ``,
      `Lead:     ${lead.fullName}`,
      `Company:  ${lead.company  || '—'}`,
      `Email:    ${lead.email    || '—'}`,
      `Brand:    ${LANE_LABELS[lead.laneId] || lead.laneId}`,
      offer ? `Offer:    ${offer.title} (${offer.offerType})` : '',
      offer?.promise ? `Offer Promise: ${offer.promise}` : '',
      offer?.targetAudience ? `Target Audience: ${offer.targetAudience}` : '',
      `Score:    ${lead.leadScore}/100`,
      lead.notes ? `\nContext: ${lead.notes}` : '',
      ``,
      `TASK: Write a personalized outreach sequence for this lead.`,
      `Deliverables:`,
      `  1. Cold email / DM (subject line + 4–6 lines, no fluff, specific hook)`,
      `  2. Follow-up #1 (3 days later — value add, not a nudge)`,
      `  3. Follow-up #2 (7 days later — soft CTA, pattern interrupt)`,
      `  4. LinkedIn connection note (300 chars max)`,
      `  5. Subject line A/B variants (2 options)`,
      ``,
      `Tone: Direct, specific, no corporate-speak. Lead with their problem, not our offer.`,
      ``,
      `[ MIKA AGENTIC OS™ · Lead Outreach · ${new Date().toLocaleDateString()} ]`,
    ].filter(l => l !== undefined).join('\n'),
  },

  'prepare-proposal': {
    label:    'Prepare Proposal',
    taskType: 'Script Creation',
    nextAction: 'Proposal in queue',
    prompt: (lead, offer) => [
      `PROPOSAL BRIEF — ${lead.fullName} × ${offer?.title || 'Custom Offer'}`,
      `═══════════════════════════════════════════════════`,
      ``,
      `Lead:     ${lead.fullName}`,
      `Company:  ${lead.company  || '—'}`,
      `Brand:    ${LANE_LABELS[lead.laneId] || lead.laneId}`,
      offer ? [
        `Offer:         ${offer.title}`,
        `Type:          ${offer.offerType}`,
        `Promise:       ${offer.promise || '—'}`,
        `Price Range:   $${offer.priceRange?.min || 0}–$${offer.priceRange?.max || 0}`,
        `Deliverables:`,
        ...(offer.deliverables || []).map((d, i) => `  ${i + 1}. ${d}`),
      ].join('\n') : '',
      lead.notes ? `\nNotes on lead: ${lead.notes}` : '',
      ``,
      `TASK: Write a complete proposal document.`,
      `Structure:`,
      `  1. Executive Summary (what we're proposing and why now)`,
      `  2. Understanding of their situation (show you listened)`,
      `  3. Proposed solution (what we'll do, tailored to them)`,
      `  4. Deliverables + timeline (what they get and when)`,
      `  5. Investment (price + what's included, what's not)`,
      `  6. Our process + what we need from them`,
      `  7. Next steps (clear single CTA)`,
      ``,
      `Length: 400–600 words. Professional but not stiff. Mika's voice.`,
      ``,
      `[ MIKA AGENTIC OS™ · Proposal · ${new Date().toLocaleDateString()} ]`,
    ].filter(l => l !== undefined).join('\n'),
  },

  'follow-up': {
    label:    'Write Follow-Up',
    taskType: 'Script Creation',
    nextAction: 'Follow-up copy in queue',
    prompt: (lead, offer) => [
      `FOLLOW-UP SEQUENCE — ${lead.fullName}`,
      `═══════════════════════════════════════════════════`,
      ``,
      `Lead:      ${lead.fullName}`,
      `Company:   ${lead.company  || '—'}`,
      `Status:    ${lead.status}`,
      `Brand:     ${LANE_LABELS[lead.laneId] || lead.laneId}`,
      offer ? `Offer:     ${offer.title}` : '',
      `Score:     ${lead.leadScore}/100`,
      lead.nextAction ? `Last note: ${lead.nextAction}` : '',
      lead.notes      ? `Context:   ${lead.notes}`       : '',
      ``,
      `TASK: Write follow-up messages for this lead based on their current stage.`,
      `Deliverables:`,
      `  1. Immediate follow-up (24h — acknowledge last interaction, add value)`,
      `  2. Re-engagement message (2 weeks of silence — pattern interrupt)`,
      `  3. Break-up message (use sparingly — creates urgency, closes loop)`,
      `  4. Value-add touchpoint (share something genuinely useful, no CTA)`,
      ``,
      `Rule: Every message must give something before asking for anything.`,
      ``,
      `[ MIKA AGENTIC OS™ · Follow-Up · ${new Date().toLocaleDateString()} ]`,
    ].filter(l => l !== undefined).join('\n'),
  },

  'create-onboarding-plan': {
    label:    'Create Onboarding Plan',
    taskType: 'Content Strategy',
    nextAction: 'Onboarding plan in queue',
    prompt: (lead, offer) => [
      `CLIENT ONBOARDING PLAN — ${lead.fullName}`,
      `═══════════════════════════════════════════════════`,
      ``,
      `Client:    ${lead.fullName}`,
      `Company:   ${lead.company  || '—'}`,
      `Email:     ${lead.email    || '—'}`,
      `Brand:     ${LANE_LABELS[lead.laneId] || lead.laneId}`,
      offer ? [
        `Purchased: ${offer.title}`,
        `Type:      ${offer.offerType}`,
        `Deliverables:`,
        ...(offer.deliverables || []).map((d, i) => `  ${i + 1}. ${d}`),
        `Price Range: $${offer.priceRange?.min || 0}–$${offer.priceRange?.max || 0}`,
      ].join('\n') : '',
      lead.notes ? `\nNotes: ${lead.notes}` : '',
      ``,
      `TASK: Create a complete client onboarding plan for this won deal.`,
      `Deliverables:`,
      `  1. Welcome email (warm, sets expectations, what happens next)`,
      `  2. Onboarding checklist (what Mika needs from the client in week 1)`,
      `  3. Project kickoff agenda (30-min call structure)`,
      `  4. Week 1–4 delivery timeline with milestones`,
      `  5. Communication cadence (how often, what channel, what to expect)`,
      `  6. Success metrics (how we'll both know this is working)`,
      `  7. Upsell timing note (when to introduce the next offer naturally)`,
      ``,
      `[ MIKA AGENTIC OS™ · Onboarding · ${new Date().toLocaleDateString()} ]`,
    ].filter(l => l !== undefined).join('\n'),
  },
};

function readJson(p, fallback) {
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (p === OFFERS_FILE) return Array.isArray(raw) ? raw : raw.offers || [];
    if (p === LEADS_FILE)  return Array.isArray(raw) ? raw : raw.leads  || [];
    return raw;
  } catch { return fallback; }
}

function writeStore(store) {
  fs.writeFileSync(LEADS_FILE, JSON.stringify({ ...store, updatedAt: new Date().toISOString() }, null, 2));
}

function writeJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { leadId, action } = req.body || {};
  if (!leadId)                    return res.status(400).json({ error: 'leadId is required' });
  if (!ACTION_META[action])       return res.status(400).json({ error: `Unknown action: ${action}` });

  const leads  = readJson(LEADS_FILE,  []);
  const offers = readJson(OFFERS_FILE, []);

  const leadIdx = leads.findIndex(l => l.leadId === leadId);
  if (leadIdx === -1) return res.status(404).json({ error: 'Lead not found' });

  const lead  = leads[leadIdx];
  const offer = lead.interestedOfferId ? offers.find(o => o.offerId === lead.interestedOfferId) : null;
  const meta  = ACTION_META[action];
  const now   = new Date().toISOString();
  const taskId = `lead-${action}-${Date.now()}-${randomBytes(3).toString('hex')}`;

  const description = meta.prompt(lead, offer);

  const task = {
    id:               taskId,
    source:           'lead-pipeline',
    lane:             lead.laneId || 'digital-diamond',
    taskType:         meta.taskType,
    title:            `[Lead] ${meta.label}: ${lead.fullName}${lead.company ? ` — ${lead.company}` : ''}`,
    description,
    leadId:           lead.leadId,
    leadAction:       action,
    priority:         (lead.leadScore || 0) >= 70 ? 'High' : 'Normal',
    approvalRequired: true,
    status:           'pending',
    createdAt:        now,
    updatedAt:        now,
  };

  // Write task
  const tasks = readJson(path.join(ROOT, 'data', 'tasks.json'), []);
  tasks.unshift(task);
  writeJson(path.join(ROOT, 'data', 'tasks.json'), tasks.slice(0, 200));

  // Queue
  const queueEntry = addToQueue(task, loadQueue());

  // Dispatch preview
  let dispatchPreview = null;
  try {
    dispatchPreview = dispatchTask({
      taskId,
      taskType:     meta.taskType,
      laneId:       lead.laneId || 'digital-diamond',
      title:        task.title,
      instructions: description,
      priority:     task.priority,
    });
  } catch {}

  // Telegram
  sendTelegramMessage([
    `<b>Lead Action Queued: ${meta.label}</b>`,
    ``,
    `${lead.fullName}${lead.company ? ` · ${lead.company}` : ''}`,
    `Brand: ${LANE_LABELS[lead.laneId] || lead.laneId} · Score: ${lead.leadScore}/100`,
    offer ? `Offer: ${offer.title}` : '',
    ``,
    `<i>Open Mission Control → Agent Dispatch → Approve</i>`,
  ].filter(Boolean).join('\n')).catch(() => {});

  // Update lead nextAction
  leads[leadIdx] = { ...lead, nextAction: meta.nextAction, updatedAt: now };
  writeStore({ leads, updatedAt: now });

  return res.status(200).json({
    ok:             true,
    taskId,
    queueId:        queueEntry.queueId,
    dispatchPreview,
    lead:           leads[leadIdx],
  });
}
