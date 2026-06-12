// lib/hermes/httpClient.js — server-side only
// Core HTTP adapter for the Hermes gateway on the VPS.
// Imported by: pages/api/hermes/http-chat.js, lib/hermes/chat.js

// ─── Connection state ─────────────────────────────────────────────────────────
// Module-level — best-effort tracking, resets on server restart.

let _online      = false;
let _lastLatency = null;
let _lastSuccess = null;
let _lastError   = null;

export function getHttpClientStatus() {
  return { online: _online, lastLatency: _lastLatency, lastSuccess: _lastSuccess, lastError: _lastError };
}

function recordSuccess(latencyMs) {
  _online      = true;
  _lastLatency = latencyMs;
  _lastSuccess = new Date().toISOString();
  _lastError   = null;
}

function recordError(msg) {
  _online    = false;
  _lastError = String(msg?.message ?? msg ?? 'Unknown error');
}

// ─── Payload builder ──────────────────────────────────────────────────────────
//
// SWAP POINT — PAYLOAD FORMAT
// Default: OpenAI-compatible chat completions.
// To switch to a Hermes-native payload format, update only this function.
// Stream flag can be added here when streaming is ready (see SWAP POINT below).

export function buildHermesHttpPayload(message, options = {}) {
  const model = options.model
    || process.env.HERMES_MODEL
    || process.env.OPENCLAW_MODEL
    || 'gpt-4o';

  return {
    model,
    messages:   [{ role: 'user', content: message }],
    max_tokens: options.maxTokens || 1500,
    ...(options.lane ? { metadata: { lane: options.lane } } : {}),
  };
}

// ─── Response validator ────────────────────────────────────────────────────────
// Normalises Hermes response shapes into a single { ok, reply, error }.
// Supported shapes: OpenAI choices[], flat output/result/content/text fields.

export function validateHermesResponse(body) {
  if (!body) return { ok: false, reply: null, error: 'Empty response body' };

  const reply =
    body.choices?.[0]?.message?.content
    ?? body.output
    ?? body.result
    ?? body.content
    ?? body.text
    ?? null;

  if (reply !== null && typeof reply === 'string' && reply.trim()) {
    return { ok: true, reply: reply.trim(), error: null };
  }

  const error = body.error?.message ?? body.error ?? body.message
    ?? 'No reply content in Hermes response';

  return { ok: false, reply: null, error: String(error) };
}

// ─── Main HTTP send ────────────────────────────────────────────────────────────

export async function sendHermesHttpMessage(message, options = {}) {
  const apiUrl   = process.env.HERMES_API_URL  || '';
  const chatPath = process.env.HERMES_CHAT_PATH || '/v1/chat/completions';

  if (!apiUrl) {
    recordError('HERMES_API_URL is not configured');
    return { ok: false, error: 'HERMES_API_URL is not configured' };
  }

  const url     = `${apiUrl.replace(/\/+$/, '')}${chatPath}`;
  const payload = buildHermesHttpPayload(message, options);

  // ── SWAP POINT — STREAMING ────────────────────────────────────────────────
  //
  // To add token streaming (SSE / chunked transfer encoding):
  //
  // 1. Add `stream: true` to payload in buildHermesHttpPayload().
  //
  // 2. Change the fetch call below to skip res.json() entirely:
  //      if (res.headers.get('content-type')?.includes('text/event-stream')) {
  //        return { ok: true, stream: res.body };  // return raw ReadableStream
  //      }
  //
  // 3. In http-chat.js (API route), detect result.stream and pipe it:
  //      res.setHeader('Content-Type', 'text/event-stream')
  //      res.setHeader('Cache-Control', 'no-cache')
  //      res.setHeader('X-Accel-Buffering', 'no')
  //      const reader = result.stream.getReader()
  //      while (true) {
  //        const { done, value } = await reader.read()
  //        if (done) break
  //        res.write(Buffer.from(value))
  //      }
  //      res.end()
  //
  // 4. In HermesChat.jsx, replace fetch+json with an EventSource or
  //    fetch-streaming reader that appends chunks to the last message.
  //
  // 5. For WebSocket upgrade instead, replace this entire function with a
  //    ws:// connection and emit events through a shared emitter.
  //
  // ─────────────────────────────────────────────────────────────────────────

  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), 85_000);
  const start      = Date.now();

  try {
    const res = await fetch(url, {
      method:  'POST',
      signal:  controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    clearTimeout(timer);

    const latencyMs = Date.now() - start;
    const body      = await res.json().catch(() => ({}));

    if (!res.ok) {
      const err = body.error?.message || `HTTP ${res.status}`;
      recordError(err);
      return { ok: false, error: err, httpStatus: res.status };
    }

    const result = validateHermesResponse(body);

    if (result.ok) {
      recordSuccess(latencyMs);
      return { ok: true, reply: result.reply, latencyMs, httpStatus: res.status };
    }

    recordError(result.error);
    return { ok: false, error: result.error, httpStatus: res.status };

  } catch (err) {
    clearTimeout(timer);
    const msg = err.name === 'AbortError' ? 'Hermes HTTP timed out after 85s' : err.message;
    recordError(msg);
    return { ok: false, error: msg, httpStatus: null };
  }
}
