const ENABLED   = process.env.TELEGRAM_ENABLED === 'true';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID   = process.env.TELEGRAM_APPROVAL_CHAT_ID || '';

let _lastSent  = null;
let _lastError = null;
let _lastVerification = {
  status: 'unknown',
  checkedAt: null,
  error: null,
};
let _verificationInFlight = null;

const VERIFICATION_COOLDOWN_MS = 60_000;

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

export function getTelegramStatus() {
  return {
    enabled: ENABLED,
    configured: isConfigured(),
    lastSent: _lastSent,
    lastError: _lastError ? sanitizeTelegramError(_lastError) : null,
    verification: isConfigured()
      ? { ..._lastVerification }
      : {
          status: 'not_configured',
          checkedAt: _lastVerification.status === 'not_configured'
            ? _lastVerification.checkedAt
            : null,
          error: null,
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
      _lastError = sanitizeTelegramError(body.description || `Telegram returned HTTP ${res.status}`);
      return { sent: false, error: _lastError };
    }
    _lastSent  = new Date().toISOString();
    _lastError = null;
    return { sent: true, messageId: body.result?.message_id };
  } catch (err) {
    _lastError = sanitizeTelegramError(err.message);
    return { sent: false, error: _lastError };
  }
}

export async function verifyTelegramDelivery() {
  const checkedAt = new Date().toISOString();
  if (!isConfigured()) {
    _lastVerification = { status: 'not_configured', checkedAt, error: null };
    return { ..._lastVerification };
  }

  const lastCheckedAt = Date.parse(_lastVerification.checkedAt || '');
  if (Number.isFinite(lastCheckedAt) && Date.now() - lastCheckedAt < VERIFICATION_COOLDOWN_MS) {
    return { ..._lastVerification, cooldown: true };
  }
  if (_verificationInFlight) return _verificationInFlight;

  _verificationInFlight = (async () => {
    const result = await sendTelegramMessage(
      'MIKA AGENTIC OS - Telegram approval delivery verification.\n'
      + 'This is a non-destructive test message triggered manually from Mission Control.'
    );

    _lastVerification = result.sent
      ? { status: 'verified', checkedAt, error: null }
      : {
          status: 'failed',
          checkedAt,
          error: sanitizeTelegramError(result.error || 'Telegram did not confirm delivery.'),
        };

    return { ..._lastVerification };
  })();

  try {
    return await _verificationInFlight;
  } finally {
    _verificationInFlight = null;
  }
}
