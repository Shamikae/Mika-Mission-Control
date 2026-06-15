// pages/api/content/thumbnail/generate.js
// Phase D — Thumbnail Studio API
//
// POST — queue an AI thumbnail brief generation task through the governed dispatch path.
//
// Input (JSON):
//   { lane, platform, style, prompt, variants (1-4), referenceDataUri? }
//
// Output:
//   { taskId, task, queueId, dispatchPreview }
//
// SECURITY:
//   • Reference image validated server-side (MIME prefix, decoded byte size)
//   • Filename is 100% server-generated — no user input in file path
//   • Full path never returned to client (only taskId)
//   • No direct provider calls — all execution goes through executeDispatch()
//   • Approval gate and routing enforced by dispatchTask() → executeDispatch()

import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { loadQueue } from '../../../../lib/queue/loadQueue';
import { addToQueue } from '../../../../lib/queue/saveQueue';
import { sendTelegramMessage } from '../../../../lib/telegram/sendTelegramMessage';
import { dispatchTask } from '../../../../lib/dispatch/dispatchTask';

const DATA_FILE = path.join(process.cwd(), 'data', 'tasks.json');
const REF_DIR   = path.join(process.cwd(), 'content-artifacts', 'thumbnail-references');

// ── Constants ─────────────────────────────────────────────────────────────────

const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MIME_TO_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB

const VALID_LANES = [
  'digital-diamond', 'managed-by-mika', 'medai',
  'cannaops', 'hotel-hooker', 'ai-twin',
];

const LANE_LABELS = {
  'digital-diamond': 'Digital Diamond AI',
  'managed-by-mika': 'Managed by Mika',
  'medai':           'MedAI',
  'cannaops':        'CannaOps',
  'hotel-hooker':    'The Hotel Hooker',
  'ai-twin':         'AI Twin Studio',
};

const VALID_PLATFORMS = ['YouTube', 'TikTok', 'Instagram', 'LinkedIn'];

const VALID_STYLES = [
  'Bold / vibrant',
  'Clean / minimal',
  'Dark / dramatic',
  'Bright / energetic',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function readTasks() {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch { return []; }
}

function writeTasks(tasks) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(tasks, null, 2));
}

function buildDescription({ lane, platform, style, prompt, variants }) {
  const laneLabel = LANE_LABELS[lane] || lane;
  const sep = '─'.repeat(52);
  return [
    `THUMBNAIL BRIEF — ${platform} · ${laneLabel}`,
    sep,
    '',
    `Platform:  ${platform}`,
    `Brand:     ${laneLabel}`,
    `Style:     ${style}`,
    `Variants:  ${variants}`,
    '',
    'Visual concept:',
    prompt.trim(),
    '',
    `[ MIKA AGENTIC OS™ · Thumbnail Studio · ${new Date().toLocaleDateString()} ]`,
  ].join('\n');
}

function buildTelegramMessage(task, dispatchPreview) {
  const laneLabel  = LANE_LABELS[task.lane] || task.lane;
  const agentName  = dispatchPreview?.selectedAgent?.displayName || 'routing...';
  const executable = dispatchPreview?.executableNow ? 'EXECUTABLE NOW' : 'STAGED / PENDING ACTIVATION';

  return [
    `<b>Thumbnail Brief Queued</b>`,
    ``,
    `Brand:    ${laneLabel}`,
    `Platform: ${task.platform}`,
    `Style:    ${task.style}`,
    `Variants: ${task.variants}`,
    `Agent:    ${agentName} · ${executable}`,
    ``,
    `<i>${task.prompt.slice(0, 120)}${task.prompt.length > 120 ? '…' : ''}</i>`,
  ].join('\n');
}

// ── Reference image handler ───────────────────────────────────────────────────
// Returns the saved filename (server-generated, no user input in path), or null.
// Throws with a user-safe message on validation failure.

function saveReferenceImage(dataUri) {
  if (!dataUri) return null;

  // Validate data URI format and MIME type
  const match = dataUri.match(/^data:(image\/[a-z]+);base64,/);
  if (!match || !ALLOWED_MIME_TYPES.has(match[1])) {
    throw new Error('Invalid image type. Only PNG, JPEG, and WebP are allowed.');
  }
  const mimeType = match[1];

  // Decode and check size
  const base64Data = dataUri.slice(dataUri.indexOf(',') + 1);
  const buffer     = Buffer.from(base64Data, 'base64');
  if (buffer.length > MAX_IMAGE_BYTES) {
    const mb = (buffer.length / 1024 / 1024).toFixed(1);
    throw new Error(`Image is ${mb}MB — maximum is 4MB.`);
  }

  // Generate entirely server-controlled filename — no user input in path
  const ext      = MIME_TO_EXT[mimeType];
  const filename = `ref-${randomBytes(16).toString('hex')}.${ext}`;

  // Ensure directory exists
  if (!fs.existsSync(REF_DIR)) fs.mkdirSync(REF_DIR, { recursive: true });

  // Path traversal guard (defence-in-depth — filename is server-generated)
  const targetPath = path.resolve(REF_DIR, filename);
  const relative   = path.relative(REF_DIR, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Invalid file path.');
  }

  fs.writeFileSync(targetPath, buffer);
  return filename; // relative filename only — full path never leaves server
}

// ── Route config ──────────────────────────────────────────────────────────────
// Base64-encoded images are ~33% larger than the raw file.
// A 4MB image becomes ~5.3MB base64. Set limit to 6MB to handle that overhead.
// The actual 4MB decoded-byte check is enforced in saveReferenceImage().
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '6mb',
    },
  },
};

// ── Handler ───────────────────────────────────────────────────────────────────

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    lane,
    platform,
    style,
    prompt,
    variants,
    referenceDataUri,
  } = req.body || {};

  // ── Validate inputs ───────────────────────────────────────────────────────
  if (!lane || !VALID_LANES.includes(lane)) {
    return res.status(400).json({ error: 'Invalid or missing lane.' });
  }
  if (!platform || !VALID_PLATFORMS.includes(platform)) {
    return res.status(400).json({ error: `Invalid platform. Valid: ${VALID_PLATFORMS.join(', ')}.` });
  }
  if (style && !VALID_STYLES.includes(style)) {
    return res.status(400).json({ error: `Invalid style direction.` });
  }
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt is required.' });
  }
  if (prompt.trim().length > 2000) {
    return res.status(400).json({ error: 'prompt must be 2000 characters or fewer.' });
  }
  const variantCount = Number(variants);
  if (!Number.isInteger(variantCount) || variantCount < 1 || variantCount > 4) {
    return res.status(400).json({ error: 'variants must be 1–4.' });
  }

  // ── Handle reference image ────────────────────────────────────────────────
  let referenceImageFilename = null;
  if (referenceDataUri) {
    try {
      referenceImageFilename = saveReferenceImage(referenceDataUri);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  // ── Build task ────────────────────────────────────────────────────────────
  const taskId    = `thumb-${Date.now()}-${randomBytes(3).toString('hex')}`;
  const now       = new Date().toISOString();
  const laneLabel = LANE_LABELS[lane] || lane;

  const task = {
    id:                    taskId,
    source:                'thumbnail-studio',
    lane,
    taskType:              'Image Generation',
    title:                 `Thumbnail — ${platform} · ${laneLabel}`,
    platform,
    style:                 style || 'Bold / vibrant',
    prompt:                prompt.trim(),
    variants:              variantCount,
    numImages:             variantCount,  // maps variants → OpenArt num_images
    workflowId:            taskId,        // single-stage workflow — workflowId = taskId
    stageId:               'thumbnail_generation',
    priority:              'Normal',
    approvalRequired:      false,
    description:           buildDescription({ lane, platform, style: style || 'Bold / vibrant', prompt, variants: variantCount }),
    referenceImageSaved:   Boolean(referenceImageFilename),
    status:                'pending',
    createdAt:             now,
    updatedAt:             now,
  };

  // ── Persist ───────────────────────────────────────────────────────────────
  const tasks = readTasks();
  tasks.unshift(task);
  writeTasks(tasks.slice(0, 200));

  const queueEntry = addToQueue(task, loadQueue());

  // ── Dispatch preview ──────────────────────────────────────────────────────
  let dispatchPreview = null;
  try {
    dispatchPreview = dispatchTask({
      taskId,
      taskType:     'Image Generation',
      laneId:       lane,
      title:        task.title,
      instructions: task.description,
      priority:     'Normal',
    });
  } catch { /* non-critical */ }

  // ── Telegram (fire-and-forget) ────────────────────────────────────────────
  sendTelegramMessage(buildTelegramMessage(task, dispatchPreview)).catch(() => {});

  return res.status(201).json({
    taskId,
    task,
    queueId:         queueEntry?.queueId || null,
    dispatchPreview,
    // referenceImageFilename intentionally excluded — full path never sent to client
  });
}
