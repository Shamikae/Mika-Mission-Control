// lib/orchestration/workflowRules.js
// Pure functions — no I/O, no fs, no network. Safe to import from both
// server routes and the browser bundle (same convention as
// lib/production/productionRules.js and lib/publishing/publishingRules.js).
//
// This is an ORCHESTRATION/READ layer only. It never creates, mutates, or
// deletes a Content Package, Production Job, or Publish Job — it only
// reads already-loaded records (passed in by the caller) and derives a
// unified timeline, health status, relationship graph, and the set of
// context-aware next actions. All actual mutations still happen exclusively
// through Production Router / Provider Execution Engine / Publishing
// Router's own existing, unchanged endpoints.

// ── Health states ─────────────────────────────────────────────────────────
// Priority order (most specific/urgent first) — a package only ever shows
// ONE health at a time, so the first matching condition below wins:
// archived > published > failed > blocked > publishing > rendering >
// ready_to_publish > waiting_approval > healthy.

export const HEALTH_STATES = [
  'healthy', 'waiting_approval', 'rendering', 'ready_to_publish', 'publishing',
  'published', 'blocked', 'failed', 'archived',
];

export const HEALTH_META = {
  healthy:          { label: 'Healthy',          color: '#4ade80' },
  waiting_approval: { label: 'Waiting Approval', color: '#f59e0b' },
  rendering:        { label: 'Rendering',        color: '#60a5fa' },
  ready_to_publish: { label: 'Ready to Publish',  color: '#4ade80' },
  publishing:       { label: 'Publishing',       color: '#60a5fa' },
  published:        { label: 'Published',        color: 'var(--gold, #c9a84c)' },
  blocked:          { label: 'Blocked',          color: '#f87171' },
  failed:           { label: 'Failed',           color: '#f87171' },
  archived:         { label: 'Archived',         color: '#5d6c86' },
};

/**
 * @param {object} pkg — content package (with .pipeline)
 * @param {object[]} productionJobs — this package's production jobs
 * @param {object[]} publishJobs — publish jobs referencing those production jobs
 */
export function computePackageHealth(pkg, productionJobs, publishJobs) {
  if (pkg?.pipeline?.stage === 'archived') return 'archived';
  if (publishJobs.some(j => j.status === 'published')) return 'published';
  if (publishJobs.some(j => j.status === 'failed')) return 'failed';
  if (productionJobs.some(j => j.execution?.status === 'failed' || j.status === 'failed')) return 'failed';
  if (productionJobs.some(j => j.status === 'blocked')) return 'blocked';
  // "Publishing" — a publish job is actively scheduled/in-flight toward going out.
  if (publishJobs.some(j => ['scheduled', 'publishing'].includes(j.status))) return 'publishing';
  // "Rendering" — a production job is actively executing right now.
  if (productionJobs.some(j => ['queued', 'executing'].includes(j.execution?.status))) return 'rendering';
  // "Ready to Publish" — an approved, completed output exists and either has
  // no publish job yet, or has one still sitting in "ready".
  const readyToPublish = productionJobs.some(j => j.execution?.status === 'completed' && j.review?.status === 'approved'
    && !publishJobs.some(p => p.productionJobId === j.id && !['draft'].includes(p.status)))
    || publishJobs.some(j => j.status === 'ready');
  if (readyToPublish) return 'ready_to_publish';
  if (productionJobs.some(j => j.execution?.status === 'completed' && (j.review?.status || 'unreviewed') === 'unreviewed')) return 'waiting_approval';
  if (pkg?.pipeline?.stage === 'review') return 'waiting_approval';
  return 'healthy';
}

// ── Timeline stages ────────────────────────────────────────────────────────

export const TIMELINE_STAGE_IDS = ['pack', 'approved', 'production', 'review', 'publishing', 'export'];

function latestByUpdatedAt(jobs) {
  return [...jobs].sort((a, b) => new Date(b.metadata?.updatedAt || b.updatedAt || 0) - new Date(a.metadata?.updatedAt || a.updatedAt || 0))[0] || null;
}

/**
 * Builds the ordered timeline for one package: Content Pack -> Approved ->
 * Production -> Review -> Publishing -> Export. Each stage gets an honest
 * status derived from real records — never fabricated progress.
 */
export function buildTimeline(pkg, productionJobs, publishJobs) {
  const now = new Date().toISOString();
  const reachedApproved = pkg?.pipeline?.history?.some(h => h.stage === 'approved') || pkg?.pipeline?.stage === 'approved' || ['production', 'published', 'archived'].includes(pkg?.pipeline?.stage);
  const latestJob = latestByUpdatedAt(productionJobs);
  const completedJobs = productionJobs.filter(j => j.execution?.status === 'completed');
  const reviewedJob = completedJobs.find(j => j.review?.status === 'approved') || completedJobs[0] || null;
  const latestPublish = latestByUpdatedAt(publishJobs);
  const anyExported = publishJobs.some(j => (j.activityHistory || []).some(e => e.type === 'export_generated'));

  const stages = [
    {
      id: 'pack', label: 'Content Pack', at: pkg?.metadata?.createdAt || null,
      status: 'done', note: `${pkg?.brand || 'Unknown brand'} · ${pkg?.platform || 'Unknown platform'}`,
    },
    {
      id: 'approved', label: 'Approved',
      status: reachedApproved ? 'done' : (pkg?.pipeline?.stage === 'review' ? 'active' : 'pending'),
      at: pkg?.pipeline?.stage === 'approved' ? pkg?.pipeline?.enteredStageAt : null,
      note: reachedApproved ? 'Package approved for production.' : 'Not yet approved in the Package Pipeline.',
    },
    {
      id: 'production', label: 'Production',
      status: !latestJob ? (reachedApproved ? 'pending' : 'blocked')
        : latestJob.execution?.status === 'failed' ? 'failed'
        : latestJob.execution?.status === 'completed' ? 'done'
        : ['queued', 'executing'].includes(latestJob.execution?.status) ? 'active' : 'pending',
      at: latestJob?.execution?.completedAt || latestJob?.metadata?.createdAt || null,
      note: latestJob ? `${productionJobs.length} production job(s) · latest via ${latestJob.selectedProvider || 'unknown provider'}` : 'No production job created yet.',
    },
    {
      id: 'review', label: 'Review',
      status: !latestJob || latestJob.execution?.status !== 'completed' ? 'pending'
        : reviewedJob?.review?.status === 'approved' ? 'done'
        : reviewedJob?.review?.status === 'rejected' ? 'failed'
        : 'active',
      at: reviewedJob?.review?.reviewedAt || null,
      note: reviewedJob ? `Review status: ${reviewedJob.review?.status || 'unreviewed'}` : 'Awaiting a completed production output.',
    },
    {
      id: 'publishing', label: 'Publishing',
      status: !publishJobs.length ? (reviewedJob?.review?.status === 'approved' ? 'pending' : 'blocked')
        : latestPublish.status === 'published' ? 'done'
        : latestPublish.status === 'failed' ? 'failed'
        : ['ready', 'scheduled'].includes(latestPublish.status) ? 'active' : 'pending',
      at: latestPublish?.publishedAt || null,
      note: publishJobs.length ? `${publishJobs.length} publish job(s) · latest: ${latestPublish.platform} (${latestPublish.status})` : 'No publish job created yet.',
    },
    {
      id: 'export', label: 'Export',
      status: anyExported ? 'done' : (latestPublish?.status === 'published' ? 'pending' : 'pending'),
      at: null,
      note: anyExported ? 'A manual export bundle has been generated.' : 'No export bundle generated yet.',
    },
  ];

  const currentStageId = [...stages].reverse().find(s => s.status === 'done' || s.status === 'active')?.id || 'pack';
  return { stages, currentStageId, generatedAt: now };
}

// ── Context-aware next actions ─────────────────────────────────────────────
// Only ever returns actions that are ACTUALLY valid right now — never a
// dead-end button. Each action names the Studio tab + ids the UI needs to
// deep-link there; it never performs the action itself.

export function computeNextActions(pkg, productionJobs, publishJobs) {
  const actions = [];
  const reachedApproved = pkg?.pipeline?.history?.some(h => h.stage === 'approved') || ['approved', 'production', 'published', 'archived'].includes(pkg?.pipeline?.stage);
  const latestJob = latestByUpdatedAt(productionJobs);
  const completedJobs = productionJobs.filter(j => j.execution?.status === 'completed');
  const unreviewedJob = completedJobs.find(j => (j.review?.status || 'unreviewed') === 'unreviewed');
  const approvedJob = completedJobs.find(j => j.review?.status === 'approved');
  const latestPublish = latestByUpdatedAt(publishJobs);

  if (!reachedApproved) {
    actions.push({ id: 'approve-package', label: 'Move package through Review/Approval', tab: 'pack-pipeline', description: 'This package must reach "Approved" before a production plan can be created.' });
    return actions; // nothing downstream is valid yet
  }
  if (!latestJob) {
    actions.push({ id: 'create-production-plan', label: 'Create Production Plan', tab: 'production-router', packageId: pkg.id, description: 'No production job exists yet for this approved package.' });
    return actions;
  }
  if (latestJob.execution?.status === 'failed') {
    actions.push({ id: 'investigate-production-failure', label: 'Investigate Production Failure', tab: 'production-router', productionJobId: latestJob.id, description: latestJob.execution?.error || 'The latest production run failed.' });
  }
  if (!['queued', 'executing', 'completed'].includes(latestJob.execution?.status) && latestJob.status === 'ready') {
    actions.push({ id: 'queue-production', label: 'Queue Production', tab: 'production-router', productionJobId: latestJob.id, description: 'This job is ready but not yet queued for execution.' });
  }
  if (unreviewedJob) {
    actions.push({ id: 'review-output', label: 'Review Output', tab: 'production-router', productionJobId: unreviewedJob.id, description: 'A completed output is awaiting approve/reject.' });
  }
  if (approvedJob && !publishJobs.some(j => j.productionJobId === approvedJob.id)) {
    actions.push({ id: 'create-publish-job', label: 'Create Publish Job', tab: 'publishing-router', productionJobId: approvedJob.id, description: 'This approved output has no publish job yet.' });
  }
  if (latestPublish && ['draft', 'ready'].includes(latestPublish.status)) {
    actions.push({ id: 'configure-publish', label: 'Configure & Publish', tab: 'publishing-router', publishJobId: latestPublish.id, description: `Publish job for ${latestPublish.platform} is still "${latestPublish.status}".` });
  }
  if (latestPublish && latestPublish.status === 'scheduled') {
    actions.push({ id: 'publish-scheduled', label: 'Publish Now (Manual)', tab: 'publishing-router', publishJobId: latestPublish.id, description: `Scheduled for ${latestPublish.scheduledFor}.` });
  }
  if (latestPublish && latestPublish.status === 'failed') {
    actions.push({ id: 'investigate-publish-failure', label: 'Investigate Publish Failure', tab: 'publishing-router', publishJobId: latestPublish.id, description: latestPublish.publishResult?.reason || 'The last publish attempt failed.' });
  }
  if (latestPublish && latestPublish.status === 'published' && !(latestPublish.activityHistory || []).some(e => e.type === 'export_generated')) {
    actions.push({ id: 'generate-export', label: 'Generate Export Bundle', tab: 'publishing-router', publishJobId: latestPublish.id, description: 'Published, but no manual export bundle has been generated yet for your records.' });
  }

  if (!actions.length) {
    actions.push({ id: 'up-to-date', label: 'Up to date', tab: null, description: 'No pending workflow action right now.' });
  }
  return actions;
}

// ── Relationship graph ──────────────────────────────────────────────────────
// A simple node/link graph for react-force-graph — one Content Pack as the
// root, its Production Jobs, their Artifacts, and any Publish Jobs.

export function buildRelationshipGraph(pkg, productionJobs, publishJobs, artifactsByJobId) {
  const nodes = [];
  const links = [];

  nodes.push({ id: `pkg:${pkg.id}`, name: pkg.topic || pkg.id, group: 'package', val: 8 });

  for (const job of productionJobs) {
    const jobNodeId = `job:${job.id}`;
    nodes.push({ id: jobNodeId, name: `${job.selectedProvider || 'job'} (${job.status})`, group: 'production_job', val: 6 });
    links.push({ source: `pkg:${pkg.id}`, target: jobNodeId });

    const artifacts = artifactsByJobId[job.id] || [];
    for (const artifact of artifacts) {
      const artNodeId = `artifact:${artifact.artifactId}`;
      nodes.push({ id: artNodeId, name: artifact.filename, group: 'artifact', val: 4 });
      links.push({ source: jobNodeId, target: artNodeId });
    }

    for (const pj of publishJobs.filter(p => p.productionJobId === job.id)) {
      const pubNodeId = `publish:${pj.id}`;
      nodes.push({ id: pubNodeId, name: `${pj.platform} (${pj.status})`, group: 'publish_job', val: 5 });
      const sourceArtifact = artifacts.find(a => a.artifactId === pj.artifactId);
      links.push({ source: sourceArtifact ? `artifact:${sourceArtifact.artifactId}` : jobNodeId, target: pubNodeId });
    }
  }

  return { nodes, links };
}

/** Bundles health + timeline + next actions + graph in one call. */
export function buildContentWorkflow(pkg, productionJobs, publishJobs, artifactsByJobId) {
  return {
    packageId: pkg.id,
    topic: pkg.topic,
    brand: pkg.brand,
    platform: pkg.platform,
    health: computePackageHealth(pkg, productionJobs, publishJobs),
    timeline: buildTimeline(pkg, productionJobs, publishJobs),
    nextActions: computeNextActions(pkg, productionJobs, publishJobs),
    graph: buildRelationshipGraph(pkg, productionJobs, publishJobs, artifactsByJobId),
  };
}
