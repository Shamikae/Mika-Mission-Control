import { useState, useEffect, useCallback } from 'react';
import { FiAlertCircle, FiCheckCircle, FiLink, FiRefreshCw, FiXCircle } from 'react-icons/fi';

// ── OpenArt MCP Connection panel ────────────────────────────────────────────
// Connection status (mirrors HeyGenConnectionPanel/HiggsfieldConnectionPanel)
// plus a live, browse-only IMAGE model catalog dropdown. OpenArt does real
// image generation (used for package thumbnails — see
// lib/openart/openartMcpClient.js's generateOpenArtImage()); this dropdown
// stays informational-only for that image catalog, since standalone image
// generation still has no job-submission flow inside Production Router
// (only the Content Workforce/thumbnail path uses it).
//
// OpenArt Video is now a REAL, separate execution adapter — see
// lib/production/execution/adapters/openartVideoMcp.adapter.js and
// OpenArtVideoSetupPanel.jsx (rendered per-job when
// job.selectedProvider === 'openart-video'). Both share this SAME OAuth
// connection/session — connect here once, and it covers image (this panel)
// and video (the per-job Setup panel) alike.

function StatusPill({ status }) {
  const meta = {
    staged:                   { label: 'Disabled', color: '#5d6c86' },
    authentication_required:  { label: 'Authentication Required', color: '#f59e0b' },
    connected:                { label: 'Connected', color: '#4ade80' },
  }[status] || { label: status || 'Unknown', color: '#5d6c86' };

  return (
    <span className="pr-status-badge font-mono" style={{ color: meta.color, background: `${meta.color}1f`, borderColor: `${meta.color}40` }}>
      {meta.label}
    </span>
  );
}

export default function OpenArtConnectionPanel() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [redirectNotice, setRedirectNotice] = useState(null);

  const [models, setModels] = useState(null);
  const [modelsError, setModelsError] = useState(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState('');

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/openart/status', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && data.ok) setStatus(data);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadModels = useCallback(async () => {
    setModelsLoading(true);
    setModelsError(null);
    try {
      const res = await fetch('/api/production/providers/openart/models', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && data.ok) {
        setModels(data.models);
        setSelectedModelId(prev => (data.models.some(m => m.id === prev) ? prev : (data.models[0]?.id || '')));
      } else {
        setModels(null);
        setModelsError(data.error || 'Could not load the OpenArt model catalog.');
      }
    } catch (err) {
      setModels(null);
      setModelsError(err.message || 'Request failed.');
    } finally {
      setModelsLoading(false);
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);
  useEffect(() => { if (status?.status === 'connected') loadModels(); }, [status?.status, loadModels]);

  // Pick up the honest redirect state left by the OAuth callback route, then
  // clean the URL so refreshing the page doesn't re-show a stale notice.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthState = params.get('openart_oauth');
    if (!oauthState) return;
    const reason = params.get('reason');
    setRedirectNotice({ state: oauthState, reason });
    params.delete('openart_oauth');
    params.delete('reason');
    const next = params.toString();
    window.history.replaceState({}, '', next ? `${window.location.pathname}?${next}` : window.location.pathname);
    loadStatus();
  }, [loadStatus]);

  const connect = async () => {
    setConnecting(true);
    setActionError(null);
    try {
      const res = await fetch('/api/openart/connect', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.ok && data.authorizationUrl) {
        window.location.href = data.authorizationUrl;
        return; // navigating away
      }
      if (res.ok && data.ok && data.status === 'authorized') {
        await loadStatus();
        return;
      }
      setActionError(data.error || 'Could not start OpenArt authorization.');
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
      const res = await fetch('/api/openart/disconnect', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.ok) {
        setModels(null);
        setSelectedModelId('');
        await loadStatus();
      } else {
        setActionError(data.error || 'Disconnect failed.');
      }
    } finally {
      setDisconnecting(false);
    }
  };

  if (!status) {
    return (
      <div className="pr-section">
        <div className="pr-section-head"><span className="font-ui">OpenArt</span></div>
        <div className="thumb-empty font-mono" style={{ padding: '12px 0' }}>Loading connection status…</div>
      </div>
    );
  }

  return (
    <div className="pr-section pr-heygen-panel">
      <div className="pr-section-head">
        <span className="font-ui">OpenArt</span>
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
            ? ' Connected to OpenArt.'
            : ` OpenArt authorization failed: ${redirectNotice.reason || 'unknown error'}.`}
        </div>
      )}

      {actionError && (
        <div className="pr-warning font-mono"><FiAlertCircle size={11} /> {actionError}</div>
      )}

      {status.status === 'staged' && (
        <p className="pr-reason-text font-mono">OpenArt MCP is disabled. Set <code>OPENART_ENABLED=true</code> to enable connecting (OAuth + model discovery).</p>
      )}

      {status.status !== 'staged' && (
        <div className="pr-exec-meta font-mono">
          <span>MCP URL: {status.mcpUrl}</span>
          <span>Client registered: {status.clientRegistered ? 'Yes' : 'No'}</span>
          {status.connectedAt && <span>Connected: {new Date(status.connectedAt).toLocaleString()}</span>}
        </div>
      )}

      {status.status === 'connected' && (
        <p className="pr-reason-text font-mono">
          The catalog below (text2image via openart_model_list) is browse-only — image generation still has no
          job-submission flow inside Production Router (only Content Workforce/thumbnails use it). OpenArt Video
          IS a real, executable Production Router provider (text2video only) — set it up per-job in OpenArt Video
          Setup once you select "OpenArt Video" as a job's provider.
        </p>
      )}

      {status.status === 'connected' && (
        <div className="pr-field" style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label className="pr-field-label font-ui">Model catalog ({models?.length ?? '—'})</label>
            <button type="button" className="thumb-icon-btn" onClick={loadModels} disabled={modelsLoading} title="Refresh model catalog">
              <FiRefreshCw size={11} className={modelsLoading ? 'spin' : ''} />
            </button>
          </div>

          {modelsLoading && !models && (
            <p className="pr-reason-text font-mono">Loading live model catalog…</p>
          )}
          {modelsError && (
            <div className="pr-warning font-mono"><FiAlertCircle size={11} /> {modelsError}</div>
          )}
          {models && models.length > 0 && (
            <>
              <select
                className="pr-select font-mono"
                value={selectedModelId}
                onChange={e => setSelectedModelId(e.target.value)}
              >
                {models.map(m => (
                  <option key={m.id} value={m.id}>{m.id}</option>
                ))}
              </select>
              {selectedModelId && (
                <p className="pr-reason-text font-mono">
                  {models.find(m => m.id === selectedModelId)?.description || 'No description available.'}
                </p>
              )}
            </>
          )}
          {models && models.length === 0 && !modelsError && (
            <p className="pr-reason-text font-mono">OpenArt returned no text2image-capable models.</p>
          )}
        </div>
      )}

      <div className="pr-exec-actions">
        {status.status === 'authentication_required' && (
          <button type="button" className="pr-btn pr-btn--approve font-ui" onClick={connect} disabled={connecting}>
            {connecting ? <><FiRefreshCw size={12} className="spin" /> Connecting…</> : <><FiLink size={12} /> Connect OpenArt</>}
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
