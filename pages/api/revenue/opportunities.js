// GET  /api/revenue/opportunities        — generate + return all opportunities with stored states
// POST /api/revenue/opportunities        — { action, id, ...fields }
//   action: 'update-status'  → { id, status: 'new'|'reviewed'|'queued'|'archived' }
//   action: 'queue-next-step'→ { id } — creates a task + queues it through the governance flow
//   action: 'create-brief'   → { id } — creates a content brief from the opportunity

import fs            from 'fs';
import path          from 'path';
import { randomBytes }        from 'crypto';
import { loadQueue }          from '../../../lib/queue/loadQueue';
import { addToQueue }         from '../../../lib/queue/saveQueue';
import { sendTelegramMessage }from '../../../lib/telegram/sendTelegramMessage';
import { dispatchTask }       from '../../../lib/dispatch/dispatchTask';

const ROOT       = process.cwd();
const TASKS_FILE = path.join(ROOT, 'data', 'tasks.json');
const STATE_FILE = path.join(ROOT, 'data', 'revenue-opportunities-state.json');
const QUEUE_FILE = path.join(ROOT, 'queue', 'tasks-queue.json');

// ── File helpers ──────────────────────────────────────────────────────────────

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function writeJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function readState() { return readJson(STATE_FILE, {}); }

function saveState(state) { writeJson(STATE_FILE, state); }

// ── Deterministic ID ─────────────────────────────────────────────────────────

function oppId(type, sourceId) {
  return `opp-${type}-${sourceId}`.replace(/[^a-z0-9-]/gi, '-').slice(0, 80);
}

// ── Opportunity generators ────────────────────────────────────────────────────

function scanArtifacts() {
  const base = path.join(ROOT, 'content-artifacts');
  const results = [];
  try {
    for (const lane of fs.readdirSync(base)) {
      const laneDir = path.join(base, lane);
      if (!fs.statSync(laneDir).isDirectory()) continue;
      for (const wfId of fs.readdirSync(laneDir)) {
        const meta = readJson(path.join(laneDir, wfId, 'metadata.json'), null);
        if (meta) results.push({ laneId: lane, ...meta });
      }
    }
  } catch {}
  return results;
}

function scanWorkflows() {
  const dir = path.join(ROOT, 'data', 'workflows');
  try {
    return fs.readdirSync(dir).filter(f => f.endsWith('.json'))
      .map(f => readJson(path.join(dir, f), null)).filter(Boolean);
  } catch { return []; }
}

function generateOpportunities(tasks, queue, workflows, artifacts, dispatchLog) {
  const opps = [];
  const now  = new Date().toISOString();

  // ── 1. Content Ready to Publish ───────────────────────────────────────────
  tasks
    .filter(t => t.status === 'complete' && t.openclawReply && t.source === 'workflow-child')
    .forEach(t => {
      const stageType = (t.stageName || t.taskType || '').toLowerCase();
      if (['repurposing pack', 'caption', 'script'].some(s => stageType.includes(s.toLowerCase()))) {
        opps.push({
          opportunityId:     oppId('content-ready', t.id),
          title:             `${t.title || t.stageName} ready to publish`,
          source:            'workflow-output',
          laneId:            t.lane,
          opportunityType:   'content-ready',
          revenuePotential:  t.stageName?.includes('Repurposing') ? 'high' : 'medium',
          effort:            'low',
          suggestedNextAction: t.stageName?.includes('Repurposing')
            ? 'Schedule across LinkedIn, X/Twitter, Blog, Pinterest, Podcast, Instagram'
            : `Review and schedule ${t.platform} ${t.stageName?.toLowerCase() || 'content'}`,
          assignedAgent:     t.lane === 'digital-diamond' ? 'diamond' : 'publisher',
          relatedTaskId:     t.id,
          relatedWorkflowId: t.workflowId,
          relatedBriefId:    t.parentBriefId,
          platform:          t.platform,
          preview:           t.openclawReply?.slice(0, 200),
          createdAt:         t.completedAt || t.updatedAt,
          briefPayload: {
            lane:        t.lane,
            platform:    t.platform || 'TikTok',
            contentGoal: `Publish and distribute ${t.stageName || 'content'}`,
            contentType: 'Repurposing pack',
            instructions: `Based on completed ${t.stageName} output from workflow ${t.workflowId}. Distribute across all planned channels.`,
          },
        });
      }
    });

  // ── 2. Repurposing Opportunity ─────────────────────────────────────────────
  tasks
    .filter(t => t.status === 'complete' && t.openclawReply && t.taskType === 'Repurposing')
    .forEach(t => {
      opps.push({
        opportunityId:     oppId('repurposing', t.workflowId || t.id),
        title:             `6-platform distribution pack ready — ${t.lane}`,
        source:            'repurposing-output',
        laneId:            t.lane,
        opportunityType:   'repurposing',
        revenuePotential:  'high',
        effort:            'low',
        suggestedNextAction: 'Create scheduling brief for each platform to maximize distribution',
        assignedAgent:     'publisher',
        relatedTaskId:     t.id,
        relatedWorkflowId: t.workflowId,
        relatedBriefId:    t.parentBriefId,
        platform:          t.platform,
        preview:           t.openclawReply?.slice(0, 200),
        createdAt:         t.completedAt || t.updatedAt,
        briefPayload: {
          lane:        t.lane,
          platform:    'LinkedIn',
          contentGoal: 'Distribute repurposed content to grow audience across platforms',
          contentType: 'Repurposing pack',
          instructions: `Repurposing pack is ready. Schedule LinkedIn version first, then X/Twitter, Blog, Pinterest, Podcast, Instagram in sequence.`,
        },
      });
    });

  // ── 3. Lead Magnet Idea (from content strategy artifacts) ────────────────
  tasks
    .filter(t => t.status === 'complete' && t.taskType === 'Content Strategy' && t.openclawReply)
    .forEach(t => {
      opps.push({
        opportunityId:     oppId('lead-magnet', t.id),
        title:             `Lead magnet opportunity — ${t.contentGoal || t.platform} content series`,
        source:            'content-strategy',
        laneId:            t.lane,
        opportunityType:   'lead-magnet',
        revenuePotential:  'high',
        effort:            'medium',
        suggestedNextAction: 'Turn content series strategy into a free guide or email opt-in to build the list',
        assignedAgent:     'diamond',
        relatedTaskId:     t.id,
        relatedWorkflowId: t.workflowId,
        relatedBriefId:    t.parentBriefId,
        platform:          t.platform,
        preview:           t.openclawReply?.slice(0, 200),
        createdAt:         t.completedAt || t.updatedAt,
        briefPayload: {
          lane:        t.lane,
          platform:    'Blog',
          contentGoal: 'Build email list via lead magnet based on AI content system',
          contentType: 'Long-form script',
          audience:    t.audience || 'creators + solopreneurs',
          tone:        t.tone || 'Educational',
          primaryOffer: t.primaryOffer || '',
          instructions: `Convert the ${t.platform} content strategy into a downloadable guide or email sequence. Use the completed strategy artifact as the foundation.`,
        },
      });
    });

  // ── 4. Digital Product Idea (from multi-stage completed workflow) ────────
  workflows
    .filter(wf => wf.status === 'active' || wf.status === 'complete')
    .forEach(wf => {
      const artifact = artifacts.find(a => a.workflowId === wf.workflowId);
      const completedStages = artifact?.stagesCompleted || [];
      if (completedStages.length >= 2) {
        opps.push({
          opportunityId:     oppId('digital-product', wf.workflowId),
          title:             `Digital product idea — ${wf.platform} content system for ${wf.lane}`,
          source:            'workflow-artifacts',
          laneId:            wf.lane,
          opportunityType:   'digital-product',
          revenuePotential:  'high',
          effort:            'medium',
          suggestedNextAction: `Package completed ${wf.platform} content system (${completedStages.length} artifacts) as a paid template or course`,
          assignedAgent:     'diamond',
          relatedWorkflowId: wf.workflowId,
          relatedBriefId:    wf.parentBriefId,
          platform:          wf.platform,
          preview:           `${completedStages.length} stages completed: ${completedStages.join(', ')}`,
          createdAt:         wf.updatedAt || wf.createdAt,
          briefPayload: {
            lane:        wf.lane,
            platform:    'Blog',
            contentGoal: `Launch digital product based on ${wf.platform} content system`,
            contentType: 'Educational post',
            audience:    wf.audience || 'creators + solopreneurs',
            tone:        wf.tone || 'Educational',
            primaryOffer: wf.primaryOffer || '',
            instructions: `Create a sales page or launch brief for a digital product that packages the ${wf.platform} content system developed in workflow ${wf.workflowId}. Include what's inside, pricing suggestion, and ideal buyer.`,
          },
        });
      }
    });

  // ── 5. AI Automation Service Opportunity ──────────────────────────────────
  const successfulDispatches = dispatchLog.filter(d =>
    d.executionStatus === 'success' || (d.executableNow && d.selectedAgentId === 'openclaw')
  );
  if (successfulDispatches.length > 0) {
    const latestDispatch = successfulDispatches[successfulDispatches.length - 1];
    opps.push({
      opportunityId:     oppId('service-offer', `dispatch-${latestDispatch.taskId}`),
      title:             'AI automation service demonstrated — offer done-for-you to clients',
      source:            'dispatch-history',
      laneId:            latestDispatch.laneId || 'digital-diamond',
      opportunityType:   'service-offer',
      revenuePotential:  'high',
      effort:            'medium',
      suggestedNextAction: 'Create a service proposal using Diamond agent — package the full content workflow as a done-for-you offer',
      assignedAgent:     'diamond',
      relatedTaskId:     latestDispatch.taskId,
      platform:          null,
      preview:           `${successfulDispatches.length} successful dispatches through OpenClaw. Full content pipeline demonstrated end-to-end.`,
      createdAt:         latestDispatch.timestamp,
      briefPayload: {
        lane:        'digital-diamond',
        platform:    'LinkedIn',
        contentGoal: 'Generate leads for done-for-you AI content service',
        contentType: 'Storytelling post',
        audience:    'business owners and content creators',
        tone:        'Professional',
        primaryOffer: 'Done-for-you AI content system',
        instructions: `Write a LinkedIn post or service pitch that demonstrates the end-to-end AI content workflow you just built. Position this as a done-for-you service for other businesses. ${successfulDispatches.length} automated tasks completed as proof.`,
      },
    });
  }

  // ── 6. Affiliate Content Idea ─────────────────────────────────────────────
  const hookTasks = tasks.filter(t =>
    t.status === 'complete' && (t.taskType === 'Hook Creation' || t.stageName?.toLowerCase().includes('hook'))
  );
  if (hookTasks.length > 0) {
    const ht = hookTasks[0];
    opps.push({
      opportunityId:     oppId('affiliate', ht.id),
      title:             `Affiliate angle — add affiliate offer to ${ht.platform} content series`,
      source:            'hook-output',
      laneId:            ht.lane,
      opportunityType:   'affiliate-content',
      revenuePotential:  'medium',
      effort:            'low',
      suggestedNextAction: 'Research relevant AI tool affiliate programs and weave into existing content hooks',
      assignedAgent:     'diamond',
      relatedTaskId:     ht.id,
      relatedWorkflowId: ht.workflowId,
      platform:          ht.platform,
      preview:           ht.openclawReply?.slice(0, 200),
      createdAt:         ht.completedAt || ht.updatedAt,
      briefPayload: {
        lane:        ht.lane,
        platform:    ht.platform || 'TikTok',
        contentGoal: 'Monetize existing content audience via affiliate partnerships',
        contentType: 'Trend post',
        audience:    'creators + solopreneurs',
        tone:        'Conversational',
        instructions: `Rework the existing ${ht.platform} hooks to naturally integrate an affiliate angle. Research 2–3 relevant AI or creator tool affiliate programs and create hook variants that recommend them authentically.`,
      },
    });
  }

  // ── 7. AI Automation Service from content brief (direct service offer) ────
  const briefs = tasks.filter(t => t.source === 'content-brief');
  briefs.forEach(brief => {
    opps.push({
      opportunityId:     oppId('service-from-brief', brief.id),
      title:             `Service offer — ${brief.contentGoal} for ${brief.platform} (${brief.lane})`,
      source:            'content-brief',
      laneId:            brief.lane,
      opportunityType:   'service-offer',
      revenuePotential:  'high',
      effort:            'high',
      suggestedNextAction: `Productize this brief into a service package — charge clients to build the same content system for their brand`,
      assignedAgent:     'diamond',
      relatedTaskId:     brief.id,
      relatedWorkflowId: brief.workflowId,
      platform:          brief.platform,
      preview:           `Goal: ${brief.contentGoal} · Platform: ${brief.platform} · Audience: ${brief.audience}`,
      createdAt:         brief.createdAt,
      briefPayload: {
        lane:        brief.lane,
        platform:    brief.platform,
        contentGoal: `Productize: ${brief.contentGoal} as a paid service`,
        contentType: 'Educational post',
        audience:    brief.audience || '',
        tone:        brief.tone || 'Professional',
        primaryOffer: `Done-for-you ${brief.platform} content system`,
        instructions: `Use this brief as a template for a client-facing service offer. Create a pricing proposal for building the same content system for other brands.`,
      },
    });
  });

  return opps;
}

// ── Action handlers ───────────────────────────────────────────────────────────

function handleUpdateStatus(id, status) {
  const VALID = ['new', 'reviewed', 'queued', 'archived'];
  if (!VALID.includes(status)) return { ok: false, error: `Invalid status. Use: ${VALID.join(', ')}` };
  const state = readState();
  state[id] = { status, updatedAt: new Date().toISOString() };
  saveState(state);
  return { ok: true, id, status };
}

function handleQueueNextStep(opp) {
  if (!opp) return { ok: false, error: 'Opportunity not found' };

  const id  = `opp-task-${Date.now()}-${randomBytes(3).toString('hex')}`;
  const now = new Date().toISOString();
  const lane = opp.laneId || 'digital-diamond';

  const LANE_LABELS = {
    'digital-diamond': 'Digital Diamond AI', 'managed-by-mika': 'Managed by Mika',
    'medai': 'MedAI', 'cannaops': 'CannaOps', 'hotel-hooker': 'The Hotel Hooker', 'ai-twin': 'AI Twin Studio',
  };

  const task = {
    id, source: 'revenue-opportunity', lane,
    taskType: 'Content Strategy',
    title: `▶ ${opp.title}`,
    description: [
      `REVENUE OPPORTUNITY — NEXT STEP`,
      `─────────────────────────────────`,
      `Opportunity: ${opp.title}`,
      `Type:        ${opp.opportunityType}`,
      `Brand:       ${LANE_LABELS[lane] || lane}`,
      `Platform:    ${opp.platform || '—'}`,
      ``,
      `Suggested Next Action:`,
      opp.suggestedNextAction,
      ``,
      `Revenue Potential: ${opp.revenuePotential?.toUpperCase()}`,
      `Effort: ${opp.effort?.toUpperCase()}`,
      ``,
      `[ MIKA AGENTIC OS™ · Revenue Opportunity · ${new Date().toLocaleDateString()} ]`,
    ].join('\n'),
    opportunityId:   opp.opportunityId,
    opportunityType: opp.opportunityType,
    relatedTaskId:   opp.relatedTaskId,
    relatedWorkflowId: opp.relatedWorkflowId,
    priority: opp.revenuePotential === 'high' ? 'High' : 'Normal',
    approvalRequired: true,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };

  const tasks = readJson(TASKS_FILE, []);
  tasks.unshift(task);
  writeJson(TASKS_FILE, tasks.slice(0, 200));

  const queueEntry = addToQueue(task, loadQueue());

  let dispatchPreview = null;
  try {
    dispatchPreview = dispatchTask({
      taskId: id, taskType: 'Content Strategy', laneId: lane,
      title: task.title, instructions: task.description,
      priority: task.priority,
    });
  } catch {}

  sendTelegramMessage([
    `<b>Revenue Opportunity Queued</b>`,
    ``,
    `${opp.title}`,
    `Type: ${opp.opportunityType} · Potential: ${opp.revenuePotential}`,
    ``,
    `<i>Open Mission Control → Agent Dispatch → Approve</i>`,
  ].join('\n')).catch(() => {});

  // Mark opportunity as queued
  const state = readState();
  state[opp.opportunityId] = { status: 'queued', updatedAt: now };
  saveState(state);

  return { ok: true, taskId: id, queueId: queueEntry.queueId, dispatchPreview };
}

function handleCreateBrief(opp) {
  if (!opp) return { ok: false, error: 'Opportunity not found' };
  const bp = opp.briefPayload;
  if (!bp?.lane || !bp?.platform || !bp?.contentGoal || !bp?.contentType) {
    return { ok: false, error: 'Opportunity is missing brief payload fields' };
  }

  const CONTENT_TYPE_TO_TASK_TYPE = {
    'Trend post': 'Trend Research', 'Educational post': 'Script Creation',
    'Storytelling post': 'Content Strategy', 'AI twin video': 'Video Prompting',
    'UGC ad concept': 'Hook Creation', 'Carousel': 'Script Creation',
    'Short-form video': 'Script Creation', 'Long-form script': 'Script Creation',
    'Repurposing pack': 'Repurposing',
  };
  const LANE_LABELS = {
    'digital-diamond': 'Digital Diamond AI', 'managed-by-mika': 'Managed by Mika',
    'medai': 'MedAI', 'cannaops': 'CannaOps', 'hotel-hooker': 'The Hotel Hooker', 'ai-twin': 'AI Twin Studio',
  };

  const taskType = CONTENT_TYPE_TO_TASK_TYPE[bp.contentType] || 'Content Strategy';
  const id       = `brief-opp-${Date.now()}-${randomBytes(3).toString('hex')}`;
  const now      = new Date().toISOString();

  const description = [
    `CONTENT BRIEF (from Revenue Opportunity) — ${bp.platform} · ${LANE_LABELS[bp.lane] || bp.lane}`,
    `────────────────────────────────────────────────────────────`,
    ``,
    `Opportunity:  ${opp.title}`,
    `Platform:     ${bp.platform}`,
    `Brand:        ${LANE_LABELS[bp.lane] || bp.lane}`,
    `Goal:         ${bp.contentGoal}`,
    `Content Type: ${bp.contentType}`,
    `Task Route:   ${taskType}`,
    bp.audience     ? `Audience:     ${bp.audience}` : '',
    bp.tone         ? `Tone:         ${bp.tone}` : '',
    bp.primaryOffer ? `Primary Offer: ${bp.primaryOffer}` : '',
    ``,
    bp.instructions || '',
    ``,
    `[ MIKA AGENTIC OS™ · Revenue Brief · ${new Date().toLocaleDateString()} ]`,
  ].filter(l => l !== undefined).join('\n');

  const task = {
    id, source: 'revenue-opportunity-brief', lane: bp.lane, taskType,
    platform: bp.platform, contentGoal: bp.contentGoal, contentType: bp.contentType,
    audience: bp.audience || '', tone: bp.tone || '', primaryOffer: bp.primaryOffer || '',
    instructions: bp.instructions || '',
    opportunityId: opp.opportunityId,
    description, priority: 'Normal', approvalRequired: true,
    status: 'pending', createdAt: now, updatedAt: now,
  };

  const tasks = readJson(TASKS_FILE, []);
  tasks.unshift(task);
  writeJson(TASKS_FILE, tasks.slice(0, 200));

  const queueEntry = addToQueue(task, loadQueue());

  let dispatchPreview = null;
  try {
    dispatchPreview = dispatchTask({
      taskId: id, taskType, laneId: bp.lane,
      title: `${bp.contentType} — ${bp.platform} · ${LANE_LABELS[bp.lane] || bp.lane}`,
      instructions: description, priority: 'Normal',
    });
  } catch {}

  sendTelegramMessage([
    `<b>Brief Created from Revenue Opportunity</b>`,
    ``,
    `${opp.title}`,
    `${bp.platform} · ${LANE_LABELS[bp.lane] || bp.lane}`,
    ``,
    `<i>Open Mission Control → Agent Dispatch → Approve</i>`,
  ].join('\n')).catch(() => {});

  // Mark opportunity as queued
  const state = readState();
  state[opp.opportunityId] = { status: 'queued', updatedAt: now };
  saveState(state);

  return { ok: true, taskId: id, queueId: queueEntry.queueId, dispatchPreview };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {

  if (req.method === 'GET') {
    const tasks       = readJson(TASKS_FILE, []);
    const queue       = readJson(QUEUE_FILE, []);
    const workflows   = scanWorkflows();
    const artifacts   = scanArtifacts();
    const dispatchLog = readJson(path.join(ROOT, 'logs', 'dispatch-log.json'), []);
    const state       = readState();

    const generated = generateOpportunities(tasks, queue, workflows, artifacts, dispatchLog);

    // Merge stored state
    const opportunities = generated.map(opp => ({
      ...opp,
      status: state[opp.opportunityId]?.status || 'new',
      statusUpdatedAt: state[opp.opportunityId]?.updatedAt || null,
    }));

    // Summary
    const visible = opportunities.filter(o => o.status !== 'archived');
    const summary = {
      total:      visible.length,
      new:        visible.filter(o => o.status === 'new').length,
      reviewed:   visible.filter(o => o.status === 'reviewed').length,
      queued:     visible.filter(o => o.status === 'queued').length,
      archived:   opportunities.filter(o => o.status === 'archived').length,
      quickWins:  visible.filter(o => o.effort === 'low').length,
      highPotential: visible.filter(o => o.revenuePotential === 'high').length,
      sweetSpot:  visible.filter(o => o.revenuePotential === 'high' && o.effort === 'low').length,
    };

    return res.status(200).json({ generatedAt: new Date().toISOString(), opportunities, summary });
  }

  if (req.method === 'POST') {
    const { action, id } = req.body || {};
    if (!action || !id) return res.status(400).json({ error: 'action and id are required' });

    if (action === 'update-status') {
      return res.status(200).json(handleUpdateStatus(id, req.body.status));
    }

    // For queue/brief actions we need the opportunity object
    const tasks       = readJson(TASKS_FILE, []);
    const queue       = readJson(QUEUE_FILE, []);
    const workflows   = scanWorkflows();
    const artifacts   = scanArtifacts();
    const dispatchLog = readJson(path.join(ROOT, 'logs', 'dispatch-log.json'), []);
    const generated   = generateOpportunities(tasks, queue, workflows, artifacts, dispatchLog);
    const state       = readState();
    const opps        = generated.map(o => ({ ...o, status: state[o.opportunityId]?.status || 'new' }));
    const opp         = opps.find(o => o.opportunityId === id);

    if (action === 'queue-next-step') return res.status(200).json(handleQueueNextStep(opp));
    if (action === 'create-brief')   return res.status(200).json(handleCreateBrief(opp));

    return res.status(400).json({ error: `Unknown action: ${action}` });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
