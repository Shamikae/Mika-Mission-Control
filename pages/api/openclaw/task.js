export const config = { api: { responseLimit: false, bodyParser: true } };
export const maxDuration = 300;

import fs from 'fs';
import path from 'path';
import { loadBusinessLaneContext } from '../../../lib/context/loadBusinessLaneContext';
import { loadLaneMemory, formatMemoryBlock } from '../../../lib/memory/loadLaneMemory';
import { buildMemoryEntry, appendLaneMemory } from '../../../lib/memory/saveLaneMemory';
import { sendTelegramMessage } from '../../../lib/telegram/sendTelegramMessage';
import { formatCompletedMessage } from '../../../lib/telegram/formatMessages';
import { saveContentArtifact } from '../../../lib/content-artifacts/saveContentArtifact';
import { updateWorkflowStageStatus } from '../../../lib/workflows/loadViralContentWorkflow';

const DATA_FILE = path.join(process.cwd(), 'data', 'tasks.json');

// ─── Task store helpers ───────────────────────────────────────────────────────

function readTasks() {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch { return []; }
}

function updateTask(taskId, patch) {
  const tasks = readTasks();
  const idx = tasks.findIndex(t => t.id === taskId);
  if (idx === -1) return null;
  tasks[idx] = { ...tasks[idx], ...patch, updatedAt: new Date().toISOString() };
  fs.writeFileSync(DATA_FILE, JSON.stringify(tasks, null, 2));
  return tasks[idx];
}

// ─── Instruction builder ──────────────────────────────────────────────────────
// Converts a Mission Control task into an OpenAI-compatible chat completion
// payload for the OpenClaw gateway (/v1/chat/completions, confirmed 2026-05-26).
// To change the model, set OPENCLAW_MODEL in .env.local.

const LANE_LABELS = {
  'digital-diamond': 'Digital Diamond AI',
  'managed-by-mika': 'Managed by Mika',
  'medai':           'MedAI',
  'cannaops':        'CannaOps',
  'hotel-hooker':    'The Hotel Hooker',
  'ai-twin':         'AI Twin Content Studio',
};

// ── Phrases that conflict with CSCEC when present in the task description ─────
const TIKTOK_CAPTION_CTA_RE    = /^[•\-*]?\s*CTA(?:\s+variants?)?:.*drive\s+to/i;
const TIKTOK_CAPTION_CTA_REPL  = '• CTA: comment-based lead capture guided by TikTok caption skill rules.';

const TIKTOK_BANNED_LINE_PATTERNS = [
  /\blink\s+in\s+bio\b/i,
  /\blimited[\s-]time\b/i,
  /\bfake\s+scarcity\b/i,
  /\b\d+\s+slots?\b/i,
  /\bdouble\s+your\s+revenue\b/i,
  /\blife[\s-]changing\b/i,
  /\bdrive\s+to\s+(?:["']?starter[\s-]kit["']?|primary\s*offer|primaryOffer)/i,
  /\burgency[\s-]driven\s+cta\b/i,
];

function sanitizeTikTokCaptionDescription(description) {
  const lines = String(description || '').split('\n');
  let changed = false;
  const sanitized = lines
    .map(line => {
      // Replace CTA drive-to lines (unless already the comment-based replacement)
      if (TIKTOK_CAPTION_CTA_RE.test(line.trim()) && !line.includes('comment-based')) {
        changed = true;
        return TIKTOK_CAPTION_CTA_REPL;
      }
      // Drop any line whose primary content is a banned phrase
      for (const re of TIKTOK_BANNED_LINE_PATTERNS) {
        if (re.test(line)) {
          changed = true;
          return null;
        }
      }
      return line;
    })
    .filter(l => l !== null)
    .join('\n');
  return { sanitized, changed };
}

// ── CSCEC violation detector — non-blocking, for response metadata only ───────
const CSCEC_OUTPUT_VIOLATIONS = [
  { pattern: /\blink\s+in\s+bio\b/i,                                                    label: 'link in bio' },
  { pattern: /\blimited[\s-]time\b/i,                                                   label: 'limited time' },
  { pattern: /\b\d+\s+slots?\b/i,                                                       label: 'slot scarcity (N slots)' },
  { pattern: /\bdouble\s+your\s+revenue\b/i,                                            label: 'double your revenue' },
  { pattern: /\blife[\s-]changing\b/i,                                                  label: 'life-changing' },
  { pattern: /\b\d+[xX]\s+(?:your\s+)?(?:revenue|income|results?)\b/i,                 label: 'unsupported revenue claim' },
  { pattern: /\bonly\s+\d+\s+(?:spots?|slots?|openings?)\s+(?:left|available|remaining)\b/i, label: 'fake scarcity' },
];

function validateCscecOutput(output) {
  const text  = String(output || '');
  const flags = CSCEC_OUTPUT_VIOLATIONS.filter(v => v.pattern.test(text)).map(v => v.label);
  return { clean: flags.length === 0, flags };
}

function loadSkillPrompt(task) {
  if (task.stageId !== 'caption_generation') return null;

  const platform     = String(task.platform || '').toLowerCase().trim();
  const searchText   = `${task.title || ''} ${task.description || ''} ${task.instructions || ''}`;
  const textMentions = searchText.toLowerCase().includes('tiktok');
  const usedFallback = platform !== 'tiktok' && textMentions;

  const isTikTok = platform === 'tiktok' || usedFallback;

  console.log('[loadSkillPrompt] caption_generation:', {
    platform:      task.platform ?? '(missing)',
    normalised:    platform || '(empty)',
    textFallback:  usedFallback,
    willLoadSkill: isTikTok,
  });

  if (!isTikTok) return null;

  try {
    const content = fs.readFileSync(
      path.join(process.cwd(), 'prompts', 'tiktok-caption.md'),
      'utf-8'
    );
    console.log('[loadSkillPrompt] tiktok-caption.md loaded OK', usedFallback ? '(via text fallback)' : '');
    return content;
  } catch (err) {
    console.warn('[loadSkillPrompt] prompts/tiktok-caption.md missing:', err.message);
    return null;
  }
}

function buildInstruction(task) {
  const laneLabel = LANE_LABELS[task.lane] || task.lane;

  const rawSkill        = loadSkillPrompt(task);
  const skillPromptLoaded = rawSkill !== null;

  const skillPrompt = rawSkill
    ? [
        'You are an AI agent operating within Mika Mission Control.',
        '',
        'THE FOLLOWING TIKTOK CAPTION RULES OVERRIDE TASK DESCRIPTION, LANE CONTEXT, MEMORY, PRIOR EXAMPLES, AND ANY MARKETING INSTRUCTIONS.',
        '',
        rawSkill,
      ].join('\n')
    : null;

  const system = skillPrompt || [
    'You are an AI agent operating within Mika Mission Control.',
    'Process the following task and respond with your plan, key actions, and expected outcome.',
    'Be concise and structured.',
  ].join(' ');

  // For TikTok caption_generation, strip conflicting marketing phrases from
  // the description before it enters the high-weight user message.
  let effectiveDescription    = task.description;
  let sanitizedDescriptionUsed = false;
  if (skillPromptLoaded) {
    const { sanitized, changed } = sanitizeTikTokCaptionDescription(task.description);
    effectiveDescription         = sanitized;
    sanitizedDescriptionUsed     = changed;
    if (changed) {
      console.log('[buildInstruction] TikTok caption description sanitized — conflicting phrases removed');
    }
  }

  const user = [
    'TASK DISPATCH — Mika Mission Control',
    '',
    `Lane:              ${laneLabel}`,
    `Type:              ${task.taskType}`,
    `Priority:          ${task.priority}`,
    `Approval Required: ${task.approvalRequired ? 'Yes' : 'No'}`,
    `Task ID:           ${task.id}`,
    `Dispatched:        ${new Date().toISOString()}`,
    `Approved by:       operator`,
    '',
    'Instructions:',
    effectiveDescription,
  ].join('\n');

  const payload = {
    model:      process.env.OPENCLAW_MODEL || 'gpt-4o',
    messages:   [
      { role: 'system', content: system },
      { role: 'user',   content: user   },
    ],
    max_tokens: skillPromptLoaded ? 1200 : 600,
  };

  return { payload, skillPromptLoaded, sanitizedDescriptionUsed };
}

// ─── OPENCLAW ADAPTER ─────────────────────────────────────────────────────────
//
//  sendTaskToOpenClaw() is the SINGLE point of contact with the gateway.
//  To swap the endpoint or protocol, change ONLY this function.
//  Everything above and below is stable.
//
//  Confirmed endpoints (2026-05-26):
//    GET  /health                   → {"ok":true,"status":"live"}
//    POST /v1/chat/completions      → OpenAI-compatible chat completion ✓
//
//  Current approach: send task as a structured chat message.
//  OPENCLAW_TASK_PATH   — override the path (default: /v1/chat/completions)
//  OPENCLAW_MODEL       — override the model  (default: gpt-4o)
//
// ─────────────────────────────────────────────────────────────────────────────

function joinUrl(base, p) {
  return base.replace(/\/+$/, '') + (p.startsWith('/') ? p : '/' + p);
}

async function sendTaskToOpenClaw(instruction, { token, controlUrl, gatewayUrl, lane }) {
  // SWAP POINT: update OPENCLAW_TASK_PATH to change the dispatch endpoint.
  const taskPath = process.env.OPENCLAW_TASK_PATH || '/v1/chat/completions';
  const baseUrl  = controlUrl || gatewayUrl;
  const url      = joinUrl(baseUrl, taskPath);

  // ── Lane context injection ─────────────────────────────────────────────────
  const ctx = loadBusinessLaneContext(lane);
  if (ctx) {
    const contextBlock = [
      `LANE: ${ctx.displayName}`,
      `MISSION: ${ctx.mission}`,
      `VOICE: ${ctx.voice}`,
      `FOCUS: ${ctx.contentFocus}`,
      ctx.operatingInstructions.length
        ? `RULES: ${ctx.operatingInstructions.join(' | ')}`
        : '',
    ].filter(Boolean).join('\n');

    const sysMsg = instruction.messages?.find(m => m.role === 'system');
    if (sysMsg) sysMsg.content = `${contextBlock}\n\n${sysMsg.content}`;
  }

  // ── Rolling memory injection ───────────────────────────────────────────────
  const memory    = loadLaneMemory(lane);
  const memBlock  = formatMemoryBlock(memory, 5);
  if (memBlock) {
    const sysMsg = instruction.messages?.find(m => m.role === 'system');
    if (sysMsg) sysMsg.content = `${sysMsg.content}\n\n${memBlock}`;
  }
  // ──────────────────────────────────────────────────────────────────────────

  const timeoutMs = Number(process.env.OPENCLAW_TASK_TIMEOUT_MS || 60_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers = {
    'Content-Type': 'application/json',
    Authorization:  `Bearer ${token}`,
    ...(ctx?.sessionKey ? { 'x-openclaw-session-key': ctx.sessionKey } : {}),
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers,
      body: JSON.stringify(instruction),
    });

    clearTimeout(timer);

    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 800) }; }

    return { ok: response.ok, httpStatus: response.status, body, error: null };
  } catch (err) {
    clearTimeout(timer);
    return {
      ok: false,
      httpStatus: null,
      body: null,
      error: err.name === 'AbortError' ? `Dispatch timed out after ${Math.round(timeoutMs / 1000)}s` : err.message,
    };
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  return res.status(410).json({
    success: false,
    code: 'governed_dispatch_required',
    error: 'Direct OpenClaw task dispatch is retired. Use POST /api/dispatch/execute.',
    skillPromptLoaded: false,
    sanitizedDescriptionUsed: false,
    cscecValidation: null,
  });
}
