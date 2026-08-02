// lib/content/generatePackageThumbnail.js
// SERVER-SIDE ONLY — uses fs.
//
// Generates a thumbnail for a content package by reusing the EXACT same
// governed dispatch → OpenArt MCP pipeline Thumbnail Studio uses
// (lib/dispatch/executeDispatch.js → adapters/openart.adapter.js →
// lib/openart/openartMcpClient.js). Nothing about model discovery, schema-
// driven params, credit estimation, budget guard, polling, or artifact
// download/validation is reimplemented here — this module only builds a
// task object shaped the way that pipeline already expects and calls it.
//
// A content-pack task uses source: 'content-pack' (not 'thumbnail-studio')
// so it never mixes into Thumbnail Studio's own Creative Library/History —
// clean provenance, same underlying governed pipeline.

import fs   from 'fs';
import path from 'path';
import { executeDispatch }   from '../dispatch/executeDispatch';
import { appendDispatchLog } from '../dispatch/dispatchLog';

const TASKS_FILE = path.join(process.cwd(), 'data', 'tasks.json');

function readTasks() {
  try {
    if (!fs.existsSync(TASKS_FILE)) return [];
    return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeTasks(tasks) {
  const dir = path.dirname(TASKS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
}

/**
 * @param {object} opts
 * @param {string} opts.packageId
 * @param {string} opts.brand      — free-text brand; sanitized downstream by saveImageArtifact's own path guard
 * @param {string} [opts.platform]
 * @param {string} [opts.headline]
 * @param {string} opts.visualBrief
 * @param {number} [opts.maxCredits] — respected by the existing budget guard, unchanged
 * @returns {Promise<{ ok: boolean, executionStatus: string, error: string|null, task: object, result: object|null }>}
 */
export async function generatePackageThumbnail({ packageId, brand, platform, headline, visualBrief, maxCredits }) {
  const prompt = String(visualBrief || headline || '').trim();
  if (!prompt) {
    return {
      ok: false,
      executionStatus: 'failed',
      error: 'No thumbnail visual brief available to generate from.',
      task: null,
      result: null,
    };
  }

  const taskId = `${packageId}-thumb-${Date.now().toString(36)}`;
  const now    = new Date().toISOString();

  const task = {
    id:                taskId,
    source:            'content-pack',
    lane:              brand || 'general',
    taskType:          'Image Generation',
    title:             `Thumbnail — ${headline || 'Content Pack'}`,
    platform:          platform || 'General',
    prompt,
    variants:          1,
    numImages:         1,
    workflowId:        packageId,
    stageId:           'thumbnail_generation',
    priority:          'Normal',
    approvalRequired:  false,
    // headline/visualBrief were already authored by the content-pack synthesis
    // model — skip the deterministic-local polish layer rather than diluting it.
    promptMode:        'exact',
    maxOpenArtCredits: Number.isFinite(maxCredits) ? maxCredits : undefined,
  };

  let result;
  try {
    result = await executeDispatch(task, { approvalGranted: true });
  } catch (err) {
    return {
      ok: false,
      executionStatus: 'failed',
      error: err.message || 'Thumbnail dispatch failed.',
      task,
      result: null,
    };
  }

  // Persist a lightweight task record for audit-trail consistency with the
  // rest of the app (dispatch log, task history) — mirrors what
  // pages/api/dispatch/execute.js does for Thumbnail Studio's own tasks.
  const finalStatus = result.executionStatus === 'success' ? 'complete'
    : (result.executionStatus === 'budget_exceeded' || result.executionStatus === 'failed') ? 'failed'
    : 'pending';

  const tasks = readTasks();
  tasks.unshift({
    ...task,
    status:           finalStatus,
    dispatchMethod:   'content-pack',
    dispatchTarget:   result.executionTarget,
    dispatchError:    result.error || undefined,
    imageFiles:       result.imageFiles?.length ? result.imageFiles : undefined,
    imageCount:       result.imageFiles?.length || undefined,
    provider:         result.rawResponse?.provider || undefined,
    historyId:        result.rawResponse?.historyId || undefined,
    selectedModel:    result.rawResponse?.model || undefined,
    estimatedCredits: result.rawResponse?.estimatedCredits ?? undefined,
    createdAt:        now,
    updatedAt:        now,
    completedAt:      finalStatus === 'complete' ? now : undefined,
  });
  writeTasks(tasks.slice(0, 500));

  appendDispatchLog({
    timestamp:        result.timestamp,
    taskId,
    taskType:         'Image Generation',
    laneId:           task.lane,
    selectedAgentId:  result.decision?.selectedAgent?.id || null,
    fallbackAgentId:  result.decision?.fallbackAgent?.id || null,
    executableNow:    result.decision?.executableNow || false,
    approvalRequired: false,
    decisionReason:   result.decision?.reason || '',
    executionStatus:  result.executionStatus,
    executionMode:    result.executionMode,
    executionTarget:  result.executionTarget,
    outputSummary:    result.outputSummary,
    errorSummary:     result.errorSummary,
  });

  return { ok: result.ok, executionStatus: result.executionStatus, error: result.error || null, task, result };
}

/**
 * Applies a generatePackageThumbnail() result onto a package's `thumbnail`
 * sub-object. Shared by the create and regenerate routes so the status
 * mapping only lives in one place. Never touches any other package field —
 * a thumbnail outcome can never affect the written package.
 */
export function applyThumbnailResultToPackage(pkg, thumbResult) {
  const filename = thumbResult.result?.imageFiles?.[0]?.filename;

  if (thumbResult.executionStatus === 'success' && filename) {
    pkg.thumbnail.artifactId  = filename;
    pkg.thumbnail.artifactUrl = `/api/image/artifacts/${encodeURIComponent(filename)}`;
    pkg.thumbnail.status      = 'completed';
    pkg.thumbnail.error       = null;
    pkg.metadata.estimatedCost = (pkg.metadata.estimatedCost || 0) + (thumbResult.result?.rawResponse?.estimatedCredits || 0);
  } else if (thumbResult.executionStatus === 'budget_exceeded') {
    pkg.thumbnail.status = 'budget_exceeded';
    pkg.thumbnail.error  = thumbResult.error || thumbResult.result?.error || 'Estimated thumbnail cost exceeded the configured maximum.';
  } else if (thumbResult.executionStatus === 'staged' || thumbResult.executionStatus === 'manual_required') {
    pkg.thumbnail.status = 'unavailable';
    pkg.thumbnail.error  = thumbResult.error || thumbResult.result?.error || 'OpenArt is not currently available.';
  } else {
    pkg.thumbnail.status = 'failed';
    pkg.thumbnail.error  = thumbResult.error || thumbResult.result?.error || 'Thumbnail generation failed.';
  }

  return pkg;
}
