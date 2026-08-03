import { useState, useEffect, useCallback } from 'react';
import { FiAlertCircle, FiCheckCircle, FiLink, FiRefreshCw, FiXCircle } from 'react-icons/fi';

// ── HeyGen MCP Connection panel ────────────────────────────────────────────
// Checkpoint 1 only: OAuth connect/status/disconnect + sanitized tool count
// and account/plan summary. Never shows tokens, client secrets, the raw
// account response, or any video generation controls (that is Checkpoint 2).

function StatusPill({ status }) {
  const meta = {
    staged:                  { label: 'Disabled', color: '#5d6c86' },
    authentication_required: { label: 'Authentication Required', color: '#f59e0b' },
    connected:               { label: 'Connected', color: '#4ade80' },
  }[status] || { label: status || 'Unknown', color: '#5d6c86' };

  return (
    <span className="pr-status-badge font-mono" style={{ color: meta.color, background: `${meta.color}1f`, borderColor: `${meta.color}40` }}>
      {meta.label}
    </span>
  );
}

export default function HeyGenConnectionPanel() {
  const [status, setStatus] = useState(null);
  const [toolCount, setToolCount] = useState(null);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [redirectNotice, setRedirectNotice] = useState(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/production/providers/heygen/status', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && data.ok) {
        setStatus(data);
        if (data.status === 'connected') {
          const toolsRes = await fetch('/api/production/providers/heygen/tools', { cache: 'no-store' }).catch(() => null);
          const toolsData = toolsRes && toolsRes.ok ? await toolsRes.json() : null;
          setToolCount(toolsData?.ok ? toolsData.count : null);
        } else {
          setToolCount(null);
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  // Pick up the honest redirect state left by the OAuth callback route, then
  // clean the URL so refreshing the page doesn't re-show a stale notice.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthState = params.get('heygen_oauth');
    if (!oauthState) return;
    const reason = params.get('reason');
    setRedirectNotice({ state: oauthState, reason });
    params.delete('heygen_oauth');
    params.delete('reason');
    const next = params.toString();
    window.history.replaceState({}, '', next ? `${window.location.pathname}?${next}` : window.location.pathname);
    loadStatus();
  }, [loadStatus]);

  const connect = async () => {
    setConnecting(true);
    setActionError(null);
    try {
      const res = await fetch('/api/production/providers/heygen/connect', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.ok && data.authorizationUrl) {
        window.location.href = data.authorizationUrl;
        return; // navigating away
      }
      if (res.ok && data.ok && data.status === 'authorized') {
        await loadStatus();
        return;
      }
      setActionError(data.error || 'Could not start HeyGen authorization.');
    } catch (err) {
      setActionError(err.message || 'Request failed.');
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    setDisconnecting(true);
    setActionError(null);
    try {
      const res = await fetch('/api/production/providers/heygen/disconnect', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.ok) await loadStatus();
      else setActionError(data.error || 'Disconnect failed.');
    } finally {
      setDisconnecting(false);
    }
  };

  if (!status) {
    return (
      <div className="pr-section">
        <div className="pr-section-head"><span className="font-ui">HeyGen (MCP)</span></div>
        <div className="thumb-empty font-mono" style={{ padding: '12px 0' }}>Loading connection status…</div>
      </div>
    );
  }

  return (
    <div className="pr-section pr-heygen-panel">
      <div className="pr-section-head">
        <span className="font-ui">HeyGen (MCP)</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <StatusPill status={status.status} />
          <button type="button" className="thumb-icon-btn" onClick={loadStatus} disabled={loading} title="Refresh status">
            <FiRefreshCw size={11} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {redirectNotice && (
        <div className={`pr-warning font-mono${redirectNotice.state === 'connected' ? '' : ''}`} style={redirectNotice.state === 'connected' ? { background: 'rgba(74,222,128,0.1)', borderColor: 'rgba(74,222,128,0.3)', color: '#4ade80' } : {}}>
          {redirectNotice.state === 'connected' ? <FiCheckCircle size={11} /> : <FiAlertCircle size={11} />}
          {redirectNotice.state === 'connected'
            ? ' Connected to HeyGen.'
            : redirectNotice.state === 'domain_not_whitelisted'
              ? ` HeyGen rejected this domain/redirect URI: ${redirectNotice.reason || 'not whitelisted'}.`
              : ` HeyGen authorization failed: ${redirectNotice.reason || 'unknown error'}.`}
        </div>
      )}

      {status.domainWhitelistingRequired && (
        <div className="pr-warning font-mono">
          <FiAlertCircle size={11} /> HeyGen has not whitelisted this application's domain/redirect URI
          (the configured <code>HEYGEN_MCP_OAUTH_REDIRECT_URL</code>). This Mika Mission Control domain
          may need to be submitted to HeyGen's integration intake process before OAuth can succeed.
        </div>
      )}

      {actionError && (
        <div className="pr-warning font-mono"><FiAlertCircle size={11} /> {actionError}</div>
      )}

      {status.status === 'staged' && (
        <p className="pr-reason-text font-mono">HeyGen MCP is disabled. Set <code>HEYGEN_MCP_ENABLED=true</code> to enable connecting (Checkpoint 1: OAuth + tool discovery only — no generation).</p>
      )}

      {status.status !== 'staged' && (
        <div className="pr-exec-meta font-mono">
          <span>MCP URL: {status.mcpUrl}</span>
          <span>Client registered: {status.clientRegistered ? 'Yes' : 'No'}</span>
          {status.connectedAt && <span>Connected: {new Date(status.connectedAt).toLocaleString()}</span>}
          {status.status === 'connected' && <span>Tools discovered: {toolCount ?? '—'}</span>}
        </div>
      )}

      {status.status === 'connected' && status.accountSummary && (
        <div className="pr-exec-meta font-mono">
          {status.accountSummary.planName && <span>Plan: {status.accountSummary.planName}</span>}
          {status.accountSummary.remainingCredits != null && <span>Credits remaining: {status.accountSummary.remainingCredits}</span>}
          {status.accountSummary.accountName && <span>Account: {status.accountSummary.accountName}</span>}
        </div>
      )}
      {status.status === 'connected' && !status.accountSummary && (
        <p className="pr-reason-text font-mono">No account/plan tool was found in the discovered tool list — connection is otherwise healthy.</p>
      )}

      <div className="pr-exec-actions">
        {status.status === 'authentication_required' && (
          <button type="button" className="pr-btn pr-btn--approve font-ui" onClick={connect} disabled={connecting}>
            {connecting ? <><FiRefreshCw size={12} className="spin" /> Connecting…</> : <><FiLink size={12} /> Connect HeyGen</>}
          </button>
        )}
        {status.status === 'connected' && (
          <button type="button" className="pr-btn pr-btn--reject font-ui" onClick={disconnect} disabled={disconnecting}>
            {disconnecting ? <><FiRefreshCw size={12} className="spin" /> Disconnecting…</> : <><FiXCircle size={12} /> Disconnect</>}
          </button>
        )}
      </div>
    </div>
  );
}
