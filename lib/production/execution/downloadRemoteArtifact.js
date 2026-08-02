// lib/production/execution/downloadRemoteArtifact.js
// SERVER-SIDE ONLY.
//
// Generic https-only, MIME-validated, size-bounded, timeout-bounded remote
// artifact downloader — modeled directly on the proven download pattern in
// lib/openart/openartMcpClient.js's downloadOpenArtImage(), generalized
// beyond images for a future real provider adapter. Neither of this
// milestone's two adapters (manual-export, mock-video) actually produce a
// remote URL output — both are local-buffer only — but the contract
// requires this path to exist and be safe for when a real adapter is added.

import { isAllowedArtifactMime, maxBytesForMime, ARTIFACT_DOWNLOAD_TIMEOUT_MS } from './executionRules.js';

export async function downloadRemoteArtifact(url, expectedMimeType) {
  if (typeof url !== 'string' || !url.startsWith('https://')) {
    throw new Error('Only https:// provider URLs are allowed for remote artifact downloads.');
  }

  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(ARTIFACT_DOWNLOAD_TIMEOUT_MS) });
  } catch (e) {
    throw new Error(`Could not reach provider URL: ${e.message}`);
  }
  if (!response.ok) throw new Error(`Provider URL returned HTTP ${response.status}`);

  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const effectiveMime = contentType || expectedMimeType;

  if (!isAllowedArtifactMime(effectiveMime)) {
    throw new Error(`MIME type "${effectiveMime}" is not in the artifact allowlist.`);
  }
  if (expectedMimeType && contentType && contentType !== expectedMimeType) {
    throw new Error(`Content-Type mismatch: expected "${expectedMimeType}", got "${contentType}".`);
  }

  const maxBytes = maxBytesForMime(effectiveMime);
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength && declaredLength > maxBytes) {
    throw new Error('Declared content length exceeds the allowed maximum.');
  }

  let arrayBuffer;
  try {
    arrayBuffer = await response.arrayBuffer();
  } catch (e) {
    throw new Error(`Failed to read provider response body: ${e.message}`);
  }
  if (arrayBuffer.byteLength > maxBytes) {
    throw new Error('Downloaded content exceeds the allowed maximum size.');
  }

  return { buffer: Buffer.from(arrayBuffer), mimeType: effectiveMime };
}
