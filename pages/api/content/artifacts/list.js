// GET /api/content/artifacts/list
// Returns metadata for all content workflow artifact directories.
//
// Security:
//   - GET only — no mutation
//   - No query params accepted — no user-controlled paths
//   - Path traversal guard on every resolved path
//   - Absolute paths never returned to client
//   - Returns empty list if artifacts directory does not exist
//   - Returns safe metadata only — no file contents

import fs   from 'fs';
import path from 'path';

const ARTIFACTS_ROOT = path.resolve(process.cwd(), 'content-artifacts');

function safeStat(fp) {
  try { return fs.statSync(fp); } catch { return null; }
}

function isInsideRoot(resolvedPath) {
  const rel = path.relative(ARTIFACTS_ROOT, resolvedPath);
  // Disallow traversal outside root and absolute paths
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

function readMeta(dirPath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dirPath, 'metadata.json'), 'utf-8'));
  } catch { return null; }
}

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Return empty list cleanly if the root directory doesn't exist yet
  const rootStat = safeStat(ARTIFACTS_ROOT);
  if (!rootStat || !rootStat.isDirectory()) {
    return res.status(200).json({ artifacts: [], total: 0 });
  }

  const artifacts = [];

  let laneDirs;
  try { laneDirs = fs.readdirSync(ARTIFACTS_ROOT); }
  catch { return res.status(200).json({ artifacts: [], total: 0 }); }

  for (const laneEntry of laneDirs) {
    const lanePath = path.resolve(ARTIFACTS_ROOT, laneEntry);

    // Traversal guard — resolved path must be inside root
    if (!isInsideRoot(lanePath)) continue;

    const laneStat = safeStat(lanePath);
    if (!laneStat || !laneStat.isDirectory()) continue;

    let wfDirs;
    try { wfDirs = fs.readdirSync(lanePath); }
    catch { continue; }

    for (const wfEntry of wfDirs) {
      const wfPath = path.resolve(lanePath, wfEntry);

      if (!isInsideRoot(wfPath)) continue;

      const wfStat = safeStat(wfPath);
      if (!wfStat || !wfStat.isDirectory()) continue;

      const meta = readMeta(wfPath);
      if (!meta) continue;

      artifacts.push({
        id:              `${meta.laneId || laneEntry}/${meta.workflowId || wfEntry}`,
        laneId:          meta.laneId          || laneEntry,
        workflowId:      meta.workflowId      || wfEntry,
        stagesCompleted: Array.isArray(meta.stagesCompleted) ? meta.stagesCompleted : [],
        artifactFiles:   Array.isArray(meta.artifactFiles)   ? meta.artifactFiles   : [],
        createdAt:       meta.createdAt  || null,
        updatedAt:       meta.updatedAt  || null,
        platform:        meta.platform   || null,
        contentGoal:     meta.contentGoal|| null,
      });
    }
  }

  artifacts.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));

  return res.status(200).json({ artifacts, total: artifacts.length });
}