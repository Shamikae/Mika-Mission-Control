// lib/production/audio/narrationStore.js
// SERVER-SIDE ONLY (filesystem). Mirrors the shape of the other fs-backed
// stores in this project (productionJobStore / hyperframesRunStore): one JSON
// record per narration, plus the generated audio file beside it.
//
// Records never contain a credential, an absolute path, or a raw provider
// argument — `localPathInternal` is stored PROJECT-RELATIVE and is never
// returned to the browser by any API.

import fs from 'fs';
import path from 'path';

export const NARRATION_DIR = path.join(process.cwd(), 'data', 'narration');
export const NARRATION_AUDIO_DIR = path.join(NARRATION_DIR, 'audio');

// Audio ids are filesystem names — strict allowlist, no separators, no dots,
// so a traversal sequence is impossible by construction (same discipline as
// hyperframesSecurity.js's composition ids).
const SAFE_AUDIO_ID_RE = /^[a-zA-Z0-9_-]{1,100}$/;

export function isValidAudioId(id) {
  return typeof id === 'string' && SAFE_AUDIO_ID_RE.test(id);
}

function ensureDirs() {
  fs.mkdirSync(NARRATION_AUDIO_DIR, { recursive: true });
}

/**
 * Resolves an audio id to its validated absolute file path. Throws rather
 * than silently falling back, and refuses anything that escapes the audio
 * directory even after resolution.
 */
export function resolveNarrationAudioPath(audioId, filename = 'narration.wav') {
  if (!isValidAudioId(audioId)) {
    const err = new Error('Invalid narration audio id.');
    err.code = 'invalid_id';
    throw err;
  }
  if (typeof filename !== 'string' || !filename || filename.includes('..') || filename.includes('/') || filename.includes('\\') || path.isAbsolute(filename)) {
    const err = new Error('Invalid narration filename.');
    err.code = 'invalid_path';
    throw err;
  }
  const dir = path.join(NARRATION_AUDIO_DIR, audioId);
  const resolved = path.resolve(dir, filename);
  if (!resolved.startsWith(dir + path.sep)) {
    const err = new Error('Refusing a narration path that escapes the narration directory.');
    err.code = 'traversal_rejected';
    throw err;
  }
  return resolved;
}

function recordPath(audioId) {
  if (!isValidAudioId(audioId)) {
    const err = new Error('Invalid narration audio id.');
    err.code = 'invalid_id';
    throw err;
  }
  return path.join(NARRATION_DIR, `${audioId}.json`);
}

export function getNarrationRecord(audioId) {
  try {
    return JSON.parse(fs.readFileSync(recordPath(audioId), 'utf-8'));
  } catch { return null; }
}

export function saveNarrationRecord(record) {
  ensureDirs();
  fs.writeFileSync(recordPath(record.audioId), JSON.stringify(record, null, 2), 'utf-8');
  return record;
}

/** True when both the record AND its audio file are present and non-empty. */
export function narrationAssetExists(audioId, filename = 'narration.wav') {
  try {
    const p = resolveNarrationAudioPath(audioId, filename);
    return fs.existsSync(p) && fs.statSync(p).size > 0;
  } catch { return false; }
}

export function ensureNarrationAudioDir(audioId) {
  if (!isValidAudioId(audioId)) {
    const err = new Error('Invalid narration audio id.');
    err.code = 'invalid_id';
    throw err;
  }
  const dir = path.join(NARRATION_AUDIO_DIR, audioId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function listNarrationRecords() {
  if (!fs.existsSync(NARRATION_DIR)) return [];
  return fs.readdirSync(NARRATION_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => getNarrationRecord(f.replace(/\.json$/, '')))
    .filter(Boolean);
}
