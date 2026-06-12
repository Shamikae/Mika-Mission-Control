import { getHermesHealthSummary } from '../../../lib/hermes/health';
import { persistHealthResults } from '../../../lib/adapters/adapterHealth';
import { sanitizeAdapterHealthResult } from '../../../lib/security/sanitizeHealth';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Cache-Control', 'no-store');
  const summary = await getHermesHealthSummary({ checkHttp: true });
  const health = summary.verified
    ? 'healthy'
    : summary.status === 'configured_unverified'
      ? 'warning'
      : summary.status === 'not_configured'
        ? 'misconfigured'
        : summary.status === 'failed'
          ? 'offline'
          : 'warning';
  persistHealthResults([sanitizeAdapterHealthResult({
    adapterId: 'hermes',
    displayName: 'Hermes Agent',
    adapterStatus: 'active',
    health,
    ok: summary.verified === true,
    reason: summary.status,
    checkedAt: summary.lastChecked || new Date().toISOString(),
    rawStatus: summary.status,
  })], { appendLog: false });
  return res.status(200).json(summary);
}
