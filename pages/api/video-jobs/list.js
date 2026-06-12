// GET /api/video-jobs/list
// Returns staged video production jobs.
// Optional query filters: ?status=pending&provider=heygen&laneId=ai-twin

import fs   from 'fs';
import path from 'path';

const DATA_FILE = path.join(process.cwd(), 'data', 'video-jobs.json');

function readJobs() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')).jobs || []; }
  catch { return []; }
}

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { status, provider, laneId } = req.query;

  const all = readJobs();
  let jobs  = all;
  if (status)   jobs = jobs.filter(j => j.status   === status);
  if (provider) jobs = jobs.filter(j => j.provider === provider);
  if (laneId)   jobs = jobs.filter(j => j.laneId   === laneId);

  const summary = {
    total:     all.length,
    pending:   all.filter(j => j.status === 'pending').length,
    approved:  all.filter(j => j.status === 'approved').length,
    rendering: all.filter(j => j.status === 'rendering').length,
    complete:  all.filter(j => j.status === 'complete').length,
    failed:    all.filter(j => j.status === 'failed').length,
    archived:  all.filter(j => j.status === 'archived').length,
  };

  return res.status(200).json({ jobs, summary, total: all.length });
}
