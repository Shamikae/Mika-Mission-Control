// POST /api/agents/claude-code/test
// Safe adapter verification route — health check + optional analysis-only test run.
// Does NOT go through dispatch. Does NOT modify files. Does NOT set liveConnected.
// For adapter readiness verification only.

import claudeCodeAdapter from '../../../../adapters/claude-code.adapter.js';

const DEFAULT_TEST_PROMPT =
  'List the top 3 files in this codebase that have the most complex logic, ' +
  'based on filename patterns alone (no file reading needed). ' +
  'Be brief — one sentence per file.';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    prompt   = DEFAULT_TEST_PROMPT,
    taskType = 'code_review',
    runTest  = false,  // set to true to actually invoke the CLI (costs tokens)
  } = req.body || {};

  // ── Step 1: Health check ──────────────────────────────────────────────────
  const t0     = Date.now();
  const health = await claudeCodeAdapter.healthCheck();

  if (!health.ok) {
    return res.status(200).json({
      ok:          false,
      phase:       'health_check',
      health,
      response:    null,
      costUsd:     null,
      durationMs:  Date.now() - t0,
      message:     health.error || 'Health check failed',
      guide:       health.activationGuide || null,
    });
  }

  // ── Step 2: Input validation ──────────────────────────────────────────────
  const validation = claudeCodeAdapter.validateInput({
    taskId:       'test-route',
    taskType,
    instructions: prompt,
  });

  if (!validation.valid) {
    return res.status(400).json({
      ok:     false,
      phase:  'validation',
      errors: validation.errors,
    });
  }

  // ── Step 3: Cost estimate (always returned, no API call) ──────────────────
  const costEstimate = claudeCodeAdapter.estimateCost({ taskType });

  // If runTest is false, return health + estimate without invoking the CLI
  if (!runTest) {
    return res.status(200).json({
      ok:          true,
      phase:       'health_only',
      health,
      costEstimate,
      response:    null,
      durationMs:  Date.now() - t0,
      message:     'Health check passed. Set runTest: true in request body to run a live test (costs tokens).',
    });
  }

  // ── Step 4: Live test run ─────────────────────────────────────────────────
  // Only reached when runTest === true. Invokes claude CLI in analysis-only mode.
  try {
    const result = await claudeCodeAdapter.execute(
      { taskId: 'test-route', taskType, instructions: prompt },
      null
    );

    return res.status(200).json({
      ok:          true,
      phase:       'test_run',
      health,
      costEstimate,
      response:    result.output,
      costUsd:     result.costUsd,
      durationMs:  result.durationMs || (Date.now() - t0),
      mode:        result.mode,
      toolsUsed:   result.toolsUsed,
    });
  } catch (e) {
    return res.status(200).json({
      ok:         false,
      phase:      'test_run',
      health,
      costEstimate,
      response:   null,
      error:      e.message,
      durationMs: Date.now() - t0,
    });
  }
}
