// adapters/claude-code.adapter.js
// Local CLI adapter for Claude Code — analysis-only mode.
//
// Safety design:
//   --tools ""               → disables ALL tool use (no file reads/writes/bash)
//   --no-session-persistence → ephemeral session, nothing saved to disk
//   --print                  → non-interactive, exits after response
//   --max-budget-usd         → hard cost cap per call
//
// Activation: set CLAUDE_CODE_ENABLED=true in .env.local, then use Activation Gate.
// Execute mode: analysis and recommendations only — no file writes, no code execution.

import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import fs   from 'fs';
import path from 'path';
import os   from 'os';

const execFileAsync = promisify(execFile);

// ── Allowed task types in analysis-only mode ─────────────────────────────────

const ANALYSIS_TASK_TYPES = [
  'code_architecture',
  'code_review',
  'refactor_plan',
  'bug_diagnosis',
];

// ── Capability modes ──────────────────────────────────────────────────────────
// Controlled by CLAUDE_CODE_TOOL_MODE env var.
//
//   analysis-only-no-files  (default)
//     --tools ""  — ALL tools disabled. Claude cannot see any files.
//     Must not claim filesystem state unless user provided the evidence.
//
//   read-only-inspection
//     --tools "Read,Glob,Grep,LS"  — read-only file inspection only.
//     No writes, no edits, no shell execution.

const CAPABILITY_MODES = {
  'analysis-only-no-files': {
    capabilityMode:  'analysis-only-no-files',
    label:           'Analysis Only — No File Inspection',
    cliToolsFlag:    '',
    canInspectFiles: false,
    canWriteFiles:   false,
    canRunShell:     false,
    allowedTools:    [],
    safetyNotice:    'Claude Code has no filesystem tools in this mode. Architecture advice is based on your description only — no filesystem state is verified.',
    promptPrefix:    'IMPORTANT: You do not have filesystem inspection tools in this mode. Do not claim files exist or do not exist unless the user provided that evidence. Give architecture-level advice only.',
  },
  'read-only-inspection': {
    capabilityMode:  'read-only-inspection',
    label:           'Read-Only Inspection',
    cliToolsFlag:    'Read,Glob,Grep,LS',
    canInspectFiles: true,
    canWriteFiles:   false,
    canRunShell:     false,
    allowedTools:    ['Read', 'Glob', 'Grep', 'LS'],
    safetyNotice:    'Claude Code can read files but cannot write, edit, create, delete, or run shell commands.',
    promptPrefix:    'READ-ONLY INSPECTION MODE.\nYou may use Read, Glob, Grep, and LS tools to inspect the codebase.\nYou may NOT write, edit, create, or delete any files.\nYou may NOT run any shell commands.\nYou may NOT make any changes to the codebase.\nProvide analysis and recommendations as text only.',
  },
};

function getCapabilityMode() {
  const raw = (process.env.CLAUDE_CODE_TOOL_MODE || 'analysis-only-no-files').trim();
  return CAPABILITY_MODES[raw] || CAPABILITY_MODES['analysis-only-no-files'];
}

export { CAPABILITY_MODES, getCapabilityMode };

// ── Cost model ────────────────────────────────────────────────────────────────
// Claude Sonnet 4.6 API pricing (estimated, not live-fetched):
//   Input:  $3.00 / 1M tokens
//   Output: $15.00 / 1M tokens
// Typical analysis task: ~1 200 input tokens, ~600 output tokens.

const COST_PER_M_INPUT  = 3.00;
const COST_PER_M_OUTPUT = 15.00;
const EST_INPUT_TOKENS  = 1200;
const EST_OUTPUT_TOKENS = 600;

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveCommand(command) {
  // Try `which` to get full path; fall back to command name (relies on PATH)
  try {
    return execFileSync('which', [command], { encoding: 'utf8', timeout: 2000 }).trim();
  } catch {
    return command;
  }
}

function hasActiveSession() {
  // Checks for existing Claude session files — indicates prior authentication
  try {
    const sessionDir = path.join(os.homedir(), '.claude', 'sessions');
    const files = fs.readdirSync(sessionDir).filter(f => f.endsWith('.json'));
    return files.length > 0;
  } catch {
    return false;
  }
}

function parseCliOutput(stdout) {
  // Claude --output-format json returns a result object
  try {
    const parsed = JSON.parse(stdout.trim());
    return { text: parsed.result || '', costUsd: parsed.cost_usd || null, sessionId: parsed.session_id || null };
  } catch {
    // Fall back to raw stdout if JSON parse fails
    return { text: stdout.trim(), costUsd: null, sessionId: null };
  }
}

// ── Adapter definition ────────────────────────────────────────────────────────

const claudeCodeAdapter = {
  adapterId:         'claude-code',
  displayName:       'Claude Code',
  status:            'staged',
  supportedTaskTypes: ANALYSIS_TASK_TYPES,

  // ── healthCheck ─────────────────────────────────────────────────────────────
  // Returns staged/misconfigured/auth_failed/healthy.
  // Never makes an API call — only checks local CLI + session state.

  async healthCheck() {
    const t0      = Date.now();
    const enabled = process.env.CLAUDE_CODE_ENABLED === 'true';
    const command = process.env.CLAUDE_CODE_COMMAND || 'claude';
    const workDir = process.env.CLAUDE_CODE_WORKING_DIR || process.cwd();

    // Not enabled → staged (not an error, expected default state)
    if (!enabled) {
      return {
        ok:        false,
        status:    process.env.CLAUDE_CODE_ENABLED !== undefined ? 'not_connected' : 'staged',
        adapterId: 'claude-code',
        latencyMs: Date.now() - t0,
        error:     'CLAUDE_CODE_ENABLED is not set to true — adapter is staged by design.',
        activationGuide: 'Set CLAUDE_CODE_ENABLED=true in .env.local, then use Activation Gate to promote to active.',
      };
    }

    // Working directory check
    if (!fs.existsSync(workDir)) {
      return {
        ok: false, status: 'misconfigured', adapterId: 'claude-code', latencyMs: Date.now() - t0,
        error: `Working directory not found: ${workDir}. Set CLAUDE_CODE_WORKING_DIR in .env.local.`,
      };
    }

    // CLI availability check (runs `claude --version` — no API call, no tokens)
    const resolvedCmd = resolveCommand(command);
    let cliVersion = null;
    try {
      const { stdout } = await execFileAsync(resolvedCmd, ['--version'], { timeout: 5000 });
      cliVersion = stdout.trim();
    } catch (e) {
      return {
        ok: false, status: 'misconfigured', adapterId: 'claude-code', latencyMs: Date.now() - t0,
        error: `Claude CLI not found: tried "${resolvedCmd}". Ensure \`claude\` is in PATH or set CLAUDE_CODE_COMMAND to full path.`,
      };
    }

    // Authentication check — look for existing sessions or API key
    const sessionAuth = hasActiveSession();
    const apiKeyAuth  = !!process.env.ANTHROPIC_API_KEY;

    if (!sessionAuth && !apiKeyAuth) {
      return {
        ok: false, status: 'auth_failed', adapterId: 'claude-code', latencyMs: Date.now() - t0,
        cliVersion,
        error: 'No active Claude session found. Run `claude` interactively to authenticate, or set ANTHROPIC_API_KEY.',
      };
    }

    const cap = getCapabilityMode();
    return {
      ok:              true,
      status:          'healthy',
      adapterId:       'claude-code',
      latencyMs:       Date.now() - t0,
      cliVersion,
      workingDir:      workDir,
      mode:            process.env.CLAUDE_CODE_MODE || 'local-cli',
      authMethod:      sessionAuth ? 'session' : 'api_key',
      // Capability contract — never changes without explicit config
      capabilityMode:  cap.capabilityMode,
      capabilityLabel: cap.label,
      canInspectFiles: cap.canInspectFiles,
      canWriteFiles:   false,
      canRunShell:     false,
      allowedTools:    cap.allowedTools,
      safetyNotice:    cap.safetyNotice,
    };
  },

  // ── execute ──────────────────────────────────────────────────────────────────
  // Analysis-only. Uses --tools "" to disable ALL tool use (no file reads/writes).
  // Returns recommendations and analysis as text — never writes files.

  async execute(task, decision) {
    const enabled = process.env.CLAUDE_CODE_ENABLED === 'true';
    if (!enabled) {
      throw new Error('Claude Code adapter is disabled. Set CLAUDE_CODE_ENABLED=true and activate via Activation Gate.');
    }

    const command   = process.env.CLAUDE_CODE_COMMAND || 'claude';
    const workDir   = process.env.CLAUDE_CODE_WORKING_DIR || process.cwd();
    const maxBudget = process.env.CLAUDE_CODE_MAX_BUDGET_USD || '1.00';

    // Governance: only allow analysis task types in this phase
    if (!ANALYSIS_TASK_TYPES.includes(task.taskType)) {
      throw new Error(
        `Task type "${task.taskType}" is not allowed in analysis-only mode. ` +
        `Allowed: ${ANALYSIS_TASK_TYPES.join(', ')}`
      );
    }

    const instructions = task.instructions || task.description || '';
    if (!instructions) throw new Error('instructions or description is required');

    const cap    = getCapabilityMode();
    const prompt = `${cap.promptPrefix}\nTask type: ${task.taskType}\n\n${instructions}`;
    const t0     = Date.now();

    // Build tool flag: empty string disables all tools, named list allowlists specific tools
    const toolArgs = cap.cliToolsFlag !== ''
      ? ['--tools', cap.cliToolsFlag]
      : ['--tools', ''];

    try {
      const { stdout } = await execFileAsync(command, [
        '--print',
        ...toolArgs,
        '--no-session-persistence',
        '--output-format', 'json',
        '--max-budget-usd', maxBudget,
        prompt,
      ], {
        timeout: 300_000,
        cwd:     workDir,
        maxBuffer: 4 * 1024 * 1024,
      });

      const { text, costUsd, sessionId } = parseCliOutput(stdout);
      const durationMs = Date.now() - t0;

      return {
        ok:             true,
        output:         text,
        costUsd,
        durationMs,
        sessionId,
        capabilityMode: cap.capabilityMode,
        canInspectFiles: cap.canInspectFiles,
        toolsUsed:      cap.allowedTools,
        taskType:       task.taskType,
      };
    } catch (e) {
      const durationMs = Date.now() - t0;
      if (e.killed || e.code === 'ETIMEDOUT') {
        throw new Error(`Claude Code timed out after ${Math.round(durationMs / 1000)}s. Try a shorter prompt.`);
      }
      if (e.stderr) {
        throw new Error(`Claude Code error: ${e.stderr.slice(0, 400)}`);
      }
      throw new Error(`Claude Code execution failed: ${e.message}`);
    }
  },

  // ── validateInput ─────────────────────────────────────────────────────────────

  validateInput(task) {
    const errors = [];
    if (!task.taskId && !task.id)     errors.push('taskId is required');
    if (!task.taskType)               errors.push('taskType is required');
    if (!ANALYSIS_TASK_TYPES.includes(task.taskType)) {
      errors.push(
        `Task type "${task.taskType}" is not supported. ` +
        `Allowed in analysis-only mode: ${ANALYSIS_TASK_TYPES.join(', ')}`
      );
    }
    if (!task.instructions && !task.description) {
      errors.push('instructions or description is required');
    }
    return { valid: errors.length === 0, errors };
  },

  // ── estimateCost ──────────────────────────────────────────────────────────────

  estimateCost(task) {
    const inputCostUsd  = (EST_INPUT_TOKENS  / 1_000_000) * COST_PER_M_INPUT;
    const outputCostUsd = (EST_OUTPUT_TOKENS / 1_000_000) * COST_PER_M_OUTPUT;
    const totalEstimate = inputCostUsd + outputCostUsd;

    return {
      estimatedCost: parseFloat(totalEstimate.toFixed(4)),
      currency:      'USD',
      tier:          'variable',
      note:          `~${EST_INPUT_TOKENS} input / ~${EST_OUTPUT_TOKENS} output tokens via local claude CLI (Sonnet pricing)`,
      breakdown: {
        inputTokens:   EST_INPUT_TOKENS,
        outputTokens:  EST_OUTPUT_TOKENS,
        inputCostUsd:  parseFloat(inputCostUsd.toFixed(4)),
        outputCostUsd: parseFloat(outputCostUsd.toFixed(4)),
        modelNote:     'Claude Sonnet 4.6: $3/M input, $15/M output',
      },
    };
  },
};

export default claudeCodeAdapter;
