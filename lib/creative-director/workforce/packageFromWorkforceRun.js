// lib/creative-director/workforce/packageFromWorkforceRun.js
// SERVER-SIDE ONLY (uses fs via the existing content package store).
//
// This is the ONLY place the Content Workforce touches Content Package
// storage, and it does so exclusively through the SAME interfaces every
// other package-creation path already uses:
//   - lib/content/contentPackageSchema.js's parseSynthesisOutput() +
//     buildContentPackage() — the exact same validation/sanitization and
//     shape-builder used by Content Pack Generator's real AI synthesis, so
//     a workforce-created package can never schema-drift from any other.
//   - lib/content/contentPackageStore.js's savePackage().
//   - lib/content/contentPipelineRules.js's defaultPipelineMeta().
// Provenance (source/creativeDirectorRequestId/workforceRunId/researchMode/
// generatedBy/reviewedAt/humanApprovedAt) is added ADDITIVELY to
// pkg.metadata after buildContentPackage() returns — contentPackageSchema.js
// itself is never modified, exactly mirroring how packageFromRequest.js
// additively attaches `pipeline`.

import { randomBytes } from 'crypto';
import { buildContentPackage, parseSynthesisOutput } from '../../content/contentPackageSchema';
import { savePackage } from '../../content/contentPackageStore';
import { defaultPipelineMeta } from '../../content/contentPipelineRules';
import { getEffectiveStageOutput, WorkforceError } from './workforceRules';
import { findLatestResearchRunForWorkforceRun } from '../../research/researchRunStore.js';

function mapScenes(scenes) {
  if (!Array.isArray(scenes)) return [];
  return scenes.map((s, i) => ({
    order: Number.isFinite(s.index) ? s.index + 1 : i + 1,
    durationSeconds: Number.isFinite(s.startSeconds) && Number.isFinite(s.endSeconds) && s.endSeconds > s.startSeconds
      ? Math.round(s.endSeconds - s.startSeconds)
      : null,
    visual: s.visual || '',
    voiceover: s.narration || '',
    onScreenText: s.onScreenText || '',
  }));
}

/**
 * @param {object} run — a completed, approved workforce run
 * @param {object} request — the originating Content Request
 * @returns {object} the persisted Content Package
 */
export function createPackageFromWorkforceRun(run, request) {
  const research = getEffectiveStageOutput(run, 'research');
  const script = getEffectiveStageOutput(run, 'script');
  const storyboard = getEffectiveStageOutput(run, 'storyboard');
  const thumbnail = getEffectiveStageOutput(run, 'thumbnail');
  const caption = getEffectiveStageOutput(run, 'caption');

  if (!script || !caption) {
    throw new WorkforceError(409, 'incomplete_run', 'Cannot map to a Content Package — Script and Caption stages must both have completed output.');
  }

  const rawHooks = Array.isArray(script.hooks) && script.hooks.length ? script.hooks : [{ text: script.selectedHook || script.fullText?.slice(0, 200), angle: 'workforce' }];
  // Ensure the human-selected/edited hook leads, so it is what a downstream
  // reader (or Publishing Router preview) sees first.
  const orderedHooks = script.selectedHook
    ? [{ text: script.selectedHook, angle: 'selected' }, ...rawHooks.filter(h => h.text !== script.selectedHook)]
    : rawHooks;

  const rawSynthesized = {
    hooks: orderedHooks.map(h => ({ text: h.text, angle: h.angle })),
    script: { opening: script.opening || '', body: script.body || '', cta: script.cta || '', fullText: script.fullText || '' },
    scenes: mapScenes(storyboard?.scenes),
    caption: caption.primaryCaption || '',
    cta: script.cta || caption.cta || '',
    hashtags: caption.hashtags || [],
    keywords: caption.keywords || [],
    thumbnail: {
      headline: thumbnail?.headline || (caption.primaryCaption || '').slice(0, 150),
      visualBrief: thumbnail?.imagePrompt || thumbnail?.visualBrief || '',
    },
  };

  const validation = parseSynthesisOutput(rawSynthesized);
  if (!validation.valid) {
    throw new WorkforceError(500, 'package_mapping_failed', `Workforce output failed Content Package schema validation: ${validation.errors.join('; ')}`);
  }

  const id = `pack-${Date.now()}-${randomBytes(3).toString('hex')}`;
  const now = new Date().toISOString();

  let pkg = buildContentPackage({
    id,
    brand: request.brand,
    platform: request.platform,
    goal: request.goal,
    topic: request.topic,
    audience: request.targetAudience,
    offer: '',
    tone: request.style,
    videoDuration: request.desiredRuntime,
    ctaInput: request.cta,
    instructions: `Created by the Content Workforce from Content Request ${request.id} (run ${run.id}), after AI Creative Review and human approval.`,
    synthesized: validation.data,
    model: run.stages.script?.result?.model || null,
    provider: 'content-workforce',
  });

  // Bounded provenance only — counts and an id to look up full detail via
  // /api/research/runs/[id], never the sources' actual titles/urls/content.
  // Never copies full source content into the package (spec requirement).
  const researchProvenance = research?.researchMode === 'live-search'
    ? {
        mode: 'live-search',
        provider: research.sourceSummary?.provider || null,
        researchRunId: findLatestResearchRunForWorkforceRun(run.id)?.id || null,
        sourceCount: research.sourceSummary?.sourceCount ?? (research.sourceIds || []).length,
        evidenceCount: (research.evidence || []).length,
        retrievedAt: research.sourceSummary?.retrievedAt || null,
      }
    : { mode: 'model-synthesis', provider: null, researchRunId: null, sourceCount: 0, evidenceCount: 0, retrievedAt: null };

  pkg = {
    ...pkg,
    pipeline: defaultPipelineMeta(now),
    metadata: {
      ...pkg.metadata,
      source: 'content-workforce',
      creativeDirectorRequestId: request.id,
      workforceRunId: run.id,
      researchMode: research?.researchMode || 'model-synthesis',
      generatedBy: 'content-workforce',
      reviewedAt: run.stages.review?.result?.completedAt || null,
      humanApprovedAt: run.approval?.approvedAt || null,
      research: researchProvenance,
    },
  };

  savePackage(pkg);
  return pkg;
}
