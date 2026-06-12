// lib/activation/activationGate.js
// Governs the staged → active promotion flow for provider adapters.
// All state is persisted to data/ files — no live billing or external calls.

import fs   from 'fs';
import path from 'path';
import { ADAPTER_ENV_MAP, loadAdapterHealth } from '../adapters/adapterHealth.js';
import { ADAPTER_COST_MODEL }                 from '../cost/costEngine.js';

const ROOT                 = process.cwd();
const REQUESTS_FILE        = path.join(ROOT, 'data', 'activation-requests.json');
const ACTIVATION_STATE_FILE = path.join(ROOT, 'data', 'adapter-activation-state.json');
const MAINT_FILE           = path.join(ROOT, 'data', 'adapter-maintenance.json');

// ── File I/O ──────────────────────────────────────────────────────────────────

export function loadActivationRequests() {
  try { return JSON.parse(fs.readFileSync(REQUESTS_FILE, 'utf8')); }
  catch { return { requests: [] }; }
}

export function saveActivationRequests(store) {
  fs.writeFileSync(REQUESTS_FILE, JSON.stringify(store, null, 2));
}

export function loadActivationState() {
  try { return JSON.parse(fs.readFileSync(ACTIVATION_STATE_FILE, 'utf8')); }
  catch { return { overrides: {} }; }
}

export function saveActivationState(state) {
  fs.writeFileSync(ACTIVATION_STATE_FILE, JSON.stringify(state, null, 2));
}

// ── Preflight Checks ──────────────────────────────────────────────────────────

function checkEnvVars(adapterId) {
  const spec = ADAPTER_ENV_MAP[adapterId];
  if (!spec) return { id: 'env_vars', label: 'Environment Variables', status: 'skip', detail: 'No env var spec defined for this adapter.' };
  const missing = spec.required.filter(k => !process.env[k]);
  if (missing.length === 0) {
    return { id: 'env_vars', label: 'Environment Variables', status: 'pass', detail: `All ${spec.required.length} required env vars present.` };
  }
  return { id: 'env_vars', label: 'Environment Variables', status: 'fail', detail: `Missing: ${missing.join(', ')}`, missingVars: missing };
}

function checkHealth(adapterId) {
  const store  = loadAdapterHealth();
  const health = store.adapters?.[adapterId];
  if (!health || !health.checkedAt) {
    return { id: 'health_check', label: 'Health Check', status: 'warn', detail: 'Never checked. Run a health check in Agent Control first.' };
  }
  const bad = ['offline', 'auth_failed', 'misconfigured'];
  if (bad.includes(health.health)) {
    return { id: 'health_check', label: 'Health Check', status: 'fail', detail: `Last check: ${health.health} — ${health.message || 'no detail'}` };
  }
  if (health.health === 'warning') {
    return { id: 'health_check', label: 'Health Check', status: 'warn', detail: `Last check: warning — ${health.message || 'latency or config issue'}` };
  }
  return { id: 'health_check', label: 'Health Check', status: 'pass', detail: `Last check: ${health.health} at ${health.checkedAt}` };
}

function checkCostRisk(adapterId) {
  const model = ADAPTER_COST_MODEL[adapterId];
  if (!model) return { id: 'cost_projection', label: 'Cost Projection', status: 'skip', detail: 'No cost model defined.' };
  const projected = model.perDispatch * 30;
  if (model.activationRisk === 'none' || model.tier === 'free') {
    return { id: 'cost_projection', label: 'Cost Projection', status: 'pass', detail: `Free tier — no cost risk. ~$${projected.toFixed(2)}/mo at 30 dispatches.` };
  }
  if (model.activationRisk === 'high' || projected >= 10) {
    return {
      id: 'cost_projection', label: 'Cost Projection', status: 'warn',
      detail: `High cost tier (${model.tier}). ~$${projected.toFixed(2)}/mo at 30 dispatches. Review before approving.`,
      projectedMonthly: projected,
    };
  }
  return { id: 'cost_projection', label: 'Cost Projection', status: 'pass', detail: `~$${projected.toFixed(2)}/mo at 30 dispatches (${model.tier} tier).`, projectedMonthly: projected };
}

function checkMaintenance(adapterId) {
  try {
    const maint = JSON.parse(fs.readFileSync(MAINT_FILE, 'utf8'));
    if (maint.maintenance?.[adapterId]?.active) {
      return { id: 'no_maintenance', label: 'Maintenance Clear', status: 'fail', detail: `Adapter is in maintenance: ${maint.maintenance[adapterId].reason || 'no reason'}` };
    }
  } catch {}
  return { id: 'no_maintenance', label: 'Maintenance Clear', status: 'pass', detail: 'No active maintenance window.' };
}

function checkNoDuplicate(adapterId) {
  const store   = loadActivationRequests();
  const pending = store.requests.filter(r => r.adapterId === adapterId && r.status === 'pending');
  if (pending.length > 0) {
    return { id: 'no_duplicate', label: 'No Duplicate Request', status: 'fail', detail: `Pending request already exists (${pending[0].id})` };
  }
  const state = loadActivationState();
  if (state.overrides?.[adapterId]?.status === 'active') {
    return { id: 'no_duplicate', label: 'No Duplicate Request', status: 'fail', detail: 'Adapter is already activated.' };
  }
  return { id: 'no_duplicate', label: 'No Duplicate Request', status: 'pass', detail: 'No pending requests.' };
}

export function runPreflightChecklist(adapterId) {
  const items = [
    checkEnvVars(adapterId),
    checkHealth(adapterId),
    checkCostRisk(adapterId),
    checkMaintenance(adapterId),
    checkNoDuplicate(adapterId),
  ];
  const failed  = items.filter(i => i.status === 'fail').length;
  const warned  = items.filter(i => i.status === 'warn').length;
  const passed  = items.filter(i => i.status === 'pass' || i.status === 'skip').length;
  return {
    adapterId,
    passed:      failed === 0,
    hasWarnings: warned > 0,
    summary:     { passed, warned, failed, total: items.length },
    items,
    checkedAt:   new Date().toISOString(),
  };
}

// ── Request Lifecycle ─────────────────────────────────────────────────────────

function genId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createActivationRequest(adapterId, adapterName, notes = '') {
  const preflight = runPreflightChecklist(adapterId);
  const request = {
    id:          genId('req'),
    adapterId,
    adapterName: adapterName || adapterId,
    requestedAt: new Date().toISOString(),
    status:      'pending',
    preflight,
    notes,
    reviewedAt:  null,
    reviewedBy:  null,
    reviewNote:  null,
  };
  const store = loadActivationRequests();
  store.requests.unshift(request);
  saveActivationRequests(store);
  return request;
}

export function approveActivationRequest(requestId) {
  const store = loadActivationRequests();
  const req   = store.requests.find(r => r.id === requestId);
  if (!req)                   return { ok: false, error: 'Request not found' };
  if (req.status !== 'pending') return { ok: false, error: `Request is already ${req.status}` };

  req.status     = 'approved';
  req.reviewedAt = new Date().toISOString();
  req.reviewedBy = 'mika';
  saveActivationRequests(store);

  const state = loadActivationState();
  if (!state.overrides) state.overrides = {};
  state.overrides[req.adapterId] = { status: 'active', activatedAt: req.reviewedAt, requestId: req.id };
  saveActivationState(state);

  return { ok: true, request: req };
}

export function rejectActivationRequest(requestId, reason = '') {
  const store = loadActivationRequests();
  const req   = store.requests.find(r => r.id === requestId);
  if (!req)                   return { ok: false, error: 'Request not found' };
  if (req.status !== 'pending') return { ok: false, error: `Request is already ${req.status}` };

  req.status     = 'rejected';
  req.reviewedAt = new Date().toISOString();
  req.reviewedBy = 'mika';
  req.reviewNote = reason;
  saveActivationRequests(store);

  return { ok: true, request: req };
}

export function rollbackActivation(adapterId, reason = '') {
  const state = loadActivationState();
  if (!state.overrides?.[adapterId]) return { ok: false, error: 'Adapter is not activated via the gate' };

  const record = {
    id:          genId('rollback'),
    adapterId,
    adapterName: adapterId,
    requestedAt: new Date().toISOString(),
    status:      'rolled_back',
    preflight:   null,
    notes:       reason || 'Manual rollback',
    reviewedAt:  new Date().toISOString(),
    reviewedBy:  'mika',
    reviewNote:  reason,
  };

  delete state.overrides[adapterId];
  saveActivationState(state);

  const store = loadActivationRequests();
  store.requests.unshift(record);
  saveActivationRequests(store);

  return { ok: true };
}

// ── Query helpers ─────────────────────────────────────────────────────────────

export function getPendingRequests() {
  const store = loadActivationRequests();
  return store.requests.filter(r => r.status === 'pending');
}

export function getActivationSummary() {
  const store = loadActivationRequests();
  const state = loadActivationState();
  return {
    pending:       store.requests.filter(r => r.status === 'pending').length,
    approved:      store.requests.filter(r => r.status === 'approved').length,
    rejected:      store.requests.filter(r => r.status === 'rejected').length,
    rolledBack:    store.requests.filter(r => r.status === 'rolled_back').length,
    activated:     Object.keys(state.overrides || {}).length,
    totalRequests: store.requests.length,
  };
}
