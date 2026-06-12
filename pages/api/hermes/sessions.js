import { loadSessions, clearSession } from '../../../lib/hermes/chatSessions';

export default function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json(loadSessions());
  }

  if (req.method === 'DELETE') {
    const { laneId } = req.body || {};
    if (!laneId) return res.status(400).json({ error: 'laneId required' });
    clearSession(laneId);
    return res.status(200).json({ success: true, laneId });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
