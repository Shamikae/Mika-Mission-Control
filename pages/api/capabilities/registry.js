import { loadCapabilityRegistry } from '../../../lib/capabilities/loadCapabilityRegistry';

export default function handler(req, res) {
  res.setHeader('Allow', 'GET');
  res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const registry = loadCapabilityRegistry();
    return res.status(200).json(registry);
  } catch (error) {
    console.error('Capability registry load failed:', error);
    return res.status(500).json({ error: 'Capability registry is invalid or unavailable' });
  }
}
