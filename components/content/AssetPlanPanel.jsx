import { useState, useCallback } from 'react';
import { FiAlertCircle, FiCheckCircle, FiRefreshCw } from 'react-icons/fi';

// ── Asset Plan panel (M3) ───────────────────────────────────────────────────
// Additive: plans every scene's visual, shows what is cached vs paid vs
// placeholder, and presents ONE approval for the whole batch.
//
// Deliberately not a redesign. It exists so the operator can see the total
// before any money moves — seven per-scene approvals would make the pipeline
// unusable, which is why there is a single Approve Plan button.

const STATUS_COLOR = {
  resolved_from_cache: '#4ade80',
  awaiting_generation: '#f59e0b',
  placeholder: '#5d6c86',
  blocked: '#f87171',
};

export default function AssetPlanPanel({ packageId }) {
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [reasons, setReasons] = useState([]);
  // Keyed by unit key — never a single shared number across units.
  const [ceiling, setCeiling] = useState({});
  const [ack, setAck] = useState(false);

  const call = useCallback(async (label, path, body) => {
    setBusy(label); setError(null); setReasons([]);
    try {
      const res = await fetch(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) { setPlan(data.plan); return data; }
      setError(res.status === 401
        ? 'Not authorized in this browser — sign in with the admin token first.'
        : data.error || `Request failed (HTTP ${res.status}).`);
      setReasons(data.reasons || []);
      if (data.plan) setPlan(data.plan);
      return null;
    } catch {
      setError('Request failed.');
      return null;
    } finally { setBusy(null); }
  }, []);

  const createPlan = () => call('create', '/api/production/assets/plans', { packageId });
  const estimate = () => plan && call('estimate', `/api/production/assets/plans/${plan.planId}/estimate`);

  const s = plan?.summary;
  const approved = plan?.status === 'approved';

  // One ceiling per unit the plan will actually spend in. There is no global
  // ceiling field because a single number cannot govern two units that have no
  // conversion between them — a "1.00" limit says nothing about whether it means
  // dollars or a vendor's credits.
  const unitsToCap = (s?.totals || []).map(t => ({
    key: t.unitKey,
    label: t.unit === 'currency' ? t.currency : t.providerCreditUnit,
  }));

  const approve = () => plan && call('approve', `/api/production/assets/plans/${plan.planId}/approve`, {
    ceilings: Object.fromEntries(
      unitsToCap
        .map(u => [u.key, Number(ceiling[u.key])])
        .filter(([, v]) => Number.isFinite(v)),
    ),
    acknowledgeProvisional: ack,
    // Binds approval to exactly what is on screen — if the plan moved, refuse.
    expectedContentHash: plan.contentHash,
  });

  const fmtTotal = t =>
    `${t.isLowerBound ? '≥ ' : ''}${t.amount} ${t.unit === 'currency' ? t.currency : t.providerCreditUnit}`;

  return (
    <div className="pr-section pr-heygen-panel">
      <div className="pr-section-head">
        <span className="font-ui">Asset Plan</span>
        <button type="button" className="thumb-icon-btn" onClick={createPlan} disabled={!!busy} title="Plan scene assets">
          <FiRefreshCw size={11} className={busy === 'create' ? 'spin' : ''} />
        </button>
      </div>

      {!plan && (
        <>
          <div className="pr-reason-text font-mono">
            Plans one visual per scene, resolves what the Asset Library already has,
            and prices only the misses. Creates no job and spends nothing.
          </div>
          <button type="button" className="thumb-btn" style={{ width: '100%' }} onClick={createPlan} disabled={!!busy}>
            {busy === 'create' ? 'Planning…' : 'Plan scene assets'}
          </button>
        </>
      )}

      {error && <div className="pr-warning font-mono"><FiAlertCircle size={11} /> {error}</div>}
      {reasons.length > 0 && (
        <div className="pr-reason-text font-mono">{reasons.map((r, i) => <div key={i}>• {r}</div>)}</div>
      )}

      {plan && (
        <>
          <div className="pr-exec-meta font-mono">
            <span>Status: {plan.status}</span>
            <span>Scenes: {s?.sceneCount}</span>
            <span>Cached: {s?.cacheHits}</span>
            <span>Paid: {s?.paidRequests}</span>
            <span>Placeholder: {s?.placeholders}</span>
            {s?.blocked > 0 && <span style={{ color: '#f87171' }}>Blocked: {s.blocked}</span>}
          </div>
          {/* Totals are shown SIDE BY SIDE, one per unit, and never added.
              A plan spending vendor credits and dollars has no single total. */}
          <div className="pr-exec-meta font-mono">
            <span>Est. total:</span>
            {(s?.totals || []).length === 0
              ? <span>0 (nothing paid)</span>
              : (s.totals || []).map((t, i) => (
                <span key={t.unitKey}>
                  {i > 0 && <span style={{ color: 'var(--text-muted)' }}> + </span>}
                  {fmtTotal(t)}
                </span>
              ))}
            <span>Completeness: {s?.estimateCompleteness}</span>
          </div>
          {s?.comparable === false && (
            <div className="pr-warning font-mono">
              <FiAlertCircle size={11} /> Costs are in incomparable units — they are reported
              separately and never summed. Each needs its own ceiling.
            </div>
          )}
          <div className="pr-exec-meta font-mono">
            <span>Provisional: {s?.provisionalRequests}</span>
            {s?.lowerBoundRequests > 0 && <span style={{ color: '#f59e0b' }}>From-price: {s.lowerBoundRequests}</span>}
            <span>Visual completeness: {s?.visualCompleteness}%</span>
          </div>
          {(s?.costWarnings || []).length > 0 && (
            <div className="pr-reason-text font-mono">
              {s.costWarnings.map((w, i) => <div key={i}>• {w}</div>)}
            </div>
          )}

          <div className="pr-field">
            <label className="pr-field-label font-ui">Scenes</label>
            <div className="pr-provider-list">
              {(plan.requests || []).map(r => (
                <div key={r.requestId} className="pr-provider-item" style={{ textAlign: 'left' }}>
                  <div className="pr-provider-item-top">
                    <span style={{ color: STATUS_COLOR[r.status] || 'var(--text-muted)' }}>
                      [{r.sceneIndex}] {r.capability}
                    </span>
                    <span className="font-mono">
                      {r.status === 'awaiting_generation'
                        ? `${r.estimate?.amount ?? '?'} ${r.estimate?.currency || ''}${r.estimate?.confirmed ? '' : ' (provisional)'}`
                        : r.status === 'resolved_from_cache' ? 'cached · 0' : '—'}
                    </span>
                  </div>
                  <div className="pr-provider-reason font-mono">
                    {r.status} {r.binding?.model ? `· ${r.binding.providerId} · ${r.binding.model}` : ''}
                    {(r.warnings || []).map((w, i) => <div key={i}>• {w}</div>)}
                    {(r.droppedFields || []).map((d, i) => <div key={`d${i}`}>• dropped {d.field}: {d.reason}</div>)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {!approved && (
            <div className="pr-field">
              <label className="pr-field-label font-ui">Batch approval</label>
              <div className="pr-exec-meta font-mono" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                {unitsToCap.length === 0
                  ? <span>No paid spend — no ceiling required.</span>
                  : unitsToCap.map(u => (
                    <label key={u.key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      Ceiling ({u.label})
                      <input
                        value={ceiling[u.key] ?? ''}
                        onChange={e => setCeiling(prev => ({ ...prev, [u.key]: e.target.value }))}
                        style={{ width: 70, padding: '4px 6px' }}
                      />
                    </label>
                  ))}
                {(s?.provisionalRequests > 0 || s?.totalIsIncomplete || s?.comparable === false) && (
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
                    Acknowledge provisional / multi-unit estimate
                  </label>
                )}
              </div>
              <div className="pr-reason-text font-mono">
                No automatic retry: a failed generation never re-spends without a new approval.
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="thumb-btn" onClick={estimate} disabled={!!busy}>
                  {busy === 'estimate' ? 'Pricing…' : 'Run cost preflight'}
                </button>
                <button type="button" className="thumb-btn" onClick={approve} disabled={!!busy || plan.status === 'draft'}>
                  {busy === 'approve' ? 'Approving…' : 'Approve Plan'}
                </button>
              </div>
            </div>
          )}

          {approved && (
            <div className="pr-approved-flash font-mono">
              <FiCheckCircle size={12} /> Plan approved — {plan.approval?.approvalRef} · totals{' '}
              {(s?.totals || []).map(fmtTotal).join(' + ') || '0'}
            </div>
          )}
        </>
      )}
    </div>
  );
}
