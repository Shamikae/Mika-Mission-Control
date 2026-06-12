// pages/api/content-artifacts/get.js
// GET ?laneId=<id>&workflowId=<id>           → all artifacts for a workflow
// GET ?laneId=<id>&workflowId=<id>&artifact=<type> → single artifact

import {
  loadContentArtifacts,
  getContentArtifact,
} from '../../../lib/content-artifacts/loadContentArtifacts';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { laneId, workflowId, artifact } = req.query;

  if (!laneId || !workflowId) {
    return res.status(400).json({ error: 'laneId and workflowId are required' });
  }

  if (artifact) {
    const result = getContentArtifact(laneId, workflowId, artifact);
    if (!result.content) {
      return res.status(404).json({ error: `Artifact "${artifact}" not found for workflow ${workflowId}` });
    }
    return res.status(200).json(result);
  }

  // Return all artifacts for this workflow
  const result = loadContentArtifacts(laneId, workflowId);
  return res.status(200).json({
    laneId,
    workflowId,
    ...result,
    // Don't return full content in the list view — just availability
    artifacts: Object.fromEntries(
      Object.entries(result.artifacts).map(([k, v]) => [k, v ? v.length : null])
    ),
  });
}
