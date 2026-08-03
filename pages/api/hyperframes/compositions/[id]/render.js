// POST /api/hyperframes/compositions/[id]/render
// Starts a render and returns immediately (queued/running) — poll
// GET /api/hyperframes/runs/[id] for progress and completion. Does NOT
// import the result; use render-and-import for the one-click flow.
//
// Input: { quality?: 'standard'|'high', lowMemoryMode?: 'auto'|'enabled'|'disabled' }

import { isValidCompositionId } from '../../../../../lib/hyperframes/hyperframesSecurity';
import { runHyperFramesRender } from '../../../../../lib/hyperframes/hyperframesRunner';
import { statusForError } from '../../../../../lib/hyperframes/hyperframesErrors';
import { sanitizeRunForResponse } from '../../../../../lib/hyperframes/hyperframesRunStore';

export const config = {
  api: { bodyParser: { sizeLimit: '4kb' } },
};

const VALID_QUALITY = new Set(['standard', 'high']);
const VALID_LOW_MEM = new Set(['auto', 'enabled', 'disabled']);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const { id } = req.query;
  if (!isValidCompositionId(id)) {
    return res.status(400).json({ ok: false, error: 'Invalid composition id.' });
  }

  const { quality, lowMemoryMode } = req.body || {};
  if (quality !== undefined && !VALID_QUALITY.has(quality)) {
    return res.status(400).json({ ok: false, error: 'quality must be "standard" or "high".' });
  }
  if (lowMemoryMode !== undefined && !VALID_LOW_MEM.has(lowMemoryMode)) {
    return res.status(400).json({ ok: false, error: 'lowMemoryMode must be "auto", "enabled", or "disabled".' });
  }

  try {
    const run = await runHyperFramesRender(id, { quality, lowMemoryMode });
    return res.status(200).json({ ok: true, run: sanitizeRunForResponse(run) });
  } catch (e) {
    return res.status(statusForError(e)).json({ ok: false, error: e.message });
  }
}
