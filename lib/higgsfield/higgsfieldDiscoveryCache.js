// lib/higgsfield/higgsfieldDiscoveryCache.js
// SERVER-SIDE, MEMORY-ONLY. No fs, no persistence — cleared on process
// restart, and explicitly invalidated on disconnect (see
// disconnectHiggsfield() in higgsfieldMcpClient.js). Exists only to avoid
// repeated large MCP listTools()/discovery round-trips on every UI render.
// Only ever holds SANITIZED shapes already stripped of OAuth data by
// higgsfieldMcpClient.js — never raw tool responses, never tokens.

const TTL_MS = 5 * 60 * 1000; // short — never a permanent runtime record

const store = new Map();

export function getCachedHiggsfieldDiscovery(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

export function setCachedHiggsfieldDiscovery(key, value) {
  store.set(key, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

export function invalidateHiggsfieldDiscoveryCache() {
  store.clear();
}
