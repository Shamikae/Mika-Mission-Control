import { persistHealthResults } from '../../../lib/adapters/adapterHealth';
import { sanitizeAdapterHealthResult } from '../../../lib/security/sanitizeHealth';

function joinUrl(baseUrl, endpointPath) {
  const base = baseUrl.replace(/\/+$/, '');
  const nextPath = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;
  return `${base}${nextPath}`;
}

function normalizeStatus(responseOk, payload) {
  if (!responseOk) return 'DEGRADED';

  // { ok: true } shape (OpenClaw /health)
  if (payload?.ok === true) return 'LIVE';
  if (payload?.ok === false) return 'OFFLINE';

  const raw = String(
    payload?.status ||
    payload?.health ||
    payload?.state ||
    payload?.mode ||
    ''
  ).toLowerCase();

  if (['degraded', 'warning', 'warn', 'partial', 'unhealthy'].includes(raw)) return 'DEGRADED';
  if (['offline', 'down', 'error', 'failed'].includes(raw)) return 'OFFLINE';
  if (['live', 'ok', 'healthy', 'online', 'up', 'running'].includes(raw)) return 'LIVE';

  return 'LIVE';
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const enabled = process.env.OPENCLAW_ENABLED !== 'false';
  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL || '';
  const statusPath = process.env.OPENCLAW_STATUS_PATH || '/api/status';
  const apiToken = process.env.OPENCLAW_API_TOKEN || '';
  const timeoutMs = Number(process.env.OPENCLAW_STATUS_TIMEOUT_MS || 5000);
  const lastChecked = new Date().toISOString();

  if (!enabled) {
    persistHealthResults([sanitizeAdapterHealthResult({
      adapterId: 'openclaw', displayName: 'OpenClaw Gateway', adapterStatus: 'active',
      health: 'offline', ok: false, reason: 'disabled', checkedAt: lastChecked,
    })], { appendLog: false });
    return res.status(200).json({ status: 'DISABLED', latencyMs: 0, lastChecked, error: null, source: 'openclaw' });
  }

  if (!gatewayUrl) {
    persistHealthResults([sanitizeAdapterHealthResult({
      adapterId: 'openclaw', displayName: 'OpenClaw Gateway', adapterStatus: 'active',
      health: 'misconfigured', ok: false, reason: 'not_configured', checkedAt: lastChecked,
    })], { appendLog: false });
    return res.status(200).json({
      status: 'UNKNOWN',
      latencyMs: null,
      lastChecked,
      error: 'OpenClaw is not configured.',
      source: 'unavailable',
    });
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
        ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
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
    persistHealthResults([sanitizeAdapterHealthResult({
      adapterId: 'openclaw',
      displayName: 'OpenClaw Gateway',
      adapterStatus: 'active',
      health: status === 'LIVE' ? 'healthy' : status === 'DEGRADED' ? 'warning' : 'offline',
      ok: status === 'LIVE',
      latencyMs,
      reason: status === 'LIVE' ? null : 'runtime_check_failed',
      checkedAt: lastChecked,
      rawStatus: status.toLowerCase(),
    })], { appendLog: false });

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

    persistHealthResults([sanitizeAdapterHealthResult({
      adapterId: 'openclaw',
      displayName: 'OpenClaw Gateway',
      adapterStatus: 'active',
      health: 'offline',
      ok: false,
      latencyMs,
      reason: isTimeout ? 'timeout' : 'unreachable',
      checkedAt: lastChecked,
      rawStatus: 'offline',
    })], { appendLog: false });

    return res.status(200).json({
      status: 'OFFLINE',
      latencyMs,
      lastChecked,
      error: isTimeout ? 'OpenClaw status request timed out.' : 'OpenClaw is unreachable.',
      source: 'openclaw',
    });
  } finally {
    clearTimeout(timeout);
  }
}
