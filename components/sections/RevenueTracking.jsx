import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ── Design tokens ────────────────────────────────────────────────────
const GOLD     = '#c9a84c';
const TEAL     = '#0dd3c5';
const EMERALD  = '#10b981';
const SAPPHIRE = '#3b82f6';
const CRIMSON  = '#ef4444';
const AMBER    = '#f59e0b';
const VIOLET   = '#8b5cf6';

const STATUS_COLOR = {
  projected: SAPPHIRE,
  pending:   AMBER,
  won:       EMERALD,
  received:  GOLD,
  lost:      CRIMSON,
};
const STATUS_LABEL = {
  projected: 'Projected',
  pending:   'Pending',
  won:       'Won',
  received:  'Received',
  lost:      'Lost',
};

const TYPE_COLOR = {
  'service':             TEAL,
  'digital-product':     SAPPHIRE,
  'affiliate':           EMERALD,
  'course':              GOLD,
  'membership':          VIOLET,
  'automation-package':  AMBER,
};
const TYPE_LABEL = {
  'service':             'Service',
  'digital-product':     'Digital Product',
  'affiliate':           'Affiliate',
  'course':              'Course',
  'membership':          'Membership',
  'automation-package':  'Automation Package',
};

const LANE_LABELS = {
  'digital-diamond': 'Digital Diamond',
  'managed-by-mika': 'Managed by Mika',
  'medai':           'MedAI',
  'cannaops':        'CannaOps',
  'hotel-hooker':    'Hotel Hooker',
  'ai-twin':         'AI Twin',
  'lead-recovery':   'Lead Recovery',
};
const LANE_COLORS = {
  'digital-diamond': GOLD,
  'managed-by-mika': TEAL,
  'medai':           '#818cf8',
  'cannaops':        '#4ade80',
  'hotel-hooker':    '#f472b6',
  'ai-twin':         '#60a5fa',
  'lead-recovery':   '#fb923c',
};

const LANES = Object.keys(LANE_LABELS);

const stagger = { initial: {}, animate: { transition: { staggerChildren: 0.04 } } };
const fadeUp  = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0, transition: { duration: 0.24 } } };

// ── Helpers ──────────────────────────────────────────────────────────

function fmt(amount) {
  if (amount == null || isNaN(amount)) return '—';
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000)     return `$${(amount / 1_000).toFixed(1)}k`;
  return `$${amount.toFixed(0)}`;
}

function safeDate(d) {
  if (!d) return '—';
  try {
    const date = new Date(d);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return '—'; }
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = Math.ceil((new Date(dateStr) - new Date()) / (1000 * 60 * 60 * 24));
  return diff;
}

function probColor(p) {
  if (p >= 70) return EMERALD;
  if (p >= 40) return AMBER;
  return CRIMSON;
}

// ── Toast ────────────────────────────────────────────────────────────

function Toast({ message, ok, onDone }) {
  useEffect(() => {
    const id = setTimeout(onDone, 3500);
    return () => clearTimeout(id);
  }, [onDone]);
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}
      className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-sm font-mono text-[10px] tracking-wide shadow-xl"
      style={{ background: ok ? `${EMERALD}18` : `${CRIMSON}18`, border: `1px solid ${ok ? EMERALD : CRIMSON}40`, color: ok ? EMERALD : CRIMSON }}
    >
      {message}
    </motion.div>
  );
}

// ── Snapshot card ────────────────────────────────────────────────────

function SnapCard({ label, value, sub, color }) {
  return (
    <div className="rounded-sm p-3 text-center" style={{ background: `${color}08`, border: `1px solid ${color}20` }}>
      <div className="font-mono text-2xl font-bold leading-none" style={{ color }}>{value}</div>
      <div className="font-mono text-[7px] tracking-widest mt-1.5 uppercase" style={{ color: 'var(--text-muted)' }}>{label}</div>
      {sub && <div className="font-mono text-[8px] mt-0.5" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>{sub}</div>}
    </div>
  );
}

// ── MiniBar ──────────────────────────────────────────────────────────

function MiniBar({ value, max, color }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="rounded-full overflow-hidden flex-1" style={{ height: 4, background: 'var(--bg-card)' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 9999, transition: 'width 0.4s ease' }} />
    </div>
  );
}

// ── By-Lane panel ────────────────────────────────────────────────────

function ByLanePanel({ byLane }) {
  if (!byLane?.length) return (
    <div className="panel-gold rounded-sm p-4" style={{ borderColor: `${TEAL}20` }}>
      <div className="font-mono text-[8px] tracking-[0.22em] uppercase mb-2" style={{ color: TEAL }}>REVENUE BY BRAND</div>
      <p className="font-mono text-[9px] text-center py-4" style={{ color: 'var(--text-muted)' }}>No data yet</p>
    </div>
  );
  const max = Math.max(...byLane.map(l => l.total), 1);
  return (
    <div className="panel-gold rounded-sm p-4" style={{ borderColor: `${TEAL}20` }}>
      <div className="font-mono text-[8px] tracking-[0.22em] uppercase mb-3" style={{ color: TEAL }}>REVENUE BY BRAND</div>
      <div className="space-y-2.5">
        {byLane.map(l => {
          const color = LANE_COLORS[l.laneId] || GOLD;
          return (
            <div key={l.laneId}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-[9px]" style={{ color }}>{LANE_LABELS[l.laneId] || l.laneId}</span>
                <span className="font-mono text-[9px] font-bold" style={{ color: 'var(--text-primary)' }}>{fmt(l.total)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <MiniBar value={l.total} max={max} color={color} />
                {l.received > 0 && (
                  <span className="font-mono text-[7px] flex-shrink-0" style={{ color: EMERALD }}>{fmt(l.received)} rcvd</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── By-Type panel ────────────────────────────────────────────────────

function ByTypePanel({ byType }) {
  if (!byType?.length) return (
    <div className="panel-gold rounded-sm p-4" style={{ borderColor: `${VIOLET}20` }}>
      <div className="font-mono text-[8px] tracking-[0.22em] uppercase mb-2" style={{ color: VIOLET }}>REVENUE BY TYPE</div>
      <p className="font-mono text-[9px] text-center py-4" style={{ color: 'var(--text-muted)' }}>No data yet</p>
    </div>
  );
  const max = Math.max(...byType.map(t => t.total), 1);
  return (
    <div className="panel-gold rounded-sm p-4" style={{ borderColor: `${VIOLET}20` }}>
      <div className="font-mono text-[8px] tracking-[0.22em] uppercase mb-3" style={{ color: VIOLET }}>REVENUE BY TYPE</div>
      <div className="space-y-2.5">
        {byType.map(t => {
          const color = TYPE_COLOR[t.revenueType] || GOLD;
          return (
            <div key={t.revenueType}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-[9px]" style={{ color }}>{TYPE_LABEL[t.revenueType] || t.revenueType}</span>
                <span className="font-mono text-[9px] font-bold" style={{ color: 'var(--text-primary)' }}>{fmt(t.total)}</span>
              </div>
              <MiniBar value={t.total} max={max} color={color} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Monthly forecast panel ───────────────────────────────────────────

function MonthlyForecastPanel({ months }) {
  if (!months?.length) return (
    <div className="panel-gold rounded-sm p-4" style={{ borderColor: `${SAPPHIRE}20` }}>
      <div className="font-mono text-[8px] tracking-[0.22em] uppercase mb-2" style={{ color: SAPPHIRE }}>MONTHLY FORECAST</div>
      <p className="font-mono text-[9px] text-center py-4" style={{ color: 'var(--text-muted)' }}>No forecast data yet</p>
    </div>
  );
  const maxVal = Math.max(...months.map(m => m.projected + m.received), 1);
  return (
    <div className="panel-gold rounded-sm p-4" style={{ borderColor: `${SAPPHIRE}20` }}>
      <div className="font-mono text-[8px] tracking-[0.22em] uppercase mb-3" style={{ color: SAPPHIRE }}>MONTHLY FORECAST</div>
      <div className="space-y-2">
        {months.map(m => {
          const label = (() => {
            try {
              const [y, mo] = m.month.split('-');
              return new Date(parseInt(y), parseInt(mo) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
            } catch { return m.month; }
          })();
          return (
            <div key={m.month} className="flex items-center gap-2">
              <span className="font-mono text-[8px] w-14 flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{label}</span>
              <div className="flex-1 flex gap-0.5 h-4 items-center">
                {m.received > 0 && (
                  <div
                    title={`Received: ${fmt(m.received)}`}
                    style={{ width: `${(m.received / maxVal * 100).toFixed(0)}%`, minWidth: 2, background: EMERALD, height: '100%', borderRadius: 2 }}
                  />
                )}
                {m.projected > 0 && (
                  <div
                    title={`Projected: ${fmt(m.projected)}`}
                    style={{ width: `${(m.projected / maxVal * 100).toFixed(0)}%`, minWidth: 2, background: `${SAPPHIRE}60`, height: '100%', borderRadius: 2 }}
                  />
                )}
              </div>
              <span className="font-mono text-[9px] font-bold w-16 text-right flex-shrink-0" style={{ color: 'var(--text-primary)' }}>
                {fmt(m.received + m.projected)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-4 mt-3 pt-2 border-t" style={{ borderColor: 'var(--border-default)' }}>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-sm" style={{ background: EMERALD }} />
          <span className="font-mono text-[7px]" style={{ color: 'var(--text-muted)' }}>Received</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-sm" style={{ background: `${SAPPHIRE}60` }} />
          <span className="font-mono text-[7px]" style={{ color: 'var(--text-muted)' }}>Projected</span>
        </div>
      </div>
    </div>
  );
}

// ── Upcoming closes panel ────────────────────────────────────────────

function UpcomingClosesPanel({ items }) {
  const today = new Date().toISOString().split('T')[0];
  return (
    <div className="panel-gold rounded-sm p-4" style={{ borderColor: `${AMBER}20` }}>
      <div className="font-mono text-[8px] tracking-[0.22em] uppercase mb-3" style={{ color: AMBER }}>UPCOMING CLOSES</div>
      {!items?.length ? (
        <p className="font-mono text-[9px] text-center py-3" style={{ color: 'var(--text-muted)' }}>No upcoming closes in 60 days</p>
      ) : (
        <div className="space-y-2">
          {items.slice(0, 6).map(r => {
            const days = daysUntil(r.expectedCloseDate);
            const isOverdue = r.expectedCloseDate < today;
            const col = isOverdue ? CRIMSON : days <= 7 ? AMBER : GOLD;
            return (
              <div key={r.revenueId} className="flex items-center gap-2 rounded-sm px-2.5 py-2"
                style={{ background: `${col}08`, border: `1px solid ${col}20` }}>
                <div>
                  <div className="font-ui text-[10px] font-medium leading-tight truncate max-w-[140px]" style={{ color: 'var(--text-primary)' }}>
                    {r.notes || TYPE_LABEL[r.revenueType] || r.revenueId}
                  </div>
                  <div className="font-mono text-[8px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {LANE_LABELS[r.laneId] || r.laneId}
                  </div>
                </div>
                <div className="ml-auto text-right flex-shrink-0">
                  <div className="font-mono text-[10px] font-bold" style={{ color: col }}>
                    {isOverdue ? `${Math.abs(days)}d overdue` : `${days}d`}
                  </div>
                  <div className="font-mono text-[9px]" style={{ color: GOLD }}>{fmt(r.amount)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── At-risk panel ────────────────────────────────────────────────────

function AtRiskPanel({ items }) {
  return (
    <div className="panel-gold rounded-sm p-4" style={{ borderColor: `${CRIMSON}20` }}>
      <div className="flex items-center justify-between mb-3">
        <div className="font-mono text-[8px] tracking-[0.22em] uppercase" style={{ color: CRIMSON }}>AT-RISK REVENUE</div>
        {items?.length > 0 && (
          <span className="font-mono text-[8px] px-1.5 py-0.5 rounded" style={{ background: `${CRIMSON}15`, color: CRIMSON }}>{items.length}</span>
        )}
      </div>
      {!items?.length ? (
        <div className="flex items-center gap-2 py-3">
          <div className="w-2 h-2 rounded-full" style={{ background: EMERALD, boxShadow: `0 0 8px ${EMERALD}` }} />
          <span className="font-mono text-[9px]" style={{ color: EMERALD }}>No at-risk items</span>
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.slice(0, 5).map(r => (
            <div key={r.revenueId} className="rounded-sm px-2.5 py-2"
              style={{ background: `${CRIMSON}08`, border: `1px solid ${CRIMSON}20` }}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-ui text-[10px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                  {r.notes || TYPE_LABEL[r.revenueType] || r.revenueId}
                </span>
                <span className="font-mono text-[9px] font-bold flex-shrink-0" style={{ color: GOLD }}>{fmt(r.amount)}</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="font-mono text-[7px]" style={{ color: 'var(--text-muted)' }}>
                  {r.probability}% · {r.expectedCloseDate ? `due ${safeDate(r.expectedCloseDate)}` : 'no close date'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Queue action dropdown ─────────────────────────────────────────────

function QueueDropdown({ revenueId, laneId, onDone, actioning }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const actions = [
    { key: 'follow-up',  label: 'Follow-Up',   color: SAPPHIRE },
    { key: 'close-plan', label: 'Close Plan',   color: EMERALD  },
    { key: 'upsell',     label: 'Upsell',       color: VIOLET   },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        disabled={actioning === revenueId}
        className="font-mono text-[7px] px-2 py-1 rounded-sm transition-all tracking-wider"
        style={{ background: `${GOLD}12`, border: `1px solid ${GOLD}28`, color: GOLD, opacity: actioning === revenueId ? 0.5 : 1 }}
      >
        {actioning === revenueId ? '…' : 'QUEUE ▾'}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            className="absolute right-0 top-full mt-1 z-30 rounded-sm overflow-hidden"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', minWidth: 130 }}
          >
            {actions.map(a => (
              <button
                key={a.key}
                onClick={() => { setOpen(false); onDone(revenueId, a.key); }}
                className="w-full text-left px-3 py-2 font-mono text-[9px] tracking-wider transition-all"
                style={{ color: a.color }}
                onMouseEnter={e => e.currentTarget.style.background = `${a.color}12`}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                {a.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Revenue card ─────────────────────────────────────────────────────

function RevenueCard({ item, onUpdate, onQueueAction, actioning }) {
  const statusColor = STATUS_COLOR[item.status] || GOLD;
  const typeColor   = TYPE_COLOR[item.revenueType] || TEAL;
  const laneColor   = LANE_COLORS[item.laneId] || GOLD;
  const days        = daysUntil(item.expectedCloseDate);
  const today       = new Date().toISOString().split('T')[0];
  const overdue     = item.expectedCloseDate && item.expectedCloseDate < today && !['received', 'lost'].includes(item.status);

  return (
    <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4" style={{ borderColor: `${statusColor}20` }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {/* Amount + status */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xl font-bold leading-none" style={{ color: statusColor }}>
              {fmt(item.amount)}
            </span>
            <span className="font-mono text-[7px] px-1.5 py-0.5 rounded tracking-wider"
              style={{ background: `${statusColor}15`, color: statusColor, border: `1px solid ${statusColor}28` }}>
              {STATUS_LABEL[item.status] || item.status}
            </span>
            {item.revenueType && (
              <span className="font-mono text-[7px] px-1.5 py-0.5 rounded tracking-wider"
                style={{ background: `${typeColor}12`, color: typeColor, border: `1px solid ${typeColor}22` }}>
                {TYPE_LABEL[item.revenueType] || item.revenueType}
              </span>
            )}
          </div>
          {/* Notes / description */}
          {item.notes && (
            <div className="font-ui text-[11px] mt-1.5 leading-snug" style={{ color: 'var(--text-primary)' }}>
              {item.notes}
            </div>
          )}
          {item.sourceLabel && (
            <div className="font-mono text-[8px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
              ↳ {item.sourceType}: {item.sourceLabel}
            </div>
          )}
        </div>
        <QueueDropdown revenueId={item.revenueId} laneId={item.laneId} onDone={onQueueAction} actioning={actioning} />
      </div>

      {/* Probability bar */}
      {!['received', 'lost'].includes(item.status) && (
        <div className="mt-2.5">
          <div className="flex items-center justify-between mb-1">
            <span className="font-mono text-[7px]" style={{ color: 'var(--text-muted)' }}>PROBABILITY</span>
            <span className="font-mono text-[8px] font-bold" style={{ color: probColor(item.probability) }}>{item.probability}%</span>
          </div>
          <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--bg-card)' }}>
            <div style={{ width: `${item.probability}%`, height: '100%', background: probColor(item.probability), borderRadius: 9999, transition: 'width 0.4s ease' }} />
          </div>
        </div>
      )}

      {/* Meta row */}
      <div className="flex items-center gap-2 mt-2.5 flex-wrap">
        <span className="font-mono text-[7px] px-1.5 py-0.5 rounded"
          style={{ background: `${laneColor}10`, color: laneColor }}>
          {LANE_LABELS[item.laneId] || item.laneId}
        </span>
        {item.expectedCloseDate && (
          <span className="font-mono text-[7px] px-1.5 py-0.5 rounded"
            style={{ background: overdue ? `${CRIMSON}12` : `${GOLD}10`, color: overdue ? CRIMSON : GOLD }}>
            {overdue ? '⚠ overdue' : days != null && days <= 7 ? `${days}d left` : safeDate(item.expectedCloseDate)}
          </span>
        )}
        {item.receivedDate && item.status === 'received' && (
          <span className="font-mono text-[7px] px-1.5 py-0.5 rounded"
            style={{ background: `${EMERALD}10`, color: EMERALD }}>
            rcvd {safeDate(item.receivedDate)}
          </span>
        )}
        {item.nextAction && (
          <span className="font-mono text-[7px] truncate max-w-[120px]" style={{ color: 'var(--text-muted)' }}>
            → {item.nextAction}
          </span>
        )}
      </div>

      {/* Quick status actions */}
      {!['received', 'lost'].includes(item.status) && (
        <div className="flex items-center gap-1.5 mt-2.5">
          <button
            onClick={() => onUpdate(item.revenueId, { status: 'received' })}
            className="font-mono text-[7px] px-2 py-1 rounded-sm tracking-wider transition-all"
            style={{ background: `${EMERALD}12`, border: `1px solid ${EMERALD}28`, color: EMERALD }}
          >
            ✓ RECEIVED
          </button>
          <button
            onClick={() => onUpdate(item.revenueId, { status: 'lost' })}
            className="font-mono text-[7px] px-2 py-1 rounded-sm tracking-wider transition-all"
            style={{ background: `${CRIMSON}08`, border: `1px solid ${CRIMSON}20`, color: CRIMSON }}
          >
            ✕ LOST
          </button>
          {item.status !== 'won' && (
            <button
              onClick={() => onUpdate(item.revenueId, { status: 'won' })}
              className="font-mono text-[7px] px-2 py-1 rounded-sm tracking-wider transition-all"
              style={{ background: `${EMERALD}08`, border: `1px solid ${EMERALD}18`, color: EMERALD }}
            >
              WON ↑
            </button>
          )}
        </div>
      )}
      {item.status === 'lost' && (
        <button
          onClick={() => onUpdate(item.revenueId, { status: 'projected' })}
          className="mt-2 font-mono text-[7px] px-2 py-1 rounded-sm tracking-wider transition-all"
          style={{ background: `${SAPPHIRE}08`, border: `1px solid ${SAPPHIRE}18`, color: SAPPHIRE }}
        >
          REOPEN
        </button>
      )}
    </motion.div>
  );
}

// ── Add Revenue Modal ────────────────────────────────────────────────

function AddRevenueModal({ onClose, onSave }) {
  const [form, setForm] = useState({
    notes: '', amount: '', revenueType: 'service', status: 'projected',
    probability: 50, laneId: 'digital-diamond', expectedCloseDate: '',
    sourceType: 'manual', sourceId: '',
  });
  const [sources, setSources] = useState([]);
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    if (form.sourceType === 'manual') { setSources([]); return; }
    const endpointMap = {
      proposal: '/api/proposals/list',
      client:   '/api/clients/list',
      offer:    '/api/offers/list',
      lead:     '/api/leads/list',
    };
    const ep = endpointMap[form.sourceType];
    if (!ep) return;
    fetch(ep)
      .then(r => r.json())
      .then(d => {
        if (form.sourceType === 'proposal') setSources((d.proposals || []).map(p => ({ id: p.proposalId, label: p.title })));
        else if (form.sourceType === 'client') setSources((d.clients || []).map(c => ({ id: c.clientId, label: c.company })));
        else if (form.sourceType === 'offer')  setSources((d.offers  || []).map(o => ({ id: o.offerId,  label: o.title })));
        else if (form.sourceType === 'lead')   setSources((d.leads   || []).map(l => ({ id: l.leadId,   label: l.fullName })));
      })
      .catch(() => setSources([]));
  }, [form.sourceType]);

  const handleSave = async () => {
    if (!form.amount) return;
    setSaving(true);
    await onSave({
      notes:             form.notes,
      amount:            parseFloat(form.amount),
      revenueType:       form.revenueType,
      status:            form.status,
      probability:       parseInt(form.probability),
      laneId:            form.laneId,
      expectedCloseDate: form.expectedCloseDate || null,
      sourceType:        form.sourceType,
      sourceId:          form.sourceId || null,
    });
    setSaving(false);
    onClose();
  };

  const inputCls = 'w-full rounded-sm px-3 py-2 font-mono text-[11px] outline-none transition-all';
  const inputStyle = { background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' };
  const labelCls = 'font-mono text-[8px] tracking-wider uppercase mb-1 block';

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
        className="panel-gold rounded-sm w-full max-w-md max-h-[90vh] overflow-y-auto"
        style={{ borderColor: `${GOLD}40` }}
      >
        <div className="p-5">
          <div className="flex items-center justify-between mb-5">
            <div className="font-display text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Add Revenue Item</div>
            <button onClick={onClose} className="font-mono text-lg" style={{ color: 'var(--text-muted)' }}>×</button>
          </div>

          <div className="space-y-3">
            <div>
              <label className={labelCls} style={{ color: GOLD }}>Description</label>
              <input className={inputCls} style={inputStyle} placeholder="What is this revenue for?"
                value={form.notes} onChange={e => set('notes', e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls} style={{ color: GOLD }}>Amount ($)</label>
                <input className={inputCls} style={inputStyle} type="number" placeholder="0"
                  value={form.amount} onChange={e => set('amount', e.target.value)} />
              </div>
              <div>
                <label className={labelCls} style={{ color: GOLD }}>Status</label>
                <select className={inputCls} style={inputStyle} value={form.status} onChange={e => set('status', e.target.value)}>
                  {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls} style={{ color: GOLD }}>Type</label>
                <select className={inputCls} style={inputStyle} value={form.revenueType} onChange={e => set('revenueType', e.target.value)}>
                  {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls} style={{ color: GOLD }}>Brand</label>
                <select className={inputCls} style={inputStyle} value={form.laneId} onChange={e => set('laneId', e.target.value)}>
                  {LANES.map(l => <option key={l} value={l}>{LANE_LABELS[l]}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className={labelCls} style={{ color: GOLD }}>Probability: {form.probability}%</label>
              <input type="range" min="0" max="100" step="5" value={form.probability}
                onChange={e => set('probability', e.target.value)}
                className="w-full" style={{ accentColor: probColor(form.probability) }} />
            </div>
            <div>
              <label className={labelCls} style={{ color: GOLD }}>Expected Close Date</label>
              <input className={inputCls} style={inputStyle} type="date"
                value={form.expectedCloseDate} onChange={e => set('expectedCloseDate', e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls} style={{ color: GOLD }}>Source Type</label>
                <select className={inputCls} style={inputStyle} value={form.sourceType}
                  onChange={e => { set('sourceType', e.target.value); set('sourceId', ''); }}>
                  <option value="manual">Manual</option>
                  <option value="proposal">Proposal</option>
                  <option value="client">Client</option>
                  <option value="offer">Offer</option>
                  <option value="lead">Lead</option>
                </select>
              </div>
              {form.sourceType !== 'manual' && (
                <div>
                  <label className={labelCls} style={{ color: GOLD }}>Source</label>
                  {sources.length > 0 ? (
                    <select className={inputCls} style={inputStyle} value={form.sourceId} onChange={e => set('sourceId', e.target.value)}>
                      <option value="">— select —</option>
                      {sources.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  ) : (
                    <input className={inputCls} style={inputStyle} placeholder="Source ID" value={form.sourceId} onChange={e => set('sourceId', e.target.value)} />
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 mt-5">
            <button onClick={onClose} className="flex-1 py-2 font-mono text-[9px] tracking-widest rounded-sm transition-all"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-muted)' }}>
              CANCEL
            </button>
            <button onClick={handleSave} disabled={saving || !form.amount}
              className="flex-1 py-2 font-mono text-[9px] tracking-widest rounded-sm transition-all"
              style={{ background: `${GOLD}20`, border: `1px solid ${GOLD}40`, color: GOLD, opacity: saving || !form.amount ? 0.5 : 1 }}>
              {saving ? 'SAVING…' : 'ADD REVENUE'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Main component ────────────────────────────────────────────────────

const FILTER_TABS = [
  { key: 'all',       label: 'All' },
  { key: 'projected', label: 'Projected' },
  { key: 'pending',   label: 'Pending' },
  { key: 'won',       label: 'Won' },
  { key: 'received',  label: 'Received' },
  { key: 'lost',      label: 'Lost' },
];

export default function RevenueTracking() {
  const [items,     setItems]     = useState([]);
  const [summary,   setSummary]   = useState(null);
  const [forecast,  setForecast]  = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [filter,    setFilter]    = useState('all');
  const [actioning, setActioning] = useState(null);
  const [showAdd,   setShowAdd]   = useState(false);
  const [toast,     setToast]     = useState(null);

  const showToast = (msg, ok = true) => setToast({ msg, ok });

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [listRes, forecastRes] = await Promise.all([
        fetch('/api/revenue/list'),
        fetch('/api/revenue/forecast'),
      ]);
      if (listRes.ok) {
        const d = await listRes.json();
        setItems(d.revenue || []);
        setSummary(d.summary || null);
      }
      if (forecastRes.ok) {
        setForecast(await forecastRes.json());
      }
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(() => load(true), 60_000);
    return () => clearInterval(id);
  }, [load]);

  const handleUpdate = async (revenueId, updates) => {
    try {
      const res = await fetch('/api/revenue/update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revenueId, ...updates }),
      });
      if (res.ok) { load(true); showToast('Updated.'); }
      else showToast('Update failed.', false);
    } catch { showToast('Update failed.', false); }
  };

  const handleQueueAction = async (revenueId, action) => {
    setActioning(revenueId);
    try {
      const res = await fetch('/api/revenue/queue-action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revenueId, action }),
      });
      if (res.ok) { showToast(`Queued. Go to Agent Dispatch → Approve.`); load(true); }
      else showToast('Queue failed.', false);
    } catch { showToast('Queue failed.', false); }
    finally { setActioning(null); }
  };

  const handleAdd = async (data) => {
    const res = await fetch('/api/revenue/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (res.ok) { load(true); showToast('Revenue item added.'); }
    else showToast('Failed to add.', false);
  };

  const filtered = filter === 'all' ? items : items.filter(r => r.status === filter);

  if (loading) return (
    <div className="flex items-center justify-center py-32">
      <div className="flex flex-col items-center gap-3">
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
          className="w-6 h-6 rounded-full"
          style={{ border: '2px solid var(--border-default)', borderTopColor: GOLD }} />
        <span className="font-mono text-[9px] tracking-widest" style={{ color: 'var(--text-muted)' }}>
          LOADING REVENUE TRACKING
        </span>
      </div>
    </div>
  );

  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-4">
      <AnimatePresence>
        {toast && <Toast message={toast.msg} ok={toast.ok} onDone={() => setToast(null)} />}
        {showAdd && <AddRevenueModal onClose={() => setShowAdd(false)} onSave={handleAdd} />}
      </AnimatePresence>

      {/* ── Header ── */}
      <motion.div variants={fadeUp} className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold leading-none" style={{ color: 'var(--text-primary)' }}>
            Revenue Tracking
          </h1>
          <p className="font-mono text-[9px] tracking-widest mt-1.5" style={{ color: 'var(--text-muted)' }}>
            MONEY VIEW · PROJECTED → RECEIVED
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="font-mono text-[9px] tracking-widest px-4 py-2 rounded-sm transition-all"
          style={{ background: `${GOLD}15`, border: `1px solid ${GOLD}30`, color: GOLD }}
        >
          + ADD REVENUE
        </button>
      </motion.div>

      {/* ── Snapshot ── */}
      {summary && (
        <motion.div variants={fadeUp} className="grid grid-cols-3 gap-3">
          <SnapCard label="Pipeline"          value={fmt(summary.pipelineValue)}    color={SAPPHIRE} sub="projected + pending + won" />
          <SnapCard label="Weighted Forecast" value={fmt(summary.weightedForecast)} color={GOLD}     sub="probability-adjusted" />
          <SnapCard label="Received"          value={fmt(summary.receivedAmount)}   color={EMERALD}  />
          <SnapCard label="Pending / Won"     value={fmt(summary.pendingAmount)}    color={AMBER}    sub={`${summary.pending + summary.won} items`} />
          <SnapCard label="Projected"         value={summary.projected}             color={SAPPHIRE} sub={`${summary.projected} items`} />
          <SnapCard label="Lost"              value={fmt(summary.lostAmount)}       color={CRIMSON}  sub={`${summary.lost} items`} />
        </motion.div>
      )}

      {/* ── Architecture reminder ── */}
      <motion.div variants={fadeUp} className="rounded-sm px-4 py-2 flex items-center gap-2"
        style={{ background: `${GOLD}06`, border: `1px solid ${GOLD}15` }}>
        <span className="font-mono text-[8px] tracking-wider" style={{ color: 'var(--text-muted)' }}>
          REVENUE FLOW:
        </span>
        {['Opportunity', 'Offer', 'Lead', 'Proposal', 'Client', 'Revenue ◀', 'Delivery'].map((step, i, arr) => (
          <span key={step} className="font-mono text-[8px]" style={{ color: step.includes('◀') ? GOLD : 'var(--text-muted)', fontWeight: step.includes('◀') ? 700 : 400 }}>
            {step}{i < arr.length - 1 ? ' →' : ''}
          </span>
        ))}
      </motion.div>

      {/* ── Monthly Forecast (full width) ── */}
      <motion.div variants={fadeUp}>
        <MonthlyForecastPanel months={forecast?.monthlyForecast || []} />
      </motion.div>

      {/* ── Main 2-col layout ── */}
      <div className="grid grid-cols-3 gap-4">

        {/* Left col: Revenue Items (2/3) */}
        <div className="col-span-2 space-y-3">
          {/* Filter tabs */}
          <div className="flex items-center gap-1 flex-wrap">
            {FILTER_TABS.map(t => {
              const count = t.key === 'all' ? items.length : items.filter(r => r.status === t.key).length;
              const isActive = filter === t.key;
              const color = t.key === 'all' ? GOLD : (STATUS_COLOR[t.key] || GOLD);
              return (
                <button key={t.key} onClick={() => setFilter(t.key)}
                  className="font-mono text-[8px] tracking-wider px-3 py-1.5 rounded-sm transition-all"
                  style={{
                    background: isActive ? `${color}18` : 'transparent',
                    border: `1px solid ${isActive ? color : 'var(--border-default)'}`,
                    color: isActive ? color : 'var(--text-muted)',
                  }}>
                  {t.label} {count > 0 && <span style={{ opacity: 0.7 }}>({count})</span>}
                </button>
              );
            })}
          </div>

          {/* Items */}
          {filtered.length === 0 ? (
            <div className="panel-gold rounded-sm p-8 text-center" style={{ borderColor: 'var(--border-default)' }}>
              <p className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>No revenue items{filter !== 'all' ? ` with status "${filter}"` : ''}.</p>
              <button onClick={() => setShowAdd(true)} className="mt-3 font-mono text-[9px] tracking-widest px-4 py-2 rounded-sm transition-all"
                style={{ background: `${GOLD}15`, border: `1px solid ${GOLD}30`, color: GOLD }}>
                + ADD FIRST ITEM
              </button>
            </div>
          ) : (
            <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-3">
              {filtered.map(item => (
                <RevenueCard
                  key={item.revenueId}
                  item={item}
                  onUpdate={handleUpdate}
                  onQueueAction={handleQueueAction}
                  actioning={actioning}
                />
              ))}
            </motion.div>
          )}
        </div>

        {/* Right col: Analytics (1/3) */}
        <div className="space-y-4">
          <ByLanePanel byLane={forecast?.revenueByLane} />
          <ByTypePanel byType={forecast?.revenueByType} />
          <UpcomingClosesPanel items={forecast?.upcomingCloses} />
          <AtRiskPanel items={forecast?.atRisk} />
        </div>
      </div>

      {/* ── Governance note ── */}
      <motion.div variants={fadeUp} className="rounded-sm px-4 py-2 flex items-center gap-2"
        style={{ background: `${SAPPHIRE}06`, border: `1px solid ${SAPPHIRE}15` }}>
        <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>
          GOVERNANCE: Revenue Item → Queue Action → Approval → Dispatch → No autonomous execution
        </span>
      </motion.div>
    </motion.div>
  );
}
