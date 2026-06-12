import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ── Design tokens ─────────────────────────────────────────────────────
const GOLD     = '#c9a84c';
const TEAL     = '#0dd3c5';
const EMERALD  = '#10b981';
const SAPPHIRE = '#3b82f6';
const CRIMSON  = '#ef4444';
const AMBER    = '#f59e0b';
const VIOLET   = '#8b5cf6';
const ROSE     = '#f43f5e';

const TIER_COLOR = { free: EMERALD, low: TEAL, medium: AMBER, high: CRIMSON, variable: VIOLET };
const RISK_COLOR = { none: EMERALD, low: TEAL, medium: AMBER, high: CRIMSON, unknown: GOLD };
const SEV_COLOR  = { warning: AMBER, info: SAPPHIRE, alert: CRIMSON };

const LANE_COLOR = {
  'digital-diamond': GOLD,
  'managed-by-mika': TEAL,
  'medai':           VIOLET,
  'cannaops':        EMERALD,
  'hotel-hooker':    ROSE,
  'ai-twin':         SAPPHIRE,
  'lead-recovery':   AMBER,
  'none':            '#4b5563',
};

const DEPT_COLOR = { OPERATIONS: GOLD, ENGINEERING: SAPPHIRE, CONTENT: VIOLET };

const stagger = { initial: {}, animate: { transition: { staggerChildren: 0.04 } } };
const fadeUp  = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0, transition: { duration: 0.22 } } };

// ── Helpers ───────────────────────────────────────────────────────────

function fmtCost(n, alwaysSign = false) {
  if (n == null) return '—';
  if (n === 0)   return alwaysSign ? '$0.00' : '$0';
  if (n < 0.001) return '<$0.001';
  if (n < 0.01)  return `$${n.toFixed(3)}`;
  if (n < 1)     return `$${n.toFixed(3)}`;
  if (n < 100)   return `$${n.toFixed(2)}`;
  return `$${n.toFixed(0)}`;
}

function fmtK(n) {
  if (n == null) return '—';
  if (n === 0)   return '0';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function safeTs(ts) {
  if (!ts) return '—';
  try {
    const diff = Math.floor((Date.now() - new Date(ts)) / 60000);
    if (diff < 1)  return 'just now';
    if (diff < 60) return `${diff}m ago`;
    return `${Math.floor(diff / 60)}h ago`;
  } catch { return '—'; }
}

function TierBadge({ tier }) {
  const col = TIER_COLOR[tier] || GOLD;
  return (
    <span className="font-mono text-[6px] px-1.5 py-0.5 rounded uppercase tracking-wider"
      style={{ background: `${col}12`, color: col, border: `1px solid ${col}22` }}>
      {tier}
    </span>
  );
}

function RiskBadge({ risk }) {
  const col = RISK_COLOR[risk] || GOLD;
  return (
    <span className="font-mono text-[6px] px-1.5 py-0.5 rounded uppercase tracking-wider"
      style={{ background: `${col}12`, color: col, border: `1px solid ${col}22` }}>
      {risk} risk
    </span>
  );
}

// ── Bar chart helper ──────────────────────────────────────────────────

function HBar({ value, max, color, height = 8 }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="flex-1 rounded-full overflow-hidden" style={{ height, background: 'rgba(255,255,255,0.04)' }}>
      <motion.div
        className="h-full rounded-full"
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        style={{ background: color, boxShadow: pct > 0 ? `0 0 8px ${color}44` : undefined }}
      />
    </div>
  );
}

// ── Metric card ───────────────────────────────────────────────────────

function MetCard({ label, value, sub, color, border }) {
  const c = color || GOLD;
  return (
    <div className="rounded-sm p-4 flex flex-col gap-1"
      style={{ background: `${c}08`, border: `1px solid ${border || c}20` }}>
      <div className="font-mono text-[7px] tracking-[0.2em] uppercase" style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div className="font-mono text-2xl font-bold leading-none" style={{ color: c }}>{value}</div>
      {sub && <div className="font-mono text-[7px]" style={{ color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────

function Panel({ title, color, children, action }) {
  return (
    <motion.div variants={fadeUp} className="panel-gold rounded-sm overflow-hidden" style={{ borderColor: `${color || GOLD}22` }}>
      <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: 'var(--border-default)', background: `${color || GOLD}06` }}>
        <div className="font-mono text-[8px] tracking-[0.22em] uppercase" style={{ color: color || GOLD }}>{title}</div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </motion.div>
  );
}

// ── 1. Cost Overview ──────────────────────────────────────────────────

function CostOverview({ summary }) {
  if (!summary) return null;
  const { today, week, month, projectedMonth, allTime, avgCostPerDispatch } = summary;
  return (
    <motion.div variants={fadeUp} className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <MetCard label="Today" value={fmtCost(today.estimatedCost, true)}
        sub={`${today.dispatches} dispatch${today.dispatches !== 1 ? 'es' : ''}`} color={SAPPHIRE} />
      <MetCard label="This Week" value={fmtCost(week.estimatedCost, true)}
        sub={`${week.dispatches} dispatches`} color={TEAL} />
      <MetCard label="This Month" value={fmtCost(month.estimatedCost, true)}
        sub={`${month.dispatches} dispatches`} color={GOLD} />
      <MetCard label="Projected Month" value={fmtCost(projectedMonth.estimatedCost, true)}
        sub={`~${projectedMonth.dispatches} dispatches`} color={VIOLET} border={VIOLET} />
    </motion.div>
  );
}

// ── 2. By Agent ───────────────────────────────────────────────────────

function AgentCostTable({ agents }) {
  if (!agents?.length) return <p className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>No agent dispatch data yet.</p>;
  const maxCost = Math.max(...agents.map(a => a.estimatedCostTotal), 0.001);
  return (
    <div className="space-y-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-0 py-1 mb-1">
        <div className="flex-1 font-mono text-[7px] tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>Agent</div>
        <div className="w-12 font-mono text-[7px] tracking-widest uppercase text-center" style={{ color: 'var(--text-muted)' }}>Disp</div>
        <div className="w-20 font-mono text-[7px] tracking-widest uppercase text-right" style={{ color: 'var(--text-muted)' }}>All-time</div>
        <div className="w-20 font-mono text-[7px] tracking-widest uppercase text-right" style={{ color: 'var(--text-muted)' }}>30-day</div>
        <div className="w-16 font-mono text-[7px] tracking-widest uppercase text-right" style={{ color: 'var(--text-muted)' }}>Avg/disp</div>
      </div>
      {agents.map(a => {
        const deptCol = DEPT_COLOR[a.department] || GOLD;
        const costCol = a.estimatedCostTotal > 0.05 ? CRIMSON : a.estimatedCostTotal > 0 ? AMBER : EMERALD;
        return (
          <div key={a.agentId} className="flex items-center gap-3 py-2 border-b" style={{ borderColor: 'var(--border-default)' }}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="font-ui text-[11px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{a.displayName}</span>
                <span className="font-mono text-[7px] px-1 py-0.5 rounded flex-shrink-0" style={{ background: `${deptCol}10`, color: deptCol }}>{a.department}</span>
                {a.adapterId && (
                  <span className="font-mono text-[7px] px-1 py-0.5 rounded flex-shrink-0" style={{ background: `${GOLD}0d`, color: GOLD, border: `1px solid ${GOLD}18` }}>{a.adapterId}</span>
                )}
              </div>
              <HBar value={a.estimatedCostTotal} max={maxCost} color={costCol} height={3} />
            </div>
            <div className="w-12 font-mono text-[9px] text-center" style={{ color: 'var(--text-secondary)' }}>{fmtK(a.totalDispatches)}</div>
            <div className="w-20 font-mono text-[9px] text-right" style={{ color: costCol }}>{fmtCost(a.estimatedCostTotal)}</div>
            <div className="w-20 font-mono text-[9px] text-right" style={{ color: 'var(--text-secondary)' }}>{fmtCost(a.estimatedCostMonth)}</div>
            <div className="w-16 font-mono text-[8px] text-right" style={{ color: 'var(--text-muted)' }}>{fmtCost(a.avgCostPerDispatch)}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── 3. By Adapter ─────────────────────────────────────────────────────

function AdapterCostTable({ adapters }) {
  if (!adapters?.length) return null;
  const maxCost = Math.max(...adapters.map(a => a.estimatedCostTotal), 0.001);
  return (
    <div className="space-y-0">
      <div className="flex items-center gap-3 py-1 mb-1">
        <div className="flex-1 font-mono text-[7px] tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>Adapter</div>
        <div className="font-mono text-[7px] tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>Tier</div>
        <div className="w-12 font-mono text-[7px] tracking-widest uppercase text-center" style={{ color: 'var(--text-muted)' }}>Exec</div>
        <div className="w-20 font-mono text-[7px] tracking-widest uppercase text-right" style={{ color: 'var(--text-muted)' }}>All-time</div>
        <div className="w-20 font-mono text-[7px] tracking-widest uppercase text-right" style={{ color: 'var(--text-muted)' }}>Proj/mo</div>
        <div className="w-16 font-mono text-[7px] tracking-widest uppercase text-right" style={{ color: 'var(--text-muted)' }}>/dispatch</div>
      </div>
      {adapters.map(a => {
        const tierCol = TIER_COLOR[a.tier] || GOLD;
        const barCol  = a.estimatedCostTotal > 0.05 ? CRIMSON : a.estimatedCostTotal > 0 ? AMBER : EMERALD;
        return (
          <div key={a.adapterId} className="py-2.5 border-b" style={{ borderColor: 'var(--border-default)' }}>
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-ui text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>{a.displayName}</span>
                  <TierBadge tier={a.tier} />
                  <RiskBadge risk={a.activationRisk} />
                </div>
                <HBar value={a.estimatedCostTotal} max={maxCost} color={barCol} height={3} />
              </div>
              <div className="w-12 font-mono text-[9px] text-center" style={{ color: 'var(--text-secondary)' }}>{fmtK(a.totalDispatches)}</div>
              <div className="w-20 font-mono text-[9px] text-right" style={{ color: a.estimatedCostTotal > 0 ? barCol : 'var(--text-muted)' }}>{fmtCost(a.estimatedCostTotal)}</div>
              <div className="w-20 font-mono text-[9px] text-right" style={{ color: a.projectedMonthlyCost > 0 ? AMBER : 'var(--text-muted)' }}>{fmtCost(a.projectedMonthlyCost)}</div>
              <div className="w-16 font-mono text-[8px] text-right" style={{ color: 'var(--text-muted)' }}>{a.perDispatch > 0 ? fmtCost(a.perDispatch) : 'free'}</div>
            </div>
            {a.note && (
              <p className="font-mono text-[7px] mt-1" style={{ color: 'var(--text-muted)' }}>{a.note}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── 4. By Lane ────────────────────────────────────────────────────────

function LaneCostPanel({ lanes }) {
  if (!lanes?.length) return null;
  const maxCost = Math.max(...lanes.map(l => l.estimatedCostTotal), 0.001);
  const maxDisp = Math.max(...lanes.map(l => l.totalDispatches), 1);

  return (
    <div className="space-y-2">
      {lanes.map(l => {
        const col = LANE_COLOR[l.laneId] || GOLD;
        return (
          <div key={l.laneId} className="flex items-center gap-3">
            <div className="w-32 font-mono text-[8px] truncate flex-shrink-0" style={{ color: col }}>{l.displayName}</div>
            <div className="flex-1">
              <HBar value={l.totalDispatches} max={maxDisp} color={col} height={6} />
            </div>
            <div className="w-12 font-mono text-[8px] text-center flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{l.totalDispatches}</div>
            <div className="w-16 font-mono text-[9px] text-right flex-shrink-0" style={{ color: l.estimatedCostTotal > 0 ? AMBER : 'var(--text-muted)' }}>
              {fmtCost(l.estimatedCostTotal)}
            </div>
          </div>
        );
      })}
      <div className="flex items-center justify-between pt-2 border-t" style={{ borderColor: 'var(--border-default)' }}>
        <span className="font-mono text-[7px]" style={{ color: 'var(--text-muted)' }}>Total</span>
        <span className="font-mono text-[9px]" style={{ color: GOLD }}>
          {fmtCost(lanes.reduce((s, l) => s + l.estimatedCostTotal, 0))}
        </span>
      </div>
    </div>
  );
}

// ── 5. Workflow Cost ──────────────────────────────────────────────────

function WorkflowCostPanel({ workflowAverages }) {
  if (!workflowAverages?.length) {
    return (
      <div className="space-y-3">
        <p className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>
          No workflow dispatch data yet. Create a content brief or viral workflow and dispatch tasks to see cost breakdown.
        </p>
        {/* Projected workflow costs */}
        <div className="rounded-sm p-3" style={{ background: `${SAPPHIRE}06`, border: `1px solid ${SAPPHIRE}15` }}>
          <div className="font-mono text-[7px] tracking-widest uppercase mb-2" style={{ color: SAPPHIRE }}>PROJECTED WORKFLOW COSTS (when active)</div>
          <div className="space-y-1.5">
            {[
              { type: 'viral-content', stages: 7, adapters: ['hermes', 'openclaw'], estCost: 0.065 },
              { type: 'content-brief', stages: 3, adapters: ['hermes'], estCost: 0.000 },
              { type: 'video-production', stages: 4, adapters: ['heygen', 'hermes'], estCost: 0.513 },
            ].map(w => (
              <div key={w.type} className="flex items-center justify-between">
                <div>
                  <span className="font-mono text-[9px]" style={{ color: 'var(--text-primary)' }}>{w.type}</span>
                  <span className="font-mono text-[7px] ml-2" style={{ color: 'var(--text-muted)' }}>{w.stages} stages · {w.adapters.join(', ')}</span>
                </div>
                <span className="font-mono text-[9px]" style={{ color: w.estCost > 0 ? AMBER : EMERALD }}>
                  {fmtCost(w.estCost)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {workflowAverages.map(w => (
        <div key={w.workflowType} className="flex items-center justify-between py-2 border-b" style={{ borderColor: 'var(--border-default)' }}>
          <div>
            <div className="font-mono text-[10px] font-semibold" style={{ color: 'var(--text-primary)' }}>{w.workflowType}</div>
            <div className="font-mono text-[7px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {w.workflowCount} workflow{w.workflowCount !== 1 ? 's' : ''} · {w.totalDispatches} dispatches · avg {w.avgDispatchesPerWorkflow} disp/workflow
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-[11px]" style={{ color: w.avgCostPerWorkflow > 0.05 ? AMBER : EMERALD }}>
              {fmtCost(w.avgCostPerWorkflow)}
            </div>
            <div className="font-mono text-[7px]" style={{ color: 'var(--text-muted)' }}>avg/workflow</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 6. Cost Alerts ────────────────────────────────────────────────────

function CostAlertsPanel({ alerts }) {
  if (!alerts?.length) {
    return <p className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>No cost alerts.</p>;
  }
  return (
    <div className="space-y-2">
      {alerts.map((a, i) => {
        const col = SEV_COLOR[a.severity] || GOLD;
        return (
          <div key={i} className="rounded-sm px-4 py-3" style={{ background: `${col}08`, border: `1px solid ${col}22` }}>
            <div className="flex items-start gap-2">
              <span className="text-[9px] flex-shrink-0 mt-0.5" style={{ color: col }}>
                {a.severity === 'warning' ? '⚠' : a.severity === 'alert' ? '✕' : 'ℹ'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-mono text-[9px] font-semibold" style={{ color: col }}>{a.title}</div>
                <div className="font-mono text-[8px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{a.detail}</div>
              </div>
              {a.cost != null && a.cost > 0 && (
                <span className="font-mono text-[8px] flex-shrink-0" style={{ color: col }}>{fmtCost(a.cost)}/ea</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── 7. Optimization Opportunities ────────────────────────────────────

function OpportunitiesPanel({ opportunities }) {
  if (!opportunities?.length) return null;
  const PRI_COL = { high: CRIMSON, medium: AMBER, low: SAPPHIRE };
  return (
    <div className="space-y-2">
      {opportunities.map((o, i) => {
        const priCol = PRI_COL[o.priority] || GOLD;
        return (
          <div key={i} className="rounded-sm p-4" style={{ background: `${priCol}06`, border: `1px solid ${priCol}18` }}>
            <div className="flex items-start gap-2 mb-1.5">
              <span className="font-mono text-[7px] px-1.5 py-0.5 rounded uppercase tracking-wider flex-shrink-0 mt-0.5"
                style={{ background: `${priCol}12`, color: priCol, border: `1px solid ${priCol}25` }}>
                {o.priority}
              </span>
              <div className="font-mono text-[10px] font-semibold" style={{ color: 'var(--text-primary)' }}>{o.title}</div>
              {o.potentialSaving != null && o.potentialSaving > 0 && (
                <span className="font-mono text-[8px] ml-auto flex-shrink-0" style={{ color: EMERALD }}>
                  save ~{fmtCost(o.potentialSaving)}/mo
                </span>
              )}
            </div>
            <p className="font-mono text-[8px] mb-1.5" style={{ color: 'var(--text-muted)' }}>{o.detail}</p>
            <div className="flex items-start gap-1">
              <span className="font-mono text-[7px] flex-shrink-0 mt-0.5" style={{ color: priCol }}>→</span>
              <span className="font-mono text-[8px]" style={{ color: priCol }}>{o.action}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Activation projections ────────────────────────────────────────────

function ActivationProjections({ projections }) {
  if (!projections?.length) return null;
  return (
    <div className="space-y-2">
      <div className="font-mono text-[7px] tracking-widest uppercase mb-2" style={{ color: 'var(--text-muted)' }}>
        PROJECTED MONTHLY COST IF ACTIVATED (at 30 dispatches/mo baseline)
      </div>
      {projections.map(p => {
        const tierCol = TIER_COLOR[p.tier] || GOLD;
        const riskCol = RISK_COLOR[p.activationRisk] || GOLD;
        return (
          <div key={p.adapterId} className="flex items-center gap-3 py-2 border-b" style={{ borderColor: 'var(--border-default)' }}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[10px] font-semibold" style={{ color: 'var(--text-primary)' }}>{p.displayName}</span>
                <TierBadge tier={p.tier} />
                <RiskBadge risk={p.activationRisk} />
              </div>
              <div className="font-mono text-[7px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{p.note}</div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="font-mono text-[11px]" style={{ color: p.projectedMonthlyCost > 0.5 ? CRIMSON : p.projectedMonthlyCost > 0 ? AMBER : EMERALD }}>
                {p.projectedMonthlyCost === 0 ? 'Free' : fmtCost(p.projectedMonthlyCost)}
              </div>
              <div className="font-mono text-[7px]" style={{ color: 'var(--text-muted)' }}>
                {p.projectedMonthlyCost > 0 ? `${fmtCost(p.projectedAnnualCost)}/yr` : 'compute only'}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────

export default function CostIntelligence() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab,     setTab]     = useState('overview');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch('/api/cost/summary');
      if (res.ok) setData(await res.json());
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(() => load(true), 60_000);
    return () => clearInterval(id);
  }, [load]);

  if (loading) return (
    <div className="flex items-center justify-center py-32">
      <div className="flex flex-col items-center gap-3">
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
          className="w-6 h-6 rounded-full"
          style={{ border: '2px solid var(--border-default)', borderTopColor: GOLD }} />
        <span className="font-mono text-[9px] tracking-widest" style={{ color: 'var(--text-muted)' }}>
          COMPUTING COST INTELLIGENCE
        </span>
      </div>
    </div>
  );

  const TABS = [
    { key: 'overview',    label: 'Overview'    },
    { key: 'agents',      label: 'By Agent'    },
    { key: 'adapters',    label: 'By Adapter'  },
    { key: 'lanes',       label: 'By Lane'     },
    { key: 'projections', label: 'Projections' },
  ];

  const hasCriticalAlert = data?.alerts?.some(a => a.severity === 'alert');
  const alertCount       = data?.alerts?.filter(a => a.severity === 'warning' || a.severity === 'alert').length || 0;

  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-4">
      {/* Header */}
      <motion.div variants={fadeUp} className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold leading-none" style={{ color: 'var(--text-primary)' }}>
            Cost Intelligence
          </h1>
          <p className="font-mono text-[9px] tracking-widest mt-1.5" style={{ color: 'var(--text-muted)' }}>
            ESTIMATES ONLY · NO BILLING API · PRE-ACTIVATION FINANCIAL VISIBILITY
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data?.updatedAt && (
            <span className="font-mono text-[7px]" style={{ color: 'var(--text-muted)' }}>
              updated {safeTs(data.updatedAt)}
            </span>
          )}
          <button onClick={() => load(true)} className="font-mono text-[9px] tracking-widest px-3 py-2 rounded-sm transition-all"
            style={{ background: `${GOLD}0f`, border: `1px solid ${GOLD}25`, color: GOLD }}>
            ↻
          </button>
        </div>
      </motion.div>

      {/* Cost overview strip — always visible */}
      <CostOverview summary={data?.summary} />

      {/* Highlights */}
      {(data?.highlights?.highestCostAgent || data?.highlights?.highestCostAdapter) && (
        <motion.div variants={fadeUp} className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {data.highlights.highestCostAgent && (
            <MetCard
              label="Highest Cost Agent"
              value={data.highlights.highestCostAgent.displayName}
              sub={fmtCost(data.highlights.highestCostAgent.estimatedCostTotal) + ' all-time'}
              color={ROSE} />
          )}
          {data.highlights.highestCostAdapter && (
            <MetCard
              label="Highest Cost Adapter"
              value={data.highlights.highestCostAdapter.displayName}
              sub={fmtCost(data.highlights.highestCostAdapter.estimatedCostTotal) + ' all-time'}
              color={AMBER} />
          )}
          <MetCard
            label="All-time Dispatches"
            value={fmtK(data.summary?.allTime?.dispatches || 0)}
            sub={`~${fmtCost(data.summary?.avgCostPerDispatch)} avg/dispatch`}
            color={SAPPHIRE} />
          <MetCard
            label="All-time Estimated"
            value={fmtCost(data.summary?.allTime?.estimatedCost || 0, true)}
            sub="estimates only — not billed"
            color={GOLD} />
        </motion.div>
      )}

      {/* Tabs */}
      <motion.div variants={fadeUp} className="flex items-center gap-1 flex-wrap">
        {TABS.map(t => {
          const isActive = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="font-mono text-[9px] tracking-wider px-4 py-2 rounded-sm transition-all"
              style={{ background: isActive ? `${GOLD}18` : 'transparent', border: `1px solid ${isActive ? GOLD : 'var(--border-default)'}`, color: isActive ? GOLD : 'var(--text-muted)' }}>
              {t.label}
            </button>
          );
        })}
        {alertCount > 0 && (
          <div className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-sm cursor-pointer"
            onClick={() => setTab('overview')}
            style={{ background: `${AMBER}10`, border: `1px solid ${AMBER}25` }}>
            <span style={{ fontSize: 9, color: AMBER }}>⚠</span>
            <span className="font-mono text-[8px]" style={{ color: AMBER }}>{alertCount} alert{alertCount !== 1 ? 's' : ''}</span>
          </div>
        )}
      </motion.div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        {tab === 'overview' && (
          <motion.div key="overview" variants={stagger} initial="initial" animate="animate" exit={{ opacity: 0 }} className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Panel title="COST ALERTS" color={AMBER}>
                <CostAlertsPanel alerts={data?.alerts} />
              </Panel>
              <Panel title="OPTIMIZATION OPPORTUNITIES" color={EMERALD}>
                <OpportunitiesPanel opportunities={data?.opportunities} />
              </Panel>
            </div>
            <Panel title="WORKFLOW COST" color={SAPPHIRE}>
              <WorkflowCostPanel workflowAverages={data?.workflowAverages} />
            </Panel>
          </motion.div>
        )}

        {tab === 'agents' && (
          <motion.div key="agents" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Panel title="COST BY AGENT" color={VIOLET}>
              <AgentCostTable agents={data?.byAgent} />
            </Panel>
          </motion.div>
        )}

        {tab === 'adapters' && (
          <motion.div key="adapters" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Panel title="COST BY ADAPTER" color={TEAL}>
              <AdapterCostTable adapters={data?.byAdapter} />
            </Panel>
          </motion.div>
        )}

        {tab === 'lanes' && (
          <motion.div key="lanes" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Panel title="COST BY BUSINESS LANE" color={GOLD}>
              <LaneCostPanel lanes={data?.byLane} />
            </Panel>
          </motion.div>
        )}

        {tab === 'projections' && (
          <motion.div key="projections" variants={stagger} initial="initial" animate="animate" exit={{ opacity: 0 }} className="space-y-4">
            <Panel title="STAGED ADAPTER ACTIVATION COST" color={CRIMSON}
              action={<span className="font-mono text-[7px]" style={{ color: 'var(--text-muted)' }}>30 dispatches/mo baseline</span>}>
              <ActivationProjections projections={data?.activationProjections} />
            </Panel>
            <Panel title="OPTIMIZATION OPPORTUNITIES" color={EMERALD}>
              <OpportunitiesPanel opportunities={data?.opportunities} />
            </Panel>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Architecture note */}
      <motion.div variants={fadeUp} className="rounded-sm px-4 py-2.5 flex items-center gap-2 flex-wrap"
        style={{ background: `${SAPPHIRE}06`, border: `1px solid ${SAPPHIRE}15` }}>
        <span className="font-mono text-[8px] tracking-wider flex-shrink-0" style={{ color: 'var(--text-muted)' }}>COST MODEL:</span>
        <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>
          Estimates from dispatch log × adapter cost model. No live billing API. Activate paid providers only after reviewing this dashboard.
        </span>
      </motion.div>
    </motion.div>
  );
}
