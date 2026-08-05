// POST /api/production/execution/[id]/reconcile-provider-submission
//
// Governed, no-spend reconciliation for a Higgsfield MCP job stuck in
// execution.errorReason "provider_submission_unresolved" — the submission
// genuinely succeeded (real credits may already have been spent) but Mika
// could not parse a job id from the response. Never calls a generation
// tool — only the read-only show_generations tool, via
// lib/production/execution/higgsfieldReconciliation.js. Never resubmits.
//
// Input:  {}                                    — search mode (read-only)
//         { confirmedProviderGenerationId }     — confirm mode (attaches
//           the id and continues through the existing poll path)
// Output: search:  { ok: true, result, candidates }
//         confirm: { ok: true, job } | { ok: false, status, error }

import { isValidId } from '../../../../../lib/production/productionRules';
import {
  searchHiggsfieldReconciliationCandidates,
  confirmHiggsfieldReconciliation,
} from '../../../../../lib/production/execution/higgsfieldReconciliation';
import { sanitizeExecutionForResponse } from '../../../../../lib/production/execution/executionRules';

export const config = {
  api: { bodyParser: { sizeLimit: '4kb' } },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string' || !isValidId(id)) {
    return res.status(400).json({ ok: false, error: 'Invalid job id.' });
  }

  const { confirmedProviderGenerationId } = req.body || {};

  if (confirmedProviderGenerationId !== undefined) {
    if (typeof confirmedProviderGenerationId !== 'string' || !confirmedProviderGenerationId.trim()) {
      return res.status(400).json({ ok: false, error: 'confirmedProviderGenerationId must be a non-empty string.' });
    }
    const result = await confirmHiggsfieldReconciliation(id, {
      confirmedProviderGenerationId: confirmedProviderGenerationId.trim(),
      actor: 'user',
    });
    if (!result.ok) return res.status(result.status || 409).json({ ok: false, error: result.error });
    return res.status(200).json({ ok: true, job: { ...result.job, execution: sanitizeExecutionForResponse(result.job.execution) } });
  }

  const result = await searchHiggsfieldReconciliationCandidates(id);
  if (!result.ok) return res.status(result.status || 409).json({ ok: false, error: result.error });
  return res.status(200).json({ ok: true, result: result.result, candidates: result.candidates });
}
