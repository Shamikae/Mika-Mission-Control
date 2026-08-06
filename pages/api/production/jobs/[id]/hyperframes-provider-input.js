// GET   /api/production/jobs/[id]/hyperframes-provider-input
// PATCH /api/production/jobs/[id]/hyperframes-provider-input
//
// Server-managed, sanitized HyperFrames setup for a Production Job:
// composition selection + optional render quality. Admin protected
// automatically (middleware.js gates every non-GET route). Sibling to
// higgsfield-provider-input.js/openart-video-provider-input.js —
// deliberately a separate route rather than a generic one, matching the
// established per-provider pattern exactly.
//
// GET:   returns the job's current sanitized providerInput plus the live
//        list of available local HyperFrames compositions (read-only,
//        reuses listHyperFramesCompositions() — never duplicates that
//        discovery logic).
// PATCH: Input: { compositionId?, quality? } — unknown keys (including
//        outputFilename/forceRerender, both explicitly out of scope this
//        checkpoint — see hyperframes.adapter.js) are silently ignored,
//        never merged into providerInput. compositionId is validated
//        against the live local composition catalog — never against a
//        client-supplied label, and never a raw filesystem path.
//
// POST:  generates a HyperFrames composition from the job's Content Package
//         via URS (buildRenderSpec -> hyperframesTranslator), then selects it
//         through the SAME apply path PATCH uses. Adds no second render
//         engine, no second job, and no bypass of the existing adapter — it
//         only produces a compositionId that PATCH could otherwise only get
//         from a hand-authored composition. Optional body:
//         { voiceId?, speed?, narration?: false } — narration is generated
//         locally at zero cost and attached as one audio track. Passing
//         narration:false produces the silent composition instead.
//
// Output: { ok: true, job?, validation?, compositions?, translation? } | { ok: false, error }

import { getProductionJob, updateProductionJob } from '../../../../../lib/production/productionJobStore';
import { loadPackage } from '../../../../../lib/content/contentPackageStore';
import { buildProductionJob, applyProductionRefToPackage } from '../../../../../lib/production/buildProductionPlan';
import { isValidId } from '../../../../../lib/production/productionRules';
import { ACTIVE_EXECUTION_STATES, sanitizeExecutionForResponse } from '../../../../../lib/production/execution/executionRules';
import { validateHyperFramesProviderInputSync } from '../../../../../lib/production/execution/adapters/hyperframes.adapter';
import { isValidCompositionId } from '../../../../../lib/hyperframes/hyperframesSecurity';
import { getHyperFramesComposition, listHyperFramesCompositions } from '../../../../../lib/hyperframes/hyperframesCompositionStore';
import { buildRenderSpec } from '../../../../../lib/production/renderSpec/buildRenderSpec';
import { translateUrsToHyperFrames } from '../../../../../lib/production/renderSpec/translators/hyperframesTranslator';
import { generateNarration } from '../../../../../lib/production/audio/narrationService';
import {
  extractNarrationFromSpec, classifyTimingFit, estimateNarrationCost,
  isValidVoiceId, isValidSpeed, DEFAULT_VOICE_ID, DEFAULT_SPEED, VOICE_ALLOWLIST,
} from '../../../../../lib/production/audio/narrationRules';

const QUALITY_VALUES = ['standard', 'high'];

export const config = {
  api: { bodyParser: { sizeLimit: '4kb' } },
};

function sanitizeJob(job) {
  return job ? { ...job, execution: sanitizeExecutionForResponse(job.execution) } : job;
}

export default async function handler(req, res) {
  const { id } = req.query;
  if (!id || typeof id !== 'string' || !isValidId(id)) {
    return res.status(400).json({ ok: false, error: 'Invalid job id.' });
  }

  const job = getProductionJob(id);
  if (!job) return res.status(404).json({ ok: false, error: `Job "${id}" not found.` });

  if (job.selectedProvider !== 'hyperframes') {
    return res.status(409).json({ ok: false, error: `This job's selected provider is "${job.selectedProvider}" — HyperFrames setup only applies to jobs with selectedProvider "hyperframes".` });
  }

  if (req.method === 'GET') {
    const compositions = await listHyperFramesCompositions();
    // Narration availability is derived from the package's own URS, so the
    // panel can show what WOULD be spoken before anything is generated.
    let narrationPreview = null;
    const previewPkg = loadPackage(job.packageId);
    if (previewPkg) {
      const built = buildRenderSpec(previewPkg, { mode: job.selectedMode });
      if (built.ok && built.spec) {
        const extracted = extractNarrationFromSpec(built.spec);
        narrationPreview = {
          available: !!extracted.text,
          source: extracted.source,
          characterCount: extracted.text.length,
          timelineDurationSeconds: built.spec.timing?.totalDurationSeconds ?? null,
          voices: VOICE_ALLOWLIST,
          defaultVoiceId: DEFAULT_VOICE_ID,
          estimatedCost: estimateNarrationCost({ characterCount: extracted.text.length }),
        };
      }
    }
    return res.status(200).json({ ok: true, providerInput: job.providerInput || null, compositions, narration: narrationPreview });
  }

  if (req.method !== 'PATCH' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const executionBlocked = job.execution && ACTIVE_EXECUTION_STATES.includes(job.execution.status);
  const executionTerminalBlocked = job.execution && ['completed', 'cancelled'].includes(job.execution.status);
  if (executionBlocked || executionTerminalBlocked) {
    return res.status(409).json({ ok: false, error: `Cannot change HyperFrames setup while execution is "${job.execution.status}".` });
  }

  // ── POST: generate a composition from this job's package via URS ───────
  if (req.method === 'POST') {
    const sourcePkg = loadPackage(job.packageId);
    if (!sourcePkg) return res.status(404).json({ ok: false, error: 'Content Package no longer exists.' });

    const built = buildRenderSpec(sourcePkg, { mode: job.selectedMode });
    if (!built.ok || !built.spec) {
      return res.status(422).json({ ok: false, error: 'Could not build a valid Render Specification for this package.', errors: built.validation?.errors || [] });
    }

    // ── Narration (local, $0, one track) ────────────────────────────────
    const wantNarration = req.body?.narration !== false;
    const voiceId = req.body?.voiceId ?? DEFAULT_VOICE_ID;
    const speed = req.body?.speed ?? DEFAULT_SPEED;
    if (wantNarration && !isValidVoiceId(voiceId)) {
      return res.status(400).json({ ok: false, error: `voiceId must be one of: ${VOICE_ALLOWLIST.map(v => v.id).join(', ')}.` });
    }
    if (wantNarration && !isValidSpeed(speed)) {
      return res.status(400).json({ ok: false, error: 'speed is outside the supported range.' });
    }

    let narration = null;
    let narrationReport = null;
    if (wantNarration) {
      const extracted = extractNarrationFromSpec(built.spec);
      if (extracted.text) {
        const gen = await generateNarration({
          packageId: built.spec.source?.packageId,
          renderSpecId: built.spec.specId,
          text: extracted.text,
          voiceId,
          speed,
          targetDurationSeconds: built.spec.timing?.totalDurationSeconds ?? null,
        });
        if (!gen.ok) {
          return res.status(502).json({ ok: false, error: `Narration generation failed: ${gen.error}` });
        }
        const fit = classifyTimingFit({
          audioDurationSeconds: gen.record.durationSeconds,
          timelineDurationSeconds: built.spec.timing?.totalDurationSeconds ?? null,
          currentSpeed: speed,
        });
        // A script that cannot fit is never silently truncated — it blocks.
        if (fit.blocking) {
          return res.status(422).json({
            ok: false,
            error: 'Narration is materially longer than the timeline — revise the script or scene timing.',
            narration: { ...summarizeNarration(gen.record, fit, extracted), blocking: true },
          });
        }
        narration = { ...gen.record, timingFit: fit.fit };
        narrationReport = { ...summarizeNarration(gen.record, fit, extracted), reused: gen.reused, blocking: false };
      } else {
        narrationReport = { available: false, reason: 'This package carries no narration text.' };
      }
    }

    let translated;
    try {
      translated = translateUrsToHyperFrames(built.spec, { narration });
    } catch (err) {
      return res.status(500).json({ ok: false, error: `Translation failed: ${err.message}` });
    }
    if (!translated.ok) {
      return res.status(422).json({ ok: false, error: translated.error, translation: translated.report || null });
    }

    const applied = await applySetup(job, { compositionId: translated.compositionId });
    if (!applied.ok) return res.status(applied.status).json({ ok: false, error: applied.error });

    return res.status(200).json({
      ok: true,
      job: applied.job,
      validation: applied.validation,
      translation: {
        compositionId: translated.compositionId,
        created: translated.created,
        reused: translated.reused,
        renderSpecId: built.spec.specId,
        ursVersion: built.spec.ursVersion,
        totalDurationSeconds: translated.manifest?.totalDurationSeconds ?? null,
        sceneCount: translated.manifest?.sceneCount ?? null,
        contentHash: translated.manifest?.contentHash ?? null,
        report: translated.report,
      },
      narration: narrationReport,
    });
  }

  const body = req.body || {};

  // Strict whitelist — only these keys are ever read from the request body.
  // outputFilename/forceRerender are deliberately NOT here (see
  // hyperframes.adapter.js's header comment) — never merged into providerInput.
  const next = { ...(job.providerInput || {}) };
  if (body.compositionId !== undefined) {
    if (typeof body.compositionId !== 'string' || !isValidCompositionId(body.compositionId)) {
      return res.status(400).json({ ok: false, error: 'compositionId must be a valid HyperFrames composition identifier.' });
    }
    next.compositionId = body.compositionId;
  }
  if (body.quality !== undefined) {
    if (body.quality !== null && !QUALITY_VALUES.includes(body.quality)) {
      return res.status(400).json({ ok: false, error: `quality must be one of: ${QUALITY_VALUES.join(', ')}, or null.` });
    }
    next.quality = body.quality;
  }

  const applied = await applySetup(job, next);
  if (!applied.ok) return res.status(applied.status).json({ ok: false, error: applied.error });
  return res.status(200).json({ ok: true, job: applied.job, validation: applied.validation });
}


/**
 * Applies a sanitized providerInput to a job and recomputes the full plan
 * through the SAME governed path every other job edit uses. Extracted so
 * PATCH (manual selection) and POST (generated selection) cannot drift —
 * the logic is byte-for-byte what PATCH did before POST existed.
 */
async function applySetup(job, next) {
  const pkg = loadPackage(job.packageId);
  if (!pkg) return { ok: false, status: 404, error: 'Content Package no longer exists.' };

  // Live-verify the composition selection against the real local
  // filesystem — never trust a client-supplied id beyond format validation.
  let compositionExists = null;
  if (next.compositionId) {
    const found = await getHyperFramesComposition(next.compositionId).catch(() => null);
    compositionExists = !!found;
  }

  const validation = validateHyperFramesProviderInputSync({
    job: { ...job, providerInput: next },
    compositionExists,
  });

  const updated = updateProductionJob(job.id, { providerInput: next });

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

  if (!rebuild.ok) return { ok: false, status: 404, error: rebuild.error };

  const final = updateProductionJob(job.id, rebuild.job);
  applyProductionRefToPackage(final);

  return { ok: true, job: sanitizeJob(final), validation };
}


/** Browser-safe narration summary — never exposes a filesystem path. */
function summarizeNarration(record, fit, extracted) {
  return {
    available: true,
    audioId: record.audioId,
    provider: record.provider,
    model: record.model,
    voiceId: record.voiceId,
    speed: record.speed,
    source: extracted.source,
    characterCount: record.characterCount,
    wordCount: record.wordCount,
    audioDurationSeconds: record.durationSeconds,
    timelineDurationSeconds: record.targetDurationSeconds,
    timingFit: fit.fit,
    varianceSeconds: fit.varianceSeconds,
    requiredSpeed: fit.requiredSpeed,
    estimatedCost: record.estimatedCost,
    actualCost: record.actualCost,
    warnings: [...(record.warnings || []), ...(fit.warnings || [])],
  };
}
