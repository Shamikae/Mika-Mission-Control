const ENABLED   = process.env.TELEGRAM_ENABLED === 'true';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID   = process.env.TELEGRAM_APPROVAL_CHAT_ID || '';

let _lastSent  = null;
let _lastError = null;

export function getTelegramStatus() {
  return { enabled: ENABLED, lastSent: _lastSent, lastError: _lastError };
}

export async function sendTelegramMessage(text) {
  if (!ENABLED || !BOT_TOKEN || !CHAT_ID) {
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
      _lastError = body.description || `HTTP ${res.status}`;
      return { sent: false, error: _lastError };
    }
    _lastSent  = new Date().toISOString();
    _lastError = null;
    return { sent: true, messageId: body.result?.message_id };
  } catch (err) {
    _lastError = err.message;
    return { sent: false, error: err.message };
  }
}
