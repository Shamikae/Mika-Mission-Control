import { callOpenClaw } from '../../../lib/openclaw/callOpenClaw';
import { loadBusinessLaneContext } from '../../../lib/context/loadBusinessLaneContext';

const MAX_MESSAGE_LENGTH = 4000;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const enabled = process.env.OPENCLAW_ENABLED !== 'false';
  if (!enabled) {
    return res.status(200).json({ ok: false, error: 'OpenClaw is disabled (OPENCLAW_ENABLED=false)' });
  }

  const { message, lane } = req.body || {};
  if (!message?.trim()) {
    return res.status(400).json({ ok: false, error: 'Message is required' });
  }

  const safeMessage = message.trim().slice(0, MAX_MESSAGE_LENGTH);

  // Inject lane context into system prompt if a lane is provided
  const ctx = lane ? loadBusinessLaneContext(lane) : null;
  const systemContent = [
    ctx
      ? `LANE: ${ctx.displayName}\nMISSION: ${ctx.mission}\nVOICE: ${ctx.voice}`
      : '',
    'You are OpenClaw, the main AI orchestrator for Mika Mission Control.',
    'Answer the operator directly and helpfully. Be concise and specific.',
  ].filter(Boolean).join('\n\n');

  const result = await callOpenClaw({
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user',   content: safeMessage   },
    ],
    maxTokens:  1000,
    sessionKey: ctx?.sessionKey,
  });

  const reply = result.body?.choices?.[0]?.message?.content ?? null;

  if (!result.ok || !reply) {
    return res.status(200).json({
      ok:    false,
      error: result.error || `HTTP ${result.httpStatus}` || 'No reply from OpenClaw',
    });
  }

  return res.status(200).json({ ok: true, reply });
}
