import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ── Design tokens ─────────────────────────────────────────────────────────────
const GOLD     = '#c9a84c';
const TEAL     = '#0dd3c5';
const EMERALD  = '#10b981';
const SAPPHIRE = '#3b82f6';
const CRIMSON  = '#ef4444';
const AMBER    = '#f59e0b';
const VIOLET   = '#8b5cf6';
const ROSE     = '#f472b6';

const OFFER_TYPE_META = {
  service:              { label: 'Service',             color: TEAL,    icon: '◉' },
  'digital-product':    { label: 'Digital Product',     color: GOLD,    icon: '◆' },
  affiliate:            { label: 'Affiliate',           color: AMBER,   icon: '⬟' },
  course:               { label: 'Course',              color: VIOLET,  icon: '◈' },
  membership:           { label: 'Membership',          color: SAPPHIRE,icon: '◎' },
  'automation-package': { label: 'Automation Package',  color: EMERALD, icon: '◭' },
};

const STATUS_META = {
  idea:       { label: 'IDEA',       color: '#6b7280'  },
  validating: { label: 'VALIDATING', color: AMBER      },
  building:   { label: 'BUILDING',   color: SAPPHIRE   },
  ready:      { label: 'READY',      color: EMERALD    },
  selling:    { label: 'SELLING',    color: GOLD       },
  archived:   { label: 'ARCHIVED',   color: '#374151'  },
};

const LANE_LABELS = {
  'digital-diamond': 'Digital Diamond', 'managed-by-mika': 'Managed by Mika',
  'medai': 'MedAI', 'cannaops': 'CannaOps', 'hotel-hooker': 'Hotel Hooker',
  'ai-twin': 'AI Twin', 'lead-recovery': 'Lead Recovery',
};

const LANE_COLORS = {
  'digital-diamond': '#c9a84c', 'managed-by-mika': '#0dd3c5',
  'medai': '#818cf8', 'cannaops': '#4ade80', 'hotel-hooker': '#f472b6',
  'ai-twin': '#60a5fa', 'lead-recovery': '#fb923c',
};

const POTENTIAL_COLOR = { high: EMERALD, medium: GOLD, low: AMBER };
const EFFORT_COLOR    = { low: EMERALD,  medium: AMBER, high: CRIMSON };

const FILTERS = [
  { id: 'all',         label: 'All',              filter: os => os.filter(o => o.status !== 'archived') },
  { id: 'ready',       label: 'Ready to Sell',    filter: os => os.filter(o => o.status === 'ready' || o.status === 'selling') },
  { id: 'validating',  label: 'Validating',       filter: os => os.filter(o => o.status === 'validating') },
  { id: 'building',    label: 'Building',         filter: os => os.filter(o => o.status === 'building') },
  { id: 'high-revenue',label: 'High Revenue',     filter: os => os.filter(o => o.revenuePotential === 'high' && o.status !== 'archived') },
  { id: 'low-effort',  label: 'Low Effort',       filter: os => os.filter(o => o.effortLevel === 'low' && o.status !== 'archived') },
];

const QUEUE_ACTIONS = [
  { id: 'validate',          label: 'Queue Validation',      color: AMBER    },
  { id: 'sales-page',        label: 'Queue Sales Page',      color: SAPPHIRE },
  { id: 'content-campaign',  label: 'Queue Content Campaign',color: TEAL     },
  { id: 'fulfillment-sop',   label: 'Queue Fulfillment SOP', color: VIOLET   },
];

const OFFER_TYPES  = ['service','digital-product','affiliate','course','membership','automation-package'];
const LANES        = Object.keys(LANE_LABELS);
const EFFORT_OPTS  = ['low','medium','high'];
const REVENUE_OPTS = ['low','medium','high'];
const STATUS_OPTS  = ['idea','validating','building','ready','selling'];

const stagger = { initial: {}, animate: { transition: { staggerChildren: 0.04 } } };
const fadeUp  = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0, transition: { duration: 0.25 } } };

// ── Helpers ───────────────────────────────────────────────────────────────────
function safeTs(ts) {
  if (!ts) return '';
  try {
    const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
    if (diff < 60) return `${diff}m ago`;
    const h = Math.floor(diff / 60);
    if (h < 24) return `${h}h ago`;
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return ''; }
}

function fmtPrice({ min = 0, max = 0, currency = 'USD' } = {}) {
  if (!min && !max) return '—';
  const fmt = n => n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : `${n}`;
  if (min === max) return `$${fmt(min)}`;
  return `$${fmt(min)}–$${fmt(max)}`;
}

// ── Pill ──────────────────────────────────────────────────────────────────────
function Pill({ label, color, small }) {
  const sz = small ? 'text-[7px] px-1.5 py-0.5' : 'text-[8px] px-2 py-0.5';
  return (
    <span className={`font-mono ${sz} rounded tracking-wide`}
      style={{ background: `${color}15`, color, border: `1px solid ${color}28` }}>
      {label}
    </span>
  );
}

// ── Create Offer Modal ────────────────────────────────────────────────────────
function CreateOfferModal({ open, onClose, onCreated, prefill }) {
  const blank = {
    title: '', laneId: 'digital-diamond', offerType: 'service',
    targetAudience: '', problemSolved: '', promise: '',
    deliverables: '', priceMin: '', priceMax: '',
    effortLevel: 'medium', revenuePotential: 'medium', status: 'idea',
    nextAction: '',
  };
  const [form, setForm] = useState({ ...blank, ...prefill });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (open) setForm({ ...blank, ...prefill });
  }, [open]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) { setErr('Title is required'); return; }
    setSaving(true); setErr('');
    try {
      const res = await fetch('/api/offers/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          deliverables: form.deliverables.split('\n').map(s => s.trim()).filter(Boolean),
          priceRange: { min: parseInt(form.priceMin, 10) || 0, max: parseInt(form.priceMax, 10) || 0, currency: 'USD' },
          sourceOpportunityId: prefill?.sourceOpportunityId || null,
        }),
      });
      const body = await res.json();
      if (body.ok) { onCreated(body.offer); onClose(); }
      else setErr(body.error || 'Failed to create offer');
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  };

  if (!open) return null;

  const inputCls = 'w-full bg-transparent rounded-sm px-2.5 py-1.5 font-mono text-[11px] focus:outline-none transition-colors';
  const inputStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-primary)' };
  const labelCls  = 'font-mono text-[8px] tracking-widest block mb-1';

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97 }}
        className="panel-gold rounded-sm w-full max-w-xl max-h-[90vh] overflow-y-auto p-5"
        style={{ borderColor: `${GOLD}30` }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-display text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>New Offer</h2>
            <p className="font-mono text-[8px] tracking-widest mt-0.5" style={{ color: 'var(--text-muted)' }}>
              OFFER LIBRARY · MIKA AGENTIC OS
            </p>
          </div>
          <button onClick={onClose} className="font-mono text-[11px] px-2 py-1 rounded" style={{ color: 'var(--text-muted)' }}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Title */}
          <div>
            <label className={labelCls} style={{ color: GOLD }}>TITLE *</label>
            <input
              value={form.title} onChange={e => set('title', e.target.value)}
              placeholder="e.g. AI Content Strategy Sprint"
              className={inputCls} style={inputStyle}
            />
          </div>

          {/* Lane + Type */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} style={{ color: 'var(--text-muted)' }}>BRAND</label>
              <select value={form.laneId} onChange={e => set('laneId', e.target.value)}
                className={inputCls} style={inputStyle}>
                {LANES.map(id => <option key={id} value={id}>{LANE_LABELS[id]}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls} style={{ color: 'var(--text-muted)' }}>OFFER TYPE</label>
              <select value={form.offerType} onChange={e => set('offerType', e.target.value)}
                className={inputCls} style={inputStyle}>
                {OFFER_TYPES.map(t => <option key={t} value={t}>{OFFER_TYPE_META[t]?.label || t}</option>)}
              </select>
            </div>
          </div>

          {/* Target audience */}
          <div>
            <label className={labelCls} style={{ color: 'var(--text-muted)' }}>TARGET AUDIENCE</label>
            <input value={form.targetAudience} onChange={e => set('targetAudience', e.target.value)}
              placeholder="Who is this for?"
              className={inputCls} style={inputStyle} />
          </div>

          {/* Problem / Promise */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} style={{ color: 'var(--text-muted)' }}>PROBLEM SOLVED</label>
              <textarea value={form.problemSolved} onChange={e => set('problemSolved', e.target.value)}
                rows={2} placeholder="What pain does this fix?"
                className={`${inputCls} resize-none`} style={inputStyle} />
            </div>
            <div>
              <label className={labelCls} style={{ color: 'var(--text-muted)' }}>PROMISE</label>
              <textarea value={form.promise} onChange={e => set('promise', e.target.value)}
                rows={2} placeholder="What transformation do you promise?"
                className={`${inputCls} resize-none`} style={inputStyle} />
            </div>
          </div>

          {/* Deliverables */}
          <div>
            <label className={labelCls} style={{ color: 'var(--text-muted)' }}>DELIVERABLES (one per line)</label>
            <textarea value={form.deliverables} onChange={e => set('deliverables', e.target.value)}
              rows={3} placeholder={'30-day content calendar\nAI-written captions (30)\nMonthly strategy call'}
              className={`${inputCls} resize-none`} style={inputStyle} />
          </div>

          {/* Price + Effort + Potential */}
          <div className="grid grid-cols-4 gap-2">
            <div>
              <label className={labelCls} style={{ color: 'var(--text-muted)' }}>MIN PRICE $</label>
              <input type="number" value={form.priceMin} onChange={e => set('priceMin', e.target.value)}
                placeholder="0" className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className={labelCls} style={{ color: 'var(--text-muted)' }}>MAX PRICE $</label>
              <input type="number" value={form.priceMax} onChange={e => set('priceMax', e.target.value)}
                placeholder="0" className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className={labelCls} style={{ color: 'var(--text-muted)' }}>EFFORT</label>
              <select value={form.effortLevel} onChange={e => set('effortLevel', e.target.value)}
                className={inputCls} style={inputStyle}>
                {EFFORT_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls} style={{ color: 'var(--text-muted)' }}>POTENTIAL</label>
              <select value={form.revenuePotential} onChange={e => set('revenuePotential', e.target.value)}
                className={inputCls} style={inputStyle}>
                {REVENUE_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>

          {/* Status + Next action */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} style={{ color: 'var(--text-muted)' }}>STATUS</label>
              <select value={form.status} onChange={e => set('status', e.target.value)}
                className={inputCls} style={inputStyle}>
                {STATUS_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls} style={{ color: 'var(--text-muted)' }}>NEXT ACTION</label>
              <input value={form.nextAction} onChange={e => set('nextAction', e.target.value)}
                placeholder="What needs to happen next?"
                className={inputCls} style={inputStyle} />
            </div>
          </div>

          {err && (
            <p className="font-mono text-[9px]" style={{ color: CRIMSON }}>{err}</p>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="font-mono text-[9px] tracking-wider px-3 py-1.5 rounded-sm"
              style={{ color: 'var(--text-muted)', border: '1px solid rgba(255,255,255,0.08)' }}>
              CANCEL
            </button>
            <button type="submit" disabled={saving}
              className="font-mono text-[9px] tracking-wider px-4 py-1.5 rounded-sm font-bold transition-all"
              style={{ background: `${GOLD}18`, border: `1px solid ${GOLD}35`, color: GOLD, opacity: saving ? 0.6 : 1 }}>
              {saving ? 'CREATING…' : 'CREATE OFFER'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

// ── Edit Status Modal ─────────────────────────────────────────────────────────
function EditStatusModal({ offer, open, onClose, onSaved }) {
  const [status, setStatus]     = useState(offer?.status || 'idea');
  const [nextAction, setNext]   = useState(offer?.nextAction || '');
  const [saving, setSaving]     = useState(false);

  useEffect(() => {
    if (open && offer) { setStatus(offer.status); setNext(offer.nextAction || ''); }
  }, [open, offer]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/offers/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offerId: offer.offerId, status, nextAction }),
      });
      const body = await res.json();
      if (body.ok) { onSaved(body.offer); onClose(); }
    } finally { setSaving(false); }
  };

  if (!open || !offer) return null;

  const inputStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-primary)' };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div initial={{ opacity: 0, scale: 0.97, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0 }}
        className="panel-gold rounded-sm w-full max-w-sm p-5" style={{ borderColor: `${GOLD}30` }}
        onClick={e => e.stopPropagation()}>
        <h3 className="font-display text-base font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
          Update Offer Status
        </h3>
        <p className="font-mono text-[9px] mb-4 truncate" style={{ color: 'var(--text-muted)' }}>{offer.title}</p>

        <div className="space-y-3">
          <div>
            <label className="font-mono text-[8px] tracking-widest block mb-1" style={{ color: 'var(--text-muted)' }}>STATUS</label>
            <select value={status} onChange={e => setStatus(e.target.value)}
              className="w-full bg-transparent rounded-sm px-2.5 py-1.5 font-mono text-[11px] focus:outline-none"
              style={inputStyle}>
              {STATUS_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="font-mono text-[8px] tracking-widest block mb-1" style={{ color: 'var(--text-muted)' }}>NEXT ACTION</label>
            <input value={nextAction} onChange={e => setNext(e.target.value)}
              className="w-full bg-transparent rounded-sm px-2.5 py-1.5 font-mono text-[11px] focus:outline-none"
              style={inputStyle} />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 mt-4">
          <button onClick={onClose} className="font-mono text-[9px] px-3 py-1.5 rounded-sm"
            style={{ color: 'var(--text-muted)', border: '1px solid rgba(255,255,255,0.08)' }}>CANCEL</button>
          <button onClick={handleSave} disabled={saving}
            className="font-mono text-[9px] tracking-wider px-4 py-1.5 rounded-sm font-bold"
            style={{ background: `${GOLD}18`, border: `1px solid ${GOLD}35`, color: GOLD }}>
            {saving ? 'SAVING…' : 'SAVE'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Offer Card ────────────────────────────────────────────────────────────────
function OfferCard({ offer, onQueueAction, onEditStatus, onArchive, actioning }) {
  const typeMeta   = OFFER_TYPE_META[offer.offerType] || { label: offer.offerType, color: GOLD, icon: '◎' };
  const statusMeta = STATUS_META[offer.status]         || STATUS_META.idea;
  const laneColor  = LANE_COLORS[offer.laneId]         || GOLD;
  const price      = fmtPrice(offer.priceRange);
  const busy       = actioning === offer.offerId;
  const isArchived = offer.status === 'archived';

  return (
    <motion.div variants={fadeUp}
      className="panel-gold rounded-sm p-4 flex flex-col gap-2.5 relative"
      style={{
        borderColor: `${typeMeta.color}20`,
        borderLeftWidth: 3,
        borderLeftColor: typeMeta.color,
        opacity: isArchived ? 0.4 : 1,
      }}>

      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            <span className="font-mono text-[10px]" style={{ color: typeMeta.color }}>{typeMeta.icon}</span>
            <Pill label={typeMeta.label} color={typeMeta.color} small />
            <Pill label={LANE_LABELS[offer.laneId] || offer.laneId} color={laneColor} small />
            <span className="font-mono text-[7px] px-1.5 py-0.5 rounded"
              style={{ background: `${statusMeta.color}15`, color: statusMeta.color, border: `1px solid ${statusMeta.color}25` }}>
              {statusMeta.label}
            </span>
          </div>
          <h3 className="font-ui text-[13px] font-semibold leading-snug" style={{ color: 'var(--text-primary)' }}>
            {offer.title}
          </h3>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="font-mono text-[8px] flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
            {safeTs(offer.updatedAt)}
          </span>
          {offer.leadCount > 0 && (
            <span className="font-mono text-[7px] px-1.5 py-0.5 rounded flex-shrink-0"
              style={{ background: `${EMERALD}15`, color: EMERALD, border: `1px solid ${EMERALD}28` }}>
              {offer.leadCount} lead{offer.leadCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Price + Metrics */}
      <div className="flex items-center gap-2 flex-wrap">
        {price !== '—' && (
          <div className="flex items-center gap-1">
            <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>PRICE</span>
            <span className="font-mono text-[11px] font-bold" style={{ color: GOLD }}>{price}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>POTENTIAL</span>
          <Pill label={(offer.revenuePotential || 'medium').toUpperCase()} color={POTENTIAL_COLOR[offer.revenuePotential] || GOLD} small />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>EFFORT</span>
          <Pill label={(offer.effortLevel || 'medium').toUpperCase()} color={EFFORT_COLOR[offer.effortLevel] || AMBER} small />
        </div>
        {offer.revenuePotential === 'high' && offer.effortLevel === 'low' && (
          <span className="font-mono text-[7px] px-1.5 py-0.5 rounded"
            style={{ background: `${GOLD}18`, color: GOLD, border: `1px solid ${GOLD}30` }}>★ SWEET SPOT</span>
        )}
      </div>

      {/* Promise */}
      {offer.promise && (
        <p className="font-body text-[11px] leading-snug line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
          {offer.promise}
        </p>
      )}

      {/* Deliverables */}
      {offer.deliverables?.length > 0 && (
        <div className="flex items-start gap-1.5">
          <span className="font-mono text-[8px] flex-shrink-0 mt-0.5" style={{ color: 'var(--text-muted)' }}>DELIVERS:</span>
          <span className="font-mono text-[9px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {offer.deliverables.slice(0, 2).join(' · ')}{offer.deliverables.length > 2 ? ` + ${offer.deliverables.length - 2} more` : ''}
          </span>
        </div>
      )}

      {/* Next action */}
      {offer.nextAction && (
        <div className="rounded-sm px-2.5 py-1.5" style={{ background: `${typeMeta.color}06`, border: `1px solid ${typeMeta.color}14` }}>
          <span className="font-mono text-[7px] tracking-widest mr-1.5" style={{ color: 'var(--text-muted)' }}>NEXT:</span>
          <span className="font-mono text-[9px]" style={{ color: 'var(--text-primary)' }}>{offer.nextAction}</span>
        </div>
      )}

      {/* Source opportunity */}
      {offer.sourceOpportunityId && (
        <p className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>
          ← from opportunity: {offer.sourceOpportunityId.slice(0, 32)}…
        </p>
      )}

      {/* Actions */}
      {!isArchived && (
        <div className="pt-1.5 border-t space-y-2" style={{ borderColor: 'var(--border-default)' }}>
          {/* Queue actions */}
          <div className="grid grid-cols-2 gap-1.5">
            {QUEUE_ACTIONS.map(qa => (
              <button key={qa.id}
                onClick={() => onQueueAction(offer.offerId, qa.id)}
                disabled={busy}
                className="font-mono text-[7px] tracking-wider px-2 py-1.5 rounded-sm transition-all text-left"
                style={{ background: `${qa.color}08`, color: qa.color, border: `1px solid ${qa.color}20`, opacity: busy ? 0.5 : 1 }}>
                {busy ? '…' : qa.label}
              </button>
            ))}
          </div>
          {/* Status + Archive */}
          <div className="flex items-center gap-1.5">
            <button onClick={() => onEditStatus(offer)}
              className="font-mono text-[8px] tracking-wider px-2.5 py-1.5 rounded-sm transition-all"
              style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)', border: '1px solid rgba(255,255,255,0.08)' }}>
              EDIT STATUS
            </button>
            <button onClick={() => onArchive(offer.offerId)}
              className="ml-auto font-mono text-[8px] px-2 py-1.5 rounded-sm"
              style={{ color: 'var(--text-muted)', opacity: 0.4 }}>
              archive
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}

// ── Summary bar ───────────────────────────────────────────────────────────────
function SummaryBar({ summary }) {
  const items = [
    { label: 'TOTAL',       value: summary.total        || 0, color: GOLD      },
    { label: 'IDEA',        value: summary.idea         || 0, color: '#6b7280' },
    { label: 'VALIDATING',  value: summary.validating   || 0, color: AMBER     },
    { label: 'BUILDING',    value: summary.building     || 0, color: SAPPHIRE  },
    { label: 'READY',       value: summary.ready        || 0, color: EMERALD   },
    { label: 'SELLING',     value: summary.selling      || 0, color: GOLD      },
    { label: '★ SWEET SPOT',value: summary.sweetSpot   || 0, color: GOLD      },
  ];
  return (
    <div className="flex items-center gap-4 flex-wrap">
      {items.map(item => (
        <div key={item.label} className="flex items-center gap-1.5">
          <span className="font-mono text-lg font-bold leading-none" style={{ color: item.color }}>{item.value}</span>
          <span className="font-mono text-[7px] tracking-widest" style={{ color: 'var(--text-muted)' }}>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState({ filter, onCreate }) {
  const msgs = {
    ready:        'No offers ready to sell yet. Move offers to Ready status when they\'re built.',
    validating:   'No offers in validation. Queue a validation task to research market demand.',
    building:     'No offers being built. Create an offer and queue a Fulfillment SOP to start.',
    'high-revenue':'No high-revenue offers yet. Set Revenue Potential to High when creating.',
    'low-effort': 'No low-effort offers yet. Set Effort Level to Low for quick wins.',
    all:          'No offers in the library yet.',
  };
  return (
    <div className="panel-gold rounded-sm flex flex-col items-center justify-center py-16 gap-3"
      style={{ borderColor: `${GOLD}15` }}>
      <span className="font-mono text-2xl" style={{ color: `${GOLD}40` }}>◆</span>
      <p className="font-mono text-[10px] text-center max-w-xs" style={{ color: 'var(--text-muted)' }}>
        {msgs[filter] || msgs.all}
      </p>
      {filter === 'all' && (
        <button onClick={onCreate}
          className="mt-2 font-mono text-[9px] tracking-wider px-4 py-2 rounded-sm"
          style={{ background: `${GOLD}12`, border: `1px solid ${GOLD}30`, color: GOLD }}>
          + CREATE FIRST OFFER
        </button>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function OfferLibrary() {
  const [data,       setData]       = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter,     setFilter]     = useState('all');
  const [actioning,  setActioning]  = useState(null);
  const [toast,      setToast]      = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOffer,  setEditOffer]  = useState(null);
  const [lastRefresh,setLastRefresh]= useState(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const res = await fetch('/api/offers/list');
      if (res.ok) { setData(await res.json()); setLastRefresh(new Date()); }
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => load(true), 60_000);
    return () => clearInterval(id);
  }, [load]);

  const showToast = (msg, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const handleQueueAction = async (offerId, action) => {
    setActioning(offerId);
    try {
      const res  = await fetch('/api/offers/queue-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offerId, action }),
      });
      const body = await res.json();
      if (body.ok) {
        const labels = {
          validate:           'Validation task queued',
          'sales-page':       'Sales page task queued',
          'content-campaign': 'Content campaign task queued',
          'fulfillment-sop':  'Fulfillment SOP task queued',
        };
        showToast(`${labels[action] || 'Task queued'} → Task ID: ${body.taskId?.slice(-8)}`);
        await load(true);
      } else {
        showToast(body.error || 'Action failed', false);
      }
    } catch (e) { showToast(e.message, false); } finally { setActioning(null); }
  };

  const handleArchive = async (offerId) => {
    try {
      await fetch('/api/offers/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offerId, status: 'archived' }),
      });
      showToast('Offer archived.');
      await load(true);
    } catch (e) { showToast(e.message, false); }
  };

  const handleStatusSaved = async (updatedOffer) => {
    showToast('Status updated.');
    await load(true);
  };

  const handleCreated = async (offer) => {
    showToast(`Offer created: ${offer.title}`);
    await load(true);
  };

  // Apply filter
  const filtered = (() => {
    const offers = data?.offers || [];
    const fn = FILTERS.find(f => f.id === filter)?.filter;
    return fn ? fn(offers) : offers.filter(o => o.status !== 'archived');
  })();

  if (loading) return (
    <div className="flex items-center justify-center py-32">
      <div className="flex flex-col items-center gap-3">
        <motion.div animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
          className="w-6 h-6 rounded-full"
          style={{ border: '2px solid var(--border-default)', borderTopColor: GOLD }} />
        <span className="font-mono text-[9px] tracking-widest" style={{ color: 'var(--text-muted)' }}>
          LOADING OFFER LIBRARY
        </span>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">

      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold leading-none" style={{ color: 'var(--text-primary)' }}>
            Offer Library
          </h1>
          <p className="font-mono text-[9px] tracking-widest mt-1.5" style={{ color: 'var(--text-muted)' }}>
            STRUCTURED OFFERS · MIKA AGENTIC OS
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastRefresh && (
            <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>
              {safeTs(lastRefresh.toISOString())}
            </span>
          )}
          <button onClick={() => load(true)} disabled={refreshing}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-sm font-mono text-[9px] tracking-wide transition-all"
            style={{ background: `${GOLD}0f`, border: `1px solid ${GOLD}20`, color: GOLD, opacity: refreshing ? 0.5 : 1 }}>
            {refreshing
              ? <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}>↻</motion.span>
              : '↻'} REFRESH
          </button>
          <button onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm font-mono text-[9px] tracking-wider font-bold transition-all"
            style={{ background: `${GOLD}18`, border: `1px solid ${GOLD}35`, color: GOLD }}>
            + NEW OFFER
          </button>
        </div>
      </div>

      {/* ── Summary bar ── */}
      <div className="panel-gold rounded-sm p-3" style={{ borderColor: `${GOLD}18` }}>
        <SummaryBar summary={data?.summary || {}} />
      </div>

      {/* ── Filter tabs ── */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {FILTERS.map(f => {
          const count  = (f.filter(data?.offers || [])).length;
          const active = filter === f.id;
          return (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm font-mono text-[9px] tracking-wider transition-all"
              style={{
                background: active ? `${GOLD}15` : 'rgba(255,255,255,0.03)',
                border: `1px solid ${active ? `${GOLD}40` : 'rgba(255,255,255,0.07)'}`,
                color: active ? GOLD : 'var(--text-muted)',
              }}>
              {f.label}
              <span className="rounded px-1"
                style={{ background: active ? `${GOLD}20` : 'rgba(255,255,255,0.06)', color: active ? GOLD : 'var(--text-muted)' }}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Grid ── */}
      {filtered.length === 0
        ? <EmptyState filter={filter} onCreate={() => setCreateOpen(true)} />
        : (
          <motion.div variants={stagger} initial="initial" animate="animate" className="grid grid-cols-2 gap-3">
            {filtered.map(offer => (
              <OfferCard
                key={offer.offerId}
                offer={offer}
                onQueueAction={handleQueueAction}
                onEditStatus={setEditOffer}
                onArchive={handleArchive}
                actioning={actioning}
              />
            ))}
          </motion.div>
        )
      }

      {/* ── Governance reminder ── */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-sm"
        style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
        <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>FLOW:</span>
        {['Offer', 'Queue Action', 'Approval', 'Dispatch', 'Deliverable'].map((step, i) => (
          <span key={step} className="flex items-center gap-1.5">
            <span className="font-mono text-[8px] tracking-wider" style={{ color: i === 0 ? GOLD : 'var(--text-muted)' }}>
              {step}
            </span>
            {i < 4 && <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)', opacity: 0.4 }}>→</span>}
          </span>
        ))}
      </div>

      {/* ── Modals ── */}
      <AnimatePresence>
        {createOpen && (
          <CreateOfferModal
            open={createOpen}
            onClose={() => setCreateOpen(false)}
            onCreated={handleCreated}
            prefill={{}}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editOffer && (
          <EditStatusModal
            open={!!editOffer}
            offer={editOffer}
            onClose={() => setEditOffer(null)}
            onSaved={handleStatusSaved}
          />
        )}
      </AnimatePresence>

      {/* ── Toast ── */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}
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
