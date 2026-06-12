import { loadPaperclipConfig, PAPERCLIP_VIEW_PATHS } from './config';

const REQUEST_TIMEOUT_MS = 6000;
const ATTACHMENT_TIMEOUT_MS = 8000;

export class PaperclipConfigurationError extends Error {
  constructor(state, message) {
    super(message);
    this.name = 'PaperclipConfigurationError';
    this.state = state;
  }
}

function requireConfigured() {
  const config = loadPaperclipConfig();
  if (!config.enabled) {
    throw new PaperclipConfigurationError('disabled', 'Paperclip is disabled');
  }
  if (!config.configured) {
    throw new PaperclipConfigurationError('configuration_pending', 'Paperclip configuration is incomplete');
  }
  return config;
}

function appendPath(baseUrl, relativePath) {
  const target = new URL(baseUrl.toString());
  const [pathPart, queryString = ''] = String(relativePath || '').split('?', 2);
  const suffix = pathPart.replace(/^\/+/, '');
  target.pathname = `${target.pathname.replace(/\/+$/, '')}/${suffix}`.replace(/\/{2,}/g, '/');
  target.search = queryString ? `?${queryString}` : '';
  target.hash = '';

  if (target.origin !== baseUrl.origin || !['http:', 'https:'].includes(target.protocol)) {
    throw new Error('Paperclip target origin is not allowed');
  }

  return target;
}

export function getPaperclipPublicMetadata() {
  const config = loadPaperclipConfig();
  const base = {
    enabled: config.enabled,
    configured: config.configured,
    state: config.state,
    refreshMs: config.refreshMs,
    views: {},
  };

  if (!config.configured) return base;

  const workspaceBase = appendPath(config.appUrl, config.companyPath);
  const views = Object.fromEntries(
    Object.entries(PAPERCLIP_VIEW_PATHS).map(([key, viewPath]) => [
      key,
      appendPath(workspaceBase, viewPath).toString(),
    ])
  );

  return {
    ...base,
    workspaceUrl: workspaceBase.toString(),
    views,
  };
}

export function buildPaperclipIssueUrl(issueId) {
  const config = requireConfigured();
  const workspaceBase = appendPath(config.appUrl, config.companyPath);
  return appendPath(workspaceBase, `/issues/${encodeURIComponent(issueId)}`).toString();
}

export async function fetchPaperclipJson(relativePath, fallback) {
  const config = requireConfigured();
  const target = appendPath(config.apiUrl, relativePath);

  try {
    const response = await fetch(target, {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      return { ok: false, status: response.status, data: fallback, error: `Paperclip returned HTTP ${response.status}` };
    }

    return { ok: true, status: response.status, data: await response.json(), error: null };
  } catch (error) {
    return { ok: false, status: null, data: fallback, error: error.message || 'Paperclip request failed' };
  }
}

export async function fetchPaperclipAttachment(attachmentId) {
  const config = requireConfigured();
  const target = appendPath(config.apiUrl, `/attachments/${encodeURIComponent(attachmentId)}/content`);

  return fetch(target, {
    method: 'GET',
    cache: 'no-store',
    headers: { Accept: 'image/*' },
    signal: AbortSignal.timeout(ATTACHMENT_TIMEOUT_MS),
  });
}

export function getPaperclipCompanyId() {
  return requireConfigured().companyId;
}
