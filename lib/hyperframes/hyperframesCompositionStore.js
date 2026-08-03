// lib/hyperframes/hyperframesCompositionStore.js
// SERVER-SIDE ONLY. Never import from client components.
//
// Read-only discovery of local HyperFrames compositions under
// tools/hyperframes/. Never returns an absolute filesystem path — only
// sanitized metadata safe for the browser.

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { HYPERFRAMES_ROOT, resolveCompositionDir, resolveCompositionFile } from './hyperframesSecurity.js';

const execFileAsync = promisify(execFile);
const OUTPUT_FILENAME = 'output.mp4';

/**
 * A composition directory is valid when it's a real (non-symlink) directory
 * directly under HYPERFRAMES_ROOT containing index.html. package.json/
 * hyperframes.json/meta.json are optional extras, never required.
 */
function isValidCompositionEntry(entry) {
  return entry.isDirectory() && !entry.isSymbolicLink();
}

async function probeOutputVideo(filePath) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,r_frame_rate',
      '-show_entries', 'format=duration',
      '-of', 'json',
      filePath,
    ], { timeout: 10_000 });
    const parsed = JSON.parse(stdout);
    const stream = parsed.streams?.[0] || {};
    const format = parsed.format || {};
    let fps = null;
    if (typeof stream.r_frame_rate === 'string' && stream.r_frame_rate.includes('/')) {
      const [num, den] = stream.r_frame_rate.split('/').map(Number);
      if (den) fps = Math.round((num / den) * 100) / 100;
    }
    return {
      width: typeof stream.width === 'number' ? stream.width : null,
      height: typeof stream.height === 'number' ? stream.height : null,
      durationSeconds: format.duration ? Math.round(Number(format.duration) * 100) / 100 : null,
      fps,
    };
  } catch {
    // ffprobe not installed, or the file isn't a valid video — honest nulls,
    // never fabricated metadata.
    return { width: null, height: null, durationSeconds: null, fps: null };
  }
}

function readMetaJson(dir) {
  try {
    const metaPath = resolveCompositionFile(dir, 'meta.json');
    if (!fs.existsSync(metaPath)) return null;
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  } catch { return null; }
}

function readPackageJsonPin(dir) {
  try {
    const pkgPath = resolveCompositionFile(dir, 'package.json');
    if (!fs.existsSync(pkgPath)) return null;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const scripts = pkg.scripts || {};
    const anyScript = Object.values(scripts).find(s => typeof s === 'string' && /hyperframes@[\d.]+/.test(s));
    const match = anyScript && anyScript.match(/hyperframes@([\d.]+)/);
    return match ? match[1] : null;
  } catch { return null; }
}

/**
 * @returns {Promise<object|null>} sanitized composition summary, or null if
 * the id is invalid/missing/not-a-real-composition.
 */
export async function getHyperFramesComposition(id) {
  let dir;
  try { dir = resolveCompositionDir(id); } catch { return null; }

  const indexPath = resolveCompositionFile(dir, 'index.html');
  const hasIndexHtml = fs.existsSync(indexPath);
  if (!hasIndexHtml) return null;

  const outputPath = resolveCompositionFile(dir, OUTPUT_FILENAME);
  const hasOutputMp4 = fs.existsSync(outputPath);
  let outputSizeBytes = null;
  let modifiedAt = null;
  let metadata = { width: null, height: null, durationSeconds: null, fps: null };

  if (hasOutputMp4) {
    const stat = fs.statSync(outputPath);
    outputSizeBytes = stat.size;
    modifiedAt = stat.mtime.toISOString();
    metadata = await probeOutputVideo(outputPath);
  } else {
    try { modifiedAt = fs.statSync(indexPath).mtime.toISOString(); } catch { /* ignore */ }
  }

  const meta = readMetaJson(dir);
  const cliVersionPin = readPackageJsonPin(dir);

  return {
    id,
    name: meta?.name || id,
    relativePath: `tools/hyperframes/${id}`, // relative, never absolute
    hasIndexHtml,
    hasOutputMp4,
    outputSizeBytes,
    modifiedAt,
    cliVersionPin,
    metadata,
  };
}

export async function listHyperFramesCompositions() {
  if (!fs.existsSync(HYPERFRAMES_ROOT)) return [];
  const entries = fs.readdirSync(HYPERFRAMES_ROOT, { withFileTypes: true }).filter(isValidCompositionEntry);
  const results = [];
  for (const entry of entries) {
    const comp = await getHyperFramesComposition(entry.name);
    if (comp) results.push(comp);
  }
  return results.sort((a, b) => new Date(b.modifiedAt || 0) - new Date(a.modifiedAt || 0));
}
