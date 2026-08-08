import { useState, useEffect, useCallback } from 'react';
import { FiAlertCircle, FiRefreshCw } from 'react-icons/fi';

// ── Kie.ai status panel ─────────────────────────────────────────────────────
// Read-only. Shows configuration/auth state, credit balance, the v1 model
// allowlist, and the two facts an operator must know BEFORE approving a Kie
// generation: the estimate is never provider-confirmed, and a submitted task
// cannot be cancelled.
//
// Deliberately not a workflow UI — there is no generate button here. Kie is
// reached only through the existing Asset Plan approval path.

const STATUS_COLOR = {
  active: '#4ade80',
  auth_error: '#f87171',
  unavailable: '#f87171',
  configuration_pending: '#f59e0b',
  disabled: '#5d6c86',
};

const STATUS_LABEL = {
  active: 'Connected',
  auth_error: 'Authentication failed',
  unavailable: 'Unreachable',
  configuration_pending: 'Awaiting API key',
  disabled: 'Disabled',
};

export default function KieStatusPanel() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/production/providers/kie/status', { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) setData(json);
      else setError(res.status === 401 ? 'Not authorized in this browser — sign in with the admin token first.' : json.error || `Request failed (HTTP ${res.status}).`);
    } catch {
      setError('Request failed.');
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const status = data?.status;

  return (
    <div className="pr-section pr-heygen-panel">
      <div className="pr-section-head">
        <span className="font-ui">Kie.ai</span>
        <button type="button" className="thumb-icon-btn" onClick={load} disabled={busy} title="Refresh Kie status">
          <FiRefreshCw size={11} className={busy ? 'spin' : ''} />
        </button>
      </div>

      {error && <div className="pr-warning font-mono"><FiAlertCircle size={11} /> {error}</div>}

      {data && (
        <>
          <div className="pr-exec-meta font-mono">
            <span style={{ color: STATUS_COLOR[status] || 'var(--text-muted)' }}>
              {STATUS_LABEL[status] || status}
            </span>
            <span>Images only</span>
            {/* Never rendered as 0 when unknown — an absent balance is not an empty account. */}
            <span>Balance: {data.balance == null ? '—' : `${data.balance} ${data.balanceCurrency || ''}`}</span>
          </div>

          {data.error && <div className="pr-reason-text font-mono">{data.error}</div>}

          <div className="pr-field">
            <label className="pr-field-label font-ui">v1 models</label>
            <div className="pr-provider-list">
              {(data.models || []).map(m => (
                <div key={m.modelId} className="pr-provider-item" style={{ textAlign: 'left' }}>
                  <div className="pr-provider-item-top">
                    <span>{m.label}</span>
                    <span className="font-mono">
                      {m.pricing ? `${m.pricing.isFloor ? 'from ' : ''}${m.pricing.amount} ${m.pricing.currency}` : 'price unknown'}
                    </span>
                  </div>
                  <div className="pr-provider-reason font-mono">
                    {m.modelId} · {m.aspectRatios.length} aspect ratios{m.resolutions ? ` · ${m.resolutions.join('/')}` : ''}
                    {m.pricing && <div>• {m.pricing.source}</div>}
                    <div>• no negative prompt, no pixel sizing, one image per request</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pr-reason-text font-mono">
            • Estimates are provisional: Kie has no cost-preflight endpoint, so a price is
            taken from published pricing and is never provider-confirmed. The real charge
            is reported in Kie credits only after a task completes.
            <br />
            • No cancellation: Kie documents no way to stop a submitted task. Once approved,
            it runs to completion and may consume credits.
            <br />
            • Result URLs expire ~{Math.round((data.capabilities?.resultUrlTtlSeconds || 600) / 60)} minutes
            after completion; artifacts are downloaded immediately on success.
          </div>
        </>
      )}
    </div>
  );
}
