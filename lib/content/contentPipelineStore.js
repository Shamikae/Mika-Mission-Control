// lib/content/contentPipelineStore.js
// SERVER-SIDE ONLY — uses fs (via the existing content package store).
//
// Adds pipeline stage tracking on top of the EXISTING content package store
// (lib/content/contentPackageStore.js) — no new persistence, no new files
// per package. Content Pack Generator's own read/write paths
// (pages/api/content/pack/*) are untouched; this module only adds a
// `pipeline` sub-object to the same package JSON and writes it back through
// the same `savePackage()`.

import { loadPackage, savePackage, listPackages } from './contentPackageStore';
import { checkStageTransition, withPipelineMeta, isValidStage } from './contentPipelineRules';

export function listPipelinePackages() {
  return listPackages().map(withPipelineMeta);
}

export function loadPipelinePackage(id) {
  const pkg = loadPackage(id);
  return pkg ? withPipelineMeta(pkg) : null;
}

/**
 * Moves one package to a new stage, appending an activity-timeline entry.
 * Gate rules (Review before Approved, Approved before Production) are
 * enforced unless `force` is set. Loosely syncs the package's own review
 * `status` forward at the Review/Approved milestones so the two views never
 * visibly contradict each other — never overrides an explicit `rejected`.
 *
 * @returns {{ ok: boolean, package?: object, error?: string }}
 */
export function moveStage(id, toStage, { actor = 'user', note = null, force = false } = {}) {
  if (!isValidStage(toStage)) {
    return { ok: false, error: `Unknown stage "${toStage}".` };
  }
  const pkg = loadPipelinePackage(id);
  if (!pkg) return { ok: false, error: `Package "${id}" not found.` };

  const check = checkStageTransition(pkg, toStage);
  if (!check.allowed && !force) {
    return { ok: false, error: check.reason, package: pkg };
  }

  if (pkg.pipeline.stage === toStage) {
    return { ok: true, package: pkg }; // no-op, already there
  }

  const now = new Date().toISOString();
  const updated = {
    ...pkg,
    pipeline: {
      stage: toStage,
      enteredStageAt: now,
      history: [...pkg.pipeline.history, { stage: toStage, at: now, actor, note: note || null }],
    },
    metadata: { ...pkg.metadata, updatedAt: now },
  };

  if (toStage === 'review' && !['needs_review', 'approved', 'rejected'].includes(updated.status)) {
    updated.status = 'needs_review';
  }
  if (toStage === 'approved' && updated.status !== 'rejected') {
    updated.status = 'approved';
  }

  savePackage(updated);
  return { ok: true, package: updated };
}

/**
 * Moves several packages to the same stage in one call. Each package is
 * gate-checked independently — one blocked package never stops the rest.
 *
 * @returns {{ ok: boolean, results: { id: string, ok: boolean, error?: string }[] }}
 */
export function bulkMoveStage(ids, toStage, opts = {}) {
  const results = ids.map(id => {
    const r = moveStage(id, toStage, opts);
    return { id, ok: r.ok, error: r.ok ? undefined : r.error };
  });
  return { ok: results.every(r => r.ok), results };
}
