// lib/production/execution/adapters/hyperframes.adapter.js
// SERVER-SIDE ONLY.
//
// Real HyperFrames provider adapter — wraps the EXISTING, already-working
// local render engine (lib/hyperframes/*) in the standard Provider
// Execution Engine contract. HyperFrames is fundamentally different from
// heygenMcp/higgsfieldMcp/openartVideoMcp: it is a LOCAL CLI tool
// (`npx hyperframes <command>`), not a remote MCP/API service — no OAuth,
// no account, no billing, no network calls of any kind. Real cost is
// always a confirmed $0 (local CPU/GPU time only).
//
// This adapter does NOT introduce a second run store, a second job system,
// or a second artifact-ingestion path. It reuses, unmodified:
//   - lib/hyperframes/hyperframesRunner.js's runHyperFramesRender()/cancelHyperFramesRun()
//   - lib/hyperframes/hyperframesRunStore.js's getHyperFramesRun()
//   - lib/hyperframes/hyperframesSecurity.js's resolveCompositionDir()/resolveCompositionFile()
//   - lib/hyperframes/hyperframesCompositionStore.js's getHyperFramesComposition()/listHyperFramesCompositions()
//   - lib/production/execution/localArtifactImport.js's validateLocalSourceFile()
//     (signature-sniffs MIME, enforces the size cap, rejects symlinks/traversal)
//   - executionEngine.js's EXISTING localBuffer output-ingestion path
//     (already proven by manualExport.adapter.js — no new ingestion code)
//
// The provider job id IS the existing HyperFrames run id (hfr-...) — no
// second id system. submit() starts a render asynchronously (mirrors the
// MCP adapters' async submit()-then-poll() pattern) and returns
// immediately; it NEVER calls startRenderAndImportFlow() (the standalone
// Studio's blocking one-click helper) and NEVER imports the artifact
// itself — that stays the engine's job via the localBuffer output poll()
// returns on completion. The standalone HyperFrames Studio flow
// (lint/check/preview/render-and-import, provider: 'hyperframes-local',
// metadata.isLocalRender: true) is a completely separate, untouched
// workflow — this adapter is an ADDITIONAL entry point into the SAME
// underlying render engine, not a replacement.

import {
  runHyperFramesRender, cancelHyperFramesRun,
} from '../../../hyperframes/hyperframesRunner.js';
import { getHyperFramesRun } from '../../../hyperframes/hyperframesRunStore.js';
import {
  getHyperFramesComposition, listHyperFramesCompositions,
} from '../../../hyperframes/hyperframesCompositionStore.js';
import {
  HYPERFRAMES_ROOT, isValidCompositionId, resolveCompositionDir, resolveCompositionFile,
} from '../../../hyperframes/hyperframesSecurity.js';
import { validateLocalSourceFile } from '../localArtifactImport.js';
import { isRetryableErrorReason } from '../executionRules.js';

import fs from 'fs';
import { spawn } from 'child_process';

const SUPPORTED_MODES = ['cinematic_broll', 'faceless_social', 'product_demo'];
const QUALITY_VALUES = ['standard', 'high'];
const OUTPUT_FILENAME = 'output.mp4'; // hardcoded by hyperframesRunner.js itself — not user-configurable in this checkpoint

function isEnabled() {
  // Explicit opt-in switch for the PROVIDER adapter only — mirrors every
  // other provider's enable flag for governance consistency. Standalone
  // HyperFrames Studio (pages/api/hyperframes/**) is completely unaffected
  // by this flag either way — it has no such gate and never has.
  const raw = String(process.env.HYPERFRAMES_ENABLED ?? '').trim().toLowerCase();
  if (raw === '') return true; // no explicit opt-out configured — default on, since there is no credential/OAuth risk to gate
  return raw === 'true';
}

// ── CLI-runnable probe — cached briefly so healthCheck() (called often:
// provider status list, validateInput() on every PATCH, etc.) doesn't
// re-spawn `npx` on every call. Memory-only, mirrors
// lib/higgsfield/higgsfieldDiscoveryCache.js's spirit for a single value. ──

const CLI_CHECK_TTL_MS = 5 * 60 * 1000;
let cliCheckCache = null; // { ok, version, error, checkedAt }

function spawnVersionCheck() {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('npx', ['--yes', 'hyperframes@latest', '--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      resolve({ ok: false, error: 'Could not start the HyperFrames CLI (npx is not available).' });
      return;
    }
    let stdout = '';
    let stderr = '';
    const killTimer = setTimeout(() => { try { child.kill('SIGTERM'); } catch { /* already gone */ } }, 15_000);
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('close', (code) => {
      clearTimeout(killTimer);
      if (code === 0 && stdout.trim()) resolve({ ok: true, version: stdout.trim().split('\n')[0].slice(0, 40) });
      else resolve({ ok: false, error: `HyperFrames CLI is not runnable (npx hyperframes --version exited with code ${code}).` });
    });
    child.on('error', () => {
      clearTimeout(killTimer);
      resolve({ ok: false, error: 'Could not start the HyperFrames CLI (npx not available or the hyperframes package is unreachable).' });
    });
  });
}

async function checkHyperFramesCliRunnable() {
  if (cliCheckCache && Date.now() - cliCheckCache.checkedAt < CLI_CHECK_TTL_MS) return cliCheckCache;
  const result = await spawnVersionCheck();
  cliCheckCache = { ...result, checkedAt: Date.now() };
  return cliCheckCache;
}

// ── Shared, pure-ish validation ──────────────────────────────────────────

/**
 * @param {{ job: object, compositionExists: boolean|null }} ctx —
 *   compositionExists is null when no compositionId was supplied yet
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateHyperFramesProviderInputSync({ job, compositionExists }) {
  const errors = [];
  const warnings = [];

  if (!SUPPORTED_MODES.includes(job?.selectedMode)) {
    errors.push(`HyperFrames only supports ${SUPPORTED_MODES.join(', ')} in this checkpoint (selected: "${job?.selectedMode || 'none'}").`);
  }

  const providerInput = job?.providerInput || null;
  const compositionId = providerInput?.compositionId;
  if (!compositionId) {
    errors.push('A composition must be selected in HyperFrames Setup.');
  } else if (!isValidCompositionId(compositionId)) {
    errors.push('compositionId is not a valid HyperFrames composition identifier.');
  } else if (compositionExists === false) {
    errors.push(`Composition "${compositionId}" was not found under tools/hyperframes/ (or is missing index.html).`);
  }

  if (providerInput?.quality != null && !QUALITY_VALUES.includes(providerInput.quality)) {
    errors.push(`quality must be one of: ${QUALITY_VALUES.join(', ')}.`);
  }

  // Explicitly out of scope for v1 — rejected rather than silently ignored.
  // outputFilename: hyperframesRunner.js hardcodes 'output.mp4' — accepting
  // a different value here would be a non-functional, misleading control.
  // forceRerender: the engine's own retry rules (executionRules.js) already
  // govern re-execution; a provider-specific bypass is unnecessary and was
  // explicitly excluded from this checkpoint.
  if (providerInput?.outputFilename != null || providerInput?.forceRerender != null) {
    errors.push('outputFilename and forceRerender are not supported in this checkpoint.');
  }

  warnings.push('This render uses local CPU/GPU time on this machine — no provider credits are charged.');
  return { valid: errors.length === 0, errors, warnings };
}

// ── Adapter ───────────────────────────────────────────────────────────────

const hyperframesAdapter = {
  id: 'hyperframes',
  displayName: 'HyperFrames',
  status: 'staged', // true executable status is only ever reported via healthCheck()
  supportedModes: SUPPORTED_MODES,
  executionType: 'local-cli',
  billingPool: 'local-compute',
  mock: false,

  /**
   * Verifies, WITHOUT rendering: the enable flag, that tools/hyperframes/
   * exists, that the CLI itself is runnable (`npx hyperframes --version`,
   * no composition touched), and that at least one valid composition
   * exists. A composition existing alone is never treated as full health —
   * the CLI-runnable check always runs too.
   */
  async healthCheck() {
    if (!isEnabled()) {
      return { ok: false, status: 'disabled', error: 'HyperFrames provider adapter is disabled. Set HYPERFRAMES_ENABLED=true to enable it.', adapterId: 'hyperframes' };
    }

    if (!fs.existsSync(HYPERFRAMES_ROOT)) {
      return { ok: false, status: 'unavailable', error: 'tools/hyperframes/ does not exist.', adapterId: 'hyperframes' };
    }

    const cliCheck = await checkHyperFramesCliRunnable();
    if (!cliCheck.ok) {
      return { ok: false, status: 'unavailable', error: cliCheck.error || 'HyperFrames CLI is not runnable.', adapterId: 'hyperframes' };
    }

    let compositions;
    try {
      compositions = await listHyperFramesCompositions();
    } catch (e) {
      return { ok: false, status: 'error', error: `Composition discovery failed unexpectedly: ${e.message}`, adapterId: 'hyperframes' };
    }

    if (!compositions.length) {
      return { ok: false, status: 'staged', error: 'No valid HyperFrames compositions were found under tools/hyperframes/.', adapterId: 'hyperframes', cliVersion: cliCheck.version };
    }

    return { ok: true, status: 'active', adapterId: 'hyperframes', cliVersion: cliCheck.version, compositionCount: compositions.length };
  },

  async validateInput({ job }) {
    const health = await this.healthCheck();
    if (!health.ok) {
      return { valid: false, errors: [health.error || `HyperFrames is not ready (status: ${health.status}).`], warnings: [] };
    }

    const compositionId = job?.providerInput?.compositionId;
    let compositionExists = null;
    if (compositionId && isValidCompositionId(compositionId)) {
      const found = await getHyperFramesComposition(compositionId).catch(() => null);
      compositionExists = !!found;
    }

    return validateHyperFramesProviderInputSync({ job, compositionExists });
  },

  /**
   * Real cost is always a confirmed $0 — local CPU/GPU time only, no
   * provider credits. Never provisional, never "free" without the
   * local-compute note.
   */
  async estimate() {
    return {
      estimateType: 'confirmed_local',
      estimatedRange: { min: 0, max: 0 },
      currency: 'USD',
      // A confirmed zero in real money. Unit-neutral for aggregation — zero
      // costs nothing in every unit — but denominated honestly all the same.
      unit: 'currency',
      provisional: false,
      approvalRequired: false,
      note: 'Local HyperFrames render — no provider credits charged; local CPU/GPU time is used.',
    };
  },

  /**
   * Starts exactly one HyperFrames run via the EXISTING runHyperFramesRender()
   * and returns immediately with its real run id — never blocks for the
   * full render, never calls startRenderAndImportFlow() (the standalone
   * Studio's blocking helper), never imports the artifact itself, never
   * creates a second Production Job. runHyperFramesRender() itself already
   * refuses a second concurrent render for the same composition
   * (hasActiveRender() check) — no additional duplicate-render logic
   * needed here.
   */
  async submit({ job }) {
    const validation = await this.validateInput({ job });
    if (!validation.valid) {
      return {
        ok: false, providerJobId: null, status: 'failed', nextPollSeconds: null,
        error: validation.errors.join(' '), errorReason: 'validation_error', rawMetadata: {},
      };
    }

    if (job.execution?.providerJobId) {
      return {
        ok: false, providerJobId: null, status: 'failed', nextPollSeconds: null,
        error: 'A HyperFrames run already exists for this execution attempt — refusing to double-submit.',
        errorReason: 'validation_error', rawMetadata: {},
      };
    }

    const providerInput = job.providerInput;
    const options = {};
    if (providerInput.quality) options.quality = providerInput.quality;

    let run;
    try {
      run = await runHyperFramesRender(providerInput.compositionId, options);
    } catch (e) {
      const reason = ['render_in_progress', 'invalid_id', 'not_found'].includes(e.code) ? 'validation_error' : 'provider_error';
      return {
        ok: false, providerJobId: null, status: 'failed', nextPollSeconds: null,
        error: e.message, errorReason: reason, rawMetadata: {},
      };
    }

    return {
      ok: true,
      providerJobId: run.id,
      status: 'waiting_provider',
      nextPollSeconds: 5,
      rawMetadata: {
        compositionId: providerInput.compositionId,
        quality: options.quality || 'standard',
        submittedAt: new Date().toISOString(),
      },
    };
  },

  /**
   * Reads the EXISTING local run record. On completion, validates the
   * rendered output THROUGH validateLocalSourceFile() (signature-sniffs
   * the MIME, enforces the size cap, rejects symlinks/traversal — the
   * exact same function the standalone Studio import flow already uses)
   * and returns it as a localBuffer output — executionEngine.js's existing,
   * unmodified ingestion path (already proven by manualExport.adapter.js)
   * handles the rest. Never creates a manual-import Production Job, never
   * returns a remote URL. Calling this again after completion is safe and
   * idempotent — it only reads and re-validates the same file, with no
   * side effects of its own.
   */
  async poll({ providerJobId }) {
    if (!providerJobId) {
      return { ok: false, status: 'failed', error: 'No provider job id recorded for this execution.', errorReason: 'malformed_output', rawMetadata: null };
    }

    const run = getHyperFramesRun(providerJobId);
    if (!run) {
      return { ok: false, status: 'failed', error: 'HyperFrames run record no longer exists.', errorReason: 'malformed_output', rawMetadata: null };
    }

    if (['queued', 'running'].includes(run.status)) {
      return { ok: true, status: 'waiting_provider', progress: typeof run.progress === 'number' ? run.progress : null, nextPollSeconds: 5, outputs: [], error: null, rawMetadata: { runStatus: run.status } };
    }

    if (run.status === 'completed') {
      let dir;
      try {
        dir = resolveCompositionDir(run.compositionId);
      } catch (e) {
        return { ok: false, status: 'failed', error: 'Composition directory could not be resolved for output validation.', errorReason: 'malformed_output', rawMetadata: { runStatus: run.status } };
      }

      let outputPath;
      try {
        outputPath = resolveCompositionFile(dir, run.outputFilename || OUTPUT_FILENAME);
      } catch (e) {
        return { ok: false, status: 'failed', error: 'Rendered output path failed security validation.', errorReason: 'malformed_output', rawMetadata: { runStatus: run.status } };
      }

      let validated;
      try {
        validated = validateLocalSourceFile({ absolutePath: outputPath, allowedRoot: dir });
      } catch (e) {
        return { ok: false, status: 'failed', error: `Rendered output failed validation: ${e.message}`, errorReason: 'malformed_output', rawMetadata: { runStatus: run.status } };
      }

      if (validated.mimeType !== 'video/mp4') {
        return { ok: false, status: 'failed', error: `Rendered output has an unexpected type ("${validated.mimeType}") — expected video/mp4.`, errorReason: 'malformed_output', rawMetadata: { runStatus: run.status } };
      }

      return {
        ok: true,
        status: 'completed',
        progress: 100,
        nextPollSeconds: null,
        outputs: [{
          type: 'video',
          localBuffer: validated.buffer,
          mimeType: validated.mimeType,
          filename: run.outputFilename || OUTPUT_FILENAME,
          metadata: { kind: 'hyperframes-render', durationSeconds: null },
        }],
        error: null,
        rawMetadata: { runStatus: run.status },
      };
    }

    if (run.status === 'failed') {
      const message = String(run.error || 'HyperFrames render failed.').slice(0, 500);
      return { ok: false, status: 'failed', error: message, errorReason: 'provider_error', retryable: isRetryableErrorReason('provider_error'), rawMetadata: { runStatus: run.status } };
    }

    if (run.status === 'cancelled') {
      return { ok: false, status: 'failed', error: 'HyperFrames render was cancelled.', errorReason: 'cancelled', retryable: false, rawMetadata: { runStatus: run.status } };
    }

    // Unrecognized/empty status — never fabricate a terminal state.
    return { ok: true, status: 'waiting_provider', progress: typeof run.progress === 'number' ? run.progress : null, nextPollSeconds: 5, outputs: [], error: null, rawMetadata: { runStatus: run.status || 'unknown' } };
  },

  /**
   * REAL cancellation — cancelHyperFramesRun() sends an actual SIGTERM to
   * the running child process. Unlike every remote MCP provider, this
   * adapter never reports provider_cancel_unsupported.
   */
  async cancel({ providerJobId }) {
    if (!providerJobId) {
      return { ok: false, status: 'not_found', error: 'No provider job was ever submitted for this attempt.' };
    }

    const before = getHyperFramesRun(providerJobId);
    if (!before) {
      return { ok: false, status: 'not_found', error: `HyperFrames run "${providerJobId}" no longer exists.` };
    }
    if (['completed', 'failed', 'cancelled'].includes(before.status)) {
      return { ok: false, status: 'already_terminal', error: `This run already reached a terminal state ("${before.status}") — nothing to cancel.` };
    }

    let after;
    try {
      after = cancelHyperFramesRun(providerJobId);
    } catch (e) {
      return { ok: false, status: 'error', error: `Could not cancel: ${e.message}` };
    }

    if (after?.status === 'cancelled') {
      return { ok: true, status: 'cancelled', error: null };
    }
    return { ok: false, status: 'error', error: 'Could not confirm cancellation — check the run status directly.' };
  },

  normalizeResult(result) {
    return {
      status: result.status,
      outputs: result.outputs || [],
      providerMetadata: result.rawMetadata || null,
    };
  },
};

export default hyperframesAdapter;
