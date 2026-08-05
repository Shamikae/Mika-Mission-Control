// PATCH /api/production/jobs/[id]/higgsfield-provider-input
// Server-managed, sanitized Higgsfield setup for a Production Job: media
// type, model, prompt, and a small set of optional generation preferences.
// Admin protected automatically (middleware.js gates every non-GET route).
// Sibling to provider-input.js (HeyGen-specific) — deliberately a separate
// route rather than a generic one, matching the established per-provider
// pattern exactly.
//
// Input: { mediaType?, model?, prompt?, aspectRatio?, durationSeconds?,
//   outputCount?, useUnlim?, testMode? } — unknown keys are silently
// ignored (never merged into providerInput), so no arbitrary nested
// payload, header, URL, or credential field can ever reach job storage.
// model is validated against the live (or briefly cached) Higgsfield model
// catalog for the selected mediaType — never against a client-supplied
// label. referenceArtifactIds/negativePrompt are intentionally NOT in the
// whitelist — not implemented / not supported this checkpoint (see
// higgsfieldMcp.adapter.js).
//
// Output: { ok: true, job, validation } | { ok: false, error }

import { getProductionJob, updateProductionJob } from '../../../../../lib/production/productionJobStore';
import { loadPackage } from '../../../../../lib/content/contentPackageStore';
import { buildProductionJob, applyProductionRefToPackage } from '../../../../../lib/production/buildProductionPlan';
import { isValidId } from '../../../../../lib/production/productionRules';
import { ACTIVE_EXECUTION_STATES, sanitizeExecutionForResponse } from '../../../../../lib/production/execution/executionRules';
import { callHiggsfieldTool } from '../../../../../lib/higgsfield/higgsfieldMcpClient';
import { validateHiggsfieldProviderInputSync } from '../../../../../lib/production/execution/adapters/higgsfieldMcp.adapter';

const MEDIA_TYPES = ['image', 'video'];
const MAX_PROMPT_CHARS = 2000;

export const config = {
  api: { bodyParser: { sizeLimit: '8kb' } },
};

function sanitizeJob(job) {
  return job ? { ...job, execution: sanitizeExecutionForResponse(job.execution) } : job;
}

function redirectUrlFromEnv() {
  return String(process.env.HIGGSFIELD_MCP_OAUTH_REDIRECT_URL || '').trim() || undefined;
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

  if (job.selectedProvider !== 'higgsfield-mcp') {
    return res.status(409).json({ ok: false, error: `This job's selected provider is "${job.selectedProvider}" — Higgsfield setup only applies to jobs with selectedProvider "higgsfield-mcp".` });
  }

  const executionBlocked = job.execution && ACTIVE_EXECUTION_STATES.includes(job.execution.status);
  const executionTerminalBlocked = job.execution && ['completed', 'cancelled'].includes(job.execution.status);
  if (executionBlocked || executionTerminalBlocked) {
    return res.status(409).json({ ok: false, error: `Cannot change Higgsfield setup while execution is "${job.execution.status}".` });
  }

  const body = req.body || {};

  // Strict whitelist — only these keys are ever read from the request body.
  const next = { ...(job.providerInput || {}) };
  if (body.mediaType !== undefined) {
    if (!MEDIA_TYPES.includes(body.mediaType)) {
      return res.status(400).json({ ok: false, error: `mediaType must be one of: ${MEDIA_TYPES.join(', ')}.` });
    }
    next.mediaType = body.mediaType;
  }
  if (body.model !== undefined) {
    if (typeof body.model !== 'string' || body.model.length > 200) {
      return res.status(400).json({ ok: false, error: 'model must be a string.' });
    }
    next.model = body.model;
  }
  if (body.prompt !== undefined) {
    if (typeof body.prompt !== 'string' || body.prompt.length > MAX_PROMPT_CHARS) {
      return res.status(400).json({ ok: false, error: `prompt must be a string of at most ${MAX_PROMPT_CHARS} characters.` });
    }
    next.prompt = body.prompt;
  }
  if (body.aspectRatio !== undefined) {
    if (body.aspectRatio !== null && (typeof body.aspectRatio !== 'string' || body.aspectRatio.length > 20)) {
      return res.status(400).json({ ok: false, error: 'aspectRatio must be a string or null.' });
    }
    next.aspectRatio = body.aspectRatio;
  }
  if (body.durationSeconds !== undefined) {
    if (body.durationSeconds !== null) {
      const d = Number(body.durationSeconds);
      if (!Number.isFinite(d) || d <= 0 || d > 30) {
        return res.status(400).json({ ok: false, error: 'durationSeconds must be a positive number no greater than 30.' });
      }
      next.durationSeconds = d;
    } else {
      next.durationSeconds = null;
    }
  }
  if (body.outputCount !== undefined) {
    if (Number(body.outputCount) !== 1) {
      return res.status(400).json({ ok: false, error: 'outputCount must be exactly 1 in this checkpoint.' });
    }
    next.outputCount = 1;
  } else if (!next.outputCount) {
    next.outputCount = 1;
  }
  if (body.useUnlim !== undefined) {
    if (body.useUnlim !== null && typeof body.useUnlim !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'useUnlim must be a boolean or null.' });
    }
    next.useUnlim = body.useUnlim;
  }
  if (body.testMode !== undefined) {
    if (typeof body.testMode !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'testMode must be a boolean.' });
    }
    next.testMode = body.testMode; // local bookkeeping only — Higgsfield has no sandbox/test endpoint
  }

  const pkg = loadPackage(job.packageId);
  if (!pkg) return res.status(404).json({ ok: false, error: 'Content Package no longer exists.' });

  // Live-verify the model selection against the current Higgsfield model
  // catalog for the selected mediaType — never trust a client-supplied label.
  const redirectUrl = redirectUrlFromEnv();
  let models = null;
  if (next.mediaType) {
    try {
      const result = await callHiggsfieldTool('models_explore', { action: 'list', type: next.mediaType, limit: 100 }, { redirectUrl });
      models = Array.isArray(result.json?.items) ? result.json.items : [];
    } catch (e) {
      return res.status(502).json({ ok: false, error: `Could not verify model selection against Higgsfield: ${e.message}` });
    }
  }

  const validation = validateHiggsfieldProviderInputSync({
    job: { ...job, providerInput: next },
    pkg,
    models,
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
