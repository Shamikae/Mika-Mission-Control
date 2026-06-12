import { getHermesConfig } from '../../../lib/hermes/sendTaskToHermes';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const cfg = getHermesConfig();

  if (!cfg.enabled || !cfg.configured) {
    return res.status(200).json({
      status:    'DISABLED',
      agentId:   cfg.agentId,
      enabled:   cfg.enabled,
      lastChecked: new Date().toISOString(),
    });
  }

  const apiUrl = process.env.HERMES_API_URL || '';
  const healthUrl = `${apiUrl.replace(/\/+$/, '')}/health`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);

  try {
    const start = Date.now();
    const r = await fetch(healthUrl, { signal: controller.signal });
    clearTimeout(timer);
    const latencyMs = Date.now() - start;

    return res.status(200).json({
      status:    r.ok ? 'LIVE' : 'DEGRADED',
      latencyMs,
      agentId:   cfg.agentId,
      enabled:   true,
      lastChecked: new Date().toISOString(),
    });
  } catch (err) {
    clearTimeout(timer);
    return res.status(200).json({
      status:    'OFFLINE',
      error:     err.name === 'AbortError' ? 'Health check timed out' : err.message,
      agentId:   cfg.agentId,
      enabled:   true,
      lastChecked: new Date().toISOString(),
    });
  }
}
