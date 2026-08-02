// lib/content/contentPackageStore.js
// SERVER-SIDE ONLY — uses fs.
// One JSON file per package under data/content-packages/<id>.json — same
// convention as lib/workflows/loadViralContentWorkflow.js's workflow-instance
// store. No database added; this is the established file-backed pattern.

import fs from 'fs';
import path from 'path';

const STORE_DIR = path.join(process.cwd(), 'data', 'content-packages');

function ensureDir() {
  if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
}

function fileFor(id) {
  return path.join(STORE_DIR, `${id}.json`);
}

export function savePackage(pkg) {
  ensureDir();
  fs.writeFileSync(fileFor(pkg.id), JSON.stringify(pkg, null, 2));
  return pkg;
}

export function loadPackage(id) {
  try {
    const file = fileFor(id);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Lists all packages, newest first (by metadata.updatedAt).
 */
export function listPackages() {
  ensureDir();
  try {
    return fs.readdirSync(STORE_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(STORE_DIR, f), 'utf-8')); }
        catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.metadata?.updatedAt || 0) - new Date(a.metadata?.updatedAt || 0));
  } catch {
    return [];
  }
}
