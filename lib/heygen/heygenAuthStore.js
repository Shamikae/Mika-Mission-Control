// lib/heygen/heygenAuthStore.js
// SERVER-SIDE ONLY. Never import from client components.
//
// File-backed storage for the HeyGen MCP OAuth session: dynamic client
// registration, tokens, PKCE verifier, CSRF state, discovery cache, and the
// last classified auth error (e.g. domain-not-whitelisted). Lives under
// data/heygen-auth/ — gitignored, never sent in any API response, never
// logged, never shared with the OpenArt auth store (lib/openart/openartAuthStore.js)
// or copied into a Production Job.
//
// Writes are atomic (temp file + rename within the same directory) so a
// reader — or a crashed write — can never observe a partially-written
// session file.

import fs   from 'fs';
import path from 'path';
import crypto from 'crypto';

const AUTH_DIR   = path.join(process.cwd(), 'data', 'heygen-auth');
const STATE_FILE = path.join(AUTH_DIR, 'session.json');

function ensureDir() {
  fs.mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(next) {
  ensureDir();
  const tmpPath = path.join(AUTH_DIR, `.session.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmpPath, STATE_FILE);
  return next;
}

export function getHeyGenAuthState() {
  return readState();
}

export function patchHeyGenAuthState(patch) {
  const next = { ...readState(), ...patch, updatedAt: new Date().toISOString() };
  return writeState(next);
}

export function clearHeyGenAuthState() {
  try {
    fs.rmSync(STATE_FILE, { force: true });
  } catch { /* best-effort */ }
}
