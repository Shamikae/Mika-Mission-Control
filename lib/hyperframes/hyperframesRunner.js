// lib/hyperframes/hyperframesRunner.js
// SERVER-SIDE ONLY. Never import from client components.
//
// Fixed HyperFrames command runner. Supports EXACTLY lint/check/preview/
// render — no arbitrary command string API, ever. Every invocation uses
// spawn() with a FIXED argument array (never string concatenation, never
// user-controlled command text) and a cwd resolved exclusively through
// resolveCompositionDir() (lib/hyperframes/hyperframesSecurity.js) — never
// constructed from unvalidated input.
//
// Preview control note (discovered during live testing): hyperframes
// preview's own `--background`/`--status`/`--stop` flags track a running
// server by PROJECT PATH with apparently-singleton semantics, which
// conflicted with a pre-existing, unrelated preview session already
// running for this same composition outside this session's control. To
// avoid that ambiguity entirely, this runner does NOT use `--background`
// — it spawns `preview` in the foreground and holds the child process's
// OWN pid directly (recorded in the run record), stopping it later via a
// direct SIGTERM to that exact pid. This sidesteps the CLI's own path-based
// tracking rather than depending on it.

import { spawn } from 'child_process';
import fs from 'fs';
import { resolveCompositionDir, resolveCompositionFile } from './hyperframesSecurity.js';
import {
  createHyperFramesRun, updateHyperFramesRun, appendHyperFramesRunLog,
  getHyperFramesRun, hasActiveRender,
} from './hyperframesRunStore.js';
import { getHyperFramesComposition } from './hyperframesCompositionStore.js';
import {
  validateLocalSourceFile, computeContentHash, createOrReuseLocalImportJob,
} from '../production/execution/localArtifactImport.js';

const RUN_TIMEOUT_MS = { lint: 30_000, check: 60_000, render: 10 * 60_000 };
const PROJECT_ROOT = process.cwd();

// In-memory handles for processes THIS server instance started — used only
// to send a real signal (cancel/stop); the run record on disk remains the
// source of truth for status.
const activeChildren = new Map(); // runId -> ChildProcess

function cliPackageFor(composition) {
  return composition?.cliVersionPin ? `hyperframes@${composition.cliVersionPin}` : 'hyperframes@latest';
}

function extractProgressPercent(text) {
  const matches = [...text.matchAll(/(\d{1,3})%/g)];
  if (!matches.length) return null;
  const n = Number(matches[matches.length - 1][1]);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

/**
 * Runs a fixed, quick (lint/check) HyperFrames command to completion and
 * returns the finished run record. Never accepts extra/unvalidated args.
 */
async function runQuickCommand(compositionId, command, extraArgs = []) {
  const composition = await getHyperFramesComposition(compositionId);
  if (!composition) {
    const err = new Error('Composition not found.'); err.code = 'not_found'; throw err;
  }
  const dir = resolveCompositionDir(compositionId);
  const run = createHyperFramesRun({ compositionId, command });
  updateHyperFramesRun(run.id, { status: 'running', startedAt: new Date().toISOString() });

  const args = [
    '--yes', cliPackageFor(composition), command, ...extraArgs,
  ];

  return new Promise((resolve) => {
    const child = spawn('npx', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', d => { stdout += d.toString(); appendHyperFramesRunLog(run.id, d.toString()); });
    child.stderr.on('data', d => { appendHyperFramesRunLog(run.id, d.toString()); });

    const killTimer = setTimeout(() => { try { child.kill('SIGTERM'); } catch { /* already gone */ } }, RUN_TIMEOUT_MS[command] || 60_000);

    child.on('close', (exitCode) => {
      clearTimeout(killTimer);
      let parsed = null;
      try { parsed = JSON.parse(stdout); } catch { /* CLI returned non-JSON — logTail still has the sanitized text */ }
      const ok = exitCode === 0 && (parsed ? parsed.ok !== false : true);
      const finalRun = updateHyperFramesRun(run.id, {
        status: ok ? 'completed' : 'failed',
        exitCode,
        completedAt: new Date().toISOString(),
        progress: 100,
        error: ok ? null : (parsed?.errorCount ? `${parsed.errorCount} error(s) found.` : `${command} exited with code ${exitCode}.`),
        // Store only a small, already-sanitized summary — never the raw stdout blob beyond what logTail already caps.
        result: parsed ? {
          ok: parsed.ok ?? null,
          errorCount: parsed.errorCount ?? parsed.lint?.errorCount ?? null,
          warningCount: parsed.warningCount ?? parsed.lint?.warningCount ?? null,
          infoCount: parsed.infoCount ?? parsed.lint?.infoCount ?? null,
        } : null,
      });
      resolve(finalRun);
    });
    child.on('error', (e) => {
      clearTimeout(killTimer);
      resolve(updateHyperFramesRun(run.id, { status: 'failed', completedAt: new Date().toISOString(), error: 'Could not start the HyperFrames CLI.' }));
    });
  });
}

export async function runHyperFramesLint(compositionId) {
  return runQuickCommand(compositionId, 'lint', ['--json']);
}

export async function runHyperFramesCheck(compositionId) {
  return runQuickCommand(compositionId, 'check', ['--json']);
}

/**
 * Starts a render child process and wires its output into the run record.
 * Returns { run, completion } — `run` is the initial (queued->running)
 * record for callers that want to return immediately and poll separately;
 * `completion` is a Promise resolving with the FINAL run record once the
 * process exits. Enforces exactly one active render per composition.
 *
 * @param {string|null} existingRunId — reuse an already-created run record
 * (e.g. one the one-click flow created up front to give the client a single
 * stable id to poll from the very start) instead of creating a new one.
 */
function startRenderProcess(compositionId, composition, options = {}, existingRunId = null) {
  // Skip the duplicate-render check when reusing an existing (already-
  // created, already 'queued') run id — that placeholder run IS itself the
  // "active render" hasActiveRender would find, so it would otherwise
  // always reject its own continuation. The caller (startRenderAndImportFlow)
  // already performed this check up front, before that placeholder existed.
  if (!existingRunId && hasActiveRender(compositionId)) {
    const err = new Error('A render is already in progress for this composition.'); err.code = 'render_in_progress'; throw err;
  }
  const dir = resolveCompositionDir(compositionId);

  const quality = ['standard', 'high'].includes(options.quality) ? options.quality : 'standard';
  // Low-memory-first default, matching the M1/8GB safety requirement — never
  // a forced multi-worker override; 'disabled' still never asks for MORE
  // than the CLI's own auto-detected worker count.
  const workersArg = options.lowMemoryMode === 'enabled' || options.lowMemoryMode === undefined
    ? ['--workers', '1']
    : []; // 'auto' / 'disabled' -> let the CLI decide, never forced higher

  const args = [
    '--yes', cliPackageFor(composition), 'render',
    '--output', 'output.mp4', // server-generated only — never a user-supplied filename
    '--quality', quality,
    '--strict', // fail the render itself on lint errors too, defense-in-depth alongside the one-click flow's own lint/check gate
    ...workersArg,
  ];

  const run = existingRunId ? getHyperFramesRun(existingRunId) : createHyperFramesRun({ compositionId, command: 'render' });
  updateHyperFramesRun(run.id, { status: 'running', startedAt: new Date().toISOString(), outputFilename: 'output.mp4' });

  const child = spawn('npx', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  activeChildren.set(run.id, child);

  const killTimer = setTimeout(() => { try { child.kill('SIGTERM'); } catch { /* already gone */ } }, RUN_TIMEOUT_MS.render);

  child.stdout.on('data', (d) => {
    const text = d.toString();
    appendHyperFramesRunLog(run.id, text);
    const progress = extractProgressPercent(text);
    if (progress != null) updateHyperFramesRun(run.id, { progress });
  });
  child.stderr.on('data', (d) => appendHyperFramesRunLog(run.id, d.toString()));

  const completion = new Promise((resolve) => {
    child.on('close', (exitCode) => {
      clearTimeout(killTimer);
      activeChildren.delete(run.id);
      const current = getHyperFramesRun(run.id);
      if (current?.status === 'cancelled') { resolve(current); return; }
      const outputPath = resolveCompositionFile(dir, 'output.mp4');
      const outputExists = fs.existsSync(outputPath);
      const final = updateHyperFramesRun(run.id, {
        status: (exitCode === 0 && outputExists) ? 'completed' : 'failed',
        exitCode,
        completedAt: new Date().toISOString(),
        progress: (exitCode === 0 && outputExists) ? 100 : current?.progress ?? null,
        error: (exitCode === 0 && outputExists) ? null : `Render exited with code ${exitCode}${outputExists ? '' : ' and produced no output.mp4'}.`,
      });
      resolve(final);
    });
    child.on('error', () => {
      clearTimeout(killTimer);
      activeChildren.delete(run.id);
      resolve(updateHyperFramesRun(run.id, { status: 'failed', completedAt: new Date().toISOString(), error: 'Could not start the HyperFrames render process.' }));
    });
  });

  return { run: getHyperFramesRun(run.id), completion };
}

/**
 * Kicks off a render WITHOUT waiting for completion — returns immediately
 * with a 'queued'->'running' run record; poll getHyperFramesRun(id) for
 * progress/completion. Enforces exactly one active render per composition.
 */
export async function runHyperFramesRender(compositionId, options = {}) {
  const composition = await getHyperFramesComposition(compositionId);
  if (!composition) {
    const err = new Error('Composition not found.'); err.code = 'not_found'; throw err;
  }
  const { run } = startRenderProcess(compositionId, composition, options);
  return run;
}

/**
 * One-click flow: validate -> lint (stop on failure) -> check (stop on
 * failure) -> render -> validate MP4 -> import idempotently. No silent
 * continuation past a lint/check failure, and never auto-approves the
 * resulting job (review.status stays 'unreviewed').
 *
 * Returns IMMEDIATELY with a single run record (status 'queued') that the
 * caller polls via getHyperFramesRun(id) — the whole lint->check->render
 * chain runs in the background. A single request that stays open for the
 * full ~20-40s duration of lint+check+render+import is fragile for a real
 * browser fetch (proxies, tab backgrounding, and this was directly observed
 * to hang in headless-browser testing even though the server-side work
 * completed correctly) — polling is the same proven-reliable pattern
 * already used by the standalone Render button.
 *
 * On failure, run.error explains which stage stopped it ("Stopped at
 * lint: ...", "Stopped at check: ...", "Stopped at render: ...", "Stopped
 * at import: ..."). On success, run.importedJobId is set once import
 * completes.
 */
export function startRenderAndImportFlow(compositionId, options = {}) {
  if (hasActiveRender(compositionId)) {
    const err = new Error('A render is already in progress for this composition.'); err.code = 'render_in_progress'; throw err;
  }
  // Validate synchronously (composition must exist) before returning a run
  // the client would otherwise poll forever.
  resolveCompositionDir(compositionId); // throws not_found/invalid_id/etc — propagates to the caller

  const run = createHyperFramesRun({ compositionId, command: 'render' });
  updateHyperFramesRun(run.id, { status: 'queued', startedAt: new Date().toISOString() });

  (async () => {
    try {
      const composition = await getHyperFramesComposition(compositionId);
      if (!composition) {
        updateHyperFramesRun(run.id, { status: 'failed', completedAt: new Date().toISOString(), error: 'Composition not found.' });
        return;
      }

      const lintRun = await runHyperFramesLint(compositionId);
      if (lintRun.status !== 'completed') {
        updateHyperFramesRun(run.id, {
          status: 'failed', completedAt: new Date().toISOString(),
          error: `Stopped at lint: ${lintRun.error || (lintRun.result?.errorCount ? `${lintRun.result.errorCount} error(s) found.` : 'lint failed.')}`,
        });
        return;
      }

      const checkRun = await runHyperFramesCheck(compositionId);
      if (checkRun.status !== 'completed') {
        updateHyperFramesRun(run.id, {
          status: 'failed', completedAt: new Date().toISOString(),
          error: `Stopped at check: ${checkRun.error || (checkRun.result?.errorCount ? `${checkRun.result.errorCount} error(s) found.` : 'check failed.')}`,
        });
        return;
      }

      const { completion } = startRenderProcess(compositionId, composition, options, run.id);
      const renderRun = await completion;
      if (renderRun.status !== 'completed') return; // startRenderProcess already set status/error on this same run record

      try {
        const importResult = await importHyperFramesOutput(compositionId);
        updateHyperFramesRun(run.id, { importedJobId: importResult.productionJobId });
      } catch (e) {
        updateHyperFramesRun(run.id, { status: 'failed', completedAt: new Date().toISOString(), error: `Stopped at import: ${e.message}` });
      }
    } catch (e) {
      updateHyperFramesRun(run.id, { status: 'failed', completedAt: new Date().toISOString(), error: e.message || 'Render and Import failed unexpectedly.' });
    }
  })();

  return getHyperFramesRun(run.id);
}

export function cancelHyperFramesRun(runId) {
  const run = getHyperFramesRun(runId);
  if (!run) return null;
  if (!['queued', 'running'].includes(run.status)) return run; // already terminal — nothing to cancel
  const child = activeChildren.get(runId);
  if (child) {
    try { child.kill('SIGTERM'); } catch { /* already exited */ }
    activeChildren.delete(runId);
  }
  return updateHyperFramesRun(runId, { status: 'cancelled', completedAt: new Date().toISOString(), error: 'Cancelled by user.' });
}

// ── Preview ──────────────────────────────────────────────────────────────
// See header comment — deliberately does not use --background; holds the
// child process pid directly instead of relying on the CLI's own
// path-based --status/--stop tracking.

const LOCAL_URL_RE = /(https?:\/\/(?:localhost|127\.0\.0\.1):\d+)/;

function portForComposition(compositionId) {
  // Deterministic per-composition port in a private range — avoids
  // collisions between compositions without needing a port-scan.
  let hash = 0;
  for (let i = 0; i < compositionId.length; i++) hash = (hash * 31 + compositionId.charCodeAt(i)) >>> 0;
  return 4100 + (hash % 100);
}

export async function startHyperFramesPreview(compositionId) {
  const composition = await getHyperFramesComposition(compositionId);
  if (!composition) {
    const err = new Error('Composition not found.'); err.code = 'not_found'; throw err;
  }
  const existingRuns = (await import('./hyperframesRunStore.js')).listHyperFramesRuns({ compositionId });
  const activePreview = existingRuns.find(r => r.command === 'preview' && r.status === 'running');
  if (activePreview) return activePreview;

  const dir = resolveCompositionDir(compositionId);
  const port = portForComposition(compositionId);
  const args = ['--yes', cliPackageFor(composition), 'preview', '--no-open', '--port', String(port)];

  const run = createHyperFramesRun({ compositionId, command: 'preview' });

  return new Promise((resolve) => {
    const child = spawn('npx', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    activeChildren.set(run.id, child);
    let resolved = false;

    const settle = (patch) => {
      const updated = updateHyperFramesRun(run.id, patch);
      if (!resolved) { resolved = true; resolve(updated); }
    };

    child.stdout.on('data', (d) => {
      const text = d.toString();
      appendHyperFramesRunLog(run.id, text);
      const match = text.match(LOCAL_URL_RE);
      if (match && !resolved) {
        settle({
          status: 'running', startedAt: new Date().toISOString(),
          previewPort: port, previewPid: child.pid,
        });
      }
    });
    child.stderr.on('data', (d) => appendHyperFramesRunLog(run.id, d.toString()));

    child.on('close', (exitCode) => {
      activeChildren.delete(run.id);
      const current = getHyperFramesRun(run.id);
      if (current?.status === 'cancelled') return;
      settle({ status: exitCode === 0 ? 'completed' : 'failed', exitCode, completedAt: new Date().toISOString(), previewPid: null });
    });
    child.on('error', () => {
      activeChildren.delete(run.id);
      settle({ status: 'failed', completedAt: new Date().toISOString(), error: 'Could not start the HyperFrames preview server.' });
    });

    // Honest timeout if the studio never reports a URL within a reasonable window.
    setTimeout(() => {
      if (!resolved) settle({ status: 'failed', error: 'Preview server did not report a local URL in time.' });
    }, 20_000);
  });
}

export function stopHyperFramesPreview(runId) {
  const run = getHyperFramesRun(runId);
  if (!run || run.command !== 'preview') return null;
  if (run.status !== 'running') return run;
  const child = activeChildren.get(runId);
  if (child) {
    try { child.kill('SIGTERM'); } catch { /* already exited */ }
    activeChildren.delete(runId);
  } else if (run.previewPid) {
    // Server may have restarted since the preview was started — the pid we
    // recorded is still real and killable even without the in-memory handle.
    try { process.kill(run.previewPid, 'SIGTERM'); } catch { /* already exited */ }
  }
  return updateHyperFramesRun(runId, { status: 'completed', completedAt: new Date().toISOString(), previewPid: null });
}

// ── Import ───────────────────────────────────────────────────────────────

export async function importHyperFramesOutput(compositionId) {
  const composition = await getHyperFramesComposition(compositionId);
  if (!composition) {
    const err = new Error('Composition not found.'); err.code = 'not_found'; throw err;
  }
  if (!composition.hasOutputMp4) {
    const err = new Error('No output.mp4 exists for this composition yet — render it first.'); err.code = 'no_output'; throw err;
  }
  const dir = resolveCompositionDir(compositionId);
  const outputPath = resolveCompositionFile(dir, 'output.mp4');

  const validated = validateLocalSourceFile({ absolutePath: outputPath, allowedRoot: PROJECT_ROOT });
  const sourceHash = computeContentHash(validated.buffer);

  const result = createOrReuseLocalImportJob({
    buffer: validated.buffer, mimeType: validated.mimeType, sizeBytes: validated.sizeBytes,
    filename: 'output.mp4', sourceHash,
    title: composition.name, provider: 'hyperframes-local', mode: 'custom',
    durationSeconds: composition.metadata.durationSeconds, width: composition.metadata.width,
    height: composition.metadata.height, fps: composition.metadata.fps,
    sourceLabel: 'hyperframes-local-studio', metadataSource: 'local-hyperframes-cli',
    extraMetadata: { hyperframesCompositionId: compositionId },
  });

  return result;
}
