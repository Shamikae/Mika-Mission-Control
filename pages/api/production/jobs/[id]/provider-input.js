// PATCH /api/production/jobs/[id]/provider-input
// Server-managed, sanitized HeyGen setup for a Production Job: avatar/voice
// selection plus a small set of optional generation preferences. Admin
// protected automatically (middleware.js gates every non-GET route).
//
// Input: { avatarId?, voiceId?, captionEnabled?, voiceSpeed?, avatarStyle?,
//   backgroundMode?, testMode?, selectedTool? } — unknown keys are silently
// ignored (never merged into providerInput), so no arbitrary nested payload,
// header, URL, or credential field can ever reach job storage. avatarId/
// voiceId are validated against the live (or briefly cached) HeyGen
// discovery list — never against client-supplied labels. Preview URLs are
// never accepted or persisted here at all (the whitelist has no such field).
//
// Output: { ok: true, job, validation } | { ok: false, error }

import { getProductionJob, updateProductionJob } from '../../../../../lib/production/productionJobStore';
import { loadPackage } from '../../../../../lib/content/contentPackageStore';
import { buildProductionJob, applyProductionRefToPackage } from '../../../../../lib/production/buildProductionPlan';
import { isValidId } from '../../../../../lib/production/productionRules';
import { ACTIVE_EXECUTION_STATES, sanitizeExecutionForResponse } from '../../../../../lib/production/execution/executionRules';
import { listHeyGenAvatars, listHeyGenVoices } from '../../../../../lib/heygen/heygenMcpClient';
import { validateHeyGenProviderInputSync } from '../../../../../lib/production/execution/adapters/heygenMcp.adapter';

const ALLOWED_SELECTED_TOOLS = ['create_video_from_avatar'];

export const config = {
  api: { bodyParser: { sizeLimit: '8kb' } },
};

function sanitizeJob(job) {
  return job ? { ...job, execution: sanitizeExecutionForResponse(job.execution) } : job;
}

export default async function handler(req, res) {
  if (req.method !== 'PATCH') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string' || !isValidId(id)) {
    return res.status(400).json({ ok: false, error: 'Invalid job id.' });
  }

  const job = getProductionJob(id);
  if (!job) return res.status(404).json({ ok: false, error: `Job "${id}" not found.` });

  if (job.selectedProvider !== 'heygen-mcp') {
    return res.status(409).json({ ok: false, error: `This job's selected provider is "${job.selectedProvider}" — HeyGen setup only applies to jobs with selectedProvider "heygen-mcp".` });
  }

  const executionBlocked = job.execution && ACTIVE_EXECUTION_STATES.includes(job.execution.status);
  const executionTerminalBlocked = job.execution && ['completed', 'cancelled'].includes(job.execution.status);
  if (executionBlocked || executionTerminalBlocked) {
    return res.status(409).json({ ok: false, error: `Cannot change HeyGen setup while execution is "${job.execution.status}".` });
  }

  const body = req.body || {};

  // Strict whitelist — only these keys are ever read from the request body.
  const next = { ...(job.providerInput || {}) };
  if (body.avatarId !== undefined) {
    if (typeof body.avatarId !== 'string' || body.avatarId.length > 200) {
      return res.status(400).json({ ok: false, error: 'avatarId must be a string.' });
    }
    next.avatarId = body.avatarId;
  }
  if (body.voiceId !== undefined) {
    if (typeof body.voiceId !== 'string' || body.voiceId.length > 200) {
      return res.status(400).json({ ok: false, error: 'voiceId must be a string.' });
    }
    next.voiceId = body.voiceId;
  }
  if (body.captionEnabled !== undefined) {
    if (typeof body.captionEnabled !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'captionEnabled must be a boolean.' });
    }
    next.captionEnabled = body.captionEnabled;
  }
  if (body.voiceSpeed !== undefined) {
    if (body.voiceSpeed !== null) {
      const speed = Number(body.voiceSpeed);
      if (!Number.isFinite(speed) || speed < 0.5 || speed > 1.5) {
        return res.status(400).json({ ok: false, error: 'voiceSpeed must be a number between 0.5 and 1.5.' });
      }
      next.voiceSpeed = speed;
    } else {
      next.voiceSpeed = null;
    }
  }
  if (body.avatarStyle !== undefined) {
    if (body.avatarStyle !== null && (typeof body.avatarStyle !== 'string' || body.avatarStyle.length > 100)) {
      return res.status(400).json({ ok: false, error: 'avatarStyle must be a string or null.' });
    }
    next.avatarStyle = body.avatarStyle; // accepted for forward-compatibility — no live schema equivalent exists yet, so it is never sent to HeyGen
  }
  if (body.backgroundMode !== undefined) {
    if (body.backgroundMode !== null && (typeof body.backgroundMode !== 'string' || body.backgroundMode.length > 100)) {
      return res.status(400).json({ ok: false, error: 'backgroundMode must be a string or null.' });
    }
    next.backgroundMode = body.backgroundMode; // same — accepted, not yet mapped to a payload field
  }
  if (body.resolution !== undefined) {
    if (body.resolution !== null && !['4k', '1080p', '720p'].includes(body.resolution)) {
      return res.status(400).json({ ok: false, error: 'resolution must be one of: 4k, 1080p, 720p.' });
    }
    next.resolution = body.resolution;
  }
  if (body.testMode !== undefined) {
    if (typeof body.testMode !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'testMode must be a boolean.' });
    }
    next.testMode = body.testMode; // local bookkeeping only — HeyGen has no sandbox/test endpoint
  }
  if (body.selectedTool !== undefined) {
    if (!ALLOWED_SELECTED_TOOLS.includes(body.selectedTool)) {
      return res.status(400).json({ ok: false, error: `selectedTool must be one of: ${ALLOWED_SELECTED_TOOLS.join(', ')}.` });
    }
    next.selectedTool = body.selectedTool;
  } else if (!next.selectedTool) {
    next.selectedTool = 'create_video_from_avatar';
  }

  const pkg = loadPackage(job.packageId);
  if (!pkg) return res.status(404).json({ ok: false, error: 'Content Package no longer exists.' });

  // Live-verify avatar/voice selections against the current (or briefly
  // cached) HeyGen discovery list — never trust a client-supplied label.
  const redirectUrl = String(process.env.HEYGEN_MCP_OAUTH_REDIRECT_URL || '').trim() || undefined;
  let avatars = null;
  let voices = null;
  try {
    [avatars, voices] = await Promise.all([
      listHeyGenAvatars({ redirectUrl }),
      listHeyGenVoices({ redirectUrl }),
    ]);
  } catch (e) {
    return res.status(502).json({ ok: false, error: `Could not verify avatar/voice selection against HeyGen: ${e.message}` });
  }

  const validation = validateHeyGenProviderInputSync({
    job: { ...job, providerInput: next },
    pkg,
    avatars,
    voices,
  });

  const updated = updateProductionJob(id, { providerInput: next });

  // Recompute the full plan (readiness/status/budget/approval) through the
  // SAME governed path every other job edit uses — never a parallel
  // recompute. A materially changed setup resets any prior approval.
  const rebuild = await buildProductionJob({
    packageId: updated.packageId,
    selectedMode: updated.selectedMode,
    selectedProvider: updated.selectedProvider,
    providerInput: next,
    maxEstimatedCost: updated.budget?.maxEstimatedCost ?? undefined,
    currency: updated.budget?.currency,
    approvalRequiredAbove: updated.budget?.approvalRequiredAbove ?? undefined,
    actor: 'user',
    existingJob: { ...updated, approval: null },
  });

  if (!rebuild.ok) return res.status(404).json({ ok: false, error: rebuild.error });

  const final = updateProductionJob(id, rebuild.job);
  applyProductionRefToPackage(final);

  return res.status(200).json({ ok: true, job: sanitizeJob(final), validation });
}
