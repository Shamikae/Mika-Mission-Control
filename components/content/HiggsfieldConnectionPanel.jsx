import { useState, useEffect, useCallback } from 'react';
import { FiAlertCircle, FiCheckCircle, FiLink, FiRefreshCw, FiXCircle } from 'react-icons/fi';

// ── Higgsfield MCP Connection panel ─────────────────────────────────────────
// Checkpoint 1: OAuth connect/status/disconnect + sanitized tool count and
// account/plan/credit summary. Checkpoint 2 adds the honest generation-
// readiness note below (required tools present). Never shows tokens, client
// secrets, the raw account response, or bypasses the explicit approval gate
// in HiggsfieldSetupPanel for any real generation.

function StatusPill({ status }) {
  const meta = {
    staged:                   { label: 'Disabled', color: '#5d6c86' },
    authentication_required:  { label: 'Authentication Required', color: '#f59e0b' },
    refresh_required:         { label: 'Reconnect Required', color: '#f59e0b' },
    authorization_error:      { label: 'Authorization Error', color: '#f87171' },
    token_present_unverified: { label: 'Unverified', color: '#60a5fa' },
    connected_verified:       { label: 'Connected', color: '#4ade80' },
  }[status] || { label: status || 'Unknown', color: '#5d6c86' };

  return (
    <span className="pr-status-badge font-mono" style={{ color: meta.color, background: `${meta.color}1f`, borderColor: `${meta.color}40` }}>
      {meta.label}
    </span>
  );
}

export default function HiggsfieldConnectionPanel() {
  const [status, setStatus] = useState(null);
  const [toolCount, setToolCount] = useState(null);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [redirectNotice, setRedirectNotice] = useState(null);
  // Set only when the browser blocked the consent tab — rendered as a
  // clickable fallback so a blocked popup never dead-ends the flow.
  const [manualAuthUrl, setManualAuthUrl] = useState(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/production/providers/higgsfield/status', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && data.ok) {
        setStatus(data);
        // Tools are only fetched for a session a real call has verified.
        if (data.status === 'connected_verified') {
          const toolsRes = await fetch('/api/production/providers/higgsfield/tools', { cache: 'no-store' }).catch(() => null);
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
    const oauthState = params.get('higgsfield_oauth');
    if (!oauthState) return;
    const reason = params.get('reason');
    setRedirectNotice({ state: oauthState, reason });
    params.delete('higgsfield_oauth');
    params.delete('reason');
    const next = params.toString();
    window.history.replaceState({}, '', next ? `${window.location.pathname}?${next}` : window.location.pathname);
    loadStatus();
  }, [loadStatus]);

  // Typed failure text. A bare 401 here means this browser session carries no
  // Mika admin token, which silently breaks EVERY mutation button — not just
  // this panel. Saying so is far more useful than "Request failed".
  const describeFailure = (res, data) => {
    if (res.status === 401 || data?.code === 'authentication_required') {
      return 'Not authorized in this browser: no Mika admin token is present for this session, so the request was rejected before reaching Higgsfield. Every mutation button is affected, not just this panel.';
    }
    if (res.status === 503 || data?.code === 'disabled') return 'Higgsfield MCP is disabled. Set HIGGSFIELD_MCP_ENABLED=true.';
    if (data?.code === 'invalid_redirect') return 'The OAuth redirect URL is not allowlisted.';
    if (data?.code === 'registration_failed') return 'Dynamic client registration with Higgsfield failed.';
    return data?.error || `Request failed (HTTP ${res.status}).`;
  };

  const connect = async () => {
    setConnecting(true);
    setActionError(null);
    setManualAuthUrl(null);
    try {
      const res = await fetch('/api/production/providers/higgsfield/connect', { method: 'POST' });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.ok && data.authorizationUrl) {
        // A refresh may have silently succeeded; otherwise send the operator to
        // consent. Opened in a new tab so the workspace is not torn down — if
        // the popup is blocked, the URL is shown as a clickable fallback.
        const opened = window.open(data.authorizationUrl, '_blank', 'noopener,noreferrer');
        if (!opened) setManualAuthUrl(data.authorizationUrl);
        return;
      }
      if (res.ok && data.ok && data.status === 'authorized') {
        await loadStatus();
        return;
      }
      setActionError(describeFailure(res, data));
    } catch (err) {
      setActionError(err.message || 'Request failed.');
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    setDisconnecting(true);
    setActionError(null);
    setManualAuthUrl(null);
    try {
      const res = await fetch('/api/production/providers/higgsfield/disconnect', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      // Status is refreshed on BOTH paths — a failed disconnect must never
      // leave a stale "Connected" label behind.
      if (res.ok && data.ok) {
        await loadStatus();
      } else {
        setActionError(describeFailure(res, data));
        await loadStatus();
      }
    } catch (err) {
      setActionError(err.message || 'Request failed.');
      await loadStatus();
    } finally {
      setDisconnecting(false);
    }
  };

  // Derived from the new verified-status semantics. `connected` no longer
  // exists as a state: a session is only "connected" once a real
  // authenticated call has proven it (connected_verified).
  const isVerified = status?.status === 'connected_verified';
  const needsReconnect = status?.reconnectRequired === true;
  const isUnverified = status?.status === 'token_present_unverified';

  if (!status) {
    return (
      <div className="pr-section">
        <div className="pr-section-head"><span className="font-ui">Higgsfield (MCP)</span></div>
        <div className="thumb-empty font-mono" style={{ padding: '12px 0' }}>Loading connection status…</div>
      </div>
    );
  }

  return (
    <div className="pr-section pr-heygen-panel">
      <div className="pr-section-head">
        <span className="font-ui">Higgsfield (MCP)</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <StatusPill status={status.status} />
          <button type="button" className="thumb-icon-btn" onClick={loadStatus} disabled={loading} title="Refresh status">
            <FiRefreshCw size={11} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {redirectNotice && (
        <div className="pr-warning font-mono" style={redirectNotice.state === 'connected' ? { background: 'rgba(74,222,128,0.1)', borderColor: 'rgba(74,222,128,0.3)', color: '#4ade80' } : {}}>
          {redirectNotice.state === 'connected' ? <FiCheckCircle size={11} /> : <FiAlertCircle size={11} />}
          {redirectNotice.state === 'connected'
            ? ' Connected to Higgsfield.'
            : redirectNotice.state === 'domain_not_whitelisted'
              ? ` Higgsfield rejected this domain/redirect URI: ${redirectNotice.reason || 'not whitelisted'}.`
              : ` Higgsfield authorization failed: ${redirectNotice.reason || 'unknown error'}.`}
        </div>
      )}

      {status.domainWhitelistingRequired && (
        <div className="pr-warning font-mono">
          <FiAlertCircle size={11} /> Higgsfield has not whitelisted this application's domain/redirect URI
          (the configured <code>HIGGSFIELD_MCP_OAUTH_REDIRECT_URL</code>). This Mika Mission Control domain
          may need to be submitted to Higgsfield's integration intake process before OAuth can succeed.
        </div>
      )}

      {isUnverified && (
        <div className="pr-reason-text font-mono">
          Tokens are stored but unproven — no authenticated call has succeeded yet this session.
          Status resolves to Connected only after a real provider call verifies it.
        </div>
      )}

      {actionError && (
        <div className="pr-warning font-mono"><FiAlertCircle size={11} /> {actionError}</div>
      )}

      {manualAuthUrl && (
        <div className="pr-warning font-mono">
          <FiAlertCircle size={11} /> The consent tab was blocked by the browser. Open this authorization link manually:
          <div style={{ marginTop: 6, wordBreak: 'break-all' }}>
            <a href={manualAuthUrl} target="_blank" rel="noopener noreferrer">{manualAuthUrl}</a>
          </div>
        </div>
      )}

      {status.status === 'staged' && (
        <p className="pr-reason-text font-mono">Higgsfield MCP is disabled. Set <code>HIGGSFIELD_MCP_ENABLED=true</code> to enable connecting (OAuth + tool discovery — generation requires explicit setup and approval below).</p>
      )}

      {status.status !== 'staged' && (
        <div className="pr-exec-meta font-mono">
          <span>MCP URL: {status.mcpUrl}</span>
          <span>Client registered: {status.clientRegistered ? 'Yes' : 'No'}</span>
          {status.connectedAt && <span>Connected: {new Date(status.connectedAt).toLocaleString()}</span>}
          {isVerified && <span>Tools discovered: {toolCount ?? '—'}</span>}
        </div>
      )}

      {isVerified && status.accountSummary && (
        <div className="pr-exec-meta font-mono">
          {status.accountSummary.planName && <span>Plan: {status.accountSummary.planName}</span>}
          {status.accountSummary.remainingCredits != null && <span>Credits remaining: {status.accountSummary.remainingCredits}</span>}
          {status.accountSummary.accountName && <span>Account: {status.accountSummary.accountName}</span>}
        </div>
      )}
      {isVerified && !status.accountSummary && (
        <p className="pr-reason-text font-mono">No account/plan tool was found in the discovered tool list — connection is otherwise healthy.</p>
      )}

      {isVerified && (
        <p className="pr-reason-text font-mono">
          Only image and video generation (via generate_image/generate_video) are wired into Mika — Higgsfield's
          much larger live tool surface (website building, game deployment, TikTok publishing, marketplace apps,
          a shell sandbox, and more) is deliberately never called from this integration.
        </p>
      )}

      <div className="pr-exec-actions">
        {needsReconnect && (
          <button type="button" className="pr-btn pr-btn--approve font-ui" onClick={connect} disabled={connecting}>
            {connecting ? <><FiRefreshCw size={12} className="spin" /> Connecting…</> : <><FiLink size={12} /> Connect Higgsfield</>}
          </button>
        )}
        {isVerified && (
          <button type="button" className="pr-btn pr-btn--reject font-ui" onClick={disconnect} disabled={disconnecting}>
            {disconnecting ? <><FiRefreshCw size={12} className="spin" /> Disconnecting…</> : <><FiXCircle size={12} /> Disconnect</>}
          </button>
        )}
      </div>
    </div>
  );
}
