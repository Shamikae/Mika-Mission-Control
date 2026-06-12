// POST /api/video-jobs/create
// Creates a staged video production job.
// No API call is made to any video provider — job status starts as "pending"
// and requires explicit human approval before any provider action.

import fs   from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';

const DATA_FILE = path.join(process.cwd(), 'data', 'video-jobs.json');

function readStore()       { try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return { jobs: [] }; } }
function writeStore(store) { fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2)); }

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    workflowId, laneId, sourceArtifact, promptPackPath,
    provider, providerDisplayName, contentFormat, budgetMode,
    title, notes,
  } = req.body || {};

  if (!provider) return res.status(400).json({ error: 'provider is required' });
  if (!laneId)   return res.status(400).json({ error: 'laneId is required' });

  const now = new Date().toISOString();
  const job = {
    jobId:               `vj-${Date.now()}-${randomBytes(3).toString('hex')}`,
    workflowId:          workflowId          || null,
    laneId,
    sourceArtifact:      sourceArtifact      || 'visual_prompting',
    promptPackPath:      promptPackPath       || null,
    provider,
    providerDisplayName: providerDisplayName || provider,
    contentFormat:       contentFormat       || 'short-form',
    budgetMode:          budgetMode          || 'balanced',
    title:               title?.trim()       || `${providerDisplayName || provider} — ${contentFormat || 'video'}`,
    status:              'pending',
    approvalRequired:    true,
    outputUrl:           null,
    notes:               notes || '',
    createdAt:           now,
    updatedAt:           now,
  };

  const store = readStore();
  store.jobs.push(job);
  writeStore(store);

  return res.status(200).json({ ok: true, job });
}
