// GET /api/cost/agents
// Returns cost breakdown per agent: dispatch count, estimated cost, avg cost.

import fs   from 'fs';
import path from 'path';
import { estimateAgentCost } from '../../../lib/cost/costEngine';

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

  // Compute for all known agent IDs (registry + seen in dispatch log)
  const seen     = new Set([...agents.map(a => a.id), ...log.map(r => r.selectedAgentId).filter(Boolean)]);
  const byAgent  = [...seen].map(id => estimateAgentCost(id, log, map))
    .sort((a, b) => b.estimatedCostTotal - a.estimatedCostTotal);

  return res.status(200).json({ agents: byAgent, count: byAgent.length, generatedAt: new Date().toISOString() });
}
