// lib/openart/openartAuthStore.js
// SERVER-SIDE ONLY. Never import from client components.
//
// File-backed storage for the OpenArt MCP OAuth session: dynamic client
// registration, tokens, PKCE verifier, CSRF state, and discovery cache.
// Lives under data/openart-auth/ — gitignored, never sent in any API response.

import fs   from 'fs';
import path from 'path';

const AUTH_DIR   = path.join(process.cwd(), 'data', 'openart-auth');
const STATE_FILE = path.join(AUTH_DIR, 'session.json');

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(patch) {
  const next = { ...readState(), ...patch, updatedAt: new Date().toISOString() };
  fs.mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}

export function getOpenArtAuthState() {
  return readState();
}

export function patchOpenArtAuthState(patch) {
  return writeState(patch);
}

export function clearOpenArtAuthState() {
  try {
    fs.rmSync(STATE_FILE, { force: true });
  } catch { /* best-effort */ }
}
