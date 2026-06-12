import { verifyTelegramDelivery } from '../../../lib/telegram/sendTelegramMessage';

export default async function handler(req, res) {
  res.setHeader('Allow', 'POST');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const verification = await verifyTelegramDelivery();
  return res.status(200).json({ verification });
}
