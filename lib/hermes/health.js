// Server-only Hermes connection resolution and runtime evidence.
// Configuration selects a transport; only a health response or real chat result verifies it.

const VALID_MODES = new Set(['http', 'ssh', 'cli']);

let runtimeEvidence = {
  mode: null,
  reachable: null,
  verified: false,
  lastChecked: null,
  error: null,
};

function isEnabled(value) {
  return value === 'true';
}

export function sanitizeHermesError(error) {
  let message = String(error?.message ?? error ?? 'Hermes connection failed');

  const sensitiveValues = [
    process.env.HERMES_API_URL,
    process.env.HERMES_API_KEY,
    process.env.HERMES_SSH_HOST,
    process.env.HERMES_SSH_USER,
    process.env.HERMES_SSH_KEY,
    process.env.HERMES_SSH_WORKING_DIR,
    process.env.HERMES_WORKING_DIR,
    process.env.HERMES_CLI_COMMAND,
    process.env.HERMES_REMOTE_COMMAND,
  ].filter(Boolean);

  for (const value of sensitiveValues) {
    message = message.split(String(value)).join('[redacted]');
  }

  return message
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted-url]')
    .replace(/(?:\/Users|\/home|\/root|[A-Za-z]:\\)[^\s"'<>]*/g, '[redacted-path]')
    .replace(/\b(?:[\w.-]+@)?(?:\d{1,3}\.){3}\d{1,3}\b/g, '[redacted-host]')
    .slice(0, 240);
}

export function getHermesModeConfiguration() {
  const chatEnabled = isEnabled(process.env.HERMES_CHAT_ENABLED);
  const chatAllowed = process.env.HERMES_CHAT_ENABLED !== 'false';
  const selectedMode = String(
    process.env.HERMES_CONNECTION_MODE || process.env.HERMES_CHAT_MODE || ''
  ).toLowerCase();
  const httpConfigured = !!process.env.HERMES_API_URL
    && (isEnabled(process.env.HERMES_ENABLED) || chatAllowed);
  const sshConfigured = chatAllowed
    && !!process.env.HERMES_SSH_HOST
    && !!process.env.HERMES_SSH_KEY;
  const cliConfigured = chatAllowed
    && (chatEnabled || selectedMode === 'cli' || !!process.env.HERMES_CLI_COMMAND);

  return {
    http: httpConfigured,
    ssh: sshConfigured,
    cli: cliConfigured,
  };
}

export function getCanonicalHermesMode() {
  const configuredModes = getHermesModeConfiguration();
  const explicitMode = String(
    process.env.HERMES_CONNECTION_MODE || process.env.HERMES_CHAT_MODE || ''
  ).toLowerCase();

  // Explicit configuration wins. Otherwise select the first configured mode
  // in canonical priority order. CLI remains the compatibility fallback.
  const mode = VALID_MODES.has(explicitMode)
    ? explicitMode
    : (['http', 'ssh', 'cli'].find(candidate => configuredModes[candidate]) || 'cli');

  return {
    mode,
    configured: configuredModes[mode] === true,
    configuredModes,
  };
}

export function recordHermesRuntimeResult(mode, result) {
  const checkedAt = new Date().toISOString();
  const ok = result?.ok === true;

  runtimeEvidence = {
    mode,
    reachable: ok,
    verified: ok,
    lastChecked: checkedAt,
    error: ok ? null : sanitizeHermesError(result?.error || 'Hermes connection failed'),
  };
}

async function checkHttpHealth() {
  const apiUrl = process.env.HERMES_API_URL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  const checkedAt = new Date().toISOString();

  try {
    const response = await fetch(`${apiUrl.replace(/\/+$/, '')}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    runtimeEvidence = {
      mode: 'http',
      reachable: true,
      verified: response.ok,
      lastChecked: checkedAt,
      error: response.ok ? null : `Hermes health check returned HTTP ${response.status}`,
    };
  } catch (error) {
    clearTimeout(timer);
    runtimeEvidence = {
      mode: 'http',
      reachable: false,
      verified: false,
      lastChecked: checkedAt,
      error: sanitizeHermesError(
        error?.name === 'AbortError' ? 'Hermes health check timed out' : error
      ),
    };
  }
}

export async function getHermesHealthSummary({ checkHttp = false } = {}) {
  const { mode, configured } = getCanonicalHermesMode();

  if (!configured) {
    return {
      mode,
      configured: false,
      reachable: false,
      verified: false,
      status: 'not_configured',
      lastChecked: null,
      error: null,
    };
  }

  if (mode === 'http' && checkHttp) {
    await checkHttpHealth();
  }

  const evidence = runtimeEvidence.mode === mode ? runtimeEvidence : null;
  if (!evidence?.lastChecked) {
    return {
      mode,
      configured: true,
      reachable: null,
      verified: false,
      status: 'configured_unverified',
      lastChecked: null,
      error: null,
    };
  }

  return {
    mode,
    configured: true,
    reachable: evidence.reachable,
    verified: evidence.verified,
    status: evidence.verified ? 'verified' : 'failed',
    lastChecked: evidence.lastChecked,
    error: evidence.error ? sanitizeHermesError(evidence.error) : null,
  };
}
