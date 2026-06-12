// lib/hermes/chatSessions.js — server-side only
// Persistent session store for Hermes Chat conversations, keyed by laneId.
// Written to memory/hermes-chat-sessions.json in the project root.

import fs from 'fs';
import path from 'path';

const SESSIONS_FILE = path.join(process.cwd(), 'memory', 'hermes-chat-sessions.json');
const MAX_MESSAGES  = 50; // keep last N messages per session

function ensureDir() {
  const dir = path.dirname(SESSIONS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function loadSessions() {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) return {};
    return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
  } catch { return {}; }
}

function writeSessions(sessions) {
  ensureDir();
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

export function getSession(laneId) {
  return loadSessions()[laneId] || null;
}

// Generic patch — use for updating sessionId, hasActiveSession, title, etc.
export function upsertSession(laneId, patch) {
  const sessions = loadSessions();
  const base = sessions[laneId] || {
    laneId,
    sessionId:        null,
    title:            null,
    hasActiveSession: false,
    messages:         [],
    lastActive:       null,
  };
  const updated = {
    ...base,
    ...patch,
    lastActive: new Date().toISOString(),
    // Don't truncate messages in a plain upsert — appendMessage handles that
    messages: patch.messages !== undefined
      ? patch.messages
      : base.messages,
  };
  sessions[laneId] = updated;
  writeSessions(sessions);
  return updated;
}

// Append a single message { role, content, ts } to the lane's session.
// Automatically trims to MAX_MESSAGES and sets title from the first user message.
export function appendMessage(laneId, message) {
  const sessions  = loadSessions();
  const existing  = sessions[laneId] || {
    laneId,
    sessionId:        null,
    title:            null,
    hasActiveSession: true,
    messages:         [],
    lastActive:       null,
  };

  const messages = [...existing.messages, message].slice(-MAX_MESSAGES);

  // Set title from first user message (once)
  const title = existing.title
    || (message.role === 'user' ? message.content.slice(0, 60) : null);

  const updated = {
    ...existing,
    messages,
    title,
    hasActiveSession: true,
    lastActive: new Date().toISOString(),
  };

  sessions[laneId] = updated;
  writeSessions(sessions);
  return updated;
}

export function clearSession(laneId) {
  const sessions = loadSessions();
  delete sessions[laneId];
  writeSessions(sessions);
}
