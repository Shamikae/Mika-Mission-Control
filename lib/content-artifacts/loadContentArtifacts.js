// lib/content-artifacts/loadContentArtifacts.js
// SERVER-SIDE ONLY.
// Reads content artifacts from the content-artifacts/ directory tree.

import fs from 'fs';
import path from 'path';
import { ARTIFACT_STAGES } from './saveContentArtifact';

const ARTIFACTS_ROOT = path.join(process.cwd(), 'content-artifacts');

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeReadJSON(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch { return null; }
}

function safeReadText(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf-8');
  } catch { return null; }
}

// ── Main exports ──────────────────────────────────────────────────────────────

/**
 * Load all artifacts for a specific workflow.
 * Returns metadata + content of every artifact file that exists.
 *
 * @param {string} laneId
 * @param {string} workflowId
 * @returns {{ metadata: object|null, artifacts: Record<string, string|null>, artifactStages: object[] }}
 */
export function loadContentArtifacts(laneId, workflowId) {
  if (!laneId || !workflowId) return { metadata: null, artifacts: {}, artifactStages: [] };

  const dir      = path.join(ARTIFACTS_ROOT, laneId, workflowId);
  const metadata = safeReadJSON(path.join(dir, 'metadata.json'));

  const artifacts = {};
  const artifactStages = [];

  for (const stage of ARTIFACT_STAGES) {
    const content  = safeReadText(path.join(dir, stage.filename));
    artifacts[stage.stageId] = content;

    artifactStages.push({
      ...stage,
      exists:       content !== null,
      completed:    metadata?.stagesCompleted?.includes(stage.stageId) || content !== null,
      taskId:       metadata?.taskIds?.[stage.stageId] || null,
      contentLength: content ? content.length : 0,
    });
  }

  return { metadata, artifacts, artifactStages };
}

/**
 * List all workflow artifact sets for a lane, newest first.
 *
 * @param {string} laneId
 * @returns {Array<{ workflowId, metadata, artifactCount, stagesCompleted }>}
 */
export function listContentArtifactWorkflows(laneId) {
  if (!laneId) return [];
  const laneDir = path.join(ARTIFACTS_ROOT, laneId);
  if (!fs.existsSync(laneDir)) return [];

  try {
    const entries = fs.readdirSync(laneDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => {
        const workflowId = d.name;
        const metadata   = safeReadJSON(path.join(laneDir, workflowId, 'metadata.json'));
        const files      = fs.readdirSync(path.join(laneDir, workflowId)).filter(f => f.endsWith('.md'));
        return {
          workflowId,
          metadata,
          artifactCount:    files.length,
          stagesCompleted:  metadata?.stagesCompleted || [],
          updatedAt:        metadata?.updatedAt || null,
          platform:         metadata?.platform  || null,
          contentGoal:      metadata?.contentGoal || null,
          contentType:      metadata?.contentType || null,
        };
      })
      .filter(e => e.metadata !== null); // only fully initialised sets

    // Sort newest first
    return entries.sort((a, b) => {
      const ta = a.updatedAt || a.metadata?.createdAt || '';
      const tb = b.updatedAt || b.metadata?.createdAt || '';
      return tb.localeCompare(ta);
    });
  } catch { return []; }
}

/**
 * Get a single artifact by lane + workflow + stageId or filename.
 *
 * @param {string} laneId
 * @param {string} workflowId
 * @param {string} artifactType  — stageId (e.g. 'hook_generation') or base filename (e.g. 'hooks')
 * @returns {{ content: string|null, filename: string|null, stage: object|null }}
 */
export function getContentArtifact(laneId, workflowId, artifactType) {
  if (!laneId || !workflowId || !artifactType) return { content: null, filename: null, stage: null };

  // Resolve to stage definition
  const stage = ARTIFACT_STAGES.find(s =>
    s.stageId   === artifactType ||
    s.filename  === artifactType ||
    s.filename  === `${artifactType}.md` ||
    s.label.toLowerCase() === artifactType.toLowerCase()
  );

  if (!stage) return { content: null, filename: null, stage: null };

  const content = safeReadText(path.join(ARTIFACTS_ROOT, laneId, workflowId, stage.filename));
  return { content, filename: stage.filename, stage };
}

/**
 * List all lanes that have at least one artifact workflow.
 */
export function listArtifactLanes() {
  if (!fs.existsSync(ARTIFACTS_ROOT)) return [];
  try {
    return fs.readdirSync(ARTIFACTS_ROOT, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch { return []; }
}
