const MOCK_STATUS = {
  status: 'LIVE',
  latencyMs: 0,
  lastChecked: null,
  error: null,
  source: 'mock',
};

function joinUrl(baseUrl, endpointPath) {
  const base = baseUrl.replace(/\/+$/, '');
  const nextPath = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;
  return `${base}${nextPath}`;
}

function normalizeStatus(responseOk, payload) {
  if (!responseOk) return 'DEGRADED';

  const raw = String(
    payload?.status ||
    payload?.health ||
    payload?.state ||
    payload?.mode ||
    ''
  ).toLowerCase();

  if (['degraded', 'warning', 'warn', 'partial', 'unhealthy'].includes(raw)) {
    return 'DEGRADED';
  }

  if (['offline', 'down', 'error', 'failed'].includes(raw)) {
    return 'OFFLINE';
  }

  return 'LIVE';
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL || '';
  const statusPath = process.env.OPENCLAW_STATUS_PATH || '/api/status';
  const apiKey = process.env.OPENCLAW_API_KEY || '';
  const timeoutMs = Number(process.env.OPENCLAW_STATUS_TIMEOUT_MS || 5000);
  const lastChecked = new Date().toISOString();

  if (!gatewayUrl) {
    return res.status(200).json({ ...MOCK_STATUS, lastChecked });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();

  try {
    const response = await fetch(joinUrl(gatewayUrl, statusPath), {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
    });

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text.slice(0, 500) };
      }
    }

    const latencyMs = Date.now() - started;
    const status = normalizeStatus(response.ok, payload);

    return res.status(200).json({
      status,
      latencyMs,
      lastChecked,
      error: response.ok ? null : `OpenClaw returned HTTP ${response.status}`,
      source: 'openclaw',
      httpStatus: response.status,
      version: payload?.version || null,
      uptime: payload?.uptime || null,
    });
  } catch (error) {
    const latencyMs = Date.now() - started;
    const isTimeout = error.name === 'AbortError';

    return res.status(200).json({
      status: 'OFFLINE',
      latencyMs,
      lastChecked,
      error: isTimeout ? `OpenClaw status request timed out after ${timeoutMs}ms` : error.message,
      source: 'openclaw',
    });
  } finally {
    clearTimeout(timeout);
  }
}
