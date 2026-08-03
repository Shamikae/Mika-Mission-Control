#!/usr/bin/env node
// scripts/import-local-production-artifact.mjs
//
// Thin CLI wrapper around lib/production/execution/localArtifactImport.js —
// the actual validation/hashing/ingestion/job-creation logic lives there so
// this script and the HyperFrames Local Studio API routes share exactly one
// implementation, never two.
//
// Usage:
//   node scripts/import-local-production-artifact.mjs \
//     --file tools/hyperframes/mika-hyperframes-test/output.mp4 \
//     --provider hyperframes-local \
//     --title "HyperFrames Local Test"
//
// Never persists the absolute (or even relative) source file path into any
// job/package/API-visible record — only a content hash (for idempotency)
// and the declared filename survive.

import fs from 'fs';
import path from 'path';
import {
  validateLocalSourceFile, computeContentHash, createOrReuseLocalImportJob,
} from '../lib/production/execution/localArtifactImport.js';

const ROOT = process.cwd();

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

const requestedPath = String(args.file);
const resolvedPath = path.resolve(ROOT, requestedPath);

if (!resolvedPath.startsWith(ROOT + path.sep)) {
  fail(`Refusing to import a file outside the project root: "${requestedPath}"`);
}

let validated;
try {
  validated = validateLocalSourceFile({ absolutePath: resolvedPath, allowedRoot: ROOT });
} catch (e) {
  fail(e.message);
}

console.log(`Source validated: real ${validated.mimeType} file, ${validated.sizeBytes} bytes, no symlinks, within project root.`);

const sourceHash = computeContentHash(validated.buffer);
console.log(`Content hash: ${sourceHash.slice(0, 16)}…`);

const result = createOrReuseLocalImportJob({
  buffer: validated.buffer, mimeType: validated.mimeType, sizeBytes: validated.sizeBytes,
  filename: path.basename(resolvedPath), sourceHash,
  title, provider, mode, durationSeconds, width, height, fps,
  sourceLabel: 'local-hyperframes-cli', metadataSource: 'local-import',
});

if (result.alreadyImported) {
  console.log('\nAlready imported — reporting the existing job/artifact instead of creating a duplicate.');
} else {
  console.log(`\nArtifact ingested -> ${result.localUrl}`);
  console.log(`Production Job created: ${result.productionJobId}`);
}

console.log(JSON.stringify(result, null, 2));
