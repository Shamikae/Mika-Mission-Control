// pages/api/dispatch/log.js
// GET — return recent dispatch log entries

import { readDispatchLog } from '../../../lib/dispatch/dispatchLog';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const limit = parseInt(req.query.limit) || 50;
  return res.status(200).json(readDispatchLog(limit));
}
