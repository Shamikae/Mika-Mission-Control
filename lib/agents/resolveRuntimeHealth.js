import { sanitizeHealthMessage } from '../security/sanitizeHealth';

const DEFAULT_MAX_EVIDENCE_AGE_MS = 15 * 60 * 1000;
const AVAILABLE_HEALTH = new Set(['healthy']);
const DEGRADED_HEALTH = new Set(['warning', 'rate_limited', 'maintenance']);
const OFFLINE_HEALTH = new Set(['offline', 'misconfigured', 'auth_failed']);

function parseTimestamp(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function maxEvidenceAgeMs() {
  const configured = Number(process.env.AGENT_HEALTH_MAX_AGE_MS);
  return Number.isInteger(configured) && configured >= 30_000
    ? configured
    : DEFAULT_MAX_EVIDENCE_AGE_MS;
}

function labelFor(runtimeStatus) {
  return {
    available: 'Available',
    reachable: 'Reachable',
    degraded: 'Degraded',
    offline: 'Offline',
    staged: 'Staged',
    unknown: 'Unknown',
  }[runtimeStatus] || 'Unknown';
}

export function resolveAgentRuntimeHealth({
  agent,
  adapter = null,
  evidence = null,
  override = null,
  maintenance = null,
  now = Date.now(),
}) {
  const declaredStatus = agent?.status || 'unknown';
  const configured = Boolean(adapter) || Boolean(agent?.adapterId);
  const checkedAt = evidence?.checkedAt || null;
  const checkedTimestamp = parseTimestamp(checkedAt);
  const evidenceAgeMs = checkedTimestamp === null ? null : Math.max(0, now - checkedTimestamp);
  const evidenceFresh = evidenceAgeMs !== null && evidenceAgeMs <= maxEvidenceAgeMs();

  let runtimeStatus = 'unknown';
  let reason = evidenceFresh ? evidence?.reason || null : checkedAt ? 'stale_evidence' : 'never_checked';

  if (override?.disabled) {
    runtimeStatus = 'offline';
    reason = 'disabled';
  } else if (maintenance?.active || evidence?.health === 'maintenance') {
    runtimeStatus = 'degraded';
    reason = 'maintenance';
  } else if (declaredStatus === 'staged' && !evidenceFresh) {
    runtimeStatus = 'staged';
  } else if (declaredStatus === 'inactive' && !evidenceFresh) {
    runtimeStatus = 'offline';
    reason = 'declared_inactive';
  } else if (evidenceFresh) {
    if (AVAILABLE_HEALTH.has(evidence.health) && evidence.ok === true) {
      runtimeStatus = adapter?.isActive || declaredStatus === 'active' || declaredStatus === 'review-only'
        ? 'available'
        : 'reachable';
    } else if (evidence.reason === 'configured_but_staged' && evidence.ok === true) {
      runtimeStatus = 'reachable';
    } else if (evidence.health === 'staged') {
      runtimeStatus = 'staged';
    } else if (DEGRADED_HEALTH.has(evidence.health)) {
      runtimeStatus = 'degraded';
    } else if (OFFLINE_HEALTH.has(evidence.health)) {
      runtimeStatus = 'offline';
    }
  }

  return {
    declaredStatus,
    configurationStatus: declaredStatus === 'staged'
      ? 'staged'
      : configured ? 'configured' : 'declared',
    runtimeStatus,
    health: labelFor(runtimeStatus),
    liveConnected: runtimeStatus === 'available' || runtimeStatus === 'reachable',
    runtimeEvidence: {
      source: evidenceFresh ? 'adapter_health_check' : 'none',
      checkedAt,
      fresh: evidenceFresh,
      ageMs: evidenceAgeMs,
      reason,
      message: evidenceFresh ? sanitizeHealthMessage(evidence) : null,
      latencyMs: evidenceFresh ? evidence?.latencyMs ?? null : null,
    },
  };
}

export function runtimeStatusLabel(runtimeStatus) {
  return labelFor(runtimeStatus);
}
