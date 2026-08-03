// lib/artifacts/normalizeArtifact.js
// Pure, client-safe (no fs, no network, no server-only imports) — used by
// both the browser bundle and any server-side rendering path. Converts a raw
// Production Job execution output (lib/production/execution/executionEngine.js's
// `ingestOutput()` shape: { id, type, mimeType, filename, sizeBytes,
// artifactUrl, metadata }) into the normalized shape every viewer component
// consumes.
//
// Security contract: `type` is derived ONLY from the already-verified
// mimeType (verified server-side at ingestion by
// lib/production/execution/executionRules.js's ARTIFACT_MIME_ALLOWLIST) —
// never from the filename extension. `localUrl` is null (and the whole
// artifact excluded from normalizeArtifactList) unless artifactUrl is a
// same-origin local Mika artifact route — a provider CDN URL can never
// survive this function.

const MIME_TYPE_MAP = {
  'video/mp4': 'video',
  'video/webm': 'video',
  'audio/mpeg': 'audio',
  'audio/wav': 'audio',
  'audio/ogg': 'audio',
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image',
  'application/json': 'json',
  'text/markdown': 'markdown',
  'text/plain': 'text',
  'application/pdf': 'pdf',
};

const LOCAL_ARTIFACT_URL_PREFIX = '/api/production/artifacts/';
const MAX_LABEL_CHARS = 120;

function isLocalArtifactUrl(url) {
  if (typeof url !== 'string' || !url.startsWith(LOCAL_ARTIFACT_URL_PREFIX)) return false;
  // Defensively reject anything that looks like it's trying to smuggle a
  // scheme/host past the prefix check (e.g. "/api/production/artifacts/@evil.com/x").
  return !/^https?:/i.test(url) && !url.includes('://');
}

function clamp(str, max = MAX_LABEL_CHARS) {
  if (typeof str !== 'string' || !str) return '';
  const trimmed = str.trim();
  return trimmed.length > max ? `${trimmed.slice(0, Math.max(0, max - 1))}…` : trimmed;
}

/** Derives a viewer-routing type from a VERIFIED mime type. Never guesses from a filename. */
export function deriveArtifactType(mimeType) {
  return MIME_TYPE_MAP[mimeType] || 'unsupported';
}

export const SUPPORTED_PREVIEW_MIME_TYPES = Object.keys(MIME_TYPE_MAP);

/**
 * @param {object} output — one entry from job.execution.outputs
 * @param {{ job?: object }} ctx
 * @returns {object|null} normalized artifact, or null if the output has no
 *   safe local URL (never renders a provider CDN URL).
 */
export function normalizeArtifact(output, { job } = {}) {
  if (!output || typeof output !== 'object') return null;
  if (!isLocalArtifactUrl(output.artifactUrl)) return null;

  const mimeType = typeof output.mimeType === 'string' && output.mimeType ? output.mimeType : 'application/octet-stream';
  const sizeBytes = typeof output.sizeBytes === 'number' && Number.isFinite(output.sizeBytes) ? output.sizeBytes : null;
  const duration = typeof output.metadata?.durationSeconds === 'number' && Number.isFinite(output.metadata.durationSeconds)
    ? output.metadata.durationSeconds : null;
  const width = typeof output.metadata?.width === 'number' ? output.metadata.width : null;
  const height = typeof output.metadata?.height === 'number' ? output.metadata.height : null;

  return {
    artifactId: typeof output.id === 'string' ? clamp(output.id, 200) : null,
    localUrl: output.artifactUrl,
    filename: clamp(typeof output.filename === 'string' && output.filename ? output.filename : (output.id || 'artifact')),
    mimeType,
    sizeBytes,
    type: deriveArtifactType(mimeType),
    duration,
    width,
    height,
    createdAt: job?.execution?.completedAt || job?.metadata?.updatedAt || null,
    provider: typeof job?.selectedProvider === 'string' ? job.selectedProvider : null,
    productionJobId: typeof job?.id === 'string' ? job.id : null,
    // Not part of the requested shape, but needed by callers to render the
    // "TEST SIMULATION" label without re-deriving it — tolerated extras are
    // fine since the shape's required fields are all still present.
    mock: job?.execution?.mock === true,
    kind: typeof output.metadata?.kind === 'string' ? output.metadata.kind : null,
  };
}

/** Normalizes every output on a job, silently dropping any without a safe local URL. */
export function normalizeArtifactList(outputs, ctx) {
  if (!Array.isArray(outputs)) return [];
  return outputs.map(o => normalizeArtifact(o, ctx)).filter(Boolean);
}

export function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i += 1; }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}

export function formatDuration(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `0:${String(s).padStart(2, '0')}`;
}
