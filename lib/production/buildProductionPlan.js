// lib/production/buildProductionPlan.js
// SERVER-SIDE ONLY.
//
// Orchestrates a governed production plan from an existing Content Package.
// Reuses lib/content/contentPackageStore.js UNMODIFIED (loadPackage/savePackage)
// — the Content Package remains the single source of truth for creative
// content. This module never writes package content fields, only an
// optional `production` reference block (see applyProductionRefToPackage).
//
// Never executes a provider. Only plans.

import { loadPackage, savePackage } from '../content/contentPackageStore';
import { resolveOpenArtVideoStatus } from './openartVideoAvailability';
import { resolveHeyGenMcpStatus } from './heygenMcpAvailability';
import { resolveHiggsfieldMcpStatus } from './higgsfieldMcpAvailability';
import { generateJobId } from './productionJobStore';
import {
  PROVIDER_CATALOG, checkPackageEligibility, recommendProductionMode,
  evaluateAssetReadiness, recommendProviders, buildOutputSpec, estimateProviderBudget,
  computeJobStatus, buildScenesSummary, buildVoiceoverScriptSummary,
  buildCaptionPlanSummary, buildVisualAssetPlanSummary, buildAudioPlanSummary,
  makeActivityEvent, isValidMode,
} from './productionRules';

/**
 * Clones PROVIDER_CATALOG with openart-video's status/activationRequirements
 * patched from live MCP tool discovery. Every other entry is a fixed,
 * documented governance decision (see productionRules.js).
 */
async function resolveLiveCatalog() {
  const [openArtLive, heygenLive, higgsfieldLive] = await Promise.all([
    resolveOpenArtVideoStatus(), resolveHeyGenMcpStatus(), resolveHiggsfieldMcpStatus(),
  ]);
  return PROVIDER_CATALOG.map(p => {
    if (p.id === 'openart-video') {
      return { ...p, status: openArtLive.status, activationRequirements: openArtLive.status === 'active' ? [] : [...p.activationRequirements, openArtLive.reason] };
    }
    if (p.id === 'heygen-mcp') {
      return { ...p, status: heygenLive.status, activationRequirements: heygenLive.status === 'active' ? [] : [...p.activationRequirements, heygenLive.reason] };
    }
    if (p.id === 'higgsfield-mcp') {
      return { ...p, status: higgsfieldLive.status, activationRequirements: higgsfieldLive.status === 'active' ? [] : [...p.activationRequirements, higgsfieldLive.reason] };
    }
    return p;
  });
}

function blockedJob({ id, packageId, pkg, eligibility, existingJob, actor }) {
  const now = new Date().toISOString();
  return {
    id,
    packageId,
    packageUpdatedAt: pkg.metadata.updatedAt,
    stalePackage: false,
    status: 'blocked',
    eligibility,
    recommendedMode: null,
    selectedMode: null,
    modeReason: null,
    recommendedProvider: null,
    selectedProvider: null,
    providerInput: null,
    preferredFutureProvider: null,
    providerCandidates: [],
    unavailableReasons: {},
    missingActivationRequirements: [],
    readiness: { ready: false, score: 0, available: [], missingRequired: [], missingOptional: [], warnings: [] },
    scenes: null,
    voiceoverScript: null,
    captionPlan: null,
    visualAssetPlan: null,
    audioPlan: null,
    outputSpec: buildOutputSpec(pkg),
    budget: null,
    approval: { required: false, requestedAt: null, approvedAt: null, approvedBy: null, rejectedAt: null, rejectedBy: null, notes: '' },
    review: existingJob?.review || { status: 'unreviewed', reviewedAt: null, reviewedBy: null, note: '' },
    metadata: {
      createdAt: existingJob?.metadata?.createdAt || now,
      updatedAt: now,
      createdBy: 'user',
      userNotes: existingJob?.metadata?.userNotes || '',
    },
    activityHistory: [
      ...(existingJob?.activityHistory || []),
      makeActivityEvent('eligibility_checked', { actor, note: `Package is not eligible: ${eligibility.reasons.join(' ')}` }),
    ],
  };
}

/**
 * Builds a full production job for an eligible package. If `existingJob` is
 * provided, its id / createdAt / approval / userNotes / activityHistory are
 * preserved (refresh path) — otherwise a fresh job is created.
 *
 * @returns {Promise<{ ok: boolean, job?: object, error?: string }>}
 */
export async function buildProductionJob({
  packageId, selectedMode, selectedProvider, providerInput, maxEstimatedCost, currency, approvalRequiredAbove,
  actor = 'user', existingJob = null,
}) {
  const pkg = loadPackage(packageId);
  if (!pkg) return { ok: false, error: `Package "${packageId}" not found.` };

  const id = existingJob?.id || generateJobId();
  const eligibility = checkPackageEligibility(pkg);

  if (!eligibility.eligible) {
    return { ok: true, job: blockedJob({ id, packageId, pkg, eligibility, existingJob, actor }) };
  }

  const catalog = await resolveLiveCatalog();
  const catalogIds = catalog.map(p => p.id);

  const modeRec = recommendProductionMode(pkg);
  const selMode = isValidMode(selectedMode) ? selectedMode : modeRec.recommendedMode;
  const finalProviderInput = providerInput !== undefined ? providerInput : (existingJob?.providerInput || null);

  // First pass: mode-only readiness, used to score provider candidates.
  const provisionalReadiness = evaluateAssetReadiness(pkg, { mode: selMode, providerId: null, catalog });
  const providerRec = recommendProviders(pkg, { mode: selMode, readiness: provisionalReadiness, catalog });
  const finalProviderId = (selectedProvider && catalogIds.includes(selectedProvider)) ? selectedProvider : providerRec.recommendedProvider;

  // Second pass: final readiness, including the selected provider's own required inputs
  // and (heygen-mcp only) the server-managed providerInput avatar/voice selection.
  const readiness = evaluateAssetReadiness(pkg, { mode: selMode, providerId: finalProviderId, catalog, providerInput: finalProviderInput });
  const budget = estimateProviderBudget(finalProviderId, { maxEstimatedCost, currency, approvalRequiredAbove, catalog });
  const status = computeJobStatus({ eligibility, readiness, budget });

  const now = new Date().toISOString();
  const activityHistory = [
    ...(existingJob?.activityHistory || []),
    makeActivityEvent('eligibility_checked', { actor, note: 'Package is eligible for production.' }),
    makeActivityEvent('mode_recommended', { actor, note: modeRec.modeReason, metadata: { recommendedMode: modeRec.recommendedMode, selectedMode: selMode } }),
    makeActivityEvent('provider_recommended', { actor, note: providerRec.recommendationReason, metadata: { recommendedProvider: providerRec.recommendedProvider, selectedProvider: finalProviderId } }),
    makeActivityEvent('readiness_evaluated', { actor, note: `Readiness score ${readiness.score}/100 — ${readiness.ready ? 'ready' : 'missing required assets'}.`, metadata: { score: readiness.score, missingRequired: readiness.missingRequired } }),
  ];
  if (budget.approvalRequired && !existingJob?.approval?.approvedAt) {
    activityHistory.push(makeActivityEvent('approval_requested', { actor: 'system', note: budget.approvalReason }));
  }

  const job = {
    id,
    packageId,
    packageUpdatedAt: pkg.metadata.updatedAt,
    stalePackage: false,
    status,
    eligibility,
    recommendedMode: modeRec.recommendedMode,
    selectedMode: selMode,
    modeReason: modeRec.modeReason,
    recommendedProvider: providerRec.recommendedProvider,
    selectedProvider: finalProviderId,
    providerInput: finalProviderInput,
    preferredFutureProvider: providerRec.preferredFutureProvider,
    providerCandidates: providerRec.providerCandidates,
    unavailableReasons: providerRec.unavailableReasons,
    missingActivationRequirements: providerRec.missingActivationRequirements,
    readiness,
    scenes: buildScenesSummary(pkg),
    voiceoverScript: buildVoiceoverScriptSummary(pkg),
    captionPlan: buildCaptionPlanSummary(pkg),
    visualAssetPlan: buildVisualAssetPlanSummary(pkg),
    audioPlan: buildAudioPlanSummary(pkg, selMode),
    outputSpec: buildOutputSpec(pkg),
    budget,
    approval: existingJob?.approval || {
      required: budget.approvalRequired,
      requestedAt: budget.approvalRequired ? now : null,
      approvedAt: null, approvedBy: null, rejectedAt: null, rejectedBy: null, notes: '',
    },
    // Output review is independent of plan approval — a job can be plan-approved
    // and still have its final OUTPUT reviewed/rejected after execution completes.
    // Existing jobs built before this field existed default to 'unreviewed', never
    // silently treated as approved.
    review: existingJob?.review || { status: 'unreviewed', reviewedAt: null, reviewedBy: null, note: '' },
    metadata: {
      createdAt: existingJob?.metadata?.createdAt || now,
      updatedAt: now,
      createdBy: 'user',
      userNotes: existingJob?.metadata?.userNotes || '',
    },
    activityHistory,
  };

  return { ok: true, job };
}

/**
 * Refresh path: reloads the package, detects staleness (packageUpdatedAt
 * drift since the job was last built), and rebuilds the plan preserving the
 * job's current selectedMode/selectedProvider/budget as inputs — so a
 * refresh reconciles against reality without discarding user choices.
 */
export async function refreshProductionJob(job, { actor = 'user' } = {}) {
  const pkg = loadPackage(job.packageId);
  if (!pkg) return { ok: false, error: `Package "${job.packageId}" not found.` };

  const wasStale = pkg.metadata.updatedAt !== job.packageUpdatedAt;
  const withStaleEvent = wasStale
    ? { ...job, activityHistory: [...job.activityHistory, makeActivityEvent('package_stale_detected', { actor: 'system', note: `Package updatedAt changed from ${job.packageUpdatedAt} to ${pkg.metadata.updatedAt}.` })] }
    : job;

  const result = await buildProductionJob({
    packageId: job.packageId,
    selectedMode: job.selectedMode,
    selectedProvider: job.selectedProvider,
    maxEstimatedCost: job.budget?.maxEstimatedCost ?? undefined,
    currency: job.budget?.currency,
    approvalRequiredAbove: job.budget?.approvalRequiredAbove ?? undefined,
    actor,
    existingJob: withStaleEvent,
  });

  if (!result.ok) return result;

  const refreshed = {
    ...result.job,
    activityHistory: [...result.job.activityHistory, makeActivityEvent('plan_refreshed', { actor, note: wasStale ? 'Refreshed against updated package.' : 'Refreshed — package unchanged.' })],
  };

  return { ok: true, job: refreshed };
}

/**
 * Adds/updates the lightweight `production` reference block on a package
 * after a plan is successfully created or materially updated. Never writes
 * package content (script/scenes/prompts/provider data/URLs/secrets) — only
 * { latestJobId, status, selectedMode, selectedProvider, updatedAt }.
 * Package approval status and pipeline stage are never touched here (moves
 * are always an explicit, separate user action per the Package Pipeline).
 *
 * `force` is true ONLY for brand-new job creation (POST /router/plan), where
 * the just-created job is unconditionally the newest thing for this package.
 * For every other caller (PATCH, approve, refresh, cancel — force=false,
 * the default), the write is guarded: it only applies if this job is still
 * the package's current `production.latestJobId` (or the package has no
 * production ref yet). This is what stops an older/unrelated job from ever
 * clobbering a newer production reference.
 */
export function applyProductionRefToPackage(job, { force = false } = {}) {
  const pkg = loadPackage(job.packageId);
  if (!pkg) return null;

  const currentLatestJobId = pkg.production?.latestJobId;
  if (!force && currentLatestJobId && currentLatestJobId !== job.id) {
    return pkg; // a different, newer job already owns this package's reference
  }

  pkg.production = {
    latestJobId: job.id,
    status: job.status,
    selectedMode: job.selectedMode,
    selectedProvider: job.selectedProvider,
    updatedAt: new Date().toISOString(),
  };
  savePackage(pkg);
  return pkg;
}
