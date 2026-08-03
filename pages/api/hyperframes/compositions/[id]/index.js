// GET /api/hyperframes/compositions/[id]
// Sanitized detail for one local HyperFrames composition.

import { isValidCompositionId } from '../../../../../lib/hyperframes/hyperframesSecurity';
import { getHyperFramesComposition } from '../../../../../lib/hyperframes/hyperframesCompositionStore';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const { id } = req.query;
  if (!isValidCompositionId(id)) {
    return res.status(400).json({ ok: false, error: 'Invalid composition id.' });
  }
  const composition = await getHyperFramesComposition(id);
  if (!composition) {
    return res.status(404).json({ ok: false, error: `Composition "${id}" not found.` });
  }
  return res.status(200).json({ ok: true, composition });
}
