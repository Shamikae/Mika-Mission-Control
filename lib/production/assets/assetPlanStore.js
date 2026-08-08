// lib/production/assets/assetPlanStore.js
// SERVER-SIDE ONLY (filesystem).
//
// One JSON file per plan under data/asset-plans/. Unlike assets and ledger
// entries, a plan IS mutable — it moves through a state machine (draft →
// estimated → awaiting_approval → approved). Every write is staged and
// atomically renamed so a concurrent reader never sees a partial plan, and
// every transition appends an activity event rather than overwriting history.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { isValidPlanId } from './assetPlanRules.js';

export const ASSET_PLAN_DIR = path.join(process.cwd(), 'data', 'asset-plans');

export function generatePlanId() {
  return `aplan-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function planPath(planId) {
  if (!isValidPlanId(planId)) {
    const err = new Error('Invalid asset plan id.');
    err.code = 'invalid_id';
    throw err;
  }
  const resolved = path.resolve(ASSET_PLAN_DIR, `${planId}.json`);
  if (path.dirname(resolved) !== path.resolve(ASSET_PLAN_DIR)) {
    const err = new Error('Refusing an asset plan path that escapes its directory.');
    err.code = 'traversal_rejected';
    throw err;
  }
  return resolved;
}

/** Atomic write: stage to a dot-prefixed temp file, then rename. */
export function savePlan(plan) {
  let target;
  try { target = planPath(plan.planId); } catch (err) { return { ok: false, error: err.message }; }

  const staging = path.join(ASSET_PLAN_DIR, `.tmp-${plan.planId}-${crypto.randomBytes(4).toString('hex')}`);
  try {
    fs.mkdirSync(ASSET_PLAN_DIR, { recursive: true });
    fs.writeFileSync(staging, JSON.stringify({ ...plan, updatedAt: new Date().toISOString() }, null, 2), { encoding: 'utf-8', flag: 'wx' });
    fs.renameSync(staging, target);
  } catch (err) {
    try { fs.rmSync(staging, { force: true }); } catch { /* ignore */ }
    return { ok: false, error: `Could not persist asset plan: ${err.message}` };
  }
  return { ok: true, plan: getPlan(plan.planId) };
}

export function getPlan(planId) {
  try { return JSON.parse(fs.readFileSync(planPath(planId), 'utf-8')); } catch { return null; }
}

export function listPlans({ packageId, status } = {}) {
  if (!fs.existsSync(ASSET_PLAN_DIR)) return [];
  return fs.readdirSync(ASSET_PLAN_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('.'))
    .map(f => { try { return JSON.parse(fs.readFileSync(path.join(ASSET_PLAN_DIR, f), 'utf-8')); } catch { return null; } })
    .filter(Boolean)
    .filter(p => !packageId || p.packageId === packageId)
    .filter(p => !status || p.status === status)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * The live plan for a URS, if one exists.
 *
 * "One plan per exact URS content hash" is enforced by reusing an existing
 * non-terminal plan for the same renderSpecId rather than minting a second —
 * two live plans for one URS would mean two competing approvals.
 */
export function findLivePlanForSpec(renderSpecId) {
  return listPlans().find(p => p.renderSpecId === renderSpecId && !['rejected', 'invalidated'].includes(p.status)) || null;
}
