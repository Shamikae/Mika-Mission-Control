import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ── Design tokens ─────────────────────────────────────────────────────────────
const GOLD     = '#c9a84c';
const TEAL     = '#0dd3c5';
const EMERALD  = '#10b981';
const SAPPHIRE = '#3b82f6';
const CRIMSON  = '#ef4444';
const AMBER    = '#f59e0b';
const VIOLET   = '#8b5cf6';

const LANE_COLORS = {
  'digital-diamond': '#c9a84c', 'managed-by-mika': '#0dd3c5',
  'medai': '#818cf8', 'cannaops': '#4ade80', 'hotel-hooker': '#f472b6',
  'ai-twin': '#60a5fa', 'lead-recovery': '#fb923c',
};
const LANE_LABELS = {
  'digital-diamond': 'Digital Diamond', 'managed-by-mika': 'Managed by Mika',
  'medai': 'MedAI', 'cannaops': 'CannaOps', 'hotel-hooker': 'Hotel Hooker',
  'ai-twin': 'AI Twin', 'lead-recovery': 'Lead Recovery',
};
const LANES = Object.keys(LANE_LABELS);

const STAGES = [
  { id: 'draft',     label: 'Draft',     color: '#6b7280'  },
  { id: 'sent',      label: 'Sent',      color: SAPPHIRE   },
  { id: 'reviewing', label: 'Reviewing', color: AMBER      },
  { id: 'accepted',  label: 'Accepted',  color: EMERALD    },
  { id: 'rejected',  label: 'Rejected',  color: CRIMSON    },
];
const STAGE_BY_ID = Object.fromEntries(STAGES.map(s => [s.id, s]));
const STAGE_NEXT  = { draft: 'sent', sent: 'reviewing', reviewing: 'accepted' };
const STAGE_PREV  = Object.fromEntries(Object.entries(STAGE_NEXT).map(([k, v]) => [v, k]));

const QUEUE_ACTIONS = [
  { id: 'draft-proposal',        label: 'Draft Proposal',         color: GOLD      },
  { id: 'revise-proposal',       label: 'Revise Proposal',        color: AMBER     },
  { id: 'prepare-presentation',  label: 'Prepare Presentation',   color: SAPPHIRE  },
  { id: 'create-scope',          label: 'Create Scope of Work',   color: VIOLET    },
];

const stagger = { initial: {}, animate: { transition: { staggerChildren: 0.04 } } };
const fadeUp  = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0, transition: { duration: 0.2 } } };

// ── Helpers ───────────────────────────────────────────────────────────────────
function safeTs(ts) {
  if (!ts) return '';
  try {
    const diff = Math.floor((Date.now() - new Date(ts)) / 60000);
    if (diff < 60) return `${diff}m`;
    const h = Math.floor(diff / 60);
    if (h < 24) return `${h}h`;
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return ''; }
}

function fmtMoney(n) {
  if (!n && n !== 0) return '—';
  if (n >= 1000) return `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return `$${n.toLocaleString()}`;
}

// ── Pill ──────────────────────────────────────────────────────────────────────
function Pill({ label, color }) {
  return (
    <span className="font-mono text-[7px] px-1.5 py-0.5 rounded tracking-wide"
      style={{ background: `${color}15`, color, border: `1px solid ${color}28` }}>
      {label}
    </span>
  );
}

// ── Queue Action Dropdown ─────────────────────────────────────────────────────
function QueueDropdown({ onAction, busy, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

  return (
    <motion.div ref={ref}
      initial={{ opacity: 0, scale: 0.95, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0 }}
      className="absolute right-0 top-full mt-1 z-30 rounded-sm py-1 w-52"
      style={{ background: 'var(--bg-topbar)', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
      <div className="px-2.5 py-1 mb-1 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <span className="font-mono text-[7px] tracking-widest" style={{ color: 'var(--text-muted)' }}>QUEUE TASK</span>
      </div>
      {QUEUE_ACTIONS.map(qa => (
        <button key={qa.id} onClick={() => { onAction(qa.id); onClose(); }}
          disabled={busy} className="w-full text-left flex items-center gap-2 px-2.5 py-1.5"
          style={{ color: 'var(--text-secondary)' }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: qa.color }} />
          <span className="font-mono text-[9px]">{qa.label}</span>
        </button>
      ))}
    </motion.div>
  );
}

// ── Proposal Card ─────────────────────────────────────────────────────────────
function ProposalCard({ proposal, onQueueAction, onEdit, onMoveStage, onConvertToClient, actioning }) {
  const [showQueue, setShowQueue] = useState(false);
  const stage      = STAGE_BY_ID[proposal.status] || STAGE_BY_ID.draft;
  const laneColor  = LANE_COLORS[proposal.laneId] || GOLD;
  const busy       = actioning === proposal.proposalId;
  const nextStage  = STAGE_NEXT[proposal.status];
  const prevStage  = STAGE_PREV[proposal.status];

  return (
    <motion.div variants={fadeUp}
      className="rounded-sm p-2.5 flex flex-col gap-2 relative group"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderLeftWidth: 2, borderLeftColor: stage.color,
      }}>

      {/* Value — hero number */}
      <div className="flex items-start justify-between gap-1">
        <div className="flex-1 min-w-0">
          <p className="font-ui text-[12px] font-semibold truncate leading-tight" style={{ color: 'var(--text-primary)' }}>
            {proposal.title}
          </p>
          {(proposal.leadName || proposal.leadCompany) && (
            <p className="font-mono text-[9px] mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
              {proposal.leadName}{proposal.leadCompany ? ` · ${proposal.leadCompany}` : ''}
            </p>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <p className="font-mono text-[14px] font-bold leading-none" style={{ color: GOLD }}>
            {fmtMoney(proposal.value)}
          </p>
          <p className="font-mono text-[8px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {safeTs(proposal.updatedAt)}
          </p>
        </div>
      </div>

      {/* Pills */}
      <div className="flex items-center gap-1 flex-wrap">
        {proposal.offerTitle && (
          <Pill label={proposal.offerTitle.slice(0, 22)} color={GOLD} />
        )}
        <Pill label={LANE_LABELS[proposal.laneId] || proposal.laneId} color={laneColor} />
        {proposal.timeline && (
          <Pill label={proposal.timeline} color={TEAL} />
        )}
      </div>

      {/* Next action */}
      {proposal.nextAction && (
        <p className="font-mono text-[8px] leading-snug line-clamp-1" style={{ color: 'var(--text-muted)' }}>
          → {proposal.nextAction}
        </p>
      )}

      {/* Hover actions */}
      <div className="flex items-center gap-1 pt-1 border-t opacity-0 group-hover:opacity-100 transition-opacity relative"
        style={{ borderColor: 'rgba(255,255,255,0.06)' }}>

        {prevStage && (
          <button onClick={() => onMoveStage(proposal.proposalId, prevStage)}
            disabled={busy} title={`Move to ${STAGE_BY_ID[prevStage]?.label}`}
            className="font-mono text-[8px] px-1.5 py-1 rounded-sm"
            style={{ color: STAGE_BY_ID[prevStage]?.color, background: `${STAGE_BY_ID[prevStage]?.color}10`, border: `1px solid ${STAGE_BY_ID[prevStage]?.color}25` }}>
            ←
          </button>
        )}
        {nextStage && (
          <button onClick={() => onMoveStage(proposal.proposalId, nextStage)}
            disabled={busy} title={`Move to ${STAGE_BY_ID[nextStage]?.label}`}
            className="font-mono text-[8px] px-1.5 py-1 rounded-sm font-bold"
            style={{ color: STAGE_BY_ID[nextStage]?.color, background: `${STAGE_BY_ID[nextStage]?.color}10`, border: `1px solid ${STAGE_BY_ID[nextStage]?.color}25` }}>
            → {STAGE_BY_ID[nextStage]?.label}
          </button>
        )}
        {proposal.status === 'reviewing' && (
          <>
            <button onClick={() => onMoveStage(proposal.proposalId, 'accepted')}
              disabled={busy}
              className="font-mono text-[8px] px-1.5 py-1 rounded-sm"
              style={{ color: EMERALD, background: `${EMERALD}10`, border: `1px solid ${EMERALD}25` }}>
              ACCEPT
            </button>
            <button onClick={() => onMoveStage(proposal.proposalId, 'rejected')}
              disabled={busy}
              className="font-mono text-[8px] px-1.5 py-1 rounded-sm"
              style={{ color: CRIMSON, background: `${CRIMSON}10`, border: `1px solid ${CRIMSON}25` }}>
              REJECT
            </button>
          </>
        )}

        {/* Convert to client — only on accepted */}
        {proposal.status === 'accepted' && (
          <button onClick={() => onConvertToClient(proposal)}
            disabled={busy}
            className="font-mono text-[8px] px-2 py-1 rounded-sm font-bold"
            style={{ color: EMERALD, background: `${EMERALD}15`, border: `1px solid ${EMERALD}35` }}>
            {busy ? '…' : '→ CLIENT'}
          </button>
        )}

        <button onClick={() => onEdit(proposal)}
          className="font-mono text-[8px] px-1.5 py-1 rounded-sm ml-auto"
          style={{ color: 'var(--text-muted)', background: 'rgba(255,255,255,0.04)' }}>
          ✎
        </button>

        <div className="relative">
          <button onClick={() => setShowQueue(s => !s)} disabled={busy}
            className="font-mono text-[8px] px-1.5 py-1 rounded-sm"
            style={{ color: GOLD, background: `${GOLD}10`, border: `1px solid ${GOLD}20` }}>
            {busy ? '…' : '⚡'}
          </button>
          <AnimatePresence>
            {showQueue && (
              <QueueDropdown
                onAction={id => onQueueAction(proposal.proposalId, id)}
                busy={busy} onClose={() => setShowQueue(false)} />
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

// ── Pipeline Column ───────────────────────────────────────────────────────────
function PipelineColumn({ stage, proposals, onQueueAction, onEdit, onMoveStage, onConvertToClient, actioning }) {
  const stageValue = proposals.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div className="flex-shrink-0 flex flex-col" style={{ width: 200 }}>
      <div className="flex items-center justify-between mb-2 px-0.5">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: stage.color }} />
          <span className="font-mono text-[9px] font-bold tracking-wider" style={{ color: stage.color }}>
            {stage.label.toUpperCase()}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {stageValue > 0 && (
            <span className="font-mono text-[8px]" style={{ color: GOLD, opacity: 0.7 }}>
              {fmtMoney(stageValue)}
            </span>
          )}
          <span className="font-mono text-[8px] rounded-full px-1.5 py-0.5"
            style={{ background: `${stage.color}15`, color: stage.color }}>
            {proposals.length}
          </span>
        </div>
      </div>
      <div className="h-0.5 mb-2 rounded-full" style={{ background: `${stage.color}30` }} />
      <motion.div variants={stagger} initial="initial" animate="animate" className="flex flex-col gap-2 min-h-[80px]">
        {proposals.length === 0 ? (
          <div className="rounded-sm py-4 flex items-center justify-center"
            style={{ border: `1px dashed ${stage.color}20` }}>
            <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)', opacity: 0.4 }}>empty</span>
          </div>
        ) : (
          proposals.map(p => (
            <ProposalCard key={p.proposalId} proposal={p}
              onQueueAction={onQueueAction} onEdit={onEdit}
              onMoveStage={onMoveStage} onConvertToClient={onConvertToClient}
              actioning={actioning} />
          ))
        )}
      </motion.div>
    </div>
  );
}

// ── Create / Edit Modal ───────────────────────────────────────────────────────
function ProposalModal({ open, onClose, onSaved, prefill, editMode, leads, offers }) {
  const blank = {
    leadId: '', offerId: '', laneId: 'digital-diamond', title: '',
    value: '', summary: '', deliverables: '', timeline: '', nextAction: '', status: 'draft',
  };
  const [form, setForm]   = useState({ ...blank, ...prefill });
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');

  useEffect(() => {
    if (open) setForm({ ...blank, ...prefill });
  }, [open]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) { setErr('Title is required'); return; }
    setSaving(true); setErr('');
    try {
      const url  = editMode ? '/api/proposals/update' : '/api/proposals/create';
      const body = editMode
        ? { proposalId: prefill.proposalId, ...form, value: parseFloat(form.value) || 0,
            deliverables: typeof form.deliverables === 'string'
              ? form.deliverables.split('\n').map(s => s.trim()).filter(Boolean)
              : form.deliverables }
        : { ...form, value: parseFloat(form.value) || 0 };
      const res  = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) { onSaved(data.proposal); onClose(); }
      else setErr(data.error || 'Failed to save');
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  };

  if (!open) return null;

  const inputSt = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-primary)' };
  const inputCl = 'w-full bg-transparent rounded-sm px-2.5 py-1.5 font-mono text-[11px] focus:outline-none';
  const labelCl = 'font-mono text-[8px] tracking-widest block mb-1';

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div initial={{ opacity: 0, scale: 0.97, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0 }}
        className="panel-gold rounded-sm w-full max-w-xl max-h-[90vh] overflow-y-auto p-5"
        style={{ borderColor: `${GOLD}30` }} onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-display text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              {editMode ? 'Edit Proposal' : 'New Proposal'}
            </h2>
            <p className="font-mono text-[8px] tracking-widest mt-0.5" style={{ color: 'var(--text-muted)' }}>
              PROPOSAL CENTER · MIKA AGENTIC OS
            </p>
          </div>
          <button onClick={onClose} className="font-mono text-[11px] px-2 py-1" style={{ color: 'var(--text-muted)' }}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className={labelCl} style={{ color: GOLD }}>TITLE *</label>
            <input value={form.title} onChange={e => set('title', e.target.value)}
              placeholder="e.g. AI Content Strategy — Q3 2026"
              className={inputCl} style={inputSt} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCl} style={{ color: 'var(--text-muted)' }}>LEAD</label>
              <select value={form.leadId} onChange={e => set('leadId', e.target.value)}
                className={inputCl} style={inputSt}>
                <option value="">— no lead linked —</option>
                {(leads || []).filter(l => l.status !== 'archived' && l.status !== 'lost').map(l => (
                  <option key={l.leadId} value={l.leadId}>
                    {l.fullName}{l.company ? ` · ${l.company}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCl} style={{ color: 'var(--text-muted)' }}>OFFER</label>
              <select value={form.offerId} onChange={e => set('offerId', e.target.value)}
                className={inputCl} style={inputSt}>
                <option value="">— no offer linked —</option>
                {(offers || []).filter(o => o.status !== 'archived').map(o => (
                  <option key={o.offerId} value={o.offerId}>{o.title}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCl} style={{ color: 'var(--text-muted)' }}>BRAND</label>
              <select value={form.laneId} onChange={e => set('laneId', e.target.value)}
                className={inputCl} style={inputSt}>
                {LANES.map(id => <option key={id} value={id}>{LANE_LABELS[id]}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCl} style={{ color: 'var(--text-muted)' }}>VALUE $</label>
              <input type="number" value={form.value} onChange={e => set('value', e.target.value)}
                placeholder="0" className={inputCl} style={inputSt} />
            </div>
            <div>
              <label className={labelCl} style={{ color: 'var(--text-muted)' }}>TIMELINE</label>
              <input value={form.timeline} onChange={e => set('timeline', e.target.value)}
                placeholder="e.g. 4 weeks" className={inputCl} style={inputSt} />
            </div>
          </div>

          <div>
            <label className={labelCl} style={{ color: 'var(--text-muted)' }}>SUMMARY</label>
            <textarea value={form.summary} onChange={e => set('summary', e.target.value)}
              rows={2} placeholder="What is this proposal about?"
              className={`${inputCl} resize-none`} style={inputSt} />
          </div>

          <div>
            <label className={labelCl} style={{ color: 'var(--text-muted)' }}>DELIVERABLES (one per line)</label>
            <textarea value={typeof form.deliverables === 'string' ? form.deliverables : form.deliverables?.join('\n') || ''}
              onChange={e => set('deliverables', e.target.value)}
              rows={3} placeholder={'30-day content strategy\nWeekly check-ins\nMonthly report'}
              className={`${inputCl} resize-none`} style={inputSt} />
          </div>

          <div>
            <label className={labelCl} style={{ color: 'var(--text-muted)' }}>NEXT ACTION</label>
            <input value={form.nextAction} onChange={e => set('nextAction', e.target.value)}
              placeholder="What needs to happen next?" className={inputCl} style={inputSt} />
          </div>

          {err && <p className="font-mono text-[9px]" style={{ color: CRIMSON }}>{err}</p>}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="font-mono text-[9px] tracking-wider px-3 py-1.5 rounded-sm"
              style={{ color: 'var(--text-muted)', border: '1px solid rgba(255,255,255,0.08)' }}>
              CANCEL
            </button>
            <button type="submit" disabled={saving}
              className="font-mono text-[9px] tracking-wider px-4 py-1.5 rounded-sm font-bold"
              style={{ background: `${GOLD}18`, border: `1px solid ${GOLD}35`, color: GOLD, opacity: saving ? 0.6 : 1 }}>
              {saving ? 'SAVING…' : editMode ? 'SAVE CHANGES' : 'CREATE PROPOSAL'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

// ── Summary Bar ───────────────────────────────────────────────────────────────
function SummaryBar({ summary }) {
  return (
    <div className="flex items-center gap-5 flex-wrap">
      {[
        { label: 'DRAFT',     value: summary.draft,     color: '#6b7280' },
        { label: 'SENT',      value: summary.sent,      color: SAPPHIRE  },
        { label: 'REVIEWING', value: summary.reviewing, color: AMBER     },
        { label: 'ACCEPTED',  value: summary.accepted,  color: EMERALD   },
        { label: 'REJECTED',  value: summary.rejected,  color: CRIMSON   },
      ].map(item => (
        <div key={item.label} className="flex items-center gap-1.5">
          <span className="font-mono text-xl font-bold leading-none" style={{ color: item.color }}>{item.value || 0}</span>
          <span className="font-mono text-[7px] tracking-widest" style={{ color: 'var(--text-muted)' }}>{item.label}</span>
        </div>
      ))}
      {summary.totalValue > 0 && (
        <div className="ml-auto flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-xl font-bold leading-none" style={{ color: TEAL }}>
              {fmtMoney(summary.totalValue)}
            </span>
            <span className="font-mono text-[7px] tracking-widest" style={{ color: 'var(--text-muted)' }}>PIPELINE</span>
          </div>
          {summary.acceptedValue > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-xl font-bold leading-none" style={{ color: EMERALD }}>
                {fmtMoney(summary.acceptedValue)}
              </span>
              <span className="font-mono text-[7px] tracking-widest" style={{ color: 'var(--text-muted)' }}>ACCEPTED</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ProposalCenter() {
  const [data,       setData]       = useState(null);
  const [leads,      setLeads]      = useState([]);
  const [offers,     setOffers]     = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actioning,  setActioning]  = useState(null);
  const [toast,      setToast]      = useState(null);
  const [modal,      setModal]      = useState(null); // null | { mode: 'create'|'edit', proposal?: {} }
  const [lastRefresh,setLastRefresh]= useState(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const [pRes, lRes, oRes] = await Promise.all([
        fetch('/api/proposals/list'),
        fetch('/api/leads/list'),
        fetch('/api/offers/list'),
      ]);
      if (pRes.ok) setData(await pRes.json());
      if (lRes.ok) { const ld = await lRes.json(); setLeads(ld.leads || []); }
      if (oRes.ok) { const od = await oRes.json(); setOffers(od.offers || []); }
      setLastRefresh(new Date());
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => load(true), 60_000);
    return () => clearInterval(id);
  }, [load]);

  const showToast = (msg, ok = true) => {
    setToast({ msg, ok }); setTimeout(() => setToast(null), 3500);
  };

  const handleQueueAction = async (proposalId, action) => {
    setActioning(proposalId);
    try {
      const res  = await fetch('/api/proposals/queue-action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalId, action }),
      });
      const body = await res.json();
      if (body.ok) {
        showToast(`${action.replace(/-/g, ' ')} queued → ID: ${body.taskId?.slice(-8)}`);
        await load(true);
      } else { showToast(body.error || 'Failed', false); }
    } catch (e) { showToast(e.message, false); } finally { setActioning(null); }
  };

  const handleMoveStage = async (proposalId, status) => {
    setActioning(proposalId);
    try {
      const res  = await fetch('/api/proposals/update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalId, status }),
      });
      const body = await res.json();
      if (body.ok) { showToast(`Moved to ${STAGE_BY_ID[status]?.label}`); await load(true); }
      else { showToast(body.error || 'Move failed', false); }
    } catch (e) { showToast(e.message, false); } finally { setActioning(null); }
  };

  const handleConvertToClient = async (proposal) => {
    setActioning(proposal.proposalId);
    try {
      const lead = leads.find(l => l.leadId === proposal.leadId);
      const [clientRes, leadRes] = await Promise.all([
        fetch('/api/clients/create', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            leadId:        proposal.leadId,
            proposalId:    proposal.proposalId,
            company:       proposal.leadCompany || proposal.leadName || proposal.title,
            contactName:   proposal.leadName || '',
            laneId:        proposal.laneId,
            offerId:       proposal.offerId,
            contractValue: proposal.value || 0,
            status:        'onboarding',
            onboardingStatus: 'pending',
            deliveryStatus:   'pending',
            nextMilestone: 'Kickoff call',
          }),
        }),
        proposal.leadId ? fetch('/api/leads/update', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leadId: proposal.leadId, status: 'won' }),
        }) : Promise.resolve(null),
      ]);
      const clientBody = await clientRes.json();
      if (clientBody.ok) {
        showToast(`Client created: ${clientBody.client.company} (ID: ${clientBody.clientId?.slice(-8)})`);
        await load(true);
      } else { showToast(clientBody.error || 'Conversion failed', false); }
    } catch (e) { showToast(e.message, false); } finally { setActioning(null); }
  };

  const handleSaved = async (p) => {
    showToast(modal?.mode === 'edit' ? 'Proposal updated.' : `Proposal created: ${p.title}`);
    setModal(null);
    await load(true);
  };

  if (loading) return (
    <div className="flex items-center justify-center py-32">
      <div className="flex flex-col items-center gap-3">
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
          className="w-6 h-6 rounded-full"
          style={{ border: '2px solid var(--border-default)', borderTopColor: GOLD }} />
        <span className="font-mono text-[9px] tracking-widest" style={{ color: 'var(--text-muted)' }}>
          LOADING PROPOSAL CENTER
        </span>
      </div>
    </div>
  );

  const byStatus = data?.byStatus || {};

  return (
    <div className="space-y-4">

      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold leading-none" style={{ color: 'var(--text-primary)' }}>
            Proposal Center
          </h1>
          <p className="font-mono text-[9px] tracking-widest mt-1.5" style={{ color: 'var(--text-muted)' }}>
            QUALIFIED LEADS → CLIENTS · MIKA AGENTIC OS
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastRefresh && (
            <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>
              {safeTs(lastRefresh.toISOString())}
            </span>
          )}
          <button onClick={() => load(true)} disabled={refreshing}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-sm font-mono text-[9px]"
            style={{ background: `${GOLD}0f`, border: `1px solid ${GOLD}20`, color: GOLD, opacity: refreshing ? 0.5 : 1 }}>
            {refreshing ? <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}>↻</motion.span> : '↻'} REFRESH
          </button>
          <button onClick={() => setModal({ mode: 'create' })}
            className="px-3 py-1.5 rounded-sm font-mono text-[9px] tracking-wider font-bold"
            style={{ background: `${GOLD}18`, border: `1px solid ${GOLD}35`, color: GOLD }}>
            + NEW PROPOSAL
          </button>
        </div>
      </div>

      {/* ── Summary ── */}
      <div className="panel-gold rounded-sm p-3" style={{ borderColor: `${GOLD}18` }}>
        <SummaryBar summary={data?.summary || {}} />
      </div>

      {/* ── Kanban ── */}
      <div className="overflow-x-auto pb-4 -mx-1 px-1">
        <div className="flex gap-3" style={{ minWidth: STAGES.length * 212 }}>
          {STAGES.map(stage => (
            <PipelineColumn key={stage.id} stage={stage}
              proposals={byStatus[stage.id] || []}
              onQueueAction={handleQueueAction} onEdit={p => setModal({ mode: 'edit', proposal: p })}
              onMoveStage={handleMoveStage} onConvertToClient={handleConvertToClient}
              actioning={actioning} />
          ))}
        </div>
      </div>

      {/* ── Flow reminder ── */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-sm"
        style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
        <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>LAYER:</span>
        {['Lead', 'Proposal', 'Accepted', 'Client', 'Delivery'].map((step, i) => (
          <span key={step} className="flex items-center gap-1.5">
            <span className="font-mono text-[8px]" style={{ color: i === 1 ? GOLD : 'var(--text-muted)' }}>{step}</span>
            {i < 4 && <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)', opacity: 0.4 }}>→</span>}
          </span>
        ))}
        <span className="ml-auto font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>
          Accepted → Convert to Client to begin delivery
        </span>
      </div>

      {/* ── Modal ── */}
      <AnimatePresence>
        {modal && (
          <ProposalModal
            open={!!modal} onClose={() => setModal(null)} onSaved={handleSaved}
            prefill={modal.proposal ? {
              ...modal.proposal,
              deliverables: Array.isArray(modal.proposal.deliverables)
                ? modal.proposal.deliverables.join('\n')
                : modal.proposal.deliverables || '',
            } : {}}
            editMode={modal.mode === 'edit'}
            leads={leads} offers={offers}
          />
        )}
      </AnimatePresence>

      {/* ── Toast ── */}
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}
            className="fixed bottom-6 right-6 px-4 py-2.5 rounded-sm z-50 font-mono text-[10px] tracking-wide"
            style={{
              background: toast.ok ? `${EMERALD}18` : `${CRIMSON}18`,
              border: `1px solid ${toast.ok ? EMERALD : CRIMSON}40`,
              color: toast.ok ? EMERALD : CRIMSON,
              backdropFilter: 'blur(12px)',
            }}>
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
