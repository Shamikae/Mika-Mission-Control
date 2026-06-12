// lib/openclaw/callOpenClaw.js
// Shared low-level wrapper for POST /v1/chat/completions.
// Used by synthesize.js and any future routes that need to hit OpenClaw
// without going through the full task dispatch pipeline.
//
// SWAP POINT: change joinUrl() target or headers to switch gateway protocol.

function joinUrl(base, p) {
  return base.replace(/\/+$/, '') + (p.startsWith('/') ? p : '/' + p);
}

export async function callOpenClaw({ messages, model, maxTokens = 800, sessionKey }) {
  const token      = process.env.OPENCLAW_API_TOKEN   || '';
  const controlUrl = process.env.OPENCLAW_CONTROL_URL || '';
  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL || '';
  const taskPath   = process.env.OPENCLAW_TASK_PATH   || '/v1/chat/completions';
  const baseUrl    = controlUrl || gatewayUrl;

  if (!token || !baseUrl) {
    return { ok: false, httpStatus: null, body: null, error: 'Missing OPENCLAW_API_TOKEN or gateway URL' };
  }

  const url     = joinUrl(baseUrl, taskPath);
  const headers = {
    'Content-Type': 'application/json',
    Authorization:  `Bearer ${token}`,
    ...(sessionKey ? { 'x-openclaw-session-key': sessionKey } : {}),
  };

  const timeoutMs  = Number(process.env.OPENCLAW_TASK_TIMEOUT_MS || 60_000);
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method:  'POST',
      signal:  controller.signal,
      headers,
      body: JSON.stringify({
        model:      model || process.env.OPENCLAW_MODEL || 'gpt-4o',
        messages,
        max_tokens: maxTokens,
      }),
    });
    clearTimeout(timer);

    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 800) }; }

    return { ok: res.ok, httpStatus: res.status, body, error: null };
  } catch (err) {
    clearTimeout(timer);
    return {
      ok: false, httpStatus: null, body: null,
      error: err.name === 'AbortError' ? `OpenClaw timed out after ${Math.round(timeoutMs / 1000)}s` : err.message,
    };
  }
}
