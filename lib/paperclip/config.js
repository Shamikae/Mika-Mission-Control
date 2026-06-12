if (typeof window !== 'undefined') {
  throw new Error('Paperclip configuration is server-only');
}

const DEFAULT_REFRESH_MS = 15000;
const MIN_REFRESH_MS = 5000;
const MAX_REFRESH_MS = 300000;
const COMPANY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const COMPANY_PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/_-]{0,255}$/;

function parseEnabled(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function parseHttpUrl(value, field, errors) {
  if (!value) {
    errors.push(`${field} is required when Paperclip is enabled`);
    return null;
  }

  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) {
      errors.push(`${field} must use http or https`);
      return null;
    }
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url;
  } catch {
    errors.push(`${field} must be a valid absolute URL`);
    return null;
  }
}

function parseRefreshMs(value, errors) {
  if (!value) return DEFAULT_REFRESH_MS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < MIN_REFRESH_MS || parsed > MAX_REFRESH_MS) {
    errors.push(`PAPERCLIP_REFRESH_MS must be an integer between ${MIN_REFRESH_MS} and ${MAX_REFRESH_MS}`);
    return DEFAULT_REFRESH_MS;
  }
  return parsed;
}

function normalizeCompanyPath(value, errors) {
  const normalized = String(value || '').trim().replace(/^\/+|\/+$/g, '');
  if (!normalized) {
    errors.push('PAPERCLIP_COMPANY_PATH is required when Paperclip is enabled');
    return null;
  }
  if (!COMPANY_PATH_PATTERN.test(normalized) || normalized.split('/').includes('..')) {
    errors.push('PAPERCLIP_COMPANY_PATH contains unsupported characters');
    return null;
  }
  return normalized;
}

export function loadPaperclipConfig(env = process.env) {
  const enabled = parseEnabled(env.PAPERCLIP_ENABLED);
  if (!enabled) {
    return Object.freeze({
      enabled: false,
      configured: false,
      state: 'disabled',
      errors: Object.freeze([]),
      appUrl: null,
      apiUrl: null,
      companyId: null,
      companyPath: null,
      refreshMs: DEFAULT_REFRESH_MS,
    });
  }

  const errors = [];
  const appUrl = parseHttpUrl(env.PAPERCLIP_APP_URL, 'PAPERCLIP_APP_URL', errors);
  const apiUrl = parseHttpUrl(env.PAPERCLIP_API_URL, 'PAPERCLIP_API_URL', errors);
  const companyId = String(env.PAPERCLIP_COMPANY_ID || '').trim();
  const companyPath = normalizeCompanyPath(env.PAPERCLIP_COMPANY_PATH, errors);
  const refreshMs = parseRefreshMs(env.PAPERCLIP_REFRESH_MS, errors);

  if (!companyId) {
    errors.push('PAPERCLIP_COMPANY_ID is required when Paperclip is enabled');
  } else if (!COMPANY_ID_PATTERN.test(companyId)) {
    errors.push('PAPERCLIP_COMPANY_ID contains unsupported characters');
  }

  return Object.freeze({
    enabled: true,
    configured: errors.length === 0,
    state: errors.length === 0 ? 'configured' : 'configuration_pending',
    errors: Object.freeze(errors),
    appUrl,
    apiUrl,
    companyId: companyId || null,
    companyPath,
    refreshMs,
  });
}

export const PAPERCLIP_VIEW_PATHS = Object.freeze({
  issues: '/issues',
  active: '/issues/active',
  done: '/issues/done',
  org: '/org',
  dashboard: '/dashboard',
  costs: '/costs',
});
