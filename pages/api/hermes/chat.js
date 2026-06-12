import { sanitizeMessage, sendHermesChatMessage } from '../../../lib/hermes/chat';
import { getSession, appendMessage, upsertSession } from '../../../lib/hermes/chatSessions';

export const config = {
  api: { bodyParser: { sizeLimit: '16kb' } },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (process.env.HERMES_CHAT_ENABLED === 'false') {
    return res.status(200).json({ ok: false, error: 'Hermes Chat is disabled (HERMES_CHAT_ENABLED=false)' });
  }

  const { message, laneId = 'default' } = req.body || {};

  let safeMessage;
  try {
    safeMessage = sanitizeMessage(message);
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }

  // Load existing session — determines whether to use -z (fresh) or --continue/--resume
  const session = getSession(laneId);

  const gate = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Request timed out after 90s')), 90_000)
  );

  try {
    const result = await Promise.race([
      sendHermesChatMessage(safeMessage, { session }),
      gate,
    ]);

    if (result.ok) {
      // Persist both turns to the session file
      appendMessage(laneId, { role: 'user',      content: safeMessage,    ts: Date.now() });
      appendMessage(laneId, { role: 'assistant', content: result.reply,   ts: Date.now() });

      // Capture session ID if Hermes surfaced one
      if (result.sessionId) {
        upsertSession(laneId, { sessionId: result.sessionId });
      }

      // Return updated session so the UI can sync
      const updatedSession = getSession(laneId);
      return res.status(200).json({ ...result, session: updatedSession });
    }

    return res.status(200).json(result);
  } catch (err) {
    return res.status(200).json({ ok: false, error: err.message });
  }
}
