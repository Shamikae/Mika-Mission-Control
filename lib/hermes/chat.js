// lib/hermes/chat.js — server-side only (imported only from pages/api/)
// Never import this from a React component. child_process is Node-only.

import { execFile } from 'child_process';
import { promisify } from 'util';
import { sendHermesHttpMessage } from './httpClient';

const execFileAsync      = promisify(execFile);
const MAX_MESSAGE_LENGTH = 4000;

// ─── Input sanitisation ───────────────────────────────────────────────────────

export function sanitizeMessage(msg) {
  if (typeof msg !== 'string') throw new Error('Message must be a string');
  const trimmed = msg.trim();
  if (!trimmed) throw new Error('Message cannot be empty');
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Message exceeds ${MAX_MESSAGE_LENGTH} character limit`);
  }
  return trimmed;
}

// ─── SWAP POINT — CLI COMMAND CONSTRUCTION ────────────────────────────────────
//
// Builds the argv array based on session state.
// Message is ALWAYS a distinct argv element — never shell-interpolated,
// so there is no shell injection risk regardless of message content.
//
// Command patterns:
//   New conversation:        hermes -z "<message>"
//   Continue (no ID):        hermes --continue -z "<message>"
//   Resume specific session: hermes --resume <sessionId> -z "<message>"
//
// To change the flag names, update the args arrays here only.
// ─────────────────────────────────────────────────────────────────────────────

export function buildHermesCommand(message, session = null) {
  const cmd = process.env.HERMES_CLI_COMMAND || 'hermes';

  if (!session || !session.hasActiveSession) {
    // Fresh start
    return { cmd, args: ['-z', message] };
  }
  if (session.sessionId) {
    // Resume a specific known session
    return { cmd, args: ['--resume', session.sessionId, '-z', message] };
  }
  // Continue the most recent session without a specific ID
  return { cmd, args: ['--continue', '-z', message] };
}

// ─── Session ID extraction ────────────────────────────────────────────────────
// Tries to capture a session ID from Hermes stdout.
// Returns null if none found — caller then relies on --continue for continuity.

function extractSessionId(output) {
  const patterns = [
    /session[_-]?id[:\s]+([a-zA-Z0-9_-]{4,64})/i,
    /session:\s*([a-zA-Z0-9_-]{4,64})/i,
    /--resume\s+([a-zA-Z0-9_-]{4,64})/i,
  ];
  for (const pat of patterns) {
    const m = output.match(pat);
    if (m) return m[1];
  }
  return null;
}

// Strip any session metadata lines from the reply before showing it to the user.
function cleanReply(raw) {
  return raw
    .replace(/^session[_-]?id[:\s]+\S+[\r\n]*/gim, '')
    .replace(/^session:\s*\S+[\r\n]*/gim, '')
    .trim();
}

// ─── CLI mode ─────────────────────────────────────────────────────────────────

async function sendViaCLI(message, session) {
  const { cmd, args } = buildHermesCommand(message, session);
  const cwd = process.env.HERMES_WORKING_DIR || process.cwd();

  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      cwd,
      timeout:   85_000,
      maxBuffer: 10 * 1024 * 1024,
      env:       process.env,
    });

    const raw       = stdout.trim();
    const sessionId = extractSessionId(raw);
    const reply     = cleanReply(raw) || raw;

    return {
      ok: true,
      reply,
      sessionId: sessionId || null,
      stderr:    stderr?.trim() || null,
    };
  } catch (err) {
    if (err.killed) return { ok: false, error: 'Hermes CLI timed out after 85s' };
    return { ok: false, error: err.stderr?.trim() || err.message || 'Hermes CLI failed' };
  }
}

// ─── SSH mode ─────────────────────────────────────────────────────────────────
//
// SWAP POINT — SSH COMMAND CONSTRUCTION
//
// Runs Hermes on a remote VPS over SSH using execFile — no shell on the Mac side.
// The remote shell receives a single command string; every component is
// individually single-quote-escaped so the message is never shell-interpolated.
//
// Required env vars:
//   HERMES_SSH_HOST          — remote IP or hostname
//   HERMES_SSH_USER          — SSH login user  (default: root)
//   HERMES_SSH_WORKING_DIR   — working dir on remote (default: /root)
//   HERMES_REMOTE_COMMAND    — hermes binary on remote (default: hermes)
//
// SSH key auth must be configured on the Mac (BatchMode=yes disables prompts).
// To use a jump host, add '-J jumphost' inside sshArgs.
// To use a specific key file, add '-i /path/to/key' inside sshArgs.
// ─────────────────────────────────────────────────────────────────────────────

// Wrap str in single quotes and escape any embedded single quotes.
// 'it'\''s' → it's  — the standard Unix shell-quoting idiom.
function shellQuote(str) {
  return "'" + String(str).replace(/'/g, "'\\''") + "'";
}

async function sendViaSSH(message, session) {
  const host       = process.env.HERMES_SSH_HOST;
  const user       = process.env.HERMES_SSH_USER        || 'root';
  const workingDir = process.env.HERMES_SSH_WORKING_DIR || '/root';
  const remoteCmd  = process.env.HERMES_REMOTE_COMMAND  || 'hermes';

  const keyFile = process.env.HERMES_SSH_KEY;

  if (!host)    return { ok: false, error: 'HERMES_SSH_HOST is not set in .env.local' };
  if (!keyFile) return { ok: false, error: 'HERMES_SSH_KEY is not set in .env.local' };

  // Build hermes flags from session state — same logic as CLI mode
  let hermesFlags;
  if (!session || !session.hasActiveSession) {
    hermesFlags = ['-z', message];
  } else if (session.sessionId) {
    hermesFlags = ['--resume', session.sessionId, '-z', message];
  } else {
    hermesFlags = ['--continue', '-z', message];
  }

  // Construct the remote shell command string.
  // cd and && are fixed shell keywords; working dir and all hermes tokens are quoted.
  // Message is always shellQuote(message) — never interpolated directly.
  const remoteShellCmd = [
    'cd', shellQuote(workingDir), '&&',
    ...[remoteCmd, ...hermesFlags].map(shellQuote),
  ].join(' ');

  const sshArgs = [
    '-i', keyFile,
    '-o', 'IdentitiesOnly=yes',
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    '-o', 'StrictHostKeyChecking=accept-new',
    `${user}@${host}`,
    remoteShellCmd,
  ];

  try {
    const { stdout, stderr } = await execFileAsync('ssh', sshArgs, {
      timeout:   85_000,
      maxBuffer: 10 * 1024 * 1024,
      env:       process.env,
    });

    const raw       = stdout.trim();
    const sessionId = extractSessionId(raw);
    const reply     = cleanReply(raw) || raw;

    return {
      ok: true,
      reply,
      sessionId: sessionId || null,
      stderr:    stderr?.trim() || null,
    };
  } catch (err) {
    if (err.killed) return { ok: false, error: 'Hermes SSH timed out after 85s', stderr: null };

    const raw = err.stderr?.trim() || err.message || 'SSH execution failed';

    if (raw.includes('Connection refused'))
      return { ok: false, error: `SSH: cannot connect to ${host} — connection refused`, stderr: raw };
    if (raw.includes('No route to host') || raw.includes('Network unreachable'))
      return { ok: false, error: `SSH: cannot reach ${host} — check network or firewall`, stderr: raw };
    if (raw.includes('Permission denied') || raw.includes('publickey'))
      return { ok: false, error: `SSH: auth failed for ${user}@${host}`, stderr: raw };
    if (raw.includes('command not found') || raw.includes('No such file'))
      return { ok: false, error: `SSH: '${remoteCmd}' not found on ${host}`, stderr: raw };
    if (raw.includes('Host key verification failed'))
      return { ok: false, error: `SSH: host key mismatch for ${host} — run: ssh-keygen -R ${host}`, stderr: raw };

    return { ok: false, error: `SSH: ${raw}`, stderr: raw };
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function sendHermesChatMessage(message, options = {}) {
  const mode = process.env.HERMES_CHAT_MODE || 'cli';
  if (mode === 'http') return sendHermesHttpMessage(message, options);
  if (mode === 'ssh')  return sendViaSSH(message, options.session || null);
  return sendViaCLI(message, options.session || null);
}
