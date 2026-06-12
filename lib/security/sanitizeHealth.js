const STATUS_MESSAGES = {
  healthy: 'Runtime health check succeeded.',
  warning: 'Runtime health check reported a degraded or unverified state.',
  offline: 'Runtime health check could not reach the adapter.',
  misconfigured: 'Adapter configuration is incomplete or invalid.',
  auth_failed: 'Adapter authentication failed.',
  rate_limited: 'Adapter is currently rate limited.',
  maintenance: 'Adapter is in maintenance.',
  staged: 'Adapter is staged and not executable.',
};

export function sanitizeHealthMessage(result = {}) {
  if (result.reason === 'configured_unverified') {
    return 'Adapter is configured, but runtime reachability is not verified.';
  }
  if (result.reason === 'configured_but_staged') {
    return 'Adapter is configured and reachable but remains staged.';
  }
  if (result.reason === 'not_registered') {
    return 'Adapter is not registered.';
  }
  return STATUS_MESSAGES[result.health] || 'Runtime health is unknown.';
}

export function sanitizeAdapterHealthResult(result = {}) {
  return {
    adapterId: result.adapterId || null,
    displayName: result.displayName || result.adapterId || 'Unknown adapter',
    adapterStatus: result.adapterStatus || 'unknown',
    health: result.health || 'unknown',
    ok: result.ok === true,
    latencyMs: Number.isFinite(result.latencyMs) ? result.latencyMs : null,
    reason: result.reason || null,
    message: sanitizeHealthMessage(result),
    checkedAt: result.checkedAt || null,
    configured: Array.isArray(result.envVarsMissing)
      ? result.envVarsMissing.length === 0
      : null,
    rawStatus: result.rawStatus || null,
  };
}
