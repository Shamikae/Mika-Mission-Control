// GET /api/executive/activity?limit=20
// Aggregates recent AI activity from dispatch log, tasks, artifacts, and memory.

import fs   from 'fs';
import path from 'path';

const ROOT = process.cwd();

function readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function recentMemoryWrites() {
  const memDir = path.join(ROOT, 'memory');
  const entries = [];
  try {
    const files = fs.readdirSync(memDir).filter(f => f.endsWith('.json'));
    for (const f of files) {
      const lane = f.replace('.json', '');
      const records = readJson(path.join(memDir, f), []);
      if (Array.isArray(records)) {
        records.slice(-3).forEach(r => entries.push({
          type:   'memory',
          ts:     r.timestamp,
          title:  `Memory write — ${lane}`,
          detail: r.summary || r.taskType || '(no summary)',
          lane,
        }));
      }
    }
  } catch {}
  return entries;
}

function recentArtifacts() {
  const base = path.join(ROOT, 'content-artifacts');
  const entries = [];
  try {
    const lanes = fs.readdirSync(base);
    for (const lane of lanes) {
      const laneDir = path.join(base, lane);
      if (!fs.statSync(laneDir).isDirectory()) continue;
      for (const wfId of fs.readdirSync(laneDir)) {
        const meta = readJson(path.join(laneDir, wfId, 'metadata.json'), null);
        if (!meta) continue;
        (meta.stagesCompleted || []).forEach(stage => {
          entries.push({
            type:   'artifact',
            ts:     meta.updatedAt || meta.createdAt,
            title:  `Artifact generated — ${stage.replace(/_/g, ' ')}`,
            detail: `Workflow: ${wfId} · Lane: ${lane}`,
            lane,
            workflowId: wfId,
          });
        });
      }
    }
  } catch {}
  return entries;
}

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const limit = Math.min(parseInt(req.query.limit) || 20, 50);

  const tasks       = readJson(path.join(ROOT, 'data', 'tasks.json'), []);
  const dispatchLog = readJson(path.join(ROOT, 'logs', 'dispatch-log.json'), []);

  const activity = [];

  // Dispatch events
  dispatchLog.slice(-15).forEach(d => activity.push({
    type:   'dispatch',
    ts:     d.timestamp,
    title:  `Dispatched — ${d.taskType || d.taskId}`,
    detail: d.executionStatus
      ? `${d.executionTarget || d.selectedAgentId} · ${d.executionStatus}`
      : `Routed → ${d.selectedAgentId || 'unassigned'} · ${d.executableNow ? 'executable' : 'staged'}`,
    lane:   d.laneId,
    status: d.executionStatus || (d.executableNow ? 'routed' : 'staged'),
    id:     d.taskId,
  }));

  // Completed tasks with AI output
  tasks
    .filter(t => t.status === 'complete' && t.completedAt)
    .slice(-10)
    .forEach(t => activity.push({
      type:   'task-complete',
      ts:     t.completedAt,
      title:  t.title || t.taskType || 'Task completed',
      detail: t.openclawReply
        ? t.openclawReply.slice(0, 140) + (t.openclawReply.length > 140 ? '…' : '')
        : 'Completed without output',
      lane:   t.lane,
      status: 'complete',
      id:     t.id,
    }));

  // Memory writes
  recentMemoryWrites().forEach(m => activity.push(m));

  // Artifact generations
  recentArtifacts().forEach(a => activity.push(a));

  // Sort by timestamp descending, dedupe by id
  const seen = new Set();
  const sorted = activity
    .filter(a => {
      if (!a.ts) return true;
      const key = a.id || `${a.type}:${a.ts}:${a.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const ta = a.ts ? new Date(a.ts).getTime() : 0;
      const tb = b.ts ? new Date(b.ts).getTime() : 0;
      return tb - ta;
    })
    .slice(0, limit);

  return res.status(200).json({ generatedAt: new Date().toISOString(), activity: sorted });
}
