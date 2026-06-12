// POST /api/offers/queue-action
// Body: { offerId, action: 'validate'|'sales-page'|'content-campaign'|'fulfillment-sop' }
// All actions create a task → queue → Telegram → no autonomous dispatch

import fs             from 'fs';
import path           from 'path';
import { randomBytes } from 'crypto';
import { loadQueue }          from '../../../lib/queue/loadQueue';
import { addToQueue }         from '../../../lib/queue/saveQueue';
import { sendTelegramMessage }from '../../../lib/telegram/sendTelegramMessage';
import { dispatchTask }       from '../../../lib/dispatch/dispatchTask';

const ROOT        = process.cwd();
const OFFERS_FILE = path.join(ROOT, 'data', 'offers.json');
const TASKS_FILE  = path.join(ROOT, 'data', 'tasks.json');

const LANE_LABELS = {
  'digital-diamond': 'Digital Diamond AI',
  'managed-by-mika': 'Managed by Mika',
  'medai':           'MedAI',
  'cannaops':        'CannaOps',
  'hotel-hooker':    'The Hotel Hooker',
  'ai-twin':         'AI Twin Studio',
  'lead-recovery':   'Lead Recovery',
};

const ACTION_META = {
  validate: {
    label:    'Market Validation',
    taskType: 'Content Strategy',
    nextAction: 'Awaiting validation research',
    statusIfNew: 'validating',
    prompt: (offer) => [
      `OFFER VALIDATION RESEARCH`,
      `═══════════════════════════════════════════════════`,
      ``,
      `Offer:           ${offer.title}`,
      `Brand:           ${LANE_LABELS[offer.laneId] || offer.laneId}`,
      `Type:            ${offer.offerType}`,
      `Target Audience: ${offer.targetAudience || '(define this)'}`,
      `Problem Solved:  ${offer.problemSolved  || '(define this)'}`,
      `Promise:         ${offer.promise        || '(define this)'}`,
      `Price Range:     $${offer.priceRange?.min || 0}–$${offer.priceRange?.max || 0}`,
      ``,
      `TASK: Research market demand, competitor pricing, and audience fit.`,
      `Deliverables:`,
      `  1. Competitor analysis (3 similar offers, their price + positioning)`,
      `  2. Target audience pain point validation (is this a real burning problem?)`,
      `  3. Recommended price point based on value + market data`,
      `  4. Verdict: GO / REFINE / DROP — with reasoning`,
      ``,
      `[ MIKA AGENTIC OS™ · Offer Validation · ${new Date().toLocaleDateString()} ]`,
    ].join('\n'),
  },
  'sales-page': {
    label:    'Sales Page',
    taskType: 'Script Creation',
    nextAction: 'Sales page in queue',
    statusIfNew: null,
    prompt: (offer) => [
      `SALES PAGE COPY — ${offer.title}`,
      `═══════════════════════════════════════════════════`,
      ``,
      `Offer:           ${offer.title}`,
      `Brand:           ${LANE_LABELS[offer.laneId] || offer.laneId}`,
      `Type:            ${offer.offerType}`,
      `Target Audience: ${offer.targetAudience || '(TBD)'}`,
      `Problem:         ${offer.problemSolved  || '(TBD)'}`,
      `Promise:         ${offer.promise        || '(TBD)'}`,
      `Price Range:     $${offer.priceRange?.min || 0}–$${offer.priceRange?.max || 0}`,
      ``,
      `Deliverables listed:`,
      (offer.deliverables || []).map((d, i) => `  ${i + 1}. ${d}`).join('\n') || '  (none listed yet)',
      ``,
      `TASK: Write complete sales page copy.`,
      `Structure:`,
      `  1. Above-fold headline + subheadline`,
      `  2. Problem section (empathy + agitation)`,
      `  3. Solution/promise section`,
      `  4. What you get (deliverables expanded)`,
      `  5. Who it's for / who it's NOT for`,
      `  6. Price + offer CTA`,
      `  7. FAQ (3–5 objections)`,
      ``,
      `[ MIKA AGENTIC OS™ · Sales Page · ${new Date().toLocaleDateString()} ]`,
    ].join('\n'),
  },
  'content-campaign': {
    label:    'Content Campaign',
    taskType: 'Content Strategy',
    nextAction: 'Content campaign in queue',
    statusIfNew: null,
    prompt: (offer) => [
      `CONTENT CAMPAIGN PLAN — ${offer.title}`,
      `═══════════════════════════════════════════════════`,
      ``,
      `Offer:           ${offer.title}`,
      `Brand:           ${LANE_LABELS[offer.laneId] || offer.laneId}`,
      `Type:            ${offer.offerType}`,
      `Target Audience: ${offer.targetAudience || '(TBD)'}`,
      `Promise:         ${offer.promise        || '(TBD)'}`,
      `Price Range:     $${offer.priceRange?.min || 0}–$${offer.priceRange?.max || 0}`,
      ``,
      `TASK: Create a 30-day content campaign to promote this offer.`,
      `Deliverables:`,
      `  1. Content angle matrix (5 angles × 6 platforms = 30 post concepts)`,
      `  2. Week 1 content calendar (7 posts, detailed hooks + CTAs)`,
      `  3. Lead magnet idea that feeds into this offer`,
      `  4. Email sequence outline (5 emails: awareness → desire → offer)`,
      `  5. Short-form video script for launch announcement`,
      ``,
      `[ MIKA AGENTIC OS™ · Content Campaign · ${new Date().toLocaleDateString()} ]`,
    ].join('\n'),
  },
  'fulfillment-sop': {
    label:    'Fulfillment SOP',
    taskType: 'Content Strategy',
    nextAction: 'Fulfillment SOP in queue',
    statusIfNew: 'building',
    prompt: (offer) => [
      `FULFILLMENT SOP — ${offer.title}`,
      `═══════════════════════════════════════════════════`,
      ``,
      `Offer:           ${offer.title}`,
      `Brand:           ${LANE_LABELS[offer.laneId] || offer.laneId}`,
      `Type:            ${offer.offerType}`,
      `Deliverables:`,
      (offer.deliverables || []).map((d, i) => `  ${i + 1}. ${d}`).join('\n') || '  (none listed yet)',
      ``,
      `TASK: Write a complete fulfillment SOP.`,
      `Structure:`,
      `  1. Onboarding checklist (what happens within 24h of purchase)`,
      `  2. Delivery timeline + milestones`,
      `  3. Tools + platforms used in delivery`,
      `  4. Quality checklist before sending to client`,
      `  5. Off-boarding / handoff checklist`,
      `  6. Repeat / upsell trigger (when/how to offer more)`,
      `  7. Automation opportunities (what can be AI-assisted or templated)`,
      ``,
      `[ MIKA AGENTIC OS™ · Fulfillment SOP · ${new Date().toLocaleDateString()} ]`,
    ].join('\n'),
  },
};

function readStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(OFFERS_FILE, 'utf8'));
    return Array.isArray(raw) ? { offers: raw } : raw;
  } catch {
    return { offers: [] };
  }
}

function writeStore(store) {
  fs.writeFileSync(OFFERS_FILE, JSON.stringify({ ...store, updatedAt: new Date().toISOString() }, null, 2));
}

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function writeJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { offerId, action } = req.body || {};
  if (!offerId) return res.status(400).json({ error: 'offerId is required' });
  if (!ACTION_META[action]) return res.status(400).json({ error: `Unknown action: ${action}. Valid: validate, sales-page, content-campaign, fulfillment-sop` });

  const store = readStore();
  const offerIdx = (store.offers || []).findIndex(o => o.offerId === offerId);
  if (offerIdx === -1) return res.status(404).json({ error: 'Offer not found' });

  const offer = store.offers[offerIdx];
  const meta  = ACTION_META[action];
  const now   = new Date().toISOString();
  const taskId = `offer-${action}-${Date.now()}-${randomBytes(3).toString('hex')}`;

  const description = meta.prompt(offer);

  const task = {
    id:               taskId,
    source:           'offer-library',
    lane:             offer.laneId || 'digital-diamond',
    taskType:         meta.taskType,
    title:            `[Offer] ${meta.label}: ${offer.title}`,
    description,
    offerId:          offer.offerId,
    offerAction:      action,
    priority:         offer.revenuePotential === 'high' ? 'High' : 'Normal',
    approvalRequired: true,
    status:           'pending',
    createdAt:        now,
    updatedAt:        now,
  };

  // Write task
  const tasks = readJson(TASKS_FILE, []);
  tasks.unshift(task);
  writeJson(TASKS_FILE, tasks.slice(0, 200));

  // Queue
  const queueEntry = addToQueue(task, loadQueue());

  // Dispatch preview (non-blocking)
  let dispatchPreview = null;
  try {
    dispatchPreview = dispatchTask({
      taskId,
      taskType:     meta.taskType,
      laneId:       offer.laneId || 'digital-diamond',
      title:        task.title,
      instructions: description,
      priority:     task.priority,
    });
  } catch {}

  // Telegram
  sendTelegramMessage([
    `<b>Offer Action Queued: ${meta.label}</b>`,
    ``,
    `${offer.title}`,
    `Brand: ${LANE_LABELS[offer.laneId] || offer.laneId} · Type: ${offer.offerType}`,
    ``,
    `<i>Open Mission Control → Agent Dispatch → Approve</i>`,
  ].join('\n')).catch(() => {});

  // Update offer
  const offerUpdates = { nextAction: meta.nextAction, updatedAt: now };
  if (meta.statusIfNew && offer.status === 'idea') {
    offerUpdates.status = meta.statusIfNew;
  }
  store.offers[offerIdx] = { ...offer, ...offerUpdates };
  writeStore(store);

  return res.status(200).json({
    ok:             true,
    taskId,
    queueId:        queueEntry.queueId,
    dispatchPreview,
    offer:          store.offers[offerIdx],
  });
}
