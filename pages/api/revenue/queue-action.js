// POST /api/revenue/queue-action
// Body: { revenueId, action: 'follow-up'|'close-plan'|'upsell' }
// All actions: task → queue → Telegram → no autonomous dispatch

import fs            from 'fs';
import path          from 'path';
import { randomBytes }         from 'crypto';
import { loadQueue }           from '../../../lib/queue/loadQueue';
import { addToQueue }          from '../../../lib/queue/saveQueue';
import { sendTelegramMessage } from '../../../lib/telegram/sendTelegramMessage';
import { dispatchTask }        from '../../../lib/dispatch/dispatchTask';

const ROOT         = process.cwd();
const REVENUE_FILE = path.join(ROOT, 'data', 'revenue-items.json');
const TASKS_FILE   = path.join(ROOT, 'data', 'tasks.json');

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
  'follow-up': {
    label:    'Revenue Follow-Up',
    taskType: 'Revenue Strategy',
    nextAction: 'Awaiting follow-up strategy',
    prompt: (r) => [
      `REVENUE FOLLOW-UP STRATEGY`,
      `═══════════════════════════════════════════════════`,
      ``,
      `Revenue Item:    ${r.notes || r.revenueId}`,
      `Amount:          $${r.amount}`,
      `Status:          ${r.status}`,
      `Probability:     ${r.probability}%`,
      `Expected Close:  ${r.expectedCloseDate || 'not set'}`,
      `Type:            ${r.revenueType}`,
      `Brand:           ${LANE_LABELS[r.laneId] || r.laneId}`,
      ``,
      `TASK: Create an actionable follow-up strategy for this revenue opportunity.`,
      ``,
      `Deliverables:`,
      `  1. Follow-up message — personalized, value-focused, not salesy (email or DM ready to send)`,
      `  2. Objection prep — top 3 likely objections with specific responses`,
      `  3. Next step recommendation — single action that moves this deal forward`,
      `  4. Follow-up cadence — ideal timing for the next 2 weeks`,
      `  5. Decision — GO (follow up now), WAIT (nurture for X days), or DROP (cut losses)`,
      ``,
      `Be direct. Every suggestion must be immediately actionable by Mika.`,
    ].join('\n'),
  },
  'close-plan': {
    label:    'Revenue Close Plan',
    taskType: 'Revenue Strategy',
    nextAction: 'Awaiting close plan',
    prompt: (r) => [
      `REVENUE CLOSING PLAN`,
      `═══════════════════════════════════════════════════`,
      ``,
      `Revenue Item:    ${r.notes || r.revenueId}`,
      `Amount:          $${r.amount}`,
      `Status:          ${r.status}`,
      `Probability:     ${r.probability}%`,
      `Expected Close:  ${r.expectedCloseDate || 'not set'}`,
      `Type:            ${r.revenueType}`,
      `Brand:           ${LANE_LABELS[r.laneId] || r.laneId}`,
      ``,
      `TASK: Create a step-by-step plan to close this deal.`,
      ``,
      `Deliverables:`,
      `  1. Deal summary — what we're selling, to whom, at what price, and why they should buy`,
      `  2. Closing steps — numbered sequence of actions to get to YES`,
      `  3. Urgency/scarcity angles — ethical ways to create momentum without being pushy`,
      `  4. Final offer framing — how to present the price for maximum perceived value`,
      `  5. Risk flags — what could derail this deal and how to prevent it`,
      `  6. Close conversation script — what Mika should say at the final conversation`,
      `  7. Post-close checklist — immediate next steps once signed/paid`,
      ``,
      `Be strategic and revenue-focused. Think like a seasoned sales closer.`,
    ].join('\n'),
  },
  'upsell': {
    label:    'Upsell Strategy',
    taskType: 'Revenue Strategy',
    nextAction: 'Awaiting upsell strategy',
    prompt: (r) => [
      `UPSELL OPPORTUNITY ANALYSIS`,
      `═══════════════════════════════════════════════════`,
      ``,
      `Revenue Item:    ${r.notes || r.revenueId}`,
      `Current Amount:  $${r.amount}`,
      `Status:          ${r.status}`,
      `Type:            ${r.revenueType}`,
      `Brand:           ${LANE_LABELS[r.laneId] || r.laneId}`,
      ``,
      `TASK: Identify and plan the best upsell opportunities for this existing revenue.`,
      ``,
      `Deliverables:`,
      `  1. Upsell opportunity analysis — what additional value can Mika realistically deliver?`,
      `  2. Top 3 upsell offers — specific, priced, ranked by likelihood to convert`,
      `  3. Timing strategy — when and how to introduce each upsell naturally`,
      `  4. Positioning message — how to frame it as added value, not a pitch`,
      `  5. Revenue projection — estimated additional MRR/ARR if accepted`,
      `  6. Relationship risk — could this upsell damage trust? How to mitigate?`,
      ``,
      `Think long-term relationship building, not one-time transaction.`,
    ].join('\n'),
  },
};

function readJson(fp, fb) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return fb; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { revenueId, action } = req.body;
  if (!revenueId)          return res.status(400).json({ error: 'revenueId required' });
  if (!ACTION_META[action]) return res.status(400).json({ error: `Unknown action: ${action}` });

  const store = readJson(REVENUE_FILE, { revenue: [] });
  const idx   = (store.revenue || []).findIndex(r => r.revenueId === revenueId);
  if (idx === -1) return res.status(404).json({ error: 'Revenue item not found' });

  const item = store.revenue[idx];
  const meta = ACTION_META[action];
  const now  = new Date().toISOString();

  const taskId = `rev-${action}-${Date.now()}-${randomBytes(3).toString('hex')}`;
  const task = {
    id:               taskId,
    title:            `${meta.label} — ${item.notes || `$${item.amount} ${item.revenueType}`}`,
    taskType:         meta.taskType,
    prompt:           meta.prompt(item),
    source:           'revenue-tracking',
    sourceId:         revenueId,
    laneId:           item.laneId || 'digital-diamond',
    priority:         item.amount >= 1000 ? 'High' : 'Normal',
    approvalRequired: true,
    status:           'pending',
    createdAt:        now,
    updatedAt:        now,
  };

  const tasks = readJson(TASKS_FILE, []);
  tasks.unshift(task);
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks.slice(0, 200), null, 2));

  addToQueue(task, loadQueue());

  let dispatchPreview = null;
  try {
    dispatchPreview = dispatchTask({
      taskId,
      taskType:     meta.taskType,
      laneId:       item.laneId || 'digital-diamond',
      title:        task.title,
      instructions: meta.prompt(item),
      priority:     task.priority,
    });
  } catch {}

  sendTelegramMessage([
    `<b>Revenue Action Queued: ${meta.label}</b>`,
    ``,
    `${item.notes || item.revenueId}`,
    `Amount: $${item.amount} · ${item.revenueType} · ${LANE_LABELS[item.laneId] || item.laneId}`,
    `Priority: ${task.priority}`,
    ``,
    `<i>Open Mission Control → Agent Dispatch → Approve</i>`,
  ].join('\n')).catch(() => {});

  store.revenue[idx] = { ...item, nextAction: meta.nextAction, updatedAt: now };
  fs.writeFileSync(REVENUE_FILE, JSON.stringify({ updatedAt: now, revenue: store.revenue }, null, 2));

  return res.status(200).json({ ok: true, taskId, dispatchPreview });
}
