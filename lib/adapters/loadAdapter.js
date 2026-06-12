// lib/adapters/loadAdapter.js
// Universal adapter registry for Mika Agentic OS.
// listAdapters() merges adapter-activation-state.json so gate-approved activations
// are reflected in status without modifying adapter source files.

import fs   from 'fs';
import path from 'path';

import openclawAdapter    from '../../adapters/openclaw.adapter.js';
import hermesAdapter      from '../../adapters/hermes.adapter.js';
import claudeCodeAdapter  from '../../adapters/claude-code.adapter.js';
import codexAdapter       from '../../adapters/codex.adapter.js';
import heygenAdapter      from '../../adapters/heygen.adapter.js';
import higgsfieldAdapter  from '../../adapters/higgsfield.adapter.js';
import openartAdapter     from '../../adapters/openart.adapter.js';
import wanAdapter         from '../../adapters/wan.adapter.js';
import comfyuiAdapter     from '../../adapters/comfyui.adapter.js';

// ── Activation state ─────────────────────────────────────────────────────────

const ACTIVATION_FILE = path.join(process.cwd(), 'data', 'adapter-activation-state.json');

function loadActivationOverrides() {
  try { return JSON.parse(fs.readFileSync(ACTIVATION_FILE, 'utf8')).overrides || {}; }
  catch { return {}; }
}

// ── Registry ─────────────────────────────────────────────────────────────────

const ADAPTER_REGISTRY = {
  'openclaw':    openclawAdapter,
  'hermes':      hermesAdapter,
  'claude-code': claudeCodeAdapter,
  'codex':       codexAdapter,
  'heygen':      heygenAdapter,
  'higgsfield':  higgsfieldAdapter,
  'openart':     openartAdapter,
  'wan':         wanAdapter,
  'comfyui':     comfyuiAdapter,
};

const REQUIRED_INTERFACE = ['adapterId', 'displayName', 'status', 'supportedTaskTypes', 'healthCheck', 'execute', 'validateInput', 'estimateCost'];

// ── Exports ───────────────────────────────────────────────────────────────────

/**
 * Get the adapter instance for a given adapterId.
 * Returns null if the adapter is not registered.
 */
export function getAdapter(adapterId) {
  return ADAPTER_REGISTRY[adapterId] ?? null;
}

/**
 * Get a lightweight status summary for an adapter without loading its full module.
 */
export function getAdapterStatus(adapterId) {
  const adapter = ADAPTER_REGISTRY[adapterId];
  if (!adapter) {
    return { adapterId, status: 'unknown', displayName: null, registered: false, error: `No adapter registered for "${adapterId}"` };
  }
  return {
    adapterId:          adapter.adapterId,
    displayName:        adapter.displayName,
    status:             adapter.status,
    supportedTaskTypes: adapter.supportedTaskTypes,
    registered:         true,
  };
}

/**
 * List all registered adapters with their current status.
 * Used by Agent Workspace, Workforce Division, and Executive Intelligence.
 */
export function listAdapters() {
  const overrides = loadActivationOverrides();
  return Object.values(ADAPTER_REGISTRY).map(a => {
    const override       = overrides[a.adapterId];
    const effectiveStatus = override?.status || a.status;
    return {
      adapterId:          a.adapterId,
      displayName:        a.displayName,
      status:             effectiveStatus,
      originalStatus:     a.status,
      supportedTaskTypes: a.supportedTaskTypes,
      isActive:           effectiveStatus === 'active',
      isStaged:           effectiveStatus === 'staged',
      activatedViaGate:   !!override,
      activatedAt:        override?.activatedAt || null,
    };
  });
}

/**
 * Validate that an adapter fully implements the required interface.
 * Used during system boot and in the Agent Registry view.
 */
export function validateAdapter(adapterId) {
  const adapter = ADAPTER_REGISTRY[adapterId];
  if (!adapter) {
    return { valid: false, adapterId, errors: [`No adapter registered for "${adapterId}"`] };
  }

  const errors = [];
  for (const key of REQUIRED_INTERFACE) {
    if (!(key in adapter)) {
      errors.push(`Missing required property: "${key}"`);
    }
  }
  if ('healthCheck'   in adapter && typeof adapter.healthCheck   !== 'function') errors.push('"healthCheck" must be a function');
  if ('execute'       in adapter && typeof adapter.execute       !== 'function') errors.push('"execute" must be a function');
  if ('validateInput' in adapter && typeof adapter.validateInput !== 'function') errors.push('"validateInput" must be a function');
  if ('estimateCost'  in adapter && typeof adapter.estimateCost  !== 'function') errors.push('"estimateCost" must be a function');
  if (!Array.isArray(adapter.supportedTaskTypes))                                errors.push('"supportedTaskTypes" must be an array');

  return { valid: errors.length === 0, adapterId, displayName: adapter.displayName, status: adapter.status, errors };
}

/**
 * Run healthCheck on all registered adapters. Async — pings live services.
 * Used by Executive Intelligence briefing and system status pages.
 */
export async function healthCheckAll() {
  const results = await Promise.allSettled(
    Object.values(ADAPTER_REGISTRY).map(async (adapter) => {
      try {
        const result = await adapter.healthCheck();
        return { adapterId: adapter.adapterId, displayName: adapter.displayName, ...result };
      } catch (e) {
        return { adapterId: adapter.adapterId, displayName: adapter.displayName, ok: false, status: 'error', error: e.message };
      }
    })
  );
  return results.map(r => r.status === 'fulfilled' ? r.value : { ok: false, status: 'error', error: r.reason?.message });
}

/**
 * Check if a given adapterId can handle a task type.
 */
export function adapterSupportsTaskType(adapterId, taskType) {
  const adapter = ADAPTER_REGISTRY[adapterId];
  if (!adapter) return false;
  return adapter.supportedTaskTypes.includes(taskType);
}

/**
 * Validate all registered adapters and return a full interface audit.
 * Used at startup to confirm the adapter layer is healthy.
 */
export function auditAdapterLayer() {
  const active  = [];
  const staged  = [];
  const invalid = [];

  for (const adapterId of Object.keys(ADAPTER_REGISTRY)) {
    const validation = validateAdapter(adapterId);
    if (!validation.valid) {
      invalid.push(validation);
    } else if (ADAPTER_REGISTRY[adapterId].status === 'active') {
      active.push(adapterId);
    } else {
      staged.push(adapterId);
    }
  }

  return {
    totalAdapters: Object.keys(ADAPTER_REGISTRY).length,
    activeAdapters: active,
    stagedAdapters: staged,
    invalidAdapters: invalid,
    healthy: invalid.length === 0,
    auditedAt: new Date().toISOString(),
  };
}
