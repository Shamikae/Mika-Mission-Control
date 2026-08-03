// POST /api/hyperframes/compositions/[id]/import
// Imports the composition's existing output.mp4 as a local Production Job,
// idempotently (same content hash -> same job/artifact, never duplicated).
// Does not render — use render-and-import for the combined flow, or
// render first then import once it has completed.

import { isValidCompositionId } from '../../../../../lib/hyperframes/hyperframesSecurity';
import { importHyperFramesOutput } from '../../../../../lib/hyperframes/hyperframesRunner';
import { statusForError } from '../../../../../lib/hyperframes/hyperframesErrors';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const { id } = req.query;
  if (!isValidCompositionId(id)) {
    return res.status(400).json({ ok: false, error: 'Invalid composition id.' });
  }
  try {
    const result = await importHyperFramesOutput(id);
    return res.status(200).json({ ok: true, import: result });
  } catch (e) {
    return res.status(statusForError(e)).json({ ok: false, error: e.message });
  }
}
