// lib/heygen/heygenDiscoveryCache.js
// SERVER-SIDE, MEMORY-ONLY. No fs, no persistence — cleared on process
// restart, and explicitly invalidated on disconnect (see disconnectHeyGen()
// in heygenMcpClient.js). Exists only to avoid repeated large MCP
// list_avatar_looks/list_voices/listTools round-trips on every UI render.
// Only ever holds the SANITIZED shapes already stripped of OAuth data by
// heygenMcpClient.js — never raw tool responses, never tokens.

const TTL_MS = 5 * 60 * 1000; // short — never a permanent runtime record

const store = new Map();

export function getCachedHeyGenDiscovery(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

export function setCachedHeyGenDiscovery(key, value) {
  store.set(key, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

export function invalidateHeyGenDiscoveryCache() {
  store.clear();
}
