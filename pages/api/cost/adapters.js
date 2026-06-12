// GET /api/cost/adapters
// Returns cost breakdown per adapter: executions, estimated cost, projected monthly cost.

import fs   from 'fs';
import path from 'path';
import { estimateAdapterCost, ADAPTER_COST_MODEL } from '../../../lib/cost/costEngine';

const ROOT = process.cwd();

function readJson(fp, fb) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return fb; }
}

function buildAgentAdapterMap(agents) {
  const map = {};
  for (const a of agents) map[a.id] = { adapterId: a.adapterId, displayName: a.displayName, department: a.department, status: a.status };
  return map;
}

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const log    = readJson(path.join(ROOT, 'logs', 'dispatch-log.json'), []);
  const raw    = readJson(path.join(ROOT, 'agents', 'agent-registry.json'), []);
  const agents = Array.isArray(raw) ? raw : (raw.agents || []);
  const map    = buildAgentAdapterMap(agents);

  const allAdapterIds = Object.keys(ADAPTER_COST_MODEL);
  const byAdapter = allAdapterIds.map(id => estimateAdapterCost(id, log, map))
    .sort((a, b) => b.estimatedCostTotal - a.estimatedCostTotal);

  return res.status(200).json({ adapters: byAdapter, count: byAdapter.length, generatedAt: new Date().toISOString() });
}
