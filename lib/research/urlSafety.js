// lib/research/urlSafety.js
// Pure functions — no I/O, no fs, no network. The ONE place URL safety and
// canonicalization rules live for the live research pipeline. Sources are
// evidence, not trusted truth — but nothing here decides truthfulness, only
// whether a URL is safe enough to ever store or link to.

const PRIVATE_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./, // link-local
  /^::1$/,
  /^\[?::1\]?$/,
  /^fc[0-9a-f]{2}:/i, // unique local IPv6
  /^fe80:/i, // link-local IPv6
];

// 172.16.0.0 – 172.31.255.255
function isPrivate172(hostname) {
  const m = hostname.match(/^172\.(\d{1,3})\./);
  if (!m) return false;
  const second = Number(m[1]);
  return second >= 16 && second <= 31;
}

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'gclid', 'fbclid', 'msclkid', 'mc_cid', 'mc_eid', 'igshid', 'ref', 'ref_src',
]);

/**
 * @returns {{ safe: boolean, reason?: string }}
 */
export function isSafeWebUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return { safe: false, reason: 'empty_url' };
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { safe: false, reason: 'unparseable_url' };
  }
  if (parsed.protocol !== 'https:') return { safe: false, reason: 'non_https_scheme' };

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (PRIVATE_HOSTNAME_PATTERNS.some(p => p.test(hostname)) || isPrivate172(hostname)) {
    return { safe: false, reason: 'private_or_local_host' };
  }
  if (!hostname.includes('.') && hostname !== '::1') {
    return { safe: false, reason: 'not_a_public_hostname' };
  }
  return { safe: true };
}

/** Strips known tracking query params; returns the URL unchanged if parsing fails. */
export function stripTrackingParams(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) parsed.searchParams.delete(key);
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

/**
 * A canonical dedupe key: lowercase host, no trailing slash, no fragment,
 * tracking params stripped, query params sorted. Two URLs that differ only
 * by tracking params or param order collapse to the same key.
 */
export function canonicalUrlKey(rawUrl) {
  try {
    const stripped = stripTrackingParams(rawUrl);
    const parsed = new URL(stripped);
    parsed.hash = '';
    const sortedParams = [...parsed.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
    parsed.search = '';
    for (const [k, v] of sortedParams) parsed.searchParams.append(k, v);
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${parsed.hostname.toLowerCase()}${path}${parsed.search}`;
  } catch {
    return rawUrl;
  }
}

export function extractDomain(rawUrl) {
  try {
    return new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}
