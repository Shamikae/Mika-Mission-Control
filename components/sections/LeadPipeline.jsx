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
  { id: 'new',           label: 'New',           color: '#6b7280'  },
  { id: 'contacted',     label: 'Contacted',     color: SAPPHIRE   },
  { id: 'qualified',     label: 'Qualified',     color: VIOLET     },
  { id: 'proposal-sent', label: 'Proposal Sent', color: GOLD       },
  { id: 'negotiating',   label: 'Negotiating',   color: AMBER      },
  { id: 'won',           label: 'Won',           color: EMERALD    },
  { id: 'lost',          label: 'Lost',          color: CRIMSON    },
];
const STAGE_IDS    = STAGES.map(s => s.id);
const STAGE_BY_ID  = Object.fromEntries(STAGES.map(s => [s.id, s]));

const OFFER_TYPES = ['service','digital-product','affiliate','course','membership','automation-package'];
const SOURCE_OPTS = ['manual','content','referral','social-media','email','dm','discovery-call','other'];

const QUEUE_ACTIONS = [
  { id: 'research-lead',           label: 'Research Lead',     color: SAPPHIRE },
  { id: 'write-outreach',          label: 'Write Outreach',    color: TEAL     },
  { id: 'prepare-proposal',        label: 'Prepare Proposal',  color: GOLD     },
  { id: 'follow-up',               label: 'Write Follow-Up',   color: VIOLET   },
  { id: 'create-onboarding-plan',  label: 'Onboarding Plan',   color: EMERALD  },
];

const STAGE_NEXT = {
  new: 'contacted', contacted: 'qualified', qualified: 'proposal-sent',
  'proposal-sent': 'negotiating', negotiating: 'won',
};
const STAGE_PREV = Object.fromEntries(Object.entries(STAGE_NEXT).map(([k, v]) => [v, k]));

const stagger = { initial: {}, animate: { transition: { staggerChildren: 0.03 } } };
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
  if (!n) return '$0';
  if (n >= 1000) return `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return `$${n}`;
}

function scoreColor(score) {
  if (score >= 80) return EMERALD;
  if (score >= 60) return TEAL;
  if (score >= 40) return AMBER;
  return CRIMSON;
}

// ── Score bar ─────────────────────────────────────────────────────────────────
function ScoreBar({ score = 50 }) {
  const color = scoreColor(score);
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div className="h-full rounded-full transition-all"
          style={{ width: `${score}%`, background: color, boxShadow: `0 0 4px ${color}60` }} />
      </div>
      <span className="font-mono text-[8px] w-6 text-right" style={{ color }}>{score}</span>
    </div>
  );
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

// ── Create / Edit Lead Modal ──────────────────────────────────────────────────
function LeadModal({ open, onClose, onSaved, prefill, editMode, offers }) {
  const blank = {
    fullName: '', company: '', email: '', source: 'manual',
    laneId: 'digital-diamond', interestedOfferId: '',
    status: 'new', leadScore: 50, notes: '', nextAction: '',
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
    if (!form.fullName.trim()) { setErr('Full name is required'); return; }
    setSaving(true); setErr('');
    try {
      const url  = editMode ? '/api/leads/update'  : '/api/leads/create';
      const body = editMode
        ? { leadId: prefill.leadId, ...form, interestedOfferId: form.interestedOfferId || null }
        : { ...form, interestedOfferId: form.interestedOfferId || null };
      const res  = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, leadScore: Number(form.leadScore) || 50 }),
      });
      const data = await res.json();
      if (data.ok) { onSaved(data.lead); onClose(); }
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
              {editMode ? 'Edit Lead' : 'New Lead'}
            </h2>
            <p className="font-mono text-[8px] tracking-widest mt-0.5" style={{ color: 'var(--text-muted)' }}>
              LEAD PIPELINE · MIKA AGENTIC OS
            </p>
          </div>
          <button onClick={onClose} className="font-mono text-[11px] px-2 py-1" style={{ color: 'var(--text-muted)' }}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Name + Company */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCl} style={{ color: GOLD }}>FULL NAME *</label>
              <input value={form.fullName} onChange={e => set('fullName', e.target.value)}
                placeholder="Jane Smith" className={inputCl} style={inputSt} />
            </div>
            <div>
              <label className={labelCl} style={{ color: 'var(--text-muted)' }}>COMPANY</label>
              <input value={form.company} onChange={e => set('company', e.target.value)}
                placeholder="Acme Inc." className={inputCl} style={inputSt} />
            </div>
          </div>

          {/* Email + Source */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCl} style={{ color: 'var(--text-muted)' }}>EMAIL</label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                placeholder="jane@acme.com" className={inputCl} style={inputSt} />
            </div>
            <div>
              <label className={labelCl} style={{ color: 'var(--text-muted)' }}>SOURCE</label>
              <select value={form.source} onChange={e => set('source', e.target.value)}
                className={inputCl} style={inputSt}>
                {SOURCE_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* Brand + Interested Offer */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCl} style={{ color: 'var(--text-muted)' }}>BRAND</label>
              <select value={form.laneId} onChange={e => set('laneId', e.target.value)}
                className={inputCl} style={inputSt}>
                {LANES.map(id => <option key={id} value={id}>{LANE_LABELS[id]}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCl} style={{ color: 'var(--text-muted)' }}>INTERESTED OFFER</label>
              <select value={form.interestedOfferId} onChange={e => set('interestedOfferId', e.target.value)}
                className={inputCl} style={inputSt}>
                <option value="">— none selected —</option>
                {(offers || []).filter(o => o.status !== 'archived').map(o => (
                  <option key={o.offerId} value={o.offerId}>{o.title}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Status + Score */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCl} style={{ color: 'var(--text-muted)' }}>STATUS</label>
              <select value={form.status} onChange={e => set('status', e.target.value)}
                className={inputCl} style={inputSt}>
                {STAGE_IDS.map(s => <option key={s} value={s}>{STAGE_BY_ID[s].label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCl} style={{ color: 'var(--text-muted)' }}>
                LEAD SCORE (0–100) — current: <span style={{ color: scoreColor(Number(form.leadScore)) }}>{form.leadScore}</span>
              </label>
              <input type="range" min="0" max="100" value={form.leadScore}
                onChange={e => set('leadScore', Number(e.target.value))}
                className="w-full mt-1" />
            </div>
          </div>

          {/* Notes + Next action */}
          <div>
            <label className={labelCl} style={{ color: 'var(--text-muted)' }}>NOTES</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
              rows={2} placeholder="Context, background, how they found us..."
              className={`${inputCl} resize-none`} style={inputSt} />
          </div>
          <div>
            <label className={labelCl} style={{ color: 'var(--text-muted)' }}>NEXT ACTION</label>
            <input value={form.nextAction} onChange={e => set('nextAction', e.target.value)}
              placeholder="What's the next step with this lead?" className={inputCl} style={inputSt} />
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
              {saving ? 'SAVING…' : editMode ? 'SAVE CHANGES' : 'ADD LEAD'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

// ── Queue Action Dropdown ─────────────────────────────────────────────────────
function QueueDropdown({ lead, onAction, busy, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <motion.div ref={ref}
      initial={{ opacity: 0, scale: 0.95, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="absolute right-0 top-full mt-1 z-30 rounded-sm py-1 w-48"
      style={{ background: 'var(--bg-topbar)', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
      <div className="px-2.5 py-1 mb-1 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <span className="font-mono text-[7px] tracking-widest" style={{ color: 'var(--text-muted)' }}>QUEUE ACTION</span>
      </div>
      {QUEUE_ACTIONS.map(qa => (
        <button key={qa.id} onClick={() => { onAction(lead.leadId, qa.id); onClose(); }}
          disabled={busy} className="w-full text-left flex items-center gap-2 px-2.5 py-1.5 transition-all"
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

// ── Lead Card ─────────────────────────────────────────────────────────────────
function LeadCard({ lead, onQueueAction, onEdit, onMoveStage, onArchive, onCreateProposal, actioning }) {
  const [showQueue, setShowQueue] = useState(false);
  const laneColor = LANE_COLORS[lead.laneId] || GOLD;
  const busy      = actioning === lead.leadId;
  const nextStage = STAGE_NEXT[lead.status];
  const prevStage = STAGE_PREV[lead.status];
  const nextMeta  = nextStage ? STAGE_BY_ID[nextStage] : null;
  const prevMeta  = prevStage ? STAGE_BY_ID[prevStage] : null;

  return (
    <motion.div variants={fadeUp}
      className="rounded-sm p-2.5 flex flex-col gap-2 relative group"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderLeftWidth: 2,
        borderLeftColor: laneColor,
      }}>

      {/* Name + score */}
      <div className="flex items-start justify-between gap-1">
        <div className="flex-1 min-w-0">
          <p className="font-ui text-[12px] font-semibold truncate leading-none" style={{ color: 'var(--text-primary)' }}>
            {lead.fullName}
          </p>
          {lead.company && (
            <p className="font-mono text-[9px] mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
              {lead.company}
            </p>
          )}
        </div>
        <span className="font-mono text-[8px] flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
          {safeTs(lead.updatedAt)}
        </span>
      </div>

      {/* Score bar */}
      <ScoreBar score={lead.leadScore || 50} />

      {/* Pills */}
      <div className="flex items-center gap-1 flex-wrap">
        {lead.offerTitle && <Pill label={lead.offerTitle.slice(0, 20)} color={GOLD} />}
        <Pill label={LANE_LABELS[lead.laneId] || lead.laneId} color={laneColor} />
      </div>

      {/* Next action */}
      {lead.nextAction && (
        <p className="font-mono text-[8px] leading-snug line-clamp-1" style={{ color: 'var(--text-muted)' }}>
          → {lead.nextAction}
        </p>
      )}

      {/* Offer price estimate */}
      {lead.offerPriceMin > 0 && (
        <p className="font-mono text-[8px]" style={{ color: GOLD, opacity: 0.7 }}>
          ≈ {fmtMoney(lead.offerPriceMin)} est.
        </p>
      )}

      {/* Actions — visible on hover */}
      <div className="flex items-center gap-1 pt-1 border-t opacity-0 group-hover:opacity-100 transition-opacity relative"
        style={{ borderColor: 'rgba(255,255,255,0.06)' }}>

        {/* Move back */}
        {prevMeta && (
          <button onClick={() => onMoveStage(lead.leadId, prevMeta.id)}
            disabled={busy}
            title={`Move to ${prevMeta.label}`}
            className="font-mono text-[8px] px-1.5 py-1 rounded-sm transition-all"
            style={{ color: prevMeta.color, background: `${prevMeta.color}10`, border: `1px solid ${prevMeta.color}25` }}>
            ←
          </button>
        )}

        {/* Move forward */}
        {nextMeta && (
          <button onClick={() => onMoveStage(lead.leadId, nextMeta.id)}
            disabled={busy}
            title={`Move to ${nextMeta.label}`}
            className="font-mono text-[8px] px-1.5 py-1 rounded-sm transition-all font-bold"
            style={{ color: nextMeta.color, background: `${nextMeta.color}10`, border: `1px solid ${nextMeta.color}25` }}>
            → {nextMeta.label.split(' ')[0]}
          </button>
        )}

        {/* Mark won/lost if in negotiating */}
        {lead.status === 'negotiating' && (
          <>
            <button onClick={() => onMoveStage(lead.leadId, 'won')}
              disabled={busy}
              className="font-mono text-[8px] px-1.5 py-1 rounded-sm"
              style={{ color: EMERALD, background: `${EMERALD}10`, border: `1px solid ${EMERALD}25` }}>
              WON
            </button>
            <button onClick={() => onMoveStage(lead.leadId, 'lost')}
              disabled={busy}
              className="font-mono text-[8px] px-1.5 py-1 rounded-sm"
              style={{ color: CRIMSON, background: `${CRIMSON}10`, border: `1px solid ${CRIMSON}25` }}>
              LOST
            </button>
          </>
        )}

        {/* Create Proposal — qualified, proposal-sent, negotiating */}
        {['qualified','proposal-sent','negotiating'].includes(lead.status) && (
          <button onClick={() => onCreateProposal(lead)}
            disabled={busy}
            className="font-mono text-[8px] px-1.5 py-1 rounded-sm font-bold"
            style={{ color: GOLD, background: `${GOLD}10`, border: `1px solid ${GOLD}25` }}>
            + PROPOSAL
          </button>
        )}

        {/* Edit */}
        <button onClick={() => onEdit(lead)}
          className="font-mono text-[8px] px-1.5 py-1 rounded-sm ml-auto"
          style={{ color: 'var(--text-muted)', background: 'rgba(255,255,255,0.04)' }}>
          ✎
        </button>

        {/* Queue actions */}
        <div className="relative">
          <button onClick={() => setShowQueue(s => !s)}
            disabled={busy}
            className="font-mono text-[8px] px-1.5 py-1 rounded-sm transition-all"
            style={{ color: SAPPHIRE, background: `${SAPPHIRE}10`, border: `1px solid ${SAPPHIRE}20` }}>
            {busy ? '…' : '⚡'}
          </button>
          <AnimatePresence>
            {showQueue && (
              <QueueDropdown lead={lead} onAction={onQueueAction}
                busy={busy} onClose={() => setShowQueue(false)} />
            )}
          </AnimatePresence>
        </div>

        {/* Archive */}
        {(lead.status === 'won' || lead.status === 'lost') && (
          <button onClick={() => onArchive(lead.leadId)}
            className="font-mono text-[7px] px-1 py-1 rounded-sm"
            style={{ color: 'var(--text-muted)', opacity: 0.4 }}>
            ×
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ── Pipeline Column ───────────────────────────────────────────────────────────
function PipelineColumn({ stage, leads, onQueueAction, onEdit, onMoveStage, onArchive, onCreateProposal, actioning }) {
  const stageValue = leads.reduce((s, l) => s + (l.offerPriceMin || 0), 0);
  const count      = leads.length;

  return (
    <div className="flex-shrink-0 flex flex-col" style={{ width: 190 }}>
      {/* Column header */}
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
            {count}
          </span>
        </div>
      </div>

      {/* Stage border accent */}
      <div className="h-0.5 mb-2 rounded-full" style={{ background: `${stage.color}30` }} />

      {/* Cards */}
      <motion.div variants={stagger} initial="initial" animate="animate"
        className="flex flex-col gap-2 min-h-[80px]">
        {leads.length === 0 ? (
          <div className="rounded-sm py-4 flex items-center justify-center"
            style={{ border: `1px dashed ${stage.color}20` }}>
            <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)', opacity: 0.4 }}>
              empty
            </span>
          </div>
        ) : (
          leads.map(lead => (
            <LeadCard key={lead.leadId} lead={lead}
              onQueueAction={onQueueAction} onEdit={onEdit}
              onMoveStage={onMoveStage} onArchive={onArchive}
              onCreateProposal={onCreateProposal}
              actioning={actioning} />
          ))
        )}
      </motion.div>
    </div>
  );
}

// ── Summary Bar ───────────────────────────────────────────────────────────────
function SummaryBar({ summary }) {
  const items = [
    { label: 'TOTAL',     value: summary.total       || 0, color: 'var(--text-primary)' },
    { label: 'QUALIFIED', value: summary.qualified    || 0, color: VIOLET               },
    { label: 'PROPOSALS', value: summary.proposalSent || 0, color: GOLD                 },
    { label: 'NEGOTIATING',value: summary.negotiating || 0, color: AMBER                },
    { label: 'WON',       value: summary.won          || 0, color: EMERALD              },
    { label: '🔥 HOT',    value: summary.hotLeads     || 0, color: CRIMSON              },
  ];
  return (
    <div className="flex items-center gap-5 flex-wrap">
      {items.map(item => (
        <div key={item.label} className="flex items-center gap-1.5">
          <span className="font-mono text-xl font-bold leading-none" style={{ color: item.color }}>{item.value}</span>
          <span className="font-mono text-[7px] tracking-widest" style={{ color: 'var(--text-muted)' }}>{item.label}</span>
        </div>
      ))}
      {(summary.pipelineValue > 0 || summary.wonValue > 0) && (
        <div className="ml-auto flex items-center gap-4">
          {summary.pipelineValue > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-xl font-bold leading-none" style={{ color: TEAL }}>
                {fmtMoney(summary.pipelineValue)}
              </span>
              <span className="font-mono text-[7px] tracking-widest" style={{ color: 'var(--text-muted)' }}>PIPELINE</span>
            </div>
          )}
          {summary.wonValue > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-xl font-bold leading-none" style={{ color: EMERALD }}>
                {fmtMoney(summary.wonValue)}
              </span>
              <span className="font-mono text-[7px] tracking-widest" style={{ color: 'var(--text-muted)' }}>WON</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function LeadPipeline() {
  const [data,        setData]        = useState(null);
  const [offers,      setOffers]      = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [actioning,   setActioning]   = useState(null);
  const [toast,       setToast]       = useState(null);
  const [createOpen,  setCreateOpen]  = useState(false);
  const [editLead,    setEditLead]    = useState(null);
  const [laneFilter,  setLaneFilter]  = useState('all');
  const [lastRefresh, setLastRefresh] = useState(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const [leadsRes, offersRes] = await Promise.all([
        fetch('/api/leads/list'),
        fetch('/api/offers/list'),
      ]);
      if (leadsRes.ok)  setData(await leadsRes.json());
      if (offersRes.ok) {
        const od = await offersRes.json();
        setOffers(od.offers || []);
      }
      setLastRefresh(new Date());
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

  const handleQueueAction = async (leadId, action) => {
    setActioning(leadId);
    try {
      const res  = await fetch('/api/leads/queue-action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, action }),
      });
      const body = await res.json();
      if (body.ok) {
        const labels = {
          'research-lead': 'Research task', 'write-outreach': 'Outreach copy',
          'prepare-proposal': 'Proposal', 'follow-up': 'Follow-up',
          'create-onboarding-plan': 'Onboarding plan',
        };
        showToast(`${labels[action] || 'Task'} queued → ID: ${body.taskId?.slice(-8)}`);
        await load(true);
      } else { showToast(body.error || 'Action failed', false); }
    } catch (e) { showToast(e.message, false); } finally { setActioning(null); }
  };

  const handleMoveStage = async (leadId, newStatus) => {
    setActioning(leadId);
    try {
      const res  = await fetch('/api/leads/update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, status: newStatus }),
      });
      const body = await res.json();
      if (body.ok) {
        showToast(`Moved to ${STAGE_BY_ID[newStatus]?.label || newStatus}`);
        await load(true);
      } else { showToast(body.error || 'Move failed', false); }
    } catch (e) { showToast(e.message, false); } finally { setActioning(null); }
  };

  const handleArchive = async (leadId) => {
    try {
      await fetch('/api/leads/update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, status: 'archived' }),
      });
      showToast('Lead archived.');
      await load(true);
    } catch (e) { showToast(e.message, false); }
  };

  const handleSaved = async (lead) => {
    showToast(editLead ? 'Lead updated.' : `Lead added: ${lead.fullName}`);
    setEditLead(null);
    await load(true);
  };

  const handleCreateProposal = async (lead) => {
    try {
      const res = await fetch('/api/proposals/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId:     lead.leadId,
          offerId:    lead.interestedOfferId || null,
          laneId:     lead.laneId,
          title:      `Proposal — ${lead.fullName}${lead.company ? ` · ${lead.company}` : ''}`,
          value:      lead.offerPriceMin || 0,
          summary:    lead.notes || '',
          nextAction: 'Draft proposal',
          status:     'draft',
        }),
      });
      const body = await res.json();
      if (body.ok) {
        showToast(`Proposal created → open Proposal Center (ID: ${body.proposalId?.slice(-8)})`);
      } else {
        showToast(body.error || 'Could not create proposal', false);
      }
    } catch (e) {
      showToast(e.message, false);
    }
  };

  // Apply lane filter to byStatus
  const filteredByStatus = (() => {
    if (!data?.byStatus) return {};
    if (laneFilter === 'all') return data.byStatus;
    const result = {};
    for (const [stage, leads] of Object.entries(data.byStatus)) {
      result[stage] = leads.filter(l => l.laneId === laneFilter);
    }
    return result;
  })();

  if (loading) return (
    <div className="flex items-center justify-center py-32">
      <div className="flex flex-col items-center gap-3">
        <motion.div animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
          className="w-6 h-6 rounded-full"
          style={{ border: '2px solid var(--border-default)', borderTopColor: GOLD }} />
        <span className="font-mono text-[9px] tracking-widest" style={{ color: 'var(--text-muted)' }}>
          LOADING LEAD PIPELINE
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
            Lead Pipeline
          </h1>
          <p className="font-mono text-[9px] tracking-widest mt-1.5" style={{ color: 'var(--text-muted)' }}>
            DISCOVERY → CONVERSION · MIKA AGENTIC OS
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastRefresh && (
            <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>
              {safeTs(lastRefresh.toISOString())}
            </span>
          )}
          <button onClick={() => load(true)} disabled={refreshing}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-sm font-mono text-[9px] transition-all"
            style={{ background: `${GOLD}0f`, border: `1px solid ${GOLD}20`, color: GOLD, opacity: refreshing ? 0.5 : 1 }}>
            {refreshing
              ? <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}>↻</motion.span>
              : '↻'} REFRESH
          </button>
          <button onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm font-mono text-[9px] tracking-wider font-bold"
            style={{ background: `${GOLD}18`, border: `1px solid ${GOLD}35`, color: GOLD }}>
            + ADD LEAD
          </button>
        </div>
      </div>

      {/* ── Summary bar ── */}
      <div className="panel-gold rounded-sm p-3" style={{ borderColor: `${GOLD}18` }}>
        <SummaryBar summary={data?.summary || {}} />
      </div>

      {/* ── Brand filter ── */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {[{ id: 'all', label: 'All Brands' }, ...LANES.map(id => ({ id, label: LANE_LABELS[id] }))].map(opt => {
          const active = laneFilter === opt.id;
          const color  = opt.id === 'all' ? GOLD : (LANE_COLORS[opt.id] || GOLD);
          return (
            <button key={opt.id} onClick={() => setLaneFilter(opt.id)}
              className="px-2.5 py-1 rounded-sm font-mono text-[8px] tracking-wider transition-all"
              style={{
                background: active ? `${color}15` : 'rgba(255,255,255,0.03)',
                border: `1px solid ${active ? `${color}40` : 'rgba(255,255,255,0.07)'}`,
                color: active ? color : 'var(--text-muted)',
              }}>
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* ── Kanban board ── */}
      <div className="overflow-x-auto pb-4 -mx-1 px-1">
        <div className="flex gap-3" style={{ minWidth: STAGES.length * 202 }}>
          {STAGES.map(stage => (
            <PipelineColumn
              key={stage.id}
              stage={stage}
              leads={filteredByStatus[stage.id] || []}
              onQueueAction={handleQueueAction}
              onEdit={setEditLead}
              onMoveStage={handleMoveStage}
              onArchive={handleArchive}
              onCreateProposal={handleCreateProposal}
              actioning={actioning}
            />
          ))}
        </div>
      </div>

      {/* ── Architecture reminder ── */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-sm"
        style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
        <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>LAYER:</span>
        {['Content', 'Opportunities', 'Offers', 'Leads', 'Revenue'].map((step, i) => (
          <span key={step} className="flex items-center gap-1.5">
            <span className="font-mono text-[8px] tracking-wider"
              style={{ color: i === 3 ? GOLD : 'var(--text-muted)' }}>
              {step}
            </span>
            {i < 4 && <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)', opacity: 0.4 }}>→</span>}
          </span>
        ))}
        <span className="ml-auto font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>
          Score: 0–30 cold · 31–60 warm · 61–80 hot · 81–100 fire
        </span>
      </div>

      {/* ── Modals ── */}
      <AnimatePresence>
        {(createOpen || editLead) && (
          <LeadModal
            open={!!(createOpen || editLead)}
            onClose={() => { setCreateOpen(false); setEditLead(null); }}
            onSaved={handleSaved}
            prefill={editLead || {}}
            editMode={!!editLead}
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
