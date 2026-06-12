import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../../lib/store';

// ── Design tokens ────────────────────────────────────────────────────
const GOLD    = '#c9a84c';
const TEAL    = '#0dd3c5';
const EMERALD = '#10b981';
const SAPPHIRE= '#3b82f6';
const CRIMSON = '#ef4444';
const AMBER   = '#f59e0b';
const VIOLET  = '#8b5cf6';

const LANE_COLORS = {
  'digital-diamond': '#c9a84c', 'managed-by-mika': '#0dd3c5',
  'medai': '#818cf8',           'cannaops': '#4ade80',
  'hotel-hooker': '#f472b6',    'ai-twin': '#60a5fa',
  'lead-recovery': '#fb923c',
};

const SEVERITY_COLOR = { high: CRIMSON, medium: AMBER, low: EMERALD };
const SEVERITY_BG    = { high: 'rgba(239,68,68,0.08)', medium: 'rgba(245,158,11,0.08)', low: 'rgba(16,185,129,0.08)' };

const ACTIVITY_COLOR = {
  'dispatch':      SAPPHIRE,
  'task-complete': EMERALD,
  'artifact':      VIOLET,
  'memory':        TEAL,
};
const ACTIVITY_ICON = {
  'dispatch':      '◎',
  'task-complete': '✓',
  'artifact':      '◈',
  'memory':        '⬡',
};

const QUICK_WIN_COLOR = {
  'content-ready':  EMERALD,
  'approved-ready': GOLD,
  'video-ready':    SAPPHIRE,
};
const QUICK_WIN_ICON  = {
  'content-ready':  '✦',
  'approved-ready': '◆',
  'video-ready':    '▷',
};

const stagger  = { initial: {}, animate: { transition: { staggerChildren: 0.05 } } };
const fadeUp   = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0, transition: { duration: 0.28 } } };
const fadeIn   = { initial: { opacity: 0 }, animate: { opacity: 1, transition: { duration: 0.22 } } };

function safeTs(ts) {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1)   return 'just now';
    if (diffMin < 60)  return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24)    return `${diffH}h ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return '—'; }
}

// ── Sub-components ───────────────────────────────────────────────────

function HealthDot({ healthy, size = 7 }) {
  return (
    <div
      className="rounded-full flex-shrink-0"
      style={{
        width: size, height: size,
        background: healthy ? EMERALD : CRIMSON,
        boxShadow: `0 0 6px ${healthy ? EMERALD : CRIMSON}`,
      }}
    />
  );
}

function SystemHealthPanel({ health }) {
  const cards = [
    {
      label: 'OpenClaw',
      status: health.openclaw?.status || '—',
      sub: health.openclaw?.latencyMs != null ? `${health.openclaw.latencyMs}ms` : null,
      healthy: health.openclaw?.healthy,
      color: GOLD,
    },
    {
      label: 'Hermes',
      status: health.hermes?.status || '—',
      sub: health.hermes?.enabled ? 'agent enabled' : 'disabled',
      healthy: health.hermes?.healthy,
      color: VIOLET,
    },
    {
      label: 'Queue',
      status: health.queue?.healthy ? 'HEALTHY' : 'DEGRADED',
      sub: `${health.queue?.depth || 0} items · ${health.queue?.pending || 0} pending`,
      healthy: health.queue?.healthy,
      color: TEAL,
    },
    {
      label: 'Dispatch',
      status: health.dispatch?.healthy ? 'HEALTHY' : 'DEGRADED',
      sub: health.dispatch?.failedCount > 0
        ? `${health.dispatch.failedCount} failed`
        : `${health.dispatch?.total || 0} total logged`,
      healthy: health.dispatch?.healthy,
      color: SAPPHIRE,
    },
  ];

  return (
    <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4" style={{ borderColor: `${TEAL}20` }}>
      <div className="font-mono text-[8px] tracking-[0.22em] uppercase mb-3" style={{ color: TEAL }}>
        SYSTEM HEALTH
      </div>
      <div className="grid grid-cols-2 gap-2">
        {cards.map(c => (
          <div
            key={c.label}
            className="rounded-sm p-3 flex items-start gap-2.5"
            style={{ background: `${c.color}06`, border: `1px solid ${c.color}18` }}
          >
            <HealthDot healthy={c.healthy} />
            <div className="min-w-0">
              <div className="font-mono text-[9px] tracking-wider" style={{ color: c.color }}>{c.label.toUpperCase()}</div>
              <div className="font-mono text-[11px] font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>{c.status}</div>
              {c.sub && <div className="font-mono text-[8px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{c.sub}</div>}
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

function MetricBlock({ label, value, color, sub }) {
  return (
    <div className="text-center px-2 py-3 rounded-sm" style={{ background: `${color}06`, border: `1px solid ${color}14` }}>
      <div className="font-mono text-xl font-bold leading-none" style={{ color }}>{value ?? '—'}</div>
      <div className="font-mono text-[7px] tracking-widest mt-1.5 uppercase" style={{ color: 'var(--text-muted)' }}>{label}</div>
      {sub && <div className="font-mono text-[8px] mt-0.5" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>{sub}</div>}
    </div>
  );
}

function WorkforcePanel({ workforce }) {
  const hasHealthData  = (workforce.healthy != null);
  const hasAdapterData = (workforce.adapterTotal != null);
  return (
    <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4" style={{ borderColor: `${GOLD}20` }}>
      <div className="font-mono text-[8px] tracking-[0.22em] uppercase mb-3" style={{ color: GOLD }}>
        WORKFORCE
      </div>
      <div className="grid grid-cols-2 gap-2">
        <MetricBlock label="Total Agents"  value={workforce.total}      color={GOLD}     />
        <MetricBlock label="Active"        value={workforce.active}     color={EMERALD}  />
        <MetricBlock label="Staged"        value={workforce.staged}     color={AMBER}    sub="ready to deploy" />
        <MetricBlock label="Executable"    value={workforce.executable} color={SAPPHIRE} sub="live-connected" />
      </div>
      {hasHealthData && (
        <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t" style={{ borderColor: 'var(--border-default)' }}>
          <MetricBlock label="Healthy"     value={workforce.healthy     || 0} color={EMERALD} />
          <MetricBlock label="Offline"     value={workforce.offline     || 0} color={workforce.offline > 0 ? CRIMSON : EMERALD} />
          <MetricBlock label="Maintenance" value={workforce.maintenance || 0} color={workforce.maintenance > 0 ? VIOLET : EMERALD} />
        </div>
      )}
      {hasAdapterData && (
        <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t" style={{ borderColor: 'var(--border-default)' }}>
          <MetricBlock label="Adapters"    value={`${workforce.adapterActive}/${workforce.adapterTotal}`} color={TEAL}    sub="active" />
          <MetricBlock label="Staged"      value={workforce.adapterStaged || 0}                          color={SAPPHIRE} sub="adapters" />
          <MetricBlock label="Adapter Maint" value={workforce.adapterMaint || 0}                         color={workforce.adapterMaint > 0 ? VIOLET : EMERALD} />
        </div>
      )}
      {/* Adapter health (from last health check run) */}
      {workforce.adapterLastCheckedAt && (
        <div className="mt-2 pt-2 border-t space-y-1.5" style={{ borderColor: 'var(--border-default)' }}>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[7px] tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>ADAPTER HEALTH</span>
            <span className="font-mono text-[7px]" style={{ color: 'var(--text-muted)' }}>
              {(() => {
                try {
                  const diff = Math.floor((Date.now() - new Date(workforce.adapterLastCheckedAt)) / 60000);
                  return diff < 1 ? 'just now' : diff < 60 ? `${diff}m ago` : `${Math.floor(diff/60)}h ago`;
                } catch { return '—'; }
              })()}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <MetricBlock label="Healthy"       value={workforce.adapterHealthy || 0}       color={EMERALD} />
            <MetricBlock label="Failed"        value={workforce.adapterFailed  || 0}       color={workforce.adapterFailed > 0 ? CRIMSON : EMERALD} />
            <MetricBlock label="Misconfigured" value={(workforce.adapterMisconfigured || 0) + (workforce.adapterAuthFailed || 0)} color={(workforce.adapterMisconfigured || 0) + (workforce.adapterAuthFailed || 0) > 0 ? AMBER : EMERALD} />
          </div>
          {workforce.adapterConfiguredButStaged > 0 && (
            <div className="rounded-sm px-2 py-1.5 mt-1" style={{ background: `${SAPPHIRE}08`, border: `1px solid ${SAPPHIRE}20` }}>
              <span className="font-mono text-[7px]" style={{ color: SAPPHIRE }}>
                {workforce.adapterConfiguredButStaged} adapter{workforce.adapterConfiguredButStaged > 1 ? 's' : ''} configured but staged — ready to activate
              </span>
            </div>
          )}
        </div>
      )}
      {workforce.adapterNeverChecked && workforce.adapterTotal > 0 && !workforce.adapterLastCheckedAt && (
        <div className="mt-2 pt-2 border-t" style={{ borderColor: 'var(--border-default)' }}>
          <div className="rounded-sm px-2 py-1.5" style={{ background: `${AMBER}06`, border: `1px solid ${AMBER}18` }}>
            <span className="font-mono text-[7px]" style={{ color: AMBER }}>
              Adapter health not checked — go to Agent Control → Run Checks
            </span>
          </div>
        </div>
      )}
      {workforce.pendingActivations > 0 && (
        <div className="mt-2 pt-2 border-t" style={{ borderColor: 'var(--border-default)' }}>
          <div className="rounded-sm px-2 py-1.5" style={{ background: `${GOLD}06`, border: `1px solid ${GOLD}22` }}>
            <span className="font-mono text-[7px]" style={{ color: GOLD }}>
              {workforce.pendingActivations} activation request{workforce.pendingActivations > 1 ? 's' : ''} awaiting review — Activation Gate
            </span>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function OperationsPanel({ ops }) {
  return (
    <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4" style={{ borderColor: `${SAPPHIRE}20` }}>
      <div className="font-mono text-[8px] tracking-[0.22em] uppercase mb-3" style={{ color: SAPPHIRE }}>
        OPERATIONS
      </div>
      <div className="grid grid-cols-3 gap-2 mb-2">
        <MetricBlock label="Pending"   value={ops.tasksPending}        color={AMBER}   />
        <MetricBlock label="Running"   value={ops.tasksRunning}        color={SAPPHIRE}/>
        <MetricBlock label="Today"     value={ops.tasksCompletedToday} color={EMERALD} sub="completed" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <MetricBlock label="All-time Complete" value={ops.tasksCompleted}    color={TEAL}   />
        <MetricBlock label="Awaiting Approval" value={ops.pendingApprovals}  color={ops.pendingApprovals > 0 ? AMBER : EMERALD} />
      </div>
      {((ops.proposalsDraft || 0) + (ops.proposalsSent || 0) + (ops.activeClients || 0)) > 0 && (
        <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t" style={{ borderColor: 'var(--border-default)' }}>
          <MetricBlock label="Proposals" value={(ops.proposalsDraft || 0) + (ops.proposalsSent || 0)} color={GOLD} sub="active" />
          <MetricBlock label="Clients" value={ops.activeClients || 0} color={EMERALD} sub="active" />
          <MetricBlock
            label="Contract"
            value={ops.contractValue > 0
              ? (ops.contractValue >= 1000 ? `${(ops.contractValue / 1000).toFixed(1)}k` : ops.contractValue)
              : '—'}
            color={TEAL}
          />
        </div>
      )}
      {((ops.projectedRevenue || 0) + (ops.receivedRevenue || 0)) > 0 && (
        <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t" style={{ borderColor: 'var(--border-default)' }}>
          <MetricBlock
            label="Pipeline"
            value={ops.projectedRevenue >= 1000 ? `$${(ops.projectedRevenue / 1000).toFixed(1)}k` : `$${ops.projectedRevenue || 0}`}
            color={SAPPHIRE}
            sub="projected"
          />
          <MetricBlock
            label="Weighted"
            value={ops.weightedForecast >= 1000 ? `$${(ops.weightedForecast / 1000).toFixed(1)}k` : `$${Math.round(ops.weightedForecast || 0)}`}
            color={GOLD}
          />
          <MetricBlock
            label="Received"
            value={ops.receivedRevenue >= 1000 ? `$${(ops.receivedRevenue / 1000).toFixed(1)}k` : `$${ops.receivedRevenue || 0}`}
            color={EMERALD}
          />
        </div>
      )}
      {ops.tasksFailed > 0 && (
        <div className="mt-2 rounded-sm px-3 py-2 flex items-center gap-2"
          style={{ background: `${CRIMSON}0a`, border: `1px solid ${CRIMSON}20` }}>
          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: CRIMSON }} />
          <span className="font-mono text-[9px]" style={{ color: CRIMSON }}>{ops.tasksFailed} failed task{ops.tasksFailed !== 1 ? 's' : ''} — see Needs Attention</span>
        </div>
      )}
    </motion.div>
  );
}

function ContentFactoryPanel({ cf }) {
  const hasVideoJobs = cf.videoJobsTotal > 0;
  return (
    <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4" style={{ borderColor: `${VIOLET}20` }}>
      <div className="font-mono text-[8px] tracking-[0.22em] uppercase mb-3" style={{ color: VIOLET }}>
        CONTENT FACTORY
      </div>
      <div className="grid grid-cols-2 gap-2">
        <MetricBlock label="Briefs Created"   value={cf.briefsCreated}       color={GOLD}    />
        <MetricBlock label="Active Workflows" value={cf.activeWorkflows}     color={SAPPHIRE} sub={`of ${cf.totalWorkflows} total`} />
        <MetricBlock label="Artifacts"        value={cf.artifactsGenerated}  color={VIOLET}  sub={`${cf.artifactWorkflows} workflow${cf.artifactWorkflows !== 1 ? 's' : ''}`} />
        <MetricBlock label="Prompt Packs"     value={cf.promptPacksGenerated} color={TEAL}   />
      </div>
      {hasVideoJobs && (
        <div className="mt-3 pt-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <div className="font-mono text-[7px] tracking-[0.18em] uppercase mb-2" style={{ color: AMBER }}>VIDEO PRODUCTION</div>
          <div className="grid grid-cols-2 gap-2">
            <MetricBlock label="Video Jobs"  value={cf.videoJobsTotal}    color={AMBER}    />
            <MetricBlock label="Pending"     value={cf.videoJobsPending}  color={AMBER}    sub="awaiting approval" />
            <MetricBlock label="Approved"    value={cf.videoJobsApproved} color={SAPPHIRE} />
            <MetricBlock label="Complete"    value={cf.videoJobsComplete} color={EMERALD}  />
          </div>
          {cf.videoJobsFailed > 0 && (
            <div className="mt-1.5 flex items-center gap-2 px-2 py-1 rounded-sm"
              style={{ background: `${CRIMSON}08`, border: `1px solid ${CRIMSON}20` }}>
              <span className="font-mono text-[7px]" style={{ color: CRIMSON }}>⚠ {cf.videoJobsFailed} video job{cf.videoJobsFailed !== 1 ? 's' : ''} failed</span>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

function EngineeringPanel({ eng, onNavigate }) {
  if (!eng) return null;
  const SAPPHIRE_ENG = '#3b82f6';
  return (
    <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4" style={{ borderColor: `${SAPPHIRE_ENG}20` }}>
      <div className="flex items-center justify-between mb-3">
        <div className="font-mono text-[8px] tracking-[0.22em] uppercase" style={{ color: SAPPHIRE_ENG }}>
          ENGINEERING INTELLIGENCE
        </div>
        {eng.pending > 0 && (
          <span className="font-mono text-[7px] px-1.5 py-0.5 rounded-sm"
            style={{ background: `${AMBER}15`, color: AMBER, border: `1px solid ${AMBER}30` }}>
            {eng.pending} running
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <MetricBlock label="Arch Reviews"     value={eng.architectureReviews}      color={SAPPHIRE_ENG} />
        <MetricBlock label="Bug Investigations" value={eng.bugInvestigations}       color={CRIMSON}      />
        <MetricBlock label="Code Reviews"     value={eng.codeReviews}              color={TEAL}         />
        <MetricBlock label="Recommendations"  value={eng.recommendationsGenerated} color={EMERALD}      sub="generated" />
      </div>
      {eng.total === 0 && (
        <button onClick={() => onNavigate?.('engineering-division')}
          className="w-full font-mono text-[7px] tracking-widest px-2 py-1.5 rounded-sm mt-1 transition-all"
          style={{ background: `${SAPPHIRE_ENG}08`, border: `1px solid ${SAPPHIRE_ENG}20`, color: `${SAPPHIRE_ENG}80` }}>
          → Open Engineering Division
        </button>
      )}
    </motion.div>
  );
}

function NeedsAttentionPanel({ items, onNavigate }) {
  if (items.length === 0) {
    return (
      <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4" style={{ borderColor: `${EMERALD}20` }}>
        <div className="font-mono text-[8px] tracking-[0.22em] uppercase mb-3" style={{ color: EMERALD }}>NEEDS ATTENTION</div>
        <div className="flex items-center gap-2 py-3">
          <div className="w-2 h-2 rounded-full" style={{ background: EMERALD, boxShadow: `0 0 8px ${EMERALD}` }} />
          <span className="font-mono text-[10px]" style={{ color: EMERALD }}>All systems nominal</span>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4" style={{ borderColor: `${CRIMSON}20` }}>
      <div className="flex items-center justify-between mb-3">
        <div className="font-mono text-[8px] tracking-[0.22em] uppercase" style={{ color: CRIMSON }}>NEEDS ATTENTION</div>
        <span className="font-mono text-[8px] px-1.5 py-0.5 rounded" style={{ background: `${CRIMSON}15`, color: CRIMSON }}>
          {items.length}
        </span>
      </div>
      <div className="space-y-2">
        {items.slice(0, 6).map((item, i) => {
          const col = SEVERITY_COLOR[item.severity] || AMBER;
          const bg  = SEVERITY_BG[item.severity]  || 'rgba(245,158,11,0.08)';
          return (
            <motion.div
              key={item.id || i}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.06 }}
              className="rounded-sm p-2.5"
              style={{ background: bg, border: `1px solid ${col}20` }}
            >
              <div className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0" style={{ background: col }} />
                <div className="min-w-0 flex-1">
                  <div className="font-ui text-[11px] font-medium leading-tight" style={{ color: 'var(--text-primary)' }}>
                    {item.title}
                  </div>
                  {item.detail && (
                    <div className="font-mono text-[8px] mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
                      {item.detail}
                    </div>
                  )}
                </div>
                <div className="font-mono text-[8px] flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                  {safeTs(item.ts)}
                </div>
              </div>
              {item.lane && (
                <div className="ml-3.5 mt-1">
                  <span
                    className="font-mono text-[7px] px-1.5 py-0.5 rounded"
                    style={{ background: `${LANE_COLORS[item.lane] || GOLD}15`, color: LANE_COLORS[item.lane] || GOLD }}
                  >
                    {item.lane}
                  </span>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

function QuickWinsPanel({ items, onNavigate }) {
  if (items.length === 0) {
    return (
      <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4" style={{ borderColor: `${GOLD}20` }}>
        <div className="font-mono text-[8px] tracking-[0.22em] uppercase mb-3" style={{ color: GOLD }}>QUICK WINS</div>
        <div className="flex items-center justify-center py-4">
          <span className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>No quick wins available yet</span>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4" style={{ borderColor: `${GOLD}20` }}>
      <div className="flex items-center justify-between mb-3">
        <div className="font-mono text-[8px] tracking-[0.22em] uppercase" style={{ color: GOLD }}>QUICK WINS</div>
        <span className="font-mono text-[8px] px-1.5 py-0.5 rounded" style={{ background: `${GOLD}15`, color: GOLD }}>
          {items.length}
        </span>
      </div>
      <div className="space-y-2">
        {items.slice(0, 5).map((item, i) => {
          const col = QUICK_WIN_COLOR[item.type] || GOLD;
          const icon = QUICK_WIN_ICON[item.type] || '✦';
          return (
            <motion.div
              key={item.id || i}
              initial={{ opacity: 0, x: 6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.06 }}
              className="rounded-sm p-2.5 cursor-default"
              style={{ background: `${col}06`, border: `1px solid ${col}18` }}
            >
              <div className="flex items-start gap-2">
                <span className="text-[10px] flex-shrink-0 mt-0.5" style={{ color: col }}>{icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-ui text-[11px] font-medium leading-tight" style={{ color: 'var(--text-primary)' }}>
                    {item.title}
                  </div>
                  {item.detail && (
                    <div className="font-mono text-[8px] mt-0.5 line-clamp-2" style={{ color: 'var(--text-muted)' }}>
                      {item.detail}
                    </div>
                  )}
                </div>
                <div className="font-mono text-[8px] flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                  {safeTs(item.ts)}
                </div>
              </div>
              {item.lane && (
                <div className="ml-4 mt-1">
                  <span
                    className="font-mono text-[7px] px-1.5 py-0.5 rounded"
                    style={{ background: `${LANE_COLORS[item.lane] || GOLD}15`, color: LANE_COLORS[item.lane] || GOLD }}
                  >
                    {item.lane}
                  </span>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

function ActivityFeed({ activity, loading }) {
  return (
    <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4" style={{ borderColor: `${SAPPHIRE}20` }}>
      <div className="font-mono text-[8px] tracking-[0.22em] uppercase mb-3" style={{ color: SAPPHIRE }}>
        RECENT AI ACTIVITY
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-6">
          <span className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>Loading…</span>
        </div>
      ) : activity.length === 0 ? (
        <div className="flex items-center justify-center py-6">
          <span className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>No recent activity</span>
        </div>
      ) : (
        <div className="space-y-0 divide-y" style={{ borderColor: 'var(--border-default)' }}>
          {activity.slice(0, 12).map((item, i) => {
            const col  = ACTIVITY_COLOR[item.type] || GOLD;
            const icon = ACTIVITY_ICON[item.type] || '◎';
            return (
              <motion.div
                key={`${item.type}-${item.ts}-${i}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.03 }}
                className="flex items-start gap-3 py-2.5"
              >
                <span className="font-mono text-[10px] flex-shrink-0 w-4 text-center mt-0.5" style={{ color: col }}>{icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-ui text-[11px] font-medium leading-snug" style={{ color: 'var(--text-primary)' }}>
                      {item.title}
                    </span>
                    <span className="font-mono text-[8px] flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                      {safeTs(item.ts)}
                    </span>
                  </div>
                  {item.detail && (
                    <div className="font-mono text-[8px] mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
                      {item.detail}
                    </div>
                  )}
                  {item.lane && (
                    <span
                      className="font-mono text-[7px] mt-1 inline-block px-1.5 py-0.5 rounded"
                      style={{ background: `${LANE_COLORS[item.lane] || GOLD}12`, color: LANE_COLORS[item.lane] || GOLD }}
                    >
                      {item.lane}
                    </span>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}

// ── Cost Panel ───────────────────────────────────────────────────────

function CostPanel({ ci }) {
  if (!ci) return null;
  const hasCosts = ci.estimatedCostToday > 0 || ci.estimatedCostMonth > 0 || ci.projectedCostMonth > 0;
  return (
    <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4" style={{ borderColor: `${GOLD}20` }}>
      <div className="font-mono text-[8px] tracking-[0.22em] uppercase mb-3" style={{ color: GOLD }}>
        COST INTELLIGENCE
      </div>
      <div className="grid grid-cols-3 gap-2">
        <MetricBlock
          label="Today"
          value={ci.estimatedCostToday > 0 ? `$${ci.estimatedCostToday.toFixed(3)}` : '$0'}
          color={ci.estimatedCostToday > 0.10 ? CRIMSON : ci.estimatedCostToday > 0 ? AMBER : EMERALD}
          sub="estimated" />
        <MetricBlock
          label="This Month"
          value={ci.estimatedCostMonth > 0 ? `$${ci.estimatedCostMonth.toFixed(3)}` : '$0'}
          color={ci.estimatedCostMonth > 1 ? CRIMSON : ci.estimatedCostMonth > 0 ? AMBER : EMERALD}
          sub="estimated" />
        <MetricBlock
          label="Projected"
          value={ci.projectedCostMonth > 0 ? `$${ci.projectedCostMonth.toFixed(2)}` : '$0'}
          color={VIOLET}
          sub="this month" />
      </div>
      {(ci.highestCostAgent || ci.highestCostAdapter) && (
        <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t" style={{ borderColor: 'var(--border-default)' }}>
          {ci.highestCostAgent && (
            <MetricBlock label="Top Agent" value={ci.highestCostAgent.displayName} color={AMBER} sub={`$${ci.highestCostAgent.estimatedCostTotal.toFixed(3)}`} />
          )}
          {ci.highestCostAdapter && (
            <MetricBlock label="Top Adapter" value={ci.highestCostAdapter.displayName} color={TEAL} sub={`$${ci.highestCostAdapter.estimatedCostTotal.toFixed(3)}`} />
          )}
        </div>
      )}
      {ci.alertCount > 0 && (
        <div className="mt-2 pt-2 border-t" style={{ borderColor: 'var(--border-default)' }}>
          <div className="rounded-sm px-2 py-1.5" style={{ background: `${AMBER}08`, border: `1px solid ${AMBER}20` }}>
            <span className="font-mono text-[7px]" style={{ color: AMBER }}>
              {ci.alertCount} cost alert{ci.alertCount !== 1 ? 's' : ''} — check Cost Intelligence dashboard
            </span>
          </div>
        </div>
      )}
      {!hasCosts && (
        <p className="font-mono text-[7px] mt-2" style={{ color: 'var(--text-muted)' }}>
          {ci.totalDispatches > 0 ? `${ci.totalDispatches} dispatches at ~$0 (free tier adapters active)` : 'No dispatch data yet.'}
        </p>
      )}
    </motion.div>
  );
}

// ── Main Component ───────────────────────────────────────────────────
export default function ExecutiveIntelligence() {
  const { setActiveSection } = useStore();

  const [briefing,  setBriefing]  = useState(null);
  const [activity,  setActivity]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [actLoading,setActLoading]= useState(true);
  const [refreshing,setRefreshing]= useState(false);
  const [lastRefresh,setLastRefresh] = useState(null);
  const [error,     setError]     = useState(null);

  const loadBriefing = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const [bRes, aRes] = await Promise.all([
        fetch('/api/executive/briefing'),
        fetch('/api/executive/activity?limit=20'),
      ]);
      if (bRes.ok) setBriefing(await bRes.json());
      if (aRes.ok) {
        const ad = await aRes.json();
        setActivity(ad.activity || []);
      }
      setLastRefresh(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setActLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial load + 60s auto-refresh
  useEffect(() => {
    loadBriefing();
    const id = setInterval(() => loadBriefing(true), 60_000);
    return () => clearInterval(id);
  }, [loadBriefing]);

  const overallHealthy = briefing
    ? Object.values(briefing.systemHealth).every(s => s.healthy !== false)
    : null;

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
            GENERATING EXECUTIVE BRIEFING
          </span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="panel-gold rounded-sm p-6 max-w-sm text-center" style={{ borderColor: `${CRIMSON}30` }}>
          <div className="font-mono text-[9px] tracking-widest mb-2" style={{ color: CRIMSON }}>BRIEFING ERROR</div>
          <p className="font-body text-sm" style={{ color: 'var(--text-muted)' }}>{error}</p>
          <button onClick={() => loadBriefing()} className="mt-4 font-mono text-[9px] tracking-widest px-4 py-2 rounded-sm transition-all"
            style={{ background: `${GOLD}15`, color: GOLD, border: `1px solid ${GOLD}30` }}>
            RETRY
          </button>
        </div>
      </div>
    );
  }

  const { systemHealth, workforce, operations, contentFactory, engineering, needsAttention, quickWins, costIntelligence } = briefing;

  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-4">

      {/* ── Header ── */}
      <motion.div variants={fadeIn} className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold leading-none" style={{ color: 'var(--text-primary)' }}>
            Executive Intelligence
          </h1>
          <p className="font-mono text-[9px] tracking-widest mt-1.5" style={{ color: 'var(--text-muted)' }}>
            CEO VIEW · MIKA AGENTIC OS
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>
              {safeTs(lastRefresh.toISOString())}
            </span>
          )}
          <div className="flex items-center gap-1.5">
            <div
              className="w-2 h-2 rounded-full"
              style={{
                background: overallHealthy ? EMERALD : AMBER,
                boxShadow: `0 0 6px ${overallHealthy ? EMERALD : AMBER}`,
              }}
            />
            <span className="font-mono text-[8px] tracking-wider" style={{ color: overallHealthy ? EMERALD : AMBER }}>
              {overallHealthy ? 'ALL SYSTEMS OK' : 'ATTENTION NEEDED'}
            </span>
          </div>
          <button
            onClick={() => loadBriefing(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm transition-all font-mono text-[9px] tracking-widest"
            style={{
              background: `${GOLD}0f`,
              border: `1px solid ${GOLD}25`,
              color: GOLD,
              opacity: refreshing ? 0.5 : 1,
            }}
          >
            {refreshing ? (
              <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}>↻</motion.span>
            ) : '↻'}
            REFRESH
          </button>
        </div>
      </motion.div>

      {/* ── Row 1: System Health + Workforce ── */}
      <div className="grid grid-cols-2 gap-4">
        <SystemHealthPanel health={systemHealth} />
        <WorkforcePanel workforce={workforce} />
      </div>

      {/* ── Row 2: Operations + Content Factory ── */}
      <div className="grid grid-cols-2 gap-4">
        <OperationsPanel ops={operations} />
        <ContentFactoryPanel cf={contentFactory} />
      </div>

      {/* ── Row 3: Engineering Intelligence ── */}
      {engineering && (
        <EngineeringPanel eng={engineering} onNavigate={setActiveSection} />
      )}

      {/* ── Row 4: Cost Intelligence ── */}
      {costIntelligence && <CostPanel ci={costIntelligence} />}

      {/* ── Row 4: Needs Attention + Quick Wins ── */}
      <div className="grid grid-cols-2 gap-4">
        <NeedsAttentionPanel items={needsAttention} onNavigate={setActiveSection} />
        <QuickWinsPanel items={quickWins} onNavigate={setActiveSection} />
      </div>

      {/* ── Row 4: Activity Feed ── */}
      <ActivityFeed activity={activity} loading={actLoading} />

    </motion.div>
  );
}
