import { getHermesHealthSummary } from '../../../lib/hermes/health';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(await getHermesHealthSummary({ checkHttp: true }));
}
