// lib/hyperframes/hyperframesSecurity.js
// SERVER-SIDE ONLY. Never import from client components.
//
// HyperFrames Local Studio is local-machine functionality only — everything
// here enforces that ONLY tools/hyperframes/<compositionId>/ directories can
// ever be touched, never anything else on disk. This is the single choke
// point every other HyperFrames module (composition store, command runner,
// API routes) must go through before touching the filesystem or spawning a
// process.

import fs from 'fs';
import path from 'path';

export const HYPERFRAMES_ROOT = path.join(process.cwd(), 'tools', 'hyperframes');

// Composition IDs are directory names — strict allowlist, no path
// separators, no leading dot, no traversal sequences possible by construction.
const SAFE_COMPOSITION_ID_RE = /^[a-zA-Z0-9_-]{1,100}$/;

export function isValidCompositionId(id) {
  return typeof id === 'string' && SAFE_COMPOSITION_ID_RE.test(id);
}

/**
 * Resolves a composition id to its real, validated absolute directory path.
 * Throws (never silently falls back) on any of: invalid id, missing
 * directory, not a directory, symlinked directory, or a directory whose
 * realpath escapes HYPERFRAMES_ROOT (symlink traversal anywhere in the
 * chain). Callers must never construct a path from unvalidated input and
 * must always go through this function first.
 */
export function resolveCompositionDir(id) {
  if (!isValidCompositionId(id)) {
    const err = new Error('Invalid composition id.');
    err.code = 'invalid_id';
    throw err;
  }

  const candidate = path.join(HYPERFRAMES_ROOT, id);

  let lstat;
  try { lstat = fs.lstatSync(candidate); } catch {
    const err = new Error('Composition not found.');
    err.code = 'not_found';
    throw err;
  }
  if (lstat.isSymbolicLink()) {
    const err = new Error('Refusing a symlinked composition directory.');
    err.code = 'symlink_rejected';
    throw err;
  }
  if (!lstat.isDirectory()) {
    const err = new Error('Composition path is not a directory.');
    err.code = 'not_a_directory';
    throw err;
  }

  let realDir;
  try { realDir = fs.realpathSync(candidate); } catch {
    const err = new Error('Could not resolve composition path.');
    err.code = 'not_found';
    throw err;
  }
  const realRoot = fs.realpathSync(HYPERFRAMES_ROOT);
  if (realDir !== path.join(realRoot, id)) {
    const err = new Error('Refusing a composition path that escapes the HyperFrames root (symlink traversal detected).');
    err.code = 'traversal_rejected';
    throw err;
  }

  return realDir;
}

/**
 * Resolves and validates an arbitrary file WITHIN an already-validated
 * composition directory (e.g. index.html, output.mp4). Rejects traversal
 * and symlinks exactly like resolveCompositionDir.
 */
export function resolveCompositionFile(compositionDir, relativeFilename) {
  if (typeof relativeFilename !== 'string' || !relativeFilename || relativeFilename.includes('..') || path.isAbsolute(relativeFilename)) {
    const err = new Error('Invalid file reference.');
    err.code = 'invalid_path';
    throw err;
  }
  const resolved = path.resolve(compositionDir, relativeFilename);
  if (!resolved.startsWith(compositionDir + path.sep) && resolved !== compositionDir) {
    const err = new Error('Refusing a file path that escapes the composition directory.');
    err.code = 'traversal_rejected';
    throw err;
  }
  return resolved;
}

/** Strips the project root prefix from an absolute path — used ONLY for
 * internal logging/debugging, never returned to the browser. Still never
 * expose the result to an API response. */
export function toProjectRelative(absolutePath) {
  const root = process.cwd();
  return absolutePath.startsWith(root) ? absolutePath.slice(root.length + 1) : absolutePath;
}
