// lib/content/contentPipelineRules.js
// Pure functions — no I/O, no fs. Safe to import from both server routes and
// the browser bundle (used for instant client-side move validation before a
// round-trip confirms it). This is the ONLY place the stage order and gate
// rules are defined — server and client always agree.

export const PIPELINE_STAGES = [
  { id: 'research',   label: 'Research',   accent: '#60a5fa' },
  { id: 'draft',      label: 'Draft',      accent: '#a78bfa' },
  { id: 'review',     label: 'Review',     accent: '#f59e0b' },
  { id: 'approved',   label: 'Approved',   accent: '#4ade80' },
  { id: 'production', label: 'Production', accent: '#38bdf8' },
  { id: 'published',  label: 'Published',  accent: 'var(--gold)' },
  { id: 'archived',   label: 'Archived',   accent: '#5d6c86' },
];

export const PIPELINE_STAGE_IDS = PIPELINE_STAGES.map(s => s.id);

export const DEFAULT_STAGE = 'research';

// Hard gates: to reach `before`, the package must have passed through
// `require` at some point in its history (not just been adjacent to it).
const GATES = [
  { require: 'review',   before: 'approved',   message: 'Review is required before Approved.' },
  { require: 'approved', before: 'production', message: 'Approved is required before Production.' },
];

export function isValidStage(stage) {
  return PIPELINE_STAGE_IDS.includes(stage);
}

export function stageMeta(stage) {
  return PIPELINE_STAGES.find(s => s.id === stage) || null;
}

function hasReachedStage(pkg, stageId) {
  const pipeline = pkg?.pipeline;
  if (!pipeline) return false;
  if (pipeline.stage === stageId) return true;
  return Array.isArray(pipeline.history) && pipeline.history.some(h => h.stage === stageId);
}

/**
 * Checks whether a package can move to `toStage` given its current pipeline
 * history. Backward moves (revisions, sending something back) are always
 * allowed — only forward moves that would skip a required gate are blocked.
 *
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function checkStageTransition(pkg, toStage) {
  if (!isValidStage(toStage)) {
    return { allowed: false, reason: `Unknown stage "${toStage}".` };
  }
  const currentStage = pkg?.pipeline?.stage || DEFAULT_STAGE;
  if (currentStage === toStage) return { allowed: true };

  const toIdx = PIPELINE_STAGE_IDS.indexOf(toStage);
  for (const gate of GATES) {
    if (toIdx >= PIPELINE_STAGE_IDS.indexOf(gate.before) && !hasReachedStage(pkg, gate.require)) {
      return { allowed: false, reason: gate.message };
    }
  }
  return { allowed: true };
}

/**
 * Builds fresh default pipeline metadata for a package that doesn't have any
 * yet (packages created before the Pipeline Manager existed).
 */
export function defaultPipelineMeta(now = new Date().toISOString()) {
  return {
    stage: DEFAULT_STAGE,
    enteredStageAt: now,
    history: [{ stage: DEFAULT_STAGE, at: now, actor: 'system', note: 'Entered pipeline' }],
  };
}

/**
 * Returns a package guaranteed to have valid `pipeline` metadata, without
 * mutating the input. Used defensively on every read.
 */
export function withPipelineMeta(pkg) {
  if (!pkg) return pkg;
  const p = pkg.pipeline;
  if (p && isValidStage(p.stage) && Array.isArray(p.history)) return pkg;
  return { ...pkg, pipeline: defaultPipelineMeta(pkg.metadata?.createdAt || undefined) };
}
