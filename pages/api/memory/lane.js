import { loadLaneMemory } from '../../../lib/memory/loadLaneMemory';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { lane } = req.query;
  if (!lane) {
    return res.status(400).json({ error: 'lane query param required' });
  }
  return res.status(200).json(loadLaneMemory(lane));
}
