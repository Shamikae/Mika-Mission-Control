import { getHttpClientStatus } from '../../../lib/hermes/httpClient';

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  return res.status(200).json({
    ...getHttpClientStatus(),
    mode:      process.env.HERMES_CHAT_MODE    || 'cli',
    enabled:   process.env.HERMES_CHAT_ENABLED !== 'false',
    configured: !!(process.env.HERMES_API_URL),
  });
}
