// lib/orchestration/missionControlMetrics.js
// Pure functions — no I/O. Aggregates already-loaded records (packages,
// production jobs, publish jobs, render queue) into the counts/rates the
// Mission Control widget and Content Orchestrator dashboard header show.
// Never mutates anything; a pure derivation over existing data only.

import { computePackageHealth, HEALTH_STATES } from './workflowRules';

function byId(items, key) {
  const map = new Map();
  for (const item of items) {
    const k = item[key];
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return map;
}

export function computeMissionControlMetrics({ packages, productionJobs, publishJobs, renderQueue = [] }) {
  const jobsByPackage = byId(productionJobs, 'packageId');
  const publishByProdJob = byId(publishJobs, 'productionJobId');

  // ── Package health breakdown (+ per-package map, so callers like the
  // Content Orchestrator's package list can show REAL health for every row
  // without an N+1 fetch per package) ───────────────────────────────────
  const byHealth = Object.fromEntries(HEALTH_STATES.map(h => [h, 0]));
  const healthByPackageId = {};
  for (const pkg of packages) {
    const jobs = jobsByPackage.get(pkg.id) || [];
    const pubs = jobs.flatMap(j => publishByProdJob.get(j.id) || []);
    const health = computePackageHealth(pkg, jobs, pubs);
    byHealth[health] = (byHealth[health] || 0) + 1;
    healthByPackageId[pkg.id] = health;
  }

  // ── Production volume / render success rate ──────────────────────────
  const byExecutionStatus = {};
  for (const job of productionJobs) {
    const status = job.execution?.status || 'none';
    byExecutionStatus[status] = (byExecutionStatus[status] || 0) + 1;
  }
  const completed = byExecutionStatus.completed || 0;
  const failed = byExecutionStatus.failed || 0;
  const renderSuccessRate = (completed + failed) > 0 ? Math.round((completed / (completed + failed)) * 100) : null;

  // ── Review status ─────────────────────────────────────────────────────
  const completedJobs = productionJobs.filter(j => j.execution?.status === 'completed');
  const review = { total: completedJobs.length, approved: 0, rejected: 0, unreviewed: 0 };
  for (const job of completedJobs) {
    const status = job.review?.status || 'unreviewed';
    review[status] = (review[status] || 0) + 1;
  }

  // ── Publish readiness ──────────────────────────────────────────────────
  const byPublishStatus = {};
  for (const job of publishJobs) {
    byPublishStatus[job.status] = (byPublishStatus[job.status] || 0) + 1;
  }
  const readyToPublish = (byPublishStatus.ready || 0) + (byPublishStatus.scheduled || 0);

  // ── Export activity ────────────────────────────────────────────────────
  const publishedJobs = publishJobs.filter(j => j.status === 'published');
  const exportedCount = publishJobs.filter(j => (j.activityHistory || []).some(e => e.type === 'export_generated')).length;
  const pendingExportCount = publishedJobs.filter(j => !(j.activityHistory || []).some(e => e.type === 'export_generated')).length;

  // ── Queues ──────────────────────────────────────────────────────────────
  const reviewQueue = completedJobs.filter(j => (j.review?.status || 'unreviewed') === 'unreviewed');
  const publishingQueue = publishJobs.filter(j => ['ready', 'scheduled'].includes(j.status));

  return {
    generatedAt: new Date().toISOString(),
    packages: { total: packages.length, byHealth, healthByPackageId },
    production: { total: productionJobs.length, byExecutionStatus, renderSuccessRate },
    review,
    publishing: { total: publishJobs.length, byStatus: byPublishStatus, readyToPublish },
    export: { generatedCount: exportedCount, pendingCount: pendingExportCount },
    queues: {
      rendering: renderQueue.length,
      review: reviewQueue.length,
      publishing: publishingQueue.length,
      export: pendingExportCount,
    },
  };
}
