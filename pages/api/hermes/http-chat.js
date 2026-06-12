import { sanitizeMessage } from '../../../lib/hermes/chat';
import { sendHermesHttpMessage } from '../../../lib/hermes/httpClient';

// ── SWAP POINT — STREAMING RESPONSE ──────────────────────────────────────────
//
// This route currently returns a single JSON response.
// To upgrade to streaming (SSE), replace the handler body with:
//
//   const result = await sendHermesHttpMessage(safeMessage, { lane, stream: true });
//   if (result.stream) {
//     res.setHeader('Content-Type', 'text/event-stream')
//     res.setHeader('Cache-Control', 'no-cache')
//     res.setHeader('X-Accel-Buffering', 'no')
//     const reader = result.stream.getReader()
//     while (true) {
//       const { done, value } = await reader.read()
//       if (done) break
//       res.write(Buffer.from(value))
//     }
//     return res.end()
//   }
//
// For WebSocket upgrade, this route would be replaced entirely by a
// pages/api/hermes/ws.js handler using the 'ws' package.
//
// ─────────────────────────────────────────────────────────────────────────────

export const config = {
  api: { bodyParser: { sizeLimit: '16kb' } },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (process.env.HERMES_CHAT_ENABLED === 'false') {
    return res.status(200).json({ ok: false, error: 'Hermes Chat is disabled (HERMES_CHAT_ENABLED=false)' });
  }

  const { message, lane } = req.body || {};

  let safeMessage;
  try {
    safeMessage = sanitizeMessage(message);
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }

  const gate = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Request timed out after 90s')), 90_000)
  );

  try {
    const result = await Promise.race([
      sendHermesHttpMessage(safeMessage, { lane }),
      gate,
    ]);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(200).json({ ok: false, error: err.message });
  }
}
