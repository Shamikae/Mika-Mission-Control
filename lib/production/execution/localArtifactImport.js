// lib/production/execution/localArtifactImport.js
// SERVER-SIDE ONLY — uses fs. Import-free of anything outside this directory
// (see lib/production/execution/package.json's {"type":"module"} scoping —
// same reason executionLock.js stays self-contained: this lets
// scripts/import-local-production-artifact.mjs AND HyperFrames Local
// Studio's API routes both import it directly via plain `node`/webpack).
//
// Extracted from scripts/import-local-production-artifact.mjs (Universal
// Output Viewer milestone) so the CLI script and the new HyperFrames
// render-and-import flow share EXACTLY one implementation — never two.
//
// Never persists an absolute (or even relative) source file path — only a
// content hash (idempotency) and a declared filename survive into any
// job/package record.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  isAllowedArtifactMime, maxBytesForMime, ARTIFACT_MIME_ALLOWLIST,
} from './executionRules.js';
import { saveProductionArtifact } from './productionArtifactStore.js';

const JOB_DIR = path.join(process.cwd(), 'data', 'production-jobs');
const PKG_DIR = path.join(process.cwd(), 'data', 'content-packages');

// ── Signature sniffing — never trusts a file extension alone ────────────

export function sniffMimeFromBuffer(buffer) {
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4';
  if (buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return 'video/webm';
  if (buffer.length >= 8 && buffer.toString('hex', 0, 8) === '89504e470d0a1a0a') return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  const text = buffer.slice(0, Math.min(buffer.length, 4096)).toString('utf8').trim();
  if (text.startsWith('{') || text.startsWith('[')) {
    try { JSON.parse(buffer.toString('utf8')); return 'application/json'; } catch { /* not valid JSON */ }
  }
  return null;
}

/**
 * Validates a REAL local source file: exists, regular file, no symlink
 * anywhere in its path, within `allowedRoot`, and its actual content
 * signature matches (or is at least compatible with) its extension.
 *
 * @param {{ absolutePath: string, allowedRoot: string }} args
 * @returns {{ buffer: Buffer, sizeBytes: number, mimeType: string }}
 */
export function validateLocalSourceFile({ absolutePath, allowedRoot }) {
  const resolvedRoot = fs.realpathSync(allowedRoot);
  if (!absolutePath.startsWith(resolvedRoot + path.sep) && absolutePath !== resolvedRoot) {
    const err = new Error('Refusing to import a file outside the allowed local root.');
    err.code = 'outside_root';
    throw err;
  }
  if (!fs.existsSync(absolutePath)) {
    const err = new Error('Source file does not exist.');
    err.code = 'not_found';
    throw err;
  }
  const lstat = fs.lstatSync(absolutePath);
  if (lstat.isSymbolicLink()) {
    const err = new Error('Refusing to import a symlink directly.');
    err.code = 'symlink_rejected';
    throw err;
  }
  if (!lstat.isFile()) {
    const err = new Error('Source path is not a regular file.');
    err.code = 'not_a_file';
    throw err;
  }
  const realPath = fs.realpathSync(absolutePath);
  if (realPath !== absolutePath) {
    const err = new Error('Refusing to import — a symlink was detected somewhere in the source path.');
    err.code = 'symlink_rejected';
    throw err;
  }

  const stat = fs.statSync(absolutePath);
  const buffer = fs.readFileSync(absolutePath);
  const sniffedMime = sniffMimeFromBuffer(buffer);
  const ext = path.extname(absolutePath).slice(1).toLowerCase();
  const extMimeGuess = Object.entries(ARTIFACT_MIME_ALLOWLIST).find(([, v]) => v.ext === ext)?.[0] || null;

  let mimeType = sniffedMime;
  if (!mimeType && ext === 'md') {
    const decoded = buffer.toString('utf8');
    if (Buffer.from(decoded, 'utf8').equals(buffer)) mimeType = 'text/markdown';
  }

  if (!mimeType) {
    const err = new Error(`Could not verify the file's actual type from its content (extension was ".${ext}").`);
    err.code = 'unrecognized_content';
    throw err;
  }
  if (extMimeGuess && extMimeGuess !== mimeType) {
    const err = new Error(`File extension (".${ext}") does not match its actual content (detected as "${mimeType}").`);
    err.code = 'mime_mismatch';
    throw err;
  }
  if (!isAllowedArtifactMime(mimeType)) {
    const err = new Error(`Detected MIME type "${mimeType}" is not in the production artifact allowlist.`);
    err.code = 'mime_not_allowed';
    throw err;
  }
  const maxBytes = maxBytesForMime(mimeType);
  if (stat.size > maxBytes) {
    const err = new Error(`File is ${stat.size} bytes, exceeding the allowed maximum of ${maxBytes} bytes for ${mimeType}.`);
    err.code = 'too_large';
    throw err;
  }

  return { buffer, sizeBytes: stat.size, mimeType };
}

export function computeContentHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** Scans local-import job records for one already matching this content hash. */
export function findExistingLocalImportJob(sourceHash) {
  if (!fs.existsSync(JOB_DIR)) return null;
  const files = fs.readdirSync(JOB_DIR).filter(f => f.endsWith('.json') && !f.includes('.tmp'));
  for (const f of files) {
    try {
      const job = JSON.parse(fs.readFileSync(path.join(JOB_DIR, f), 'utf-8'));
      if (job?.metadata?.isLocalRender === true && job.metadata?.sourceHash === sourceHash) return job;
    } catch { /* skip unreadable */ }
  }
  return null;
}

function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
function simplifiedAspectRatio(w, h) {
  if (!w || !h) return 'Not specified';
  const d = gcd(w, h) || 1;
  return `${w / d}:${h / d}`;
}

/**
 * Idempotent: if a job with this exact content hash already exists, returns
 * it unchanged (never a duplicate). Otherwise ingests the artifact via
 * saveProductionArtifact (never a manual copy) and creates one honestly
 * local-labeled, already-`completed` Production Job + backing package.
 *
 * @returns {{ ok: true, alreadyImported: boolean, productionJobId, packageId, artifactId, localUrl, mimeType, sizeBytes }}
 */
export function createOrReuseLocalImportJob({
  buffer, mimeType, sizeBytes, filename, sourceHash,
  title, brand = 'Local Import', provider, mode = 'custom',
  durationSeconds = null, width = null, height = null, fps = null,
  sourceLabel = 'local-import', metadataSource = 'local-import',
  extraMetadata = {},
}) {
  const existing = findExistingLocalImportJob(sourceHash);
  if (existing) {
    const output = existing.execution?.outputs?.[0];
    return {
      ok: true, alreadyImported: true,
      productionJobId: existing.id, packageId: existing.packageId,
      artifactId: output?.id || null, localUrl: output?.artifactUrl || null,
      mimeType: output?.mimeType || null, sizeBytes: output?.sizeBytes || null,
    };
  }

  fs.mkdirSync(JOB_DIR, { recursive: true });
  fs.mkdirSync(PKG_DIR, { recursive: true });

  const saved = saveProductionArtifact({
    brand: brand.replace(/[^a-zA-Z0-9_-]/g, '') || 'LocalImport',
    productionJobId: `pr-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`, // placeholder dir name; real job id assigned below and matches
    buffer, mimeType, filename,
  });

  const packageId = `pack-local-import-${sourceHash.slice(0, 16)}`;
  const packagePath = path.join(PKG_DIR, `${packageId}.json`);
  const now = new Date().toISOString();

  let pkg = fs.existsSync(packagePath) ? JSON.parse(fs.readFileSync(packagePath, 'utf-8')) : null;
  if (!pkg) {
    pkg = {
      id: packageId, status: 'approved', brand, platform: 'Local', goal: 'Local render import',
      topic: title, audience: '', offer: '', tone: '', videoDuration: durationSeconds ? `${durationSeconds}s` : '',
      hooks: [],
      script: { opening: '', body: '', cta: '', fullText: `Locally imported render: ${title}. Not a Production Router-authored script.` },
      scenes: [{ order: 1, durationSeconds: durationSeconds || 0, visual: title, voiceover: '', onScreenText: '' }],
      caption: '', cta: '', hashtags: [], keywords: [],
      thumbnail: { headline: title, visualBrief: '', artifactId: null, artifactUrl: null, status: 'not_requested', error: null },
      pipeline: { stage: 'approved', enteredStageAt: now, history: [{ stage: 'approved', at: now, actor: 'system', note: 'Created automatically for a local artifact import.' }] },
      metadata: { workflowId: packageId, model: null, provider: metadataSource, createdAt: now, updatedAt: now, estimatedCost: null, actualCost: null, instructions: '' },
      production: null,
    };
    fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2));
  }

  const jobId = saved.productionJobId; // reuse the exact dir name saveProductionArtifact already used
  const activity = (type, note) => ({ type, at: new Date().toISOString(), actor: 'system', note, metadata: null });

  const job = {
    id: jobId, packageId, packageUpdatedAt: pkg.metadata.updatedAt, stalePackage: false, status: 'completed',
    eligibility: { eligible: true, reasons: [] },
    recommendedMode: mode, selectedMode: mode,
    modeReason: 'Locally imported render — mode is informational only; this job was never planned through Production Router\'s recommendation engine.',
    recommendedProvider: provider, selectedProvider: provider,
    providerInput: null, preferredFutureProvider: null, providerCandidates: [], unavailableReasons: {}, missingActivationRequirements: [],
    readiness: {
      ready: true, score: 100, available: ['script'], missingRequired: [], missingOptional: [],
      warnings: ['This is a locally imported render — it was never planned through Production Router or executed through the Provider Execution Engine.'],
    },
    scenes: null, voiceoverScript: null, captionPlan: null, visualAssetPlan: null, audioPlan: null,
    outputSpec: {
      platform: 'Local', targetDuration: durationSeconds ? `${durationSeconds}s` : 'Not specified',
      aspectRatio: simplifiedAspectRatio(width, height),
      resolution: (width && height) ? `${width}x${height}` : 'Not specified',
      frameRate: fps || null, captionBurnIn: false, safeAreaNotes: 'Not applicable — locally imported render.',
      fileFormat: ARTIFACT_MIME_ALLOWLIST[mimeType]?.ext || null,
    },
    budget: {
      estimateType: 'free', estimatedRange: { min: 0, max: 0, currency: 'USD', unit: 'local import — no provider spend' },
      costTier: 'free', approvalRequired: false, approvalReason: 'Local import — no provider API spend, no credentials used.',
      maxEstimatedCost: null, currency: 'USD', approvalRequiredAbove: null,
    },
    approval: { required: false, requestedAt: null, approvedAt: null, approvedBy: null, rejectedAt: null, rejectedBy: null, notes: 'Local import — plan approval does not apply.' },
    review: { status: 'unreviewed', reviewedAt: null, reviewedBy: null, note: '' },
    metadata: {
      createdAt: now, updatedAt: now, createdBy: 'user', userNotes: '',
      source: sourceLabel, isLocalRender: true, isProviderExecution: false,
      durationSeconds, width, height, fps, sourceHash,
      ...extraMetadata,
    },
    activityHistory: [
      activity('job_created', `Locally imported render: "${title}".`),
      activity('manual_exported', `Ingested via ${sourceLabel} — never routed through the Provider Execution Engine.`),
    ],
    execution: {
      status: 'completed', provider, providerJobId: null, attemptCount: 0, maxAttempts: 1,
      startedAt: now, completedAt: now, updatedAt: now, cancelledAt: null, lastPollAt: null, nextPollAt: null, progress: 100,
      error: null, errorReason: null,
      outputs: [{
        id: saved.id,
        type: ARTIFACT_MIME_ALLOWLIST[mimeType]?.category || 'document',
        mimeType, filename: saved.filename, sizeBytes: saved.sizeBytes, artifactUrl: saved.artifactUrl,
        metadata: { kind: 'local-import', durationSeconds, width, height, fps },
      }],
      providerMetadata: { note: 'Locally imported render — never routed through the Provider Execution Engine.', isLocalRender: true },
      mock: false, lock: null,
    },
  };

  const jobTmpPath = path.join(JOB_DIR, `${jobId}.json.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(jobTmpPath, JSON.stringify(job, null, 2));
  fs.renameSync(jobTmpPath, path.join(JOB_DIR, `${jobId}.json`));

  pkg.production = { latestJobId: job.id, status: job.status, selectedMode: job.selectedMode, selectedProvider: job.selectedProvider, updatedAt: new Date().toISOString() };
  fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2));

  return {
    ok: true, alreadyImported: false,
    productionJobId: job.id, packageId, artifactId: saved.id, localUrl: saved.artifactUrl,
    mimeType, sizeBytes: saved.sizeBytes,
  };
}
