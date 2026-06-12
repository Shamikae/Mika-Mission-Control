// GET /api/cost/lanes
// Returns cost breakdown per business lane/project.

import fs   from 'fs';
import path from 'path';
import { estimateLaneCost } from '../../../lib/cost/costEngine';

const ROOT = process.cwd();

function readJson(fp, fb) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return fb; }
}

function buildAgentAdapterMap(agents) {
  const map = {};
  for (const a of agents) map[a.id] = { adapterId: a.adapterId, displayName: a.displayName, department: a.department, status: a.status };
  return map;
}

const ALL_LANES = [
  'digital-diamond', 'managed-by-mika', 'medai', 'cannaops',
  'hotel-hooker', 'ai-twin', 'lead-recovery', null,
];

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const log    = readJson(path.join(ROOT, 'logs', 'dispatch-log.json'), []);
  const raw    = readJson(path.join(ROOT, 'agents', 'agent-registry.json'), []);
  const agents = Array.isArray(raw) ? raw : (raw.agents || []);
  const map    = buildAgentAdapterMap(agents);

  // Include all known lanes + any seen in logs
  const seenLanes = new Set([...log.map(r => r.laneId || 'none')]);
  const allLanes  = new Set([...ALL_LANES.map(l => l || 'none'), ...seenLanes]);

  const byLane = [...allLanes].map(id => estimateLaneCost(id === 'none' ? null : id, log, map))
    .filter(l => l.totalDispatches > 0 || ALL_LANES.includes(l.laneId === 'none' ? null : l.laneId))
    .sort((a, b) => b.estimatedCostTotal - a.estimatedCostTotal);

  return res.status(200).json({ lanes: byLane, count: byLane.length, generatedAt: new Date().toISOString() });
}
