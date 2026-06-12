// lib/adapters/adapterHealth.js
// Adapter health monitoring layer for Mika Agentic OS.
//
// Health states:
//   healthy              — adapter responded ok within latency threshold
//   warning              — degraded response or high latency or configured_but_staged
//   offline              — adapter unreachable or timed out
//   misconfigured        — env var present but wrong, or URL not set on active adapter
//   auth_failed          — adapter reachable but auth rejected
//   rate_limited         — HTTP 429 from upstream
//   maintenance          — manually placed in maintenance (skips live check)
//   staged               — env vars not configured, adapter is awaiting activation

import fs   from 'fs';
import path from 'path';
import { getAdapter, listAdapters } from './loadAdapter.js';
import { sanitizeAdapterHealthResult } from '../security/sanitizeHealth.js';

const ROOT         = process.cwd();
const HEALTH_FILE  = path.join(ROOT, 'data', 'adapter-health.json');
const LOG_FILE     = path.join(ROOT, 'logs', 'adapter-health-log.json');
const MAINT_FILE   = path.join(ROOT, 'data', 'adapter-maintenance.json');
const MAX_LOG      = 500;
const HIGH_LATENCY = 2500; // ms

// ── Env var requirements per adapter ────────────────────────────────────────

export const ADAPTER_ENV_MAP = {
  'openclaw':   {
    required:       ['OPENCLAW_GATEWAY_URL'],
    optional:       ['OPENCLAW_API_TOKEN', 'OPENCLAW_STATUS_PATH', 'OPENCLAW_MODEL'],
    activationNote: 'Set OPENCLAW_GATEWAY_URL to your VPS IP (e.g. http://1.2.3.4:3000)',
  },
  'hermes':     {
    required:       [],
    optional:       [
      'HERMES_CONNECTION_MODE', 'HERMES_CHAT_MODE', 'HERMES_CHAT_ENABLED',
      'HERMES_ENABLED', 'HERMES_API_URL', 'HERMES_SSH_HOST', 'HERMES_SSH_KEY',
      'HERMES_CLI_COMMAND',
    ],
    activationNote: 'Configure one Hermes mode: HTTP, SSH, or local CLI',
  },
  'claude-code':{
    required:       ['CLAUDE_CODE_ENABLED', 'CLAUDE_CODE_COMMAND'],
    optional:       ['CLAUDE_CODE_WORKING_DIR', 'CLAUDE_CODE_MODE'],
    activationNote: 'Set CLAUDE_CODE_ENABLED=true and CLAUDE_CODE_COMMAND=claude in .env.local. Requires claude CLI installed and an active session (~/.claude/sessions/).',
  },
  'codex':      {
    required:       ['OPENAI_API_KEY', 'CODEX_ENABLED'],
    optional:       [],
    activationNote: 'Set OPENAI_API_KEY and CODEX_ENABLED=true',
  },
  'heygen':     {
    required:       ['HEYGEN_API_KEY', 'HEYGEN_ENABLED'],
    optional:       [],
    activationNote: 'Set HEYGEN_API_KEY (from heygen.com) and HEYGEN_ENABLED=true',
  },
  'higgsfield': {
    required:       ['HIGGSFIELD_API_KEY', 'HIGGSFIELD_ENABLED'],
    optional:       [],
    activationNote: 'Set HIGGSFIELD_API_KEY and HIGGSFIELD_ENABLED=true',
  },
  'openart':    {
    required:       ['OPENART_API_KEY', 'OPENART_ENABLED'],
    optional:       [],
    activationNote: 'Set OPENART_API_KEY (from openart.ai) and OPENART_ENABLED=true',
  },
  'wan':        {
    required:       ['WAN_ENABLED', 'WAN_ENDPOINT'],
    optional:       [],
    activationNote: 'Set WAN_ENABLED=true and WAN_ENDPOINT to your Wan server URL',
  },
  'comfyui':    {
    required:       ['COMFYUI_ENABLED', 'COMFYUI_ENDPOINT'],
    optional:       [],
    activationNote: 'Run ComfyUI locally (default: http://127.0.0.1:8188), set COMFYUI_ENABLED=true and COMFYUI_ENDPOINT',
  },
};

// ── File helpers ─────────────────────────────────────────────────────────────

function readJson(fp, fb) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return fb; }
}

function writeJson(fp, data) {
  fs.writeFileSync(fp, JSON.stringify(data, null, 2));
}

// ── Storage ──────────────────────────────────────────────────────────────────

export function loadAdapterHealth() {
  return readJson(HEALTH_FILE, { updatedAt: null, checkedAt: null, adapters: {} });
}

export function saveAdapterHealth(store) {
  store.updatedAt = new Date().toISOString();
  writeJson(HEALTH_FILE, store);
}

// ── Log ───────────────────────────────────────────────────────────────────────

function appendHealthLog(entries) {
  const log = readJson(LOG_FILE, []);
  const next = [...log, ...entries].slice(-MAX_LOG);
  writeJson(LOG_FILE, next);
}

// ── Env var analysis ─────────────────────────────────────────────────────────

function analyseEnvVars(adapterId) {
  const map = ADAPTER_ENV_MAP[adapterId];
  if (!map) return { missing: [], present: [], activationNote: null };

  const missing = map.required.filter(v => !process.env[v] || process.env[v] === '');
  const present = map.required.filter(v =>  process.env[v] && process.env[v] !== '');

  return { missing, present, activationNote: map.activationNote || null };
}

// ── Health state mapping ──────────────────────────────────────────────────────

function mapToHealthState(adapter, checkResult, envAnalysis) {
  // Maintenance overrides everything
  const maintStore = readJson(MAINT_FILE, { maintenance: {} });
  if (maintStore.maintenance?.[adapter.adapterId]?.active) {
    return {
      health: 'maintenance',
      reason: 'manually_set',
      message: maintStore.maintenance[adapter.adapterId].reason || 'In maintenance',
    };
  }

  const raw = checkResult.status;
  const ok  = checkResult.ok;

  // Active adapters
  if (adapter.status === 'active') {
    if (ok) {
      if (checkResult.latencyMs != null && checkResult.latencyMs > HIGH_LATENCY) {
        return { health: 'warning', reason: 'high_latency', message: `Response slow — ${checkResult.latencyMs}ms (>${HIGH_LATENCY}ms threshold)` };
      }
      return { health: 'healthy', reason: null, message: `Responding in ${checkResult.latencyMs ?? '?'}ms` };
    }
    if (raw === 'auth_failed')    return { health: 'auth_failed',    reason: 'auth_rejected', message: checkResult.error || 'Authentication rejected by upstream' };
    if (raw === 'rate_limited')   return { health: 'rate_limited',   reason: 'rate_limited',  message: checkResult.error || 'Rate limit hit — back off and retry' };
    if (raw === 'misconfigured')  return { health: 'misconfigured',  reason: 'bad_config',    message: checkResult.error || 'Config error — check env vars' };
    if (raw === 'disabled')       return { health: 'misconfigured',  reason: 'env_var_disabled', message: checkResult.error || 'Adapter disabled via env var' };
    if (raw === 'degraded')       return { health: 'warning',        reason: 'degraded',      message: checkResult.error || 'Adapter responded but reported degraded status' };
    if (raw === 'configured_unverified') return { health: 'warning', reason: 'configured_unverified', message: 'Hermes is configured but this mode has no verified runtime evidence yet' };
    if (raw === 'not_configured') return { health: 'misconfigured', reason: 'not_configured', message: 'No complete Hermes connection mode is configured' };
    if (raw === 'offline')        return { health: 'offline',        reason: 'unreachable',   message: checkResult.error || 'Adapter endpoint unreachable' };
    // Fallback for any other not-ok case
    return { health: 'offline', reason: raw || 'unknown', message: checkResult.error || 'Health check failed' };
  }

  // Staged adapters
  if (adapter.status === 'staged') {
    if (ok) {
      // Adapter is fully healthy but not yet promoted — ready to activate via gate
      return { health: 'warning', reason: 'configured_but_staged', message: 'Adapter is configured and healthy — ready to activate via Activation Gate.' };
    }
    if (raw === 'not_connected') {
      // Env vars are set but disabled or partially configured
      return { health: 'warning', reason: 'configured_but_staged', message: 'Env vars are configured — adapter can be activated via Activation Gate.' };
    }
    if (raw === 'auth_failed') {
      return { health: 'auth_failed', reason: 'auth_rejected', message: checkResult.error || 'Authentication failed — check CLI auth or ANTHROPIC_API_KEY.' };
    }
    if (raw === 'misconfigured') {
      return { health: 'misconfigured', reason: 'bad_config', message: checkResult.error || 'Config error — check env vars and working directory.' };
    }
    return { health: 'staged', reason: 'not_configured', message: envAnalysis.missing.length > 0 ? `Missing: ${envAnalysis.missing.join(', ')}` : 'Adapter is staged — follow activation path' };
  }

  return { health: 'offline', reason: 'unknown', message: 'Adapter status unknown' };
}

// ── Core health check ─────────────────────────────────────────────────────────

export async function runAdapterHealthCheck(adapterId) {
  const sourceAdapter = getAdapter(adapterId);
  if (!sourceAdapter) {
    return {
      adapterId,
      displayName:    adapterId,
      adapterStatus:  'unknown',
      health:         'offline',
      ok:             false,
      latencyMs:      null,
      reason:         'not_registered',
      message:        `No adapter registered for "${adapterId}"`,
      checkedAt:      new Date().toISOString(),
      envVarsMissing: [],
      envVarsPresent: [],
      activationNote: null,
      rawStatus:      null,
    };
  }

  const effectiveAdapter = listAdapters().find(adapter => adapter.adapterId === adapterId) || {
    adapterId: sourceAdapter.adapterId,
    displayName: sourceAdapter.displayName,
    status: sourceAdapter.status,
  };
  const envAnalysis = analyseEnvVars(adapterId);
  let checkResult;
  const t0 = Date.now();

  try {
    checkResult = await sourceAdapter.healthCheck();
  } catch (e) {
    checkResult = { ok: false, status: 'offline', error: e.message, latencyMs: Date.now() - t0 };
  }

  const { health, reason, message } = mapToHealthState(effectiveAdapter, checkResult, envAnalysis);

  return sanitizeAdapterHealthResult({
    adapterId,
    displayName:    effectiveAdapter.displayName,
    adapterStatus:  effectiveAdapter.status,
    health,
    ok:             checkResult.ok ?? false,
    latencyMs:      checkResult.latencyMs ?? null,
    reason,
    message,
    checkedAt:      new Date().toISOString(),
    envVarsMissing: envAnalysis.missing,
    envVarsPresent: envAnalysis.present,
    activationNote: envAnalysis.activationNote,
    rawStatus:      checkResult.status ?? null,
  });
}

export async function runAllAdapterHealthChecks() {
  const adapters = listAdapters();
  const results  = await Promise.allSettled(
    adapters.map(a => runAdapterHealthCheck(a.adapterId))
  );

  return results.map(r =>
    r.status === 'fulfilled'
      ? r.value
      : { adapterId: '?', health: 'offline', ok: false, reason: 'exception', message: r.reason?.message || 'Unknown error', checkedAt: new Date().toISOString() }
  );
}

// ── Persist results ───────────────────────────────────────────────────────────

export function persistHealthResults(results, { appendLog = true } = {}) {
  const store = loadAdapterHealth();
  const now   = new Date().toISOString();
  const sanitizedResults = results.map(sanitizeAdapterHealthResult);

  for (const r of sanitizedResults) {
    store.adapters[r.adapterId] = r;
  }
  store.checkedAt = now;
  saveAdapterHealth(store);

  if (appendLog) {
    const logEntries = sanitizedResults.map(r => ({
      ...r,
      loggedAt: now,
    }));
    appendHealthLog(logEntries);
  }

  return store;
}

// ── Summary ───────────────────────────────────────────────────────────────────

export function getAdapterHealthSummary(store) {
  if (!store) store = loadAdapterHealth();
  const entries = Object.values(store.adapters || {});

  const count = (health) => entries.filter(e => e.health === health).length;

  const needsAttention = entries.filter(e =>
    ['offline', 'misconfigured', 'auth_failed', 'rate_limited'].includes(e.health)
  );
  const configuredButStaged = entries.filter(e => e.reason === 'configured_but_staged');

  return {
    total:               entries.length,
    healthy:             count('healthy'),
    warning:             count('warning'),
    offline:             count('offline'),
    misconfigured:       count('misconfigured'),
    auth_failed:         count('auth_failed'),
    rate_limited:        count('rate_limited'),
    maintenance:         count('maintenance'),
    staged:              count('staged'),
    configuredButStaged: configuredButStaged.length,
    failed:              needsAttention.length,
    needsAttention:      needsAttention.map(e => ({ adapterId: e.adapterId, displayName: e.displayName, health: e.health, reason: e.reason, message: e.message })),
    configuredButStagedAdapters: configuredButStaged.map(e => ({ adapterId: e.adapterId, displayName: e.displayName })),
    lastCheckedAt:       store.checkedAt || null,
    neverChecked:        !store.checkedAt,
    allHealthy:          entries.length > 0 && needsAttention.length === 0 && count('warning') === 0,
  };
}
