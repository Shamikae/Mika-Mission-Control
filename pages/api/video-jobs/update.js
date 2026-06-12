// POST /api/video-jobs/update
// Updates status, outputUrl, or notes on an existing video job.
// Status transitions: pending → approved → rendering → complete | failed → archived

import fs   from 'fs';
import path from 'path';

const DATA_FILE    = path.join(process.cwd(), 'data', 'video-jobs.json');
const VALID_STATUS = ['pending', 'approved', 'rendering', 'complete', 'failed', 'archived'];

function readStore()       { try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return { jobs: [] }; } }
function writeStore(store) { fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2)); }

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { jobId, status, outputUrl, notes } = req.body || {};

  if (!jobId) return res.status(400).json({ error: 'jobId is required' });
  if (status !== undefined && !VALID_STATUS.includes(status)) {
    return res.status(400).json({ error: `Invalid status "${status}". Valid: ${VALID_STATUS.join(', ')}` });
  }

  const store = readStore();
  const idx   = store.jobs.findIndex(j => j.jobId === jobId);
  if (idx === -1) return res.status(404).json({ error: `Job ${jobId} not found` });

  const patch = { updatedAt: new Date().toISOString() };
  if (status    !== undefined) patch.status    = status;
  if (outputUrl !== undefined) patch.outputUrl = outputUrl;
  if (notes     !== undefined) patch.notes     = notes;

  store.jobs[idx] = { ...store.jobs[idx], ...patch };
  writeStore(store);

  return res.status(200).json({ ok: true, job: store.jobs[idx] });
}
