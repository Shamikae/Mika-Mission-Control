// PATCH /api/production/jobs/[id]/openart-video-provider-input
// Server-managed, sanitized OpenArt Video setup for a Production Job: model,
// prompt, and the small set of text2video generation preferences OpenArt's
// own live form schema requires. Admin protected automatically
// (middleware.js gates every non-GET route). Sibling to
// higgsfield-provider-input.js — deliberately a separate route rather than
// a generic one, matching the established per-provider pattern exactly.
//
// Input: { model?, prompt?, aspectRatio?, durationSeconds?, resolution?,
//   outputCount? } — unknown keys are silently ignored (never merged into
//   providerInput), so no arbitrary nested payload, header, URL, or
//   credential field can ever reach job storage. model is validated against
//   the live (text2video-capable only) OpenArt model catalog — never
//   against a client-supplied label. aspectRatio/durationSeconds/resolution
//   are validated against the SELECTED model's live openart_model_form_get
//   schema. Reference-media fields are intentionally NOT in the whitelist —
//   not implemented this checkpoint (see openartVideoMcp.adapter.js).
//
// Output: { ok: true, job, validation } | { ok: false, error }

import { getProductionJob, updateProductionJob } from '../../../../../lib/production/productionJobStore';
import { loadPackage } from '../../../../../lib/content/contentPackageStore';
import { buildProductionJob, applyProductionRefToPackage } from '../../../../../lib/production/buildProductionPlan';
import { isValidId } from '../../../../../lib/production/productionRules';
import { ACTIVE_EXECUTION_STATES, sanitizeExecutionForResponse } from '../../../../../lib/production/execution/executionRules';
import {
  validateOpenArtVideoProviderInputSync, fetchVideoModelCatalog, fetchVideoModelForm,
} from '../../../../../lib/production/execution/adapters/openartVideoMcp.adapter';

const MAX_PROMPT_CHARS = 2000;

export const config = {
  api: { bodyParser: { sizeLimit: '8kb' } },
};

function sanitizeJob(job) {
  return job ? { ...job, execution: sanitizeExecutionForResponse(job.execution) } : job;
}

function redirectUrlFromEnv() {
  return String(process.env.OPENART_OAUTH_REDIRECT_URL || '').trim() || undefined;
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

  if (job.selectedProvider !== 'openart-video') {
    return res.status(409).json({ ok: false, error: `This job's selected provider is "${job.selectedProvider}" — OpenArt Video setup only applies to jobs with selectedProvider "openart-video".` });
  }

  const executionBlocked = job.execution && ACTIVE_EXECUTION_STATES.includes(job.execution.status);
  const executionTerminalBlocked = job.execution && ['completed', 'cancelled'].includes(job.execution.status);
  if (executionBlocked || executionTerminalBlocked) {
    return res.status(409).json({ ok: false, error: `Cannot change OpenArt Video setup while execution is "${job.execution.status}".` });
  }

  const body = req.body || {};

  // Strict whitelist — only these keys are ever read from the request body.
  const next = { ...(job.providerInput || {}) };
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
      if (!Number.isFinite(d) || d <= 0 || d > 60) {
        return res.status(400).json({ ok: false, error: 'durationSeconds must be a positive number no greater than 60.' });
      }
      next.durationSeconds = d;
    } else {
      next.durationSeconds = null;
    }
  }
  if (body.resolution !== undefined) {
    if (body.resolution !== null && (typeof body.resolution !== 'string' || body.resolution.length > 20)) {
      return res.status(400).json({ ok: false, error: 'resolution must be a string or null.' });
    }
    next.resolution = body.resolution;
  }
  if (body.outputCount !== undefined) {
    if (Number(body.outputCount) !== 1) {
      return res.status(400).json({ ok: false, error: 'outputCount must be exactly 1 in this checkpoint.' });
    }
    next.outputCount = 1;
  } else if (!next.outputCount) {
    next.outputCount = 1;
  }

  const pkg = loadPackage(job.packageId);
  if (!pkg) return res.status(404).json({ ok: false, error: 'Content Package no longer exists.' });

  // Live-verify the model selection against the current text2video-capable
  // OpenArt model catalog, and — once a model is selected — the model's own
  // live form schema (duration/aspectRatio/resolution constraints). Never
  // trust a client-supplied label or cached assumption.
  const redirectUrl = redirectUrlFromEnv();
  let models = null;
  let formSchema = null;
  try {
    models = await fetchVideoModelCatalog(redirectUrl);
    if (next.model) {
      formSchema = await fetchVideoModelForm(next.model, redirectUrl);
    }
  } catch (e) {
    return res.status(502).json({ ok: false, error: `Could not verify model selection against OpenArt: ${e.message}` });
  }

  const validation = validateOpenArtVideoProviderInputSync({
    job: { ...job, providerInput: next },
    pkg,
    models,
    formSchema,
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
