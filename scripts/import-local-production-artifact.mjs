#!/usr/bin/env node
// scripts/import-local-production-artifact.mjs
//
// Imports a REAL, ALREADY-RENDERED local file (video/image/audio-adjacent
// document types already governed by the Provider Execution Engine's own
// artifact allowlist) into Mika Mission Control's existing secure artifact
// storage, and creates one honestly-labeled, already-`completed` Production
// Job so it shows up in Studio → Production Router / the Universal Output
// Viewer — WITHOUT pretending it was ever routed through the Provider
// Execution Engine or any real provider adapter.
//
// Reuses (imports directly, unmodified):
//   - lib/production/execution/productionArtifactStore.js (saveProductionArtifact)
//   - lib/production/execution/executionRules.js (MIME allowlist, size limits)
// Both live under lib/production/execution/, which already has its own
// {"type":"module"} scoping (see lib/production/execution/package.json) —
// safe to import directly via plain `node`.
//
// Does NOT import lib/production/productionJobStore.js or
// lib/content/contentPackageStore.js or lib/production/buildProductionPlan.js
// directly — those live in lib/production/ and lib/content/, which are
// NOT ESM-scoped, and (unlike lib/production/execution/*) their own
// relative imports omit file extensions (e.g. `from './productionRules'`),
// which Node's native ESM resolver requires — scoping those directories
// would break under plain `node` without also rewriting every import in
// them, which is out of scope here. Instead, this script replicates their
// exact, simple, already-proven file conventions inline (same directory,
// same JSON shape, same atomic-write pattern for jobs, same plain-write
// pattern for packages) — see the comments at each write site.
//
// Never persists the absolute (or even relative) source file path into any
// job/package/API-visible record — only a content hash (for idempotency)
// and the declared filename survive.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  isAllowedArtifactMime, maxBytesForMime, ARTIFACT_MIME_ALLOWLIST,
} from '../lib/production/execution/executionRules.js';
import { saveProductionArtifact } from '../lib/production/execution/productionArtifactStore.js';

const ROOT = process.cwd();
const JOB_DIR = path.join(ROOT, 'data', 'production-jobs');
const PKG_DIR = path.join(ROOT, 'data', 'content-packages');

// ── CLI args ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { out[key] = true; }
    else { out[key] = next; i++; }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

if (!args.file) fail('--file is required (path to the local artifact, relative to the project root).');

const provider = typeof args.provider === 'string' && args.provider.trim() ? args.provider.trim().slice(0, 60) : 'local-import';
const title = typeof args.title === 'string' && args.title.trim() ? args.title.trim().slice(0, 150) : 'Local Import';
const mode = typeof args.mode === 'string' && args.mode.trim() ? args.mode.trim() : 'custom';
const durationSeconds = args.duration !== undefined ? Number(args.duration) : null;
const width = args.width !== undefined ? Number(args.width) : null;
const height = args.height !== undefined ? Number(args.height) : null;
const fps = args.fps !== undefined ? Number(args.fps) : null;

// ── 1. Source validation ────────────────────────────────────────────────
// Exists, is a REGULAR file (never a directory or special file), cannot
// escape the project root (no path-traversal), and is never reached
// through a symlink anywhere in its path (realpath must exactly match the
// resolved path — a mismatch means a symlink was involved somewhere).

const requestedPath = String(args.file);
const resolvedPath = path.resolve(ROOT, requestedPath);

if (!resolvedPath.startsWith(ROOT + path.sep)) {
  fail(`Refusing to import a file outside the project root: "${requestedPath}"`);
}
if (!fs.existsSync(resolvedPath)) {
  fail(`Source file does not exist: "${requestedPath}"`);
}

const lstat = fs.lstatSync(resolvedPath);
if (lstat.isSymbolicLink()) {
  fail('Refusing to import a symlink directly.');
}
if (!lstat.isFile()) {
  fail('Source path is not a regular file.');
}

let realPath;
try { realPath = fs.realpathSync(resolvedPath); } catch { fail('Could not resolve the real path of the source file.'); }
if (realPath !== resolvedPath) {
  fail('Refusing to import — a symlink was detected somewhere in the source path (realpath does not match the resolved path).');
}

const stat = fs.statSync(resolvedPath);
const buffer = fs.readFileSync(resolvedPath);

// ── MIME sniffing — verifies the ACTUAL file signature, never trusts the
// extension alone (same principle the Universal Output Viewer's
// normalizeArtifact applies client-side: never trust a filename). ────────

function sniffMime(buf) {
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4';
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video/webm';
  if (buf.length >= 8 && buf.toString('hex', 0, 8) === '89504e470d0a1a0a') return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  const text = buf.slice(0, Math.min(buf.length, 4096)).toString('utf8').trim();
  if (text.startsWith('{') || text.startsWith('[')) {
    try { JSON.parse(buf.toString('utf8')); return 'application/json'; } catch { /* not valid JSON after all */ }
  }
  return null;
}

const sniffedMime = sniffMime(buffer);
const ext = path.extname(resolvedPath).slice(1).toLowerCase();
const extMimeGuess = Object.entries(ARTIFACT_MIME_ALLOWLIST).find(([, v]) => v.ext === ext)?.[0] || null;

// Markdown has no reliable magic-byte signature — accept it only via
// extension, and only after confirming the content decodes as plain UTF-8
// text (rejects e.g. a renamed binary file).
let mimeType = sniffedMime;
if (!mimeType && ext === 'md') {
  const decoded = buffer.toString('utf8');
  const reEncoded = Buffer.from(decoded, 'utf8');
  if (reEncoded.equals(buffer)) mimeType = 'text/markdown';
}

if (!mimeType) fail(`Could not verify the file's actual type from its content (extension was ".${ext}"). Refusing to guess from the filename alone.`);
if (extMimeGuess && extMimeGuess !== mimeType) {
  fail(`File extension (".${ext}") does not match its actual content (detected as "${mimeType}"). Refusing to import a mismatched/spoofed file.`);
}
if (!isAllowedArtifactMime(mimeType)) {
  fail(`Detected MIME type "${mimeType}" is not in the production artifact allowlist (${Object.keys(ARTIFACT_MIME_ALLOWLIST).join(', ')}).`);
}

const maxBytes = maxBytesForMime(mimeType);
if (stat.size > maxBytes) {
  fail(`File is ${stat.size} bytes, exceeding the allowed maximum of ${maxBytes} bytes for ${mimeType}.`);
}

console.log(`Source validated: real ${mimeType} file, ${stat.size} bytes, no symlinks, within project root.`);

// ── 2. Content hash — for idempotency, never for path exposure ─────────

const sourceHash = crypto.createHash('sha256').update(buffer).digest('hex');
console.log(`Content hash: ${sourceHash.slice(0, 16)}…`);

// ── 3. Idempotency — has this exact content already been imported? ─────

function ensureDirs() {
  fs.mkdirSync(JOB_DIR, { recursive: true });
  fs.mkdirSync(PKG_DIR, { recursive: true });
}
ensureDirs();

function listLocalImportJobs() {
  return fs.readdirSync(JOB_DIR)
    .filter(f => f.endsWith('.json') && !f.includes('.tmp'))
    .map(f => { try { return JSON.parse(fs.readFileSync(path.join(JOB_DIR, f), 'utf-8')); } catch { return null; } })
    .filter(j => j && j.metadata?.isLocalRender === true);
}

const existing = listLocalImportJobs().find(j => j.metadata?.sourceHash === sourceHash);
if (existing) {
  const existingOutput = existing.execution?.outputs?.[0];
  console.log('\nAlready imported — reporting the existing job/artifact instead of creating a duplicate.');
  console.log(JSON.stringify({
    ok: true,
    alreadyImported: true,
    productionJobId: existing.id,
    artifactId: existingOutput?.id || null,
    localUrl: existingOutput?.artifactUrl || null,
  }, null, 2));
  process.exit(0);
}

// ── 4. Ingest via the EXISTING, unmodified artifact-storage abstraction ──
// (never a manual fs.copyFile into some ad-hoc folder)

const brand = 'LocalImport';
const jobId = `pr-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`; // same format as productionJobStore.js's generateJobId()

const saved = saveProductionArtifact({
  brand,
  productionJobId: jobId,
  buffer,
  mimeType,
  filename: path.basename(resolvedPath), // display filename only — never a path
});

console.log(`Artifact ingested: ${saved.id} (${saved.sizeBytes} bytes) -> ${saved.artifactUrl}`);

// ── 5. Package — one per import, deterministic id from the content hash so
// re-running against the same file is idempotent at the package level too.
// Written with the SAME plain-writeFileSync convention as
// lib/content/contentPackageStore.js's savePackage() (that store has no
// atomic-write upgrade, unlike the job store below — matched exactly, not
// "improved," to stay consistent with every other package on disk).

const packageId = `pack-local-import-${sourceHash.slice(0, 16)}`;
const packagePath = path.join(PKG_DIR, `${packageId}.json`);
const now = new Date().toISOString();

let pkg = fs.existsSync(packagePath) ? JSON.parse(fs.readFileSync(packagePath, 'utf-8')) : null;
if (!pkg) {
  pkg = {
    id: packageId,
    status: 'approved',
    brand: 'Local Import',
    platform: 'Local',
    goal: 'Local render import',
    topic: title,
    audience: '', offer: '', tone: '', videoDuration: durationSeconds ? `${durationSeconds}s` : '',
    hooks: [],
    script: { opening: '', body: '', cta: '', fullText: `Locally imported render: ${title}. Not a Production Router-authored script.` },
    scenes: [{ order: 1, durationSeconds: durationSeconds || 0, visual: title, voiceover: '', onScreenText: '' }],
    caption: '', cta: '', hashtags: [], keywords: [],
    thumbnail: { headline: title, visualBrief: '', artifactId: null, artifactUrl: null, status: 'not_requested', error: null },
    pipeline: { stage: 'approved', enteredStageAt: now, history: [{ stage: 'approved', at: now, actor: 'system', note: 'Created automatically for a local artifact import.' }] },
    metadata: { workflowId: packageId, model: null, provider: 'local-import', createdAt: now, updatedAt: now, estimatedCost: null, actualCost: null, instructions: '' },
    production: null,
  };
  fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2));
  console.log(`Package created: ${packageId}`);
} else {
  console.log(`Reusing existing package: ${packageId}`);
}

// ── 6. Production Job — honestly labeled, already `completed`, never
// claiming Provider Execution Engine involvement. Written with the SAME
// atomic temp-write-then-rename convention as
// lib/production/productionJobStore.js's writeJobFile() — matched exactly.

const activity = (type, note) => ({ type, at: new Date().toISOString(), actor: 'system', note, metadata: null });

function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
function simplifiedAspectRatio(w, h) {
  if (!w || !h) return 'Not specified';
  const d = gcd(w, h) || 1;
  return `${w / d}:${h / d}`;
}

const job = {
  id: jobId,
  packageId,
  packageUpdatedAt: pkg.metadata.updatedAt,
  stalePackage: false,
  status: 'completed',
  eligibility: { eligible: true, reasons: [] },
  recommendedMode: mode,
  selectedMode: mode,
  modeReason: 'Locally imported render — mode is informational only; this job was never planned through Production Router\'s recommendation engine.',
  recommendedProvider: provider,
  selectedProvider: provider,
  providerInput: null,
  preferredFutureProvider: null,
  providerCandidates: [],
  unavailableReasons: {},
  missingActivationRequirements: [],
  readiness: {
    ready: true, score: 100, available: ['script'], missingRequired: [], missingOptional: [],
    warnings: ['This is a locally imported render — it was never planned through Production Router or executed through the Provider Execution Engine.'],
  },
  scenes: null, voiceoverScript: null, captionPlan: null, visualAssetPlan: null, audioPlan: null,
  outputSpec: {
    platform: 'Local', targetDuration: durationSeconds ? `${durationSeconds}s` : 'Not specified',
    aspectRatio: simplifiedAspectRatio(width, height),
    resolution: (width && height) ? `${width}x${height}` : 'Not specified',
    frameRate: fps || null, captionBurnIn: false, safeAreaNotes: 'Not applicable — locally imported render.', fileFormat: ARTIFACT_MIME_ALLOWLIST[mimeType]?.ext || null,
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
    // Task-required local-import metadata:
    source: 'local-hyperframes-cli',
    isLocalRender: true,
    isProviderExecution: false,
    durationSeconds, width, height, fps,
    // Extra field needed for idempotency (requirement 9) — never a path.
    sourceHash,
  },
  activityHistory: [
    activity('job_created', `Locally imported render: "${title}".`),
    activity('manual_exported', 'Ingested via scripts/import-local-production-artifact.mjs — never routed through the Provider Execution Engine.'),
  ],
  execution: {
    status: 'completed',
    provider,
    providerJobId: null,
    attemptCount: 0,
    maxAttempts: 1,
    startedAt: now, completedAt: now, updatedAt: now,
    cancelledAt: null, lastPollAt: null, nextPollAt: null,
    progress: 100,
    error: null, errorReason: null,
    outputs: [{
      id: saved.id,
      type: ARTIFACT_MIME_ALLOWLIST[mimeType]?.category || 'document',
      mimeType,
      filename: saved.filename,
      sizeBytes: saved.sizeBytes,
      artifactUrl: saved.artifactUrl,
      metadata: { kind: 'local-import', durationSeconds, width, height, fps },
    }],
    providerMetadata: { note: 'Locally imported render — never routed through the Provider Execution Engine.', isLocalRender: true },
    mock: false,
    lock: null,
  },
};

const jobTmpPath = path.join(JOB_DIR, `${jobId}.json.${process.pid}.${Date.now()}.tmp`);
fs.writeFileSync(jobTmpPath, JSON.stringify(job, null, 2));
fs.renameSync(jobTmpPath, path.join(JOB_DIR, `${jobId}.json`));
console.log(`Production Job created: ${jobId}`);

// ── 7. Package backlink — same shape/rule as
// lib/production/buildProductionPlan.js's applyProductionRefToPackage()
// with force:true (this is a brand-new job, so it unconditionally becomes
// the package's latest — matching that function's own documented
// force:true case for "brand-new job creation").

pkg.production = {
  latestJobId: job.id,
  status: job.status,
  selectedMode: job.selectedMode,
  selectedProvider: job.selectedProvider,
  updatedAt: new Date().toISOString(),
};
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2));

console.log('\nImport complete.');
console.log(JSON.stringify({
  ok: true,
  alreadyImported: false,
  productionJobId: job.id,
  packageId,
  artifactId: saved.id,
  localUrl: saved.artifactUrl,
  mimeType,
  sizeBytes: saved.sizeBytes,
}, null, 2));
