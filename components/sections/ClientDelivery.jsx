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
  { id: 'onboarding', label: 'Onboarding', color: TEAL      },
  { id: 'active',     label: 'Active',     color: EMERALD   },
  { id: 'at-risk',    label: 'At Risk',    color: CRIMSON   },
  { id: 'completed',  label: 'Completed',  color: GOLD      },
];
const STAGE_BY_ID  = Object.fromEntries(STAGES.map(s => [s.id, s]));
const STAGE_NEXT   = { onboarding: 'active', active: 'completed' };
const ONBOARDING_STATUSES = ['pending','in-progress','complete'];
const DELIVERY_STATUSES   = ['pending','in-progress','on-track','at-risk','complete'];

const QUEUE_ACTIONS = [
  { id: 'onboarding-plan',    label: 'Onboarding Plan',  color: TEAL    },
  { id: 'delivery-plan',      label: 'Delivery Plan',    color: SAPPHIRE},
  { id: 'progress-review',    label: 'Progress Review',  color: GOLD    },
  { id: 'upsell-opportunity', label: 'Upsell Opportunity',color: VIOLET  },
];

const DELIVERY_STATUS_COLOR = {
  pending: '#6b7280', 'in-progress': SAPPHIRE, 'on-track': EMERALD, 'at-risk': CRIMSON, complete: GOLD,
};
const ONBOARDING_STATUS_COLOR = {
  pending: '#6b7280', 'in-progress': AMBER, complete: EMERALD,
};

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

// ── Queue Dropdown ────────────────────────────────────────────────────────────
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

// ── Client Card ───────────────────────────────────────────────────────────────
function ClientCard({ client, onQueueAction, onEdit, onMoveStage, actioning }) {
  const [showQueue, setShowQueue] = useState(false);
  const stage     = STAGE_BY_ID[client.status]  || STAGE_BY_ID.onboarding;
  const laneColor = LANE_COLORS[client.laneId]  || GOLD;
  const busy      = actioning === client.clientId;
  const nextStage = STAGE_NEXT[client.status];

  const deliveryColor   = DELIVERY_STATUS_COLOR[client.deliveryStatus]   || '#6b7280';
  const onboardingColor = ONBOARDING_STATUS_COLOR[client.onboardingStatus] || '#6b7280';

  return (
    <motion.div variants={fadeUp}
      className="rounded-sm p-2.5 flex flex-col gap-2 relative group"
      style={{
        background: client.status === 'at-risk'
          ? 'rgba(239,68,68,0.04)'
          : 'rgba(255,255,255,0.03)',
        border: `1px solid ${client.status === 'at-risk' ? `${CRIMSON}20` : 'rgba(255,255,255,0.07)'}`,
        borderLeftWidth: 2, borderLeftColor: stage.color,
      }}>

      {/* Company + value */}
      <div className="flex items-start justify-between gap-1">
        <div className="flex-1 min-w-0">
          <p className="font-ui text-[12px] font-semibold truncate leading-tight" style={{ color: 'var(--text-primary)' }}>
            {client.company}
          </p>
          {client.contactName && (
            <p className="font-mono text-[9px] mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
              {client.contactName}
            </p>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <p className="font-mono text-[14px] font-bold leading-none"
            style={{ color: client.status === 'completed' ? GOLD : EMERALD }}>
            {fmtMoney(client.contractValue)}
          </p>
          <p className="font-mono text-[8px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {safeTs(client.updatedAt)}
          </p>
        </div>
      </div>

      {/* Status pills */}
      <div className="flex items-center gap-1 flex-wrap">
        {client.offerTitle && <Pill label={client.offerTitle.slice(0, 20)} color={GOLD} />}
        <Pill label={LANE_LABELS[client.laneId] || client.laneId} color={laneColor} />
      </div>

      {/* Onboarding + delivery status */}
      <div className="grid grid-cols-2 gap-1.5">
        <div className="rounded-sm px-2 py-1"
          style={{ background: `${onboardingColor}08`, border: `1px solid ${onboardingColor}18` }}>
          <div className="font-mono text-[6px] tracking-widest mb-0.5" style={{ color: 'var(--text-muted)' }}>ONBOARDING</div>
          <div className="font-mono text-[8px] font-bold" style={{ color: onboardingColor }}>
            {client.onboardingStatus?.replace(/-/g, ' ').toUpperCase() || 'PENDING'}
          </div>
        </div>
        <div className="rounded-sm px-2 py-1"
          style={{ background: `${deliveryColor}08`, border: `1px solid ${deliveryColor}18` }}>
          <div className="font-mono text-[6px] tracking-widest mb-0.5" style={{ color: 'var(--text-muted)' }}>DELIVERY</div>
          <div className="font-mono text-[8px] font-bold" style={{ color: deliveryColor }}>
            {client.deliveryStatus?.replace(/-/g, ' ').toUpperCase() || 'PENDING'}
          </div>
        </div>
      </div>

      {/* Next milestone */}
      {client.nextMilestone && (
        <p className="font-mono text-[8px] line-clamp-1" style={{ color: TEAL }}>
          ◎ {client.nextMilestone}
        </p>
      )}

      {/* Hover actions */}
      <div className="flex items-center gap-1 pt-1 border-t opacity-0 group-hover:opacity-100 transition-opacity relative"
        style={{ borderColor: 'rgba(255,255,255,0.06)' }}>

        {nextStage && (
          <button onClick={() => onMoveStage(client.clientId, nextStage)}
            disabled={busy}
            className="font-mono text-[8px] px-1.5 py-1 rounded-sm font-bold"
            style={{ color: STAGE_BY_ID[nextStage]?.color, background: `${STAGE_BY_ID[nextStage]?.color}10`, border: `1px solid ${STAGE_BY_ID[nextStage]?.color}25` }}>
            → {STAGE_BY_ID[nextStage]?.label}
          </button>
        )}
        {client.status === 'active' && (
          <button onClick={() => onMoveStage(client.clientId, 'at-risk')}
            disabled={busy}
            className="font-mono text-[8px] px-1.5 py-1 rounded-sm"
            style={{ color: CRIMSON, background: `${CRIMSON}10`, border: `1px solid ${CRIMSON}25` }}>
            AT RISK
          </button>
        )}
        {client.status === 'at-risk' && (
          <button onClick={() => onMoveStage(client.clientId, 'active')}
            disabled={busy}
            className="font-mono text-[8px] px-1.5 py-1 rounded-sm"
            style={{ color: EMERALD, background: `${EMERALD}10`, border: `1px solid ${EMERALD}25` }}>
            RESOLVED
          </button>
        )}

        <button onClick={() => onEdit(client)}
          className="font-mono text-[8px] px-1.5 py-1 rounded-sm ml-auto"
          style={{ color: 'var(--text-muted)', background: 'rgba(255,255,255,0.04)' }}>
          ✎
        </button>

        <div className="relative">
          <button onClick={() => setShowQueue(s => !s)} disabled={busy}
            className="font-mono text-[8px] px-1.5 py-1 rounded-sm"
            style={{ color: SAPPHIRE, background: `${SAPPHIRE}10`, border: `1px solid ${SAPPHIRE}20` }}>
            {busy ? '…' : '⚡'}
          </button>
          <AnimatePresence>
            {showQueue && (
              <QueueDropdown
                onAction={id => onQueueAction(client.clientId, id)}
                busy={busy} onClose={() => setShowQueue(false)} />
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

// ── Pipeline Column ───────────────────────────────────────────────────────────
function DeliveryColumn({ stage, clients, onQueueAction, onEdit, onMoveStage, actioning }) {
  const stageValue = clients.reduce((s, c) => s + (c.contractValue || 0), 0);
  return (
    <div className="flex-shrink-0 flex flex-col" style={{ width: 210 }}>
      <div className="flex items-center justify-between mb-2 px-0.5">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: stage.color }} />
          <span className="font-mono text-[9px] font-bold tracking-wider" style={{ color: stage.color }}>
            {stage.label.toUpperCase()}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {stageValue > 0 && (
            <span className="font-mono text-[8px]" style={{ color: EMERALD, opacity: 0.7 }}>
              {fmtMoney(stageValue)}
            </span>
          )}
          <span className="font-mono text-[8px] rounded-full px-1.5 py-0.5"
            style={{ background: `${stage.color}15`, color: stage.color }}>
            {clients.length}
          </span>
        </div>
      </div>
      <div className="h-0.5 mb-2 rounded-full" style={{ background: `${stage.color}30` }} />
      <motion.div variants={stagger} initial="initial" animate="animate" className="flex flex-col gap-2 min-h-[80px]">
        {clients.length === 0 ? (
          <div className="rounded-sm py-4 flex items-center justify-center"
            style={{ border: `1px dashed ${stage.color}20` }}>
            <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)', opacity: 0.4 }}>empty</span>
          </div>
        ) : (
          clients.map(c => (
            <ClientCard key={c.clientId} client={c}
              onQueueAction={onQueueAction} onEdit={onEdit}
              onMoveStage={onMoveStage} actioning={actioning} />
          ))
        )}
      </motion.div>
    </div>
  );
}

// ── Edit Client Modal ─────────────────────────────────────────────────────────
function ClientModal({ open, onClose, onSaved, prefill, offers }) {
  const blank = {
    company: '', contactName: '', laneId: 'digital-diamond', offerId: '',
    status: 'onboarding', contractValue: '', onboardingStatus: 'pending',
    deliveryStatus: 'pending', nextMilestone: '',
  };
  const [form, setForm]   = useState({ ...blank, ...prefill });
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');

  useEffect(() => { if (open) setForm({ ...blank, ...prefill }); }, [open]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.company.trim()) { setErr('Company is required'); return; }
    setSaving(true); setErr('');
    try {
      const isEdit = !!prefill?.clientId;
      const url    = isEdit ? '/api/clients/update' : '/api/clients/create';
      const body   = isEdit
        ? { clientId: prefill.clientId, ...form, contractValue: parseFloat(form.contractValue) || 0 }
        : { ...form, contractValue: parseFloat(form.contractValue) || 0 };
      const res  = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) { onSaved(data.client); onClose(); }
      else setErr(data.error || 'Failed');
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
        className="panel-gold rounded-sm w-full max-w-lg max-h-[90vh] overflow-y-auto p-5"
        style={{ borderColor: `${GOLD}30` }} onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            {prefill?.clientId ? 'Update Client' : 'Add Client'}
          </h2>
          <button onClick={onClose} className="font-mono text-[11px] px-2 py-1" style={{ color: 'var(--text-muted)' }}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCl} style={{ color: GOLD }}>COMPANY *</label>
              <input value={form.company} onChange={e => set('company', e.target.value)}
                placeholder="Acme Inc." className={inputCl} style={inputSt} />
            </div>
            <div>
              <label className={labelCl} style={{ color: 'var(--text-muted)' }}>CONTACT NAME</label>
              <input value={form.contactName} onChange={e => set('contactName', e.target.value)}
                placeholder="Jane Smith" className={inputCl} style={inputSt} />
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
              <label className={labelCl} style={{ color: 'var(--text-muted)' }}>OFFER</label>
              <select value={form.offerId} onChange={e => set('offerId', e.target.value)}
                className={inputCl} style={inputSt}>
                <option value="">— none —</option>
                {(offers || []).filter(o => o.status !== 'archived').map(o => (
                  <option key={o.offerId} value={o.offerId}>{o.title}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCl} style={{ color: 'var(--text-muted)' }}>CONTRACT $</label>
              <input type="number" value={form.contractValue} onChange={e => set('contractValue', e.target.value)}
                placeholder="0" className={inputCl} style={inputSt} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCl} style={{ color: 'var(--text-muted)' }}>STATUS</label>
              <select value={form.status} onChange={e => set('status', e.target.value)}
                className={inputCl} style={inputSt}>
                {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCl} style={{ color: 'var(--text-muted)' }}>ONBOARDING</label>
              <select value={form.onboardingStatus} onChange={e => set('onboardingStatus', e.target.value)}
                className={inputCl} style={inputSt}>
                {ONBOARDING_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCl} style={{ color: 'var(--text-muted)' }}>DELIVERY</label>
              <select value={form.deliveryStatus} onChange={e => set('deliveryStatus', e.target.value)}
                className={inputCl} style={inputSt}>
                {DELIVERY_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className={labelCl} style={{ color: 'var(--text-muted)' }}>NEXT MILESTONE</label>
            <input value={form.nextMilestone} onChange={e => set('nextMilestone', e.target.value)}
              placeholder="e.g. Kickoff call scheduled" className={inputCl} style={inputSt} />
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
              style={{ background: `${EMERALD}18`, border: `1px solid ${EMERALD}35`, color: EMERALD, opacity: saving ? 0.6 : 1 }}>
              {saving ? 'SAVING…' : prefill?.clientId ? 'SAVE CHANGES' : 'ADD CLIENT'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

// ── Summary Bar ───────────────────────────────────────────────────────────────
function SummaryBar({ summary }) {
  const items = [
    { label: 'ONBOARDING', value: summary.onboarding   || 0, color: TEAL     },
    { label: 'ACTIVE',     value: summary.active       || 0, color: EMERALD  },
    { label: 'AT RISK',    value: summary.atRisk       || 0, color: CRIMSON  },
    { label: 'COMPLETED',  value: summary.completed    || 0, color: GOLD     },
  ];
  return (
    <div className="flex items-center gap-5 flex-wrap">
      {items.map(item => (
        <div key={item.label} className="flex items-center gap-1.5">
          <span className="font-mono text-xl font-bold leading-none" style={{ color: item.color }}>{item.value}</span>
          <span className="font-mono text-[7px] tracking-widest" style={{ color: 'var(--text-muted)' }}>{item.label}</span>
        </div>
      ))}
      {summary.activeContractValue > 0 && (
        <div className="ml-auto flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-xl font-bold leading-none" style={{ color: EMERALD }}>
              {fmtMoney(summary.activeContractValue)}
            </span>
            <span className="font-mono text-[7px] tracking-widest" style={{ color: 'var(--text-muted)' }}>ACTIVE VALUE</span>
          </div>
          {summary.totalContractValue !== summary.activeContractValue && (
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-xl font-bold leading-none" style={{ color: GOLD }}>
                {fmtMoney(summary.totalContractValue)}
              </span>
              <span className="font-mono text-[7px] tracking-widest" style={{ color: 'var(--text-muted)' }}>TOTAL</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full`}
              style={{ background: summary.deliveryHealth === 'healthy' ? EMERALD : CRIMSON,
                       boxShadow: `0 0 6px ${summary.deliveryHealth === 'healthy' ? EMERALD : CRIMSON}` }} />
            <span className="font-mono text-[8px]"
              style={{ color: summary.deliveryHealth === 'healthy' ? EMERALD : CRIMSON }}>
              {summary.deliveryHealth === 'healthy' ? 'DELIVERY HEALTHY' : 'DELIVERY AT RISK'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ClientDelivery() {
  const [data,       setData]       = useState(null);
  const [offers,     setOffers]     = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actioning,  setActioning]  = useState(null);
  const [toast,      setToast]      = useState(null);
  const [editClient, setEditClient] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [lastRefresh,setLastRefresh]= useState(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const [cRes, oRes] = await Promise.all([
        fetch('/api/clients/list'),
        fetch('/api/offers/list'),
      ]);
      if (cRes.ok) setData(await cRes.json());
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

  const handleQueueAction = async (clientId, action) => {
    setActioning(clientId);
    try {
      const res  = await fetch('/api/clients/queue-action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, action }),
      });
      const body = await res.json();
      if (body.ok) {
        showToast(`${action.replace(/-/g, ' ')} queued → ID: ${body.taskId?.slice(-8)}`);
        await load(true);
      } else { showToast(body.error || 'Failed', false); }
    } catch (e) { showToast(e.message, false); } finally { setActioning(null); }
  };

  const handleMoveStage = async (clientId, status) => {
    setActioning(clientId);
    try {
      const res  = await fetch('/api/clients/update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, status }),
      });
      const body = await res.json();
      if (body.ok) { showToast(`Moved to ${STAGE_BY_ID[status]?.label}`); await load(true); }
      else { showToast(body.error || 'Move failed', false); }
    } catch (e) { showToast(e.message, false); } finally { setActioning(null); }
  };

  const handleSaved = async (client) => {
    showToast(editClient ? 'Client updated.' : `Client added: ${client.company}`);
    setEditClient(null); setCreateOpen(false);
    await load(true);
  };

  if (loading) return (
    <div className="flex items-center justify-center py-32">
      <div className="flex flex-col items-center gap-3">
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
          className="w-6 h-6 rounded-full"
          style={{ border: '2px solid var(--border-default)', borderTopColor: EMERALD }} />
        <span className="font-mono text-[9px] tracking-widest" style={{ color: 'var(--text-muted)' }}>
          LOADING CLIENT DELIVERY
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
            Client Delivery
          </h1>
          <p className="font-mono text-[9px] tracking-widest mt-1.5" style={{ color: 'var(--text-muted)' }}>
            ACTIVE ENGAGEMENTS · MIKA AGENTIC OS
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
          <button onClick={() => setCreateOpen(true)}
            className="px-3 py-1.5 rounded-sm font-mono text-[9px] tracking-wider font-bold"
            style={{ background: `${EMERALD}18`, border: `1px solid ${EMERALD}35`, color: EMERALD }}>
            + ADD CLIENT
          </button>
        </div>
      </div>

      {/* ── Summary ── */}
      <div className="panel-gold rounded-sm p-3" style={{ borderColor: `${EMERALD}18` }}>
        <SummaryBar summary={data?.summary || {}} />
      </div>

      {/* ── Kanban board ── */}
      <div className="overflow-x-auto pb-4 -mx-1 px-1">
        <div className="flex gap-3" style={{ minWidth: STAGES.length * 222 }}>
          {STAGES.map(stage => (
            <DeliveryColumn key={stage.id} stage={stage}
              clients={byStatus[stage.id] || []}
              onQueueAction={handleQueueAction}
              onEdit={setEditClient}
              onMoveStage={handleMoveStage}
              actioning={actioning} />
          ))}
        </div>
      </div>

      {/* ── Flow reminder ── */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-sm"
        style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
        <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>LAYER:</span>
        {['Proposal', 'Client', 'Onboarding', 'Delivery', 'Revenue'].map((step, i) => (
          <span key={step} className="flex items-center gap-1.5">
            <span className="font-mono text-[8px]" style={{ color: i === 1 ? EMERALD : 'var(--text-muted)' }}>{step}</span>
            {i < 4 && <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)', opacity: 0.4 }}>→</span>}
          </span>
        ))}
        <span className="ml-auto font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>
          At Risk → flag → queue progress review
        </span>
      </div>

      {/* ── Modals ── */}
      <AnimatePresence>
        {(createOpen || editClient) && (
          <ClientModal
            open={!!(createOpen || editClient)}
            onClose={() => { setCreateOpen(false); setEditClient(null); }}
            onSaved={handleSaved}
            prefill={editClient || {}}
            offers={offers}
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
