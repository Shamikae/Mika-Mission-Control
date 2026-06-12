// lib/content-artifacts/saveContentArtifact.js
// SERVER-SIDE ONLY.
//
// Saves workflow stage outputs as durable content artifacts.
// Every successful viral content workflow stage execution writes here.
//
// Directory structure:
//   content-artifacts/<laneId>/<workflowId>/
//     metadata.json
//     research.md
//     hooks.md
//     strategy.md
//     script.md
//     video-prompt.md
//     caption.md
//     repurposing.md

import fs from 'fs';
import path from 'path';

const ARTIFACTS_ROOT = path.join(process.cwd(), 'content-artifacts');

// ── Stage → filename mapping ──────────────────────────────────────────────────

const STAGE_TO_FILENAME = {
  trend_research:    'research.md',
  hook_generation:   'hooks.md',
  content_strategy:  'strategy.md',
  script_generation: 'script.md',
  visual_prompting:  'video-prompt.md',
  caption_generation:'caption.md',
  repurposing:       'repurposing.md',
};

// Reverse map: filename → stageId
export const FILENAME_TO_STAGE = Object.fromEntries(
  Object.entries(STAGE_TO_FILENAME).map(([k, v]) => [v, k])
);

export const ARTIFACT_STAGES = [
  { stageId: 'trend_research',    filename: 'research.md',    icon: '🔥', label: 'Research'     },
  { stageId: 'hook_generation',   filename: 'hooks.md',       icon: '🪝', label: 'Hooks'         },
  { stageId: 'content_strategy',  filename: 'strategy.md',    icon: '🎯', label: 'Strategy'     },
  { stageId: 'script_generation', filename: 'script.md',      icon: '📝', label: 'Script'        },
  { stageId: 'visual_prompting',  filename: 'video-prompt.md',icon: '🎬', label: 'Video Prompt'  },
  { stageId: 'caption_generation',filename: 'caption.md',     icon: '💬', label: 'Caption'       },
  { stageId: 'repurposing',       filename: 'repurposing.md', icon: '♻',  label: 'Repurposing'   },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getArtifactFilenameForStage(stageId) {
  return STAGE_TO_FILENAME[stageId] || null;
}

export function ensureArtifactDirectory(laneId, workflowId) {
  const dir = path.join(ARTIFACTS_ROOT, laneId, workflowId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readMetadata(laneId, workflowId) {
  try {
    const file = path.join(ARTIFACTS_ROOT, laneId, workflowId, 'metadata.json');
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch { return null; }
}

function writeMetadata(laneId, workflowId, meta) {
  const dir  = ensureArtifactDirectory(laneId, workflowId);
  const file = path.join(dir, 'metadata.json');
  fs.writeFileSync(file, JSON.stringify(meta, null, 2));
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Save a content artifact for a completed workflow stage.
 * Creates the artifact directory if needed.
 * Updates metadata.json with stage completion info.
 *
 * @param {object} params
 * @param {string} params.laneId
 * @param {string} params.workflowId
 * @param {string} params.stageId
 * @param {string} params.taskId
 * @param {string} params.content — the raw agent output
 * @param {object} [params.metadata] — extra fields to merge into metadata.json
 */
export function saveContentArtifact({ laneId, workflowId, stageId, taskId, content, metadata = {} }) {
  if (!laneId || !workflowId || !stageId || !content) return null;

  const filename = getArtifactFilenameForStage(stageId);
  if (!filename) return null; // Unknown stage — skip silently

  const dir = ensureArtifactDirectory(laneId, workflowId);
  const now = new Date().toISOString();

  // ── Write artifact file ───────────────────────────────────────────────────
  // Prepend a header so the file is self-documenting
  const stageInfo = ARTIFACT_STAGES.find(s => s.stageId === stageId);
  const header = [
    `# ${stageInfo?.icon || ''} ${stageInfo?.label || stageId}`,
    `<!-- MIKA AGENTIC OS™ · Content Artifact · Workflow: ${workflowId} -->`,
    `<!-- Lane: ${laneId} | Task: ${taskId} | Generated: ${now} -->`,
    ``,
  ].join('\n');

  fs.writeFileSync(path.join(dir, filename), header + content);

  // ── Update metadata.json ──────────────────────────────────────────────────
  const existing = readMetadata(laneId, workflowId) || {
    workflowId,
    laneId,
    createdAt: now,
    stagesCompleted: [],
    taskIds: {},
    artifactFiles: [],
    ...metadata,
  };

  if (!existing.stagesCompleted.includes(stageId)) {
    existing.stagesCompleted.push(stageId);
  }
  existing.taskIds[stageId]      = taskId;
  if (!existing.artifactFiles.includes(filename)) {
    existing.artifactFiles.push(filename);
  }
  existing.updatedAt             = now;
  // Merge any extra metadata fields (platform, contentGoal, etc.)
  Object.assign(existing, metadata);

  writeMetadata(laneId, workflowId, existing);

  return { laneId, workflowId, stageId, filename, savedAt: now };
}
