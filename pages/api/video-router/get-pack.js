// pages/api/video-router/get-pack.js
// GET ?laneId=<id>&workflowId=<id>
// Returns previously generated prompt pack. Returns 404 if not yet generated.

import { loadPromptPack } from '../../../lib/video-router/generatePromptPack';
import { loadProviderProfiles, getBudgetModes, getContentFormatRouting } from '../../../lib/video-router/loadProviderProfiles';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { laneId, workflowId, profilesOnly } = req.query;

  // Return just provider profiles + routing metadata (no artifact needed)
  if (profilesOnly === 'true') {
    return res.status(200).json({
      providers:          loadProviderProfiles(),
      budgetModes:        getBudgetModes(),
      contentFormatRouting: getContentFormatRouting(),
    });
  }

  if (!laneId || !workflowId) {
    return res.status(400).json({ error: 'laneId and workflowId are required' });
  }

  const pack = loadPromptPack(laneId, workflowId);

  if (!pack) {
    return res.status(404).json({ exists: false, pack: null });
  }

  return res.status(200).json({ exists: true, pack });
}
