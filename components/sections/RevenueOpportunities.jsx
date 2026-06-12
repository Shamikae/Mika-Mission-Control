import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ── Design tokens ────────────────────────────────────────────────────
const GOLD    = '#c9a84c';
const TEAL    = '#0dd3c5';
const EMERALD = '#10b981';
const SAPPHIRE= '#3b82f6';
const CRIMSON = '#ef4444';
const AMBER   = '#f59e0b';
const VIOLET  = '#8b5cf6';

const OPP_META = {
  'content-ready':    { label: 'Content Ready',    color: TEAL,    icon: '▷' },
  'repurposing':      { label: 'Repurposing',       color: SAPPHIRE,icon: '♻' },
  'lead-magnet':      { label: 'Lead Magnet',       color: VIOLET,  icon: '◈' },
  'digital-product':  { label: 'Digital Product',   color: GOLD,    icon: '◆' },
  'service-offer':    { label: 'Service Offer',     color: CRIMSON, icon: '◉' },
  'affiliate-content':{ label: 'Affiliate Content', color: AMBER,   icon: '⬟' },
  'ai-automation':    { label: 'AI Automation',     color: SAPPHIRE,icon: '◎' },
};

const POTENTIAL_COLOR = { high: EMERALD, medium: GOLD, low: AMBER };
const EFFORT_COLOR    = { low: EMERALD,  medium: AMBER, high: CRIMSON };

const LANE_COLORS = {
  'digital-diamond': '#c9a84c', 'managed-by-mika': '#0dd3c5',
  'medai': '#818cf8',           'cannaops': '#4ade80',
  'hotel-hooker': '#f472b6',    'ai-twin': '#60a5fa',
  'lead-recovery': '#fb923c',
};

const LANE_LABELS = {
  'digital-diamond': 'Digital Diamond', 'managed-by-mika': 'Managed by Mika',
  'medai': 'MedAI', 'cannaops': 'CannaOps', 'hotel-hooker': 'Hotel Hooker',
  'ai-twin': 'AI Twin', 'lead-recovery': 'Lead Recovery',
};

const FILTERS = [
  { id: 'all',         label: 'All',            count: d => d.length },
  { id: 'quick-wins',  label: 'Quick Wins',     count: d => d.filter(o => o.effort === 'low').length },
  { id: 'sweet-spot',  label: '★ Sweet Spot',   count: d => d.filter(o => o.revenuePotential === 'high' && o.effort === 'low').length },
  { id: 'content',     label: 'Content',        count: d => d.filter(o => ['content-ready','repurposing','lead-magnet'].includes(o.opportunityType)).length },
  { id: 'service',     label: 'Services',       count: d => d.filter(o => ['service-offer','ai-automation','digital-product'].includes(o.opportunityType)).length },
  { id: 'new',         label: 'New',            count: d => d.filter(o => o.status === 'new').length },
];

const stagger = { initial: {}, animate: { transition: { staggerChildren: 0.04 } } };
const fadeUp  = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0, transition: { duration: 0.25 } } };

function safeTs(ts) {
  if (!ts) return '';
  try {
    const diffMin = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return ''; }
}

// ── Pill ─────────────────────────────────────────────────────────────
function Pill({ label, color, small }) {
  const size = small ? 'text-[7px] px-1.5 py-0.5' : 'text-[8px] px-2 py-0.5';
  return (
    <span className={`font-mono ${size} rounded tracking-wide`}
      style={{ background: `${color}15`, color, border: `1px solid ${color}28` }}>
      {label}
    </span>
  );
}

// ── Status badge ─────────────────────────────────────────────────────
function StatusPill({ status }) {
  const map = {
    new:      { label: 'NEW',      color: SAPPHIRE },
    reviewed: { label: 'REVIEWED', color: TEAL     },
    queued:   { label: 'QUEUED',   color: GOLD     },
    archived: { label: 'ARCHIVED', color: '#4b5563'},
  };
  const m = map[status] || map.new;
  return <Pill label={m.label} color={m.color} small />;
}

// ── Opportunity card ─────────────────────────────────────────────────
function OpportunityCard({ opp, onAction, onCreateLead, actioning }) {
  const meta  = OPP_META[opp.opportunityType] || { label: opp.opportunityType, color: GOLD, icon: '◎' };
  const isNew = opp.status === 'new';
  const busy  = actioning === opp.opportunityId;

  return (
    <motion.div
      variants={fadeUp}
      className="panel-gold rounded-sm p-4 flex flex-col gap-3 relative"
      style={{
        borderColor: `${meta.color}22`,
        borderLeftWidth: 3,
        borderLeftColor: meta.color,
        opacity: opp.status === 'archived' ? 0.45 : 1,
      }}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-mono text-[11px]" style={{ color: meta.color }}>{meta.icon}</span>
            <Pill label={meta.label} color={meta.color} small />
            {opp.laneId && (
              <Pill label={LANE_LABELS[opp.laneId] || opp.laneId} color={LANE_COLORS[opp.laneId] || GOLD} small />
            )}
            <StatusPill status={opp.status} />
          </div>
          <h3 className="font-ui text-[13px] font-semibold leading-snug" style={{ color: 'var(--text-primary)' }}>
            {opp.title}
          </h3>
        </div>
        <span className="font-mono text-[8px] flex-shrink-0 mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {safeTs(opp.createdAt)}
        </span>
      </div>

      {/* Revenue + Effort row */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>POTENTIAL</span>
          <Pill label={opp.revenuePotential?.toUpperCase()} color={POTENTIAL_COLOR[opp.revenuePotential] || GOLD} small />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>EFFORT</span>
          <Pill label={opp.effort?.toUpperCase()} color={EFFORT_COLOR[opp.effort] || AMBER} small />
        </div>
        {opp.revenuePotential === 'high' && opp.effort === 'low' && (
          <span className="font-mono text-[7px] px-1.5 py-0.5 rounded"
            style={{ background: `${GOLD}18`, color: GOLD, border: `1px solid ${GOLD}30` }}>
            ★ SWEET SPOT
          </span>
        )}
      </div>

      {/* Suggested next action */}
      <div className="rounded-sm px-3 py-2" style={{ background: `${meta.color}06`, border: `1px solid ${meta.color}14` }}>
        <div className="font-mono text-[7px] tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>NEXT ACTION</div>
        <p className="font-body text-[11px] leading-snug" style={{ color: 'var(--text-primary)' }}>
          {opp.suggestedNextAction}
        </p>
      </div>

      {/* Preview */}
      {opp.preview && (
        <p className="font-mono text-[9px] leading-relaxed line-clamp-2" style={{ color: 'var(--text-muted)' }}>
          {opp.preview}
        </p>
      )}

      {/* Agent + platform */}
      {(opp.assignedAgent || opp.platform) && (
        <div className="flex items-center gap-2 flex-wrap">
          {opp.platform && <Pill label={opp.platform} color={SAPPHIRE} small />}
          {opp.assignedAgent && (
            <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>
              → {opp.assignedAgent}
            </span>
          )}
        </div>
      )}

      {/* Actions */}
      {opp.status !== 'archived' && (
        <div className="flex items-center gap-2 pt-1 border-t flex-wrap" style={{ borderColor: 'var(--border-default)' }}>
          {opp.status === 'new' && (
            <button
              onClick={() => onAction('update-status', opp.opportunityId, { status: 'reviewed' })}
              disabled={busy}
              className="font-mono text-[8px] tracking-wider px-2.5 py-1.5 rounded-sm transition-all"
              style={{ background: `${TEAL}10`, color: TEAL, border: `1px solid ${TEAL}25` }}
            >
              REVIEW
            </button>
          )}
          <button
            onClick={() => onAction('create-brief', opp.opportunityId)}
            disabled={busy}
            className="font-mono text-[8px] tracking-wider px-2.5 py-1.5 rounded-sm transition-all font-semibold"
            style={{ background: `${GOLD}12`, color: GOLD, border: `1px solid ${GOLD}30` }}
          >
            {busy ? '…' : 'CREATE BRIEF'}
          </button>
          <button
            onClick={() => onAction('queue-next-step', opp.opportunityId)}
            disabled={busy || opp.status === 'queued'}
            className="font-mono text-[8px] tracking-wider px-2.5 py-1.5 rounded-sm transition-all font-semibold"
            style={{
              background: opp.status === 'queued' ? 'transparent' : `${SAPPHIRE}12`,
              color: opp.status === 'queued' ? 'var(--text-muted)' : SAPPHIRE,
              border: `1px solid ${opp.status === 'queued' ? 'var(--border-default)' : `${SAPPHIRE}30`}`,
              opacity: opp.status === 'queued' ? 0.5 : 1,
            }}
          >
            {opp.status === 'queued' ? 'QUEUED ✓' : 'QUEUE NEXT STEP'}
          </button>
          <button
            onClick={() => onCreateLead(opp)}
            disabled={busy}
            className="font-mono text-[8px] tracking-wider px-2.5 py-1.5 rounded-sm transition-all"
            style={{ background: `${EMERALD}10`, color: EMERALD, border: `1px solid ${EMERALD}25` }}
          >
            + LEAD
          </button>
          <button
            onClick={() => onAction('update-status', opp.opportunityId, { status: 'archived' })}
            disabled={busy}
            className="ml-auto font-mono text-[8px] px-2 py-1.5 rounded-sm transition-all"
            style={{ color: 'var(--text-muted)', opacity: 0.5 }}
          >
            archive
          </button>
        </div>
      )}
    </motion.div>
  );
}

// ── Summary bar ──────────────────────────────────────────────────────
function SummaryBar({ summary }) {
  const items = [
    { label: 'TOTAL',      value: summary.total,        color: GOLD     },
    { label: 'NEW',        value: summary.new,          color: SAPPHIRE },
    { label: 'QUICK WINS', value: summary.quickWins,    color: EMERALD  },
    { label: 'HIGH VALUE', value: summary.highPotential,color: EMERALD  },
    { label: '★ SWEET SPOT',value: summary.sweetSpot,  color: GOLD     },
    { label: 'QUEUED',     value: summary.queued,       color: TEAL     },
  ];
  return (
    <div className="flex items-center gap-4 flex-wrap">
      {items.map(item => (
        <div key={item.label} className="flex items-center gap-1.5">
          <span className="font-mono text-lg font-bold leading-none" style={{ color: item.color }}>
            {item.value}
          </span>
          <span className="font-mono text-[7px] tracking-widest" style={{ color: 'var(--text-muted)' }}>
            {item.label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────
export default function RevenueOpportunities() {
  const [data,       setData]       = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter,     setFilter]     = useState('all');
  const [actioning,  setActioning]  = useState(null);
  const [toast,      setToast]      = useState(null);
  const [lastRefresh,setLastRefresh]= useState(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await fetch('/api/revenue/opportunities');
      if (res.ok) {
        const d = await res.json();
        setData(d);
        setLastRefresh(new Date());
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
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

  const handleAction = async (action, id, extra = {}) => {
    setActioning(id);
    try {
      const res = await fetch('/api/revenue/opportunities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, id, ...extra }),
      });
      const body = await res.json();
      if (body.ok !== false) {
        const msgs = {
          'update-status':   extra.status === 'archived' ? 'Opportunity archived.' : 'Status updated.',
          'queue-next-step': `Queued → Approval required. Task ID: ${body.taskId?.slice(-8)}`,
          'create-brief':    `Brief created → Approval required. Task ID: ${body.taskId?.slice(-8)}`,
        };
        showToast(msgs[action] || 'Done.');
        await load(true);
      } else {
        showToast(body.error || 'Action failed.', false);
      }
    } catch (e) {
      showToast(e.message, false);
    } finally {
      setActioning(null);
    }
  };

  const handleCreateLead = async (opp) => {
    try {
      const res = await fetch('/api/leads/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: '',
          laneId: opp.laneId || 'digital-diamond',
          source: 'revenue-opportunity',
          notes: `From opportunity: ${opp.title} (${opp.opportunityType})`,
          nextAction: opp.suggestedNextAction || '',
          status: 'new',
          leadScore: opp.revenuePotential === 'high' ? 60 : 40,
        }),
      });
      const body = await res.json();
      if (body.ok) {
        showToast(`Lead stub created — open Lead Pipeline to complete (ID: ${body.leadId?.slice(-8)})`);
      } else {
        showToast(body.error || 'Could not create lead', false);
      }
    } catch (e) {
      showToast(e.message, false);
    }
  };

  // Filter opportunities
  const applyFilter = (opps) => {
    const visible = opps.filter(o => o.status !== 'archived');
    switch (filter) {
      case 'quick-wins':  return visible.filter(o => o.effort === 'low');
      case 'sweet-spot':  return visible.filter(o => o.revenuePotential === 'high' && o.effort === 'low');
      case 'content':     return visible.filter(o => ['content-ready','repurposing','lead-magnet'].includes(o.opportunityType));
      case 'service':     return visible.filter(o => ['service-offer','ai-automation','digital-product','affiliate-content'].includes(o.opportunityType));
      case 'new':         return visible.filter(o => o.status === 'new');
      default:            return visible;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="flex flex-col items-center gap-3">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
            className="w-6 h-6 rounded-full"
            style={{ border: `2px solid var(--border-default)`, borderTopColor: GOLD }}
          />
          <span className="font-mono text-[9px] tracking-widest" style={{ color: 'var(--text-muted)' }}>
            SCANNING FOR REVENUE OPPORTUNITIES
          </span>
        </div>
      </div>
    );
  }

  const opps    = data?.opportunities || [];
  const summary = data?.summary       || {};
  const filtered = applyFilter(opps);

  return (
    <div className="space-y-4">

      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold leading-none" style={{ color: 'var(--text-primary)' }}>
            Revenue Opportunities
          </h1>
          <p className="font-mono text-[9px] tracking-widest mt-1.5" style={{ color: 'var(--text-muted)' }}>
            WHAT CAN MAKE MONEY NEXT · MIKA AGENTIC OS
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>
              {safeTs(lastRefresh.toISOString())}
            </span>
          )}
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm transition-all font-mono text-[9px] tracking-widest"
            style={{ background: `${GOLD}0f`, border: `1px solid ${GOLD}25`, color: GOLD, opacity: refreshing ? 0.5 : 1 }}
          >
            {refreshing
              ? <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}>↻</motion.span>
              : '↻'
            }
            REFRESH
          </button>
        </div>
      </div>

      {/* ── Summary bar ── */}
      <div className="panel-gold rounded-sm p-3" style={{ borderColor: `${GOLD}20` }}>
        <SummaryBar summary={summary} />
      </div>

      {/* ── Filter tabs ── */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {FILTERS.map(f => {
          const count  = f.count(opps.filter(o => o.status !== 'archived'));
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm font-mono text-[9px] tracking-wider transition-all"
              style={{
                background: active ? `${GOLD}15` : 'rgba(255,255,255,0.03)',
                border: `1px solid ${active ? `${GOLD}40` : 'rgba(255,255,255,0.07)'}`,
                color: active ? GOLD : 'var(--text-muted)',
              }}
            >
              {f.label}
              <span className="rounded px-1" style={{
                background: active ? `${GOLD}20` : 'rgba(255,255,255,0.06)',
                color: active ? GOLD : 'var(--text-muted)',
              }}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Opportunity grid ── */}
      {filtered.length === 0 ? (
        <div className="panel-gold rounded-sm flex items-center justify-center py-16" style={{ borderColor: `${GOLD}18` }}>
          <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
            No opportunities in this view
          </span>
        </div>
      ) : (
        <motion.div variants={stagger} initial="initial" animate="animate"
          className="grid grid-cols-2 gap-3">
          {filtered.map(opp => (
            <OpportunityCard
              key={opp.opportunityId}
              opp={opp}
              onAction={handleAction}
              onCreateLead={handleCreateLead}
              actioning={actioning}
            />
          ))}
        </motion.div>
      )}

      {/* ── Flow reminder ── */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-sm"
        style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
        <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>
          FLOW:
        </span>
        {['Opportunity', 'Queue', 'Approval', 'Dispatch', 'Output'].map((step, i) => (
          <span key={step} className="flex items-center gap-1.5">
            <span className="font-mono text-[8px] tracking-wider" style={{ color: i === 0 ? GOLD : 'var(--text-muted)' }}>
              {step}
            </span>
            {i < 4 && <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)', opacity: 0.4 }}>→</span>}
          </span>
        ))}
      </div>

      {/* ── Toast notification ── */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className="fixed bottom-6 right-6 px-4 py-2.5 rounded-sm z-50 font-mono text-[10px] tracking-wide"
            style={{
              background: toast.ok ? `${EMERALD}18` : `${CRIMSON}18`,
              border: `1px solid ${toast.ok ? EMERALD : CRIMSON}40`,
              color: toast.ok ? EMERALD : CRIMSON,
              backdropFilter: 'blur(12px)',
            }}
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
