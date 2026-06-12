// components/sections/ActivationGate.jsx
// Governed staged → active promotion for AI provider adapters.
// Flow: RUN PREFLIGHT → REQUEST ACTIVATION → APPROVE → adapter activated.

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const GOLD     = '#c9a84c';
const TEAL     = '#0dd3c5';
const EMERALD  = '#10b981';
const SAPPHIRE = '#3b82f6';
const CRIMSON  = '#ef4444';
const AMBER    = '#f59e0b';
const VIOLET   = '#8b5cf6';

const TIER_COLOR   = { free: EMERALD, low: TEAL, variable: AMBER, medium: AMBER, high: CRIMSON };
const RISK_COLOR   = { none: EMERALD, low: TEAL, medium: AMBER, high: CRIMSON, unknown: '#6b7280' };
const CHECK_COLOR  = { pass: EMERALD, fail: CRIMSON, warn: AMBER, skip: '#6b7280' };
const CHECK_ICON   = { pass: '✓', fail: '✗', warn: '!', skip: '–' };
const STATUS_COLOR = { pending: AMBER, approved: EMERALD, rejected: CRIMSON, rolled_back: '#6b7280' };

const stagger = { initial: {}, animate: { transition: { staggerChildren: 0.04 } } };
const fadeUp  = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0, transition: { duration: 0.22 } } };

// ── Sub-components ────────────────────────────────────────────────────────────

function CheckItem({ item }) {
  const color = CHECK_COLOR[item.status] || '#6b7280';
  return (
    <div className="flex items-start gap-2 py-1">
      <span className="font-mono text-[10px] w-4 mt-0.5 flex-shrink-0" style={{ color }}>
        {CHECK_ICON[item.status] || '?'}
      </span>
      <div className="flex-1 min-w-0">
        <span className="font-ui text-[10px] font-semibold" style={{ color: 'var(--text-primary)' }}>{item.label}</span>
        <p className="font-mono text-[8px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-muted)' }}>{item.detail}</p>
      </div>
    </div>
  );
}

function StagedCard({ adapter, preflight, onRunPreflight, onRequest, checking, requesting }) {
  const [expanded, setExpanded] = useState(false);
  const pf         = preflight[adapter.adapterId];
  const canRequest = pf?.passed === true;
  const tierColor  = TIER_COLOR[adapter.costTier] || GOLD;
  const riskColor  = RISK_COLOR[adapter.activationRisk] || GOLD;

  return (
    <motion.div variants={fadeUp} className="panel-gold p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-ui text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{adapter.displayName}</div>
          <div className="font-mono text-[8px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{adapter.adapterId}</div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {adapter.costTier && (
            <span className="font-mono text-[8px] px-1.5 py-0.5 rounded border"
              style={{ color: tierColor, borderColor: `${tierColor}40` }}>
              {adapter.costTier.toUpperCase()} TIER
            </span>
          )}
          {adapter.activationRisk && adapter.activationRisk !== 'none' && (
            <span className="font-mono text-[8px] px-1.5 py-0.5 rounded"
              style={{ color: riskColor, background: `${riskColor}12` }}>
              {adapter.activationRisk.toUpperCase()} RISK
            </span>
          )}
          <span className="font-mono text-[8px] px-1.5 py-0.5 rounded"
            style={{ background: `${AMBER}12`, color: AMBER }}>STAGED</span>
        </div>
      </div>

      {/* Projected cost */}
      {adapter.perDispatch > 0 && (
        <div className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>
          ~${(adapter.perDispatch * 30).toFixed(2)}/mo at 30 dispatches · ${adapter.perDispatch}/dispatch
        </div>
      )}

      {/* Preflight result summary */}
      {pf && (
        <div className="flex items-center gap-3">
          <span className="font-mono text-[9px]" style={{ color: pf.passed ? EMERALD : CRIMSON }}>
            {pf.passed ? '✓ Preflight passed' : '✗ Preflight failed'}
            {pf.hasWarnings ? ' (warnings)' : ''}
          </span>
          <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>
            {pf.summary.passed}✓{pf.summary.warned > 0 ? ` ${pf.summary.warned}!` : ''}{pf.summary.failed > 0 ? ` ${pf.summary.failed}✗` : ''}
          </span>
          <button
            className="ml-auto font-mono text-[8px] tracking-wider"
            style={{ color: 'var(--text-muted)' }}
            onClick={() => setExpanded(e => !e)}>
            {expanded ? 'HIDE' : 'DETAILS'}
          </button>
        </div>
      )}

      {/* Preflight detail */}
      <AnimatePresence>
        {expanded && pf && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            style={{ overflow: 'hidden' }}>
            <div className="border-t pt-2 space-y-0.5" style={{ borderColor: 'var(--border-default)' }}>
              {pf.items.map(item => <CheckItem key={item.id} item={item} />)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={() => onRunPreflight(adapter.adapterId)}
          disabled={checking === adapter.adapterId}
          className="flex-1 font-mono text-[9px] py-1.5 rounded border transition-all"
          style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)' }}>
          {checking === adapter.adapterId ? 'CHECKING…' : 'RUN PREFLIGHT'}
        </button>
        <button
          onClick={() => onRequest(adapter.adapterId, adapter.displayName)}
          disabled={!canRequest || requesting === adapter.adapterId}
          className="flex-1 font-mono text-[9px] py-1.5 rounded transition-all"
          style={{
            background: canRequest ? `${GOLD}18` : 'transparent',
            color:      canRequest ? GOLD : '#4b5563',
            border:     `1px solid ${canRequest ? `${GOLD}45` : '#374151'}`,
            cursor:     canRequest ? 'pointer' : 'not-allowed',
          }}>
          {requesting === adapter.adapterId ? 'REQUESTING…' : 'REQUEST ACTIVATION'}
        </button>
      </div>

      {!pf && (
        <p className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>
          Run preflight to verify readiness before requesting activation.
        </p>
      )}
    </motion.div>
  );
}

function ActivatedCard({ adapter, state, onRollback, rolling }) {
  const info      = state[adapter.adapterId];
  const tierColor = TIER_COLOR[adapter.costTier] || GOLD;

  return (
    <motion.div variants={fadeUp} className="panel-gold p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-ui text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{adapter.displayName}</div>
          <div className="font-mono text-[8px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {info?.activatedAt ? `Activated ${new Date(info.activatedAt).toLocaleDateString()}` : 'Activated via governance gate'}
          </div>
        </div>
        <span className="font-mono text-[8px] px-1.5 py-0.5 rounded"
          style={{ background: `${EMERALD}12`, color: EMERALD }}>ACTIVATED</span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {adapter.costTier && (
          <span className="font-mono text-[8px] px-1.5 py-0.5 rounded border"
            style={{ color: tierColor, borderColor: `${tierColor}40` }}>
            {adapter.costTier.toUpperCase()} · ${adapter.perDispatch}/dispatch
          </span>
        )}
        {info?.requestId && (
          <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>
            req: {info.requestId.slice(0, 22)}…
          </span>
        )}
      </div>

      <button
        onClick={() => onRollback(adapter.adapterId)}
        disabled={rolling === adapter.adapterId}
        className="w-full font-mono text-[9px] py-1.5 rounded border transition-all"
        style={{ borderColor: `${CRIMSON}40`, color: CRIMSON }}>
        {rolling === adapter.adapterId ? 'ROLLING BACK…' : '⊘ ROLLBACK TO STAGED'}
      </button>
    </motion.div>
  );
}

function RequestCard({ request, onApprove, onReject, actionLoading }) {
  const [showReject, setShowReject] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const pf          = request.preflight;
  const statusColor = STATUS_COLOR[request.status] || GOLD;

  return (
    <motion.div variants={fadeUp} className="panel-gold p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-ui text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{request.adapterName}</div>
          <div className="font-mono text-[9px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {new Date(request.requestedAt).toLocaleString()}
          </div>
          <div className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>
            {request.id.slice(0, 28)}…
          </div>
        </div>
        <span className="font-mono text-[8px] px-1.5 py-0.5 rounded flex-shrink-0"
          style={{ background: `${statusColor}12`, color: statusColor }}>
          {request.status.toUpperCase().replace('_', ' ')}
        </span>
      </div>

      {/* Preflight summary grid */}
      {pf && (
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { label: 'PASSED', val: pf.summary.passed,  col: EMERALD },
            { label: 'WARN',   val: pf.summary.warned,  col: pf.summary.warned  > 0 ? AMBER   : 'var(--text-muted)' },
            { label: 'FAILED', val: pf.summary.failed,  col: pf.summary.failed  > 0 ? CRIMSON : 'var(--text-muted)' },
          ].map(({ label, val, col }) => (
            <div key={label} className="rounded-sm p-1.5" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-default)' }}>
              <div className="font-mono text-sm font-bold" style={{ color: col }}>{val}</div>
              <div className="font-mono text-[7px]" style={{ color: 'var(--text-muted)' }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {!pf?.passed && pf && (
        <div className="rounded-sm px-2 py-1.5" style={{ background: `${CRIMSON}08`, border: `1px solid ${CRIMSON}20` }}>
          <span className="font-mono text-[8px]" style={{ color: CRIMSON }}>Preflight failed — review issues before approving.</span>
        </div>
      )}

      {request.notes && (
        <p className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>Notes: {request.notes}</p>
      )}

      {/* Approve / Reject actions */}
      {request.status === 'pending' && (
        <div className="space-y-2">
          {showReject && (
            <input
              className="w-full font-mono text-[10px] bg-transparent border rounded px-2 py-1.5 outline-none"
              style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
              placeholder="Rejection reason (optional)…"
              value={rejectNote}
              onChange={e => setRejectNote(e.target.value)}
            />
          )}
          <div className="flex gap-2">
            <button
              onClick={() => onApprove(request.id)}
              disabled={!!actionLoading[request.id]}
              className="flex-1 font-mono text-[9px] py-1.5 rounded transition-all"
              style={{ background: `${EMERALD}18`, color: EMERALD, border: `1px solid ${EMERALD}35` }}>
              {actionLoading[request.id] === 'approve' ? 'APPROVING…' : '✓ APPROVE'}
            </button>
            {!showReject ? (
              <button
                onClick={() => setShowReject(true)}
                className="flex-1 font-mono text-[9px] py-1.5 rounded border transition-all"
                style={{ borderColor: `${CRIMSON}35`, color: CRIMSON }}>
                REJECT
              </button>
            ) : (
              <button
                onClick={() => { onReject(request.id, rejectNote); setShowReject(false); }}
                disabled={!!actionLoading[request.id]}
                className="flex-1 font-mono text-[9px] py-1.5 rounded transition-all"
                style={{ background: `${CRIMSON}18`, color: CRIMSON, border: `1px solid ${CRIMSON}35` }}>
                {actionLoading[request.id] === 'reject' ? 'REJECTING…' : '✗ CONFIRM'}
              </button>
            )}
          </div>
        </div>
      )}

      {request.reviewNote && (
        <p className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>Note: {request.reviewNote}</p>
      )}
    </motion.div>
  );
}

function HistoryRow({ request }) {
  const statusColor = STATUS_COLOR[request.status] || GOLD;
  return (
    <div className="flex items-center gap-3 py-2.5 border-b" style={{ borderColor: 'var(--border-default)' }}>
      <span className="font-mono text-[7px] px-1.5 py-0.5 rounded flex-shrink-0"
        style={{ background: `${statusColor}12`, color: statusColor }}>
        {request.status.replace('_', ' ').toUpperCase()}
      </span>
      <span className="font-ui text-[11px] flex-1 min-w-0 truncate" style={{ color: 'var(--text-primary)' }}>
        {request.adapterName}
      </span>
      <div className="text-right flex-shrink-0">
        <div className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>
          {new Date(request.requestedAt).toLocaleDateString()}
        </div>
        {request.reviewedBy && (
          <div className="font-mono text-[7px]" style={{ color: 'var(--text-muted)' }}>by {request.reviewedBy}</div>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ActivationGate() {
  const [data,          setData]          = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [tab,           setTab]           = useState('staged');
  const [preflight,     setPreflight]     = useState({});
  const [checking,      setChecking]      = useState(null);
  const [requesting,    setRequesting]    = useState(null);
  const [rolling,       setRolling]       = useState(null);
  const [actionLoading, setActionLoading] = useState({});
  const [toast,         setToast]         = useState(null);

  const showToast = (msg, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch('/api/activation');
      if (res.ok) setData(await res.json());
    } catch {}
    if (!silent) setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(() => load(true), 60_000);
    return () => clearInterval(id);
  }, [load]);

  const runPreflight = async (adapterId) => {
    setChecking(adapterId);
    try {
      const res = await fetch(`/api/activation/preflight?adapterId=${encodeURIComponent(adapterId)}`);
      if (res.ok) {
        const pf = await res.json();
        setPreflight(p => ({ ...p, [adapterId]: pf }));
        showToast(`${adapterId}: preflight ${pf.passed ? 'passed' : 'failed'}`, pf.passed);
      } else { showToast('Preflight request failed.', false); }
    } catch { showToast('Preflight check failed.', false); }
    finally { setChecking(null); }
  };

  const requestActivation = async (adapterId, adapterName) => {
    setRequesting(adapterId);
    try {
      const res = await fetch('/api/activation/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adapterId, adapterName }),
      });
      if (res.ok) {
        showToast(`Activation request created for ${adapterName}`);
        setTab('requests');
        await load(true);
      } else { showToast('Failed to create request.', false); }
    } catch { showToast('Request failed.', false); }
    finally { setRequesting(null); }
  };

  const approveRequest = async (requestId) => {
    setActionLoading(p => ({ ...p, [requestId]: 'approve' }));
    try {
      const res = await fetch('/api/activation/approve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId }),
      });
      const d = await res.json();
      if (res.ok) { showToast('Request approved — adapter activated.'); await load(true); }
      else { showToast(d.error || 'Approval failed.', false); }
    } catch { showToast('Approval failed.', false); }
    finally { setActionLoading(p => ({ ...p, [requestId]: null })); }
  };

  const rejectRequest = async (requestId, reason) => {
    setActionLoading(p => ({ ...p, [requestId]: 'reject' }));
    try {
      const res = await fetch('/api/activation/reject', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, reason }),
      });
      const d = await res.json();
      if (res.ok) { showToast('Request rejected.'); await load(true); }
      else { showToast(d.error || 'Rejection failed.', false); }
    } catch { showToast('Rejection failed.', false); }
    finally { setActionLoading(p => ({ ...p, [requestId]: null })); }
  };

  const rollbackAdapter = async (adapterId) => {
    setRolling(adapterId);
    try {
      const res = await fetch('/api/activation/rollback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adapterId }),
      });
      if (res.ok) { showToast(`${adapterId} rolled back to staged.`); await load(true); }
      else { showToast('Rollback failed.', false); }
    } catch { showToast('Rollback failed.', false); }
    finally { setRolling(null); }
  };

  // Derived
  const stagedAdapters    = (data?.adapters || []).filter(a => a.originalStatus === 'staged' && !a.activatedViaGate);
  const activatedAdapters = (data?.adapters || []).filter(a => a.activatedViaGate);
  const pendingRequests   = (data?.requests || []).filter(r => r.status === 'pending');
  const allRequests       = data?.requests || [];
  const activationState   = data?.activationState || {};
  const summary           = data?.summary || {};

  const TABS = [
    { id: 'staged',    label: 'STAGED',    badge: stagedAdapters.length,    badgeColor: SAPPHIRE },
    { id: 'activated', label: 'ACTIVATED', badge: activatedAdapters.length, badgeColor: EMERALD  },
    { id: 'requests',  label: 'REQUESTS',  badge: pendingRequests.length,   badgeColor: AMBER    },
    { id: 'history',   label: 'HISTORY',   badge: allRequests.length,       badgeColor: GOLD     },
  ];

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <div className="w-6 h-6 rounded-full"
        style={{ border: '2px solid var(--border-default)', borderTopColor: GOLD, animation: 'spin 1s linear infinite' }} />
    </div>
  );

  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-4">

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
            className="fixed top-4 right-4 z-50 font-mono text-[10px] px-4 py-2.5 rounded-sm shadow-lg"
            style={{
              background: toast.ok ? `${EMERALD}18` : `${CRIMSON}18`,
              border:     `1px solid ${toast.ok ? EMERALD : CRIMSON}40`,
              color:      toast.ok ? EMERALD : CRIMSON,
              backdropFilter: 'blur(8px)',
            }}>
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header panel */}
      <motion.div variants={fadeUp} className="panel-gold p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-light" style={{ color: GOLD }}>Activation Gate</h2>
            <p className="font-mono text-[9px] mt-1" style={{ color: 'var(--text-muted)' }}>
              Governed staged → active promotion for AI provider adapters
            </p>
          </div>
          <div className="flex gap-5 text-center">
            <div>
              <div className="font-mono text-xl font-bold" style={{ color: GOLD }}>{summary.activated || 0}</div>
              <div className="font-mono text-[7px] tracking-widest" style={{ color: 'var(--text-muted)' }}>ACTIVATED</div>
            </div>
            <div>
              <div className="font-mono text-xl font-bold" style={{ color: AMBER }}>{summary.pending || 0}</div>
              <div className="font-mono text-[7px] tracking-widest" style={{ color: 'var(--text-muted)' }}>PENDING</div>
            </div>
            <div>
              <div className="font-mono text-xl font-bold" style={{ color: SAPPHIRE }}>{stagedAdapters.length}</div>
              <div className="font-mono text-[7px] tracking-widest" style={{ color: 'var(--text-muted)' }}>STAGED</div>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-sm px-3 py-2" style={{ background: `${SAPPHIRE}06`, border: `1px solid ${SAPPHIRE}18` }}>
          <p className="font-mono text-[8px] leading-relaxed" style={{ color: `${SAPPHIRE}cc` }}>
            GOVERNANCE — All activations require: preflight pass → activation request → explicit approval.
            Activating a provider enables dispatch routing for that adapter. High-cost providers (HeyGen, Higgsfield)
            will incur per-generation charges — review cost projections carefully before approving.
          </p>
        </div>
      </motion.div>

      {/* Tab bar */}
      <div className="flex gap-1">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm font-mono text-[9px] tracking-wider transition-all"
            style={{
              background: tab === t.id ? `${GOLD}12` : 'transparent',
              color:      tab === t.id ? GOLD : 'var(--text-muted)',
              border:     `1px solid ${tab === t.id ? `${GOLD}28` : 'transparent'}`,
            }}>
            {t.label}
            {t.badge > 0 && (
              <span className="font-mono text-[7px] w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: `${t.badgeColor}22`, color: t.badgeColor }}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">

        {tab === 'staged' && (
          <motion.div key="staged" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
            {stagedAdapters.length === 0 ? (
              <div className="panel-gold p-8 text-center space-y-1">
                <p className="font-mono text-[11px]" style={{ color: EMERALD }}>All staged adapters have been activated.</p>
                <p className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>Check ACTIVATED tab to view gate-approved adapters.</p>
              </div>
            ) : (
              <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-3">
                {stagedAdapters.map(adapter => (
                  <StagedCard
                    key={adapter.adapterId}
                    adapter={adapter}
                    preflight={preflight}
                    onRunPreflight={runPreflight}
                    onRequest={requestActivation}
                    checking={checking}
                    requesting={requesting}
                  />
                ))}
              </motion.div>
            )}
          </motion.div>
        )}

        {tab === 'activated' && (
          <motion.div key="activated" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
            {activatedAdapters.length === 0 ? (
              <div className="panel-gold p-8 text-center space-y-2">
                <p className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>No adapters activated via governance gate yet.</p>
                <p className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>
                  Go to STAGED → run preflight → request activation → approve in REQUESTS.
                </p>
              </div>
            ) : (
              <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-3">
                {activatedAdapters.map(adapter => (
                  <ActivatedCard
                    key={adapter.adapterId}
                    adapter={adapter}
                    state={activationState}
                    onRollback={rollbackAdapter}
                    rolling={rolling}
                  />
                ))}
              </motion.div>
            )}
          </motion.div>
        )}

        {tab === 'requests' && (
          <motion.div key="requests" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
            {pendingRequests.length === 0 ? (
              <div className="panel-gold p-8 text-center">
                <p className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>No pending activation requests.</p>
                <p className="font-mono text-[9px] mt-1" style={{ color: 'var(--text-muted)' }}>
                  Go to STAGED → run preflight → request activation.
                </p>
              </div>
            ) : (
              <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-3">
                {pendingRequests.map(req => (
                  <RequestCard
                    key={req.id}
                    request={req}
                    onApprove={approveRequest}
                    onReject={rejectRequest}
                    actionLoading={actionLoading}
                  />
                ))}
              </motion.div>
            )}
          </motion.div>
        )}

        {tab === 'history' && (
          <motion.div key="history" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="panel-gold p-4">
              <div className="font-mono text-[8px] tracking-[0.2em] mb-3" style={{ color: 'var(--text-muted)' }}>
                ALL REQUESTS — {allRequests.length} TOTAL
              </div>
              {allRequests.length === 0 ? (
                <p className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>No activation history yet.</p>
              ) : (
                allRequests.map(req => <HistoryRow key={req.id} request={req} />)
              )}
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </motion.div>
  );
}
