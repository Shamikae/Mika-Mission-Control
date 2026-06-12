// pages/api/video-router/generate-pack.js
// POST — generate provider-specific video prompt pack from video-prompt.md artifact.
// Does NOT call any external APIs. No video generated. No credits spent.

import { generatePromptPack } from '../../../lib/video-router/generatePromptPack';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { laneId, workflowId, budgetMode, contentFormat } = req.body || {};

  if (!laneId || !workflowId) {
    return res.status(400).json({ error: 'laneId and workflowId are required' });
  }

  try {
    const pack = generatePromptPack({
      laneId,
      workflowId,
      budgetMode:    budgetMode    || 'balanced',
      contentFormat: contentFormat || 'short-form',
    });

    if (!pack.ok) {
      return res.status(422).json({ error: pack.error });
    }

    return res.status(200).json(pack);
  } catch (err) {
    console.error('[video-router/generate-pack]', err);
    return res.status(500).json({ error: err.message || 'Prompt pack generation failed' });
  }
}
