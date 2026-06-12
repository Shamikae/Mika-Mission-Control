import fs   from 'fs';
import path from 'path';

const ENABLED   = process.env.TELEGRAM_ENABLED === 'true';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID   = process.env.TELEGRAM_APPROVAL_CHAT_ID || '';

const STATE_FILE               = path.join(process.cwd(), 'data', 'telegram-state.json');
const VERIFICATION_COOLDOWN_MS = 60_000;

// In-flight dedup is intentionally module-level — one active probe per process is correct.
let _verificationInFlight = null;

function isConfigured() {
  return ENABLED && Boolean(BOT_TOKEN) && Boolean(CHAT_ID);
}

function sanitizeTelegramError(error) {
  let message = String(error || 'Telegram delivery failed.');
  for (const secret of [BOT_TOKEN, CHAT_ID]) {
    if (secret) message = message.replaceAll(secret, '[redacted]');
  }
  message = message
    .replace(/https?:\/\/\S+/gi, '[redacted URL]')
    .replace(/(?:\/Users|\/home|[A-Za-z]:\\)[^\s]*/g, '[redacted path]');
  return message.slice(0, 240);
}

// ── File-backed state ─────────────────────────────────────────────────────────
// Shared across all route module instances — fixes cross-route stale state.

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { lastSent: null, lastError: null, verification: { status: 'unknown', checkedAt: null, error: null } };
  }
}

function writeState(patch) {
  try {
    const next = { ...readState(), ...patch };
    fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2));
  } catch { /* non-fatal — status display degrades gracefully */ }
}

// ── Exports ───────────────────────────────────────────────────────────────────

export function getTelegramStatus() {
  const state = readState();
  const verification = state.verification || { status: 'unknown', checkedAt: null, error: null };
  return {
    enabled:      ENABLED,
    configured:   isConfigured(),
    lastSent:     state.lastSent,
    lastError:    state.lastError ? sanitizeTelegramError(state.lastError) : null,
    verification: isConfigured()
      ? { ...verification }
      : {
          status:     'not_configured',
          checkedAt:  verification.status === 'not_configured' ? verification.checkedAt : null,
          error:      null,
        },
  };
}

export async function sendTelegramMessage(text) {
  if (!isConfigured()) {
    return { sent: false, reason: 'disabled' };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = sanitizeTelegramError(body.description || `Telegram returned HTTP ${res.status}`);
      writeState({ lastError: err });
      return { sent: false, error: err };
    }
    writeState({ lastSent: new Date().toISOString(), lastError: null });
    return { sent: true, messageId: body.result?.message_id };
  } catch (err) {
    const sanitized = sanitizeTelegramError(err.message);
    writeState({ lastError: sanitized });
    return { sent: false, error: sanitized };
  }
}

export async function verifyTelegramDelivery() {
  const checkedAt = new Date().toISOString();
  if (!isConfigured()) {
    writeState({ verification: { status: 'not_configured', checkedAt, error: null } });
    return { status: 'not_configured', checkedAt, error: null };
  }

  const state         = readState();
  const lastCheckedAt = Date.parse(state.verification?.checkedAt || '');
  if (Number.isFinite(lastCheckedAt) && Date.now() - lastCheckedAt < VERIFICATION_COOLDOWN_MS) {
    return { ...state.verification, cooldown: true };
  }
  if (_verificationInFlight) return _verificationInFlight;

  _verificationInFlight = (async () => {
    const result = await sendTelegramMessage(
      'MIKA AGENTIC OS - Telegram approval delivery verification.\n'
      + 'This is a non-destructive test message triggered manually from Mission Control.'
    );

    const verification = result.sent
      ? { status: 'verified', checkedAt, error: null }
      : {
          status:    'failed',
          checkedAt,
          error:     sanitizeTelegramError(result.error || 'Telegram did not confirm delivery.'),
        };

    writeState({ verification });
    return { ...verification };
  })();

  try {
    return await _verificationInFlight;
  } finally {
    _verificationInFlight = null;
  }
}
