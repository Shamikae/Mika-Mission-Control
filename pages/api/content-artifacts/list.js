// pages/api/content-artifacts/list.js
// GET ?laneId=<id>  → list all artifact workflows for a lane
// GET (no params)   → list all lanes + counts

import {
  listContentArtifactWorkflows,
  listArtifactLanes,
} from '../../../lib/content-artifacts/loadContentArtifacts';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { laneId } = req.query;

  if (laneId) {
    const workflows = listContentArtifactWorkflows(laneId);
    return res.status(200).json({ laneId, workflows, count: workflows.length });
  }

  // No laneId — return all lanes with counts
  const lanes = listArtifactLanes();
  const summary = lanes.map(id => ({
    laneId:         id,
    workflowCount:  listContentArtifactWorkflows(id).length,
  }));

  return res.status(200).json({ lanes: summary });
}
