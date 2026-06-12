import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../../lib/store';

// ── Design tokens ────────────────────────────────────────────────────
const GOLD     = '#c9a84c';
const TEAL     = '#0dd3c5';
const EMERALD  = '#10b981';
const SAPPHIRE = '#3b82f6';
const CRIMSON  = '#ef4444';
const AMBER    = '#f59e0b';
const VIOLET   = '#8b5cf6';

// Agent health (capitalised, from control-center API)
const HEALTH_COLOR = {
  'Available':          EMERALD,
  'Reachable':          TEAL,
  'Degraded':           AMBER,
  'Offline':            CRIMSON,
  'Staged':             SAPPHIRE,
  'Unknown':            '#6b7280',
};
// Adapter health (lowercase, from adapterHealth lib)
const ADAPTER_HEALTH_COLOR = {
  'healthy':              EMERALD,
  'warning':              AMBER,
  'offline':              CRIMSON,
  'misconfigured':        AMBER,
  'auth_failed':          CRIMSON,
  'rate_limited':         AMBER,
  'maintenance':          VIOLET,
  'staged':               SAPPHIRE,
};
const ADAPTER_HEALTH_LABEL = {
  'healthy':              'Healthy',
  'warning':              'Warning',
  'offline':              'Offline',
  'misconfigured':        'Misconfigured',
  'auth_failed':          'Auth Failed',
  'rate_limited':         'Rate Limited',
  'maintenance':          'Maintenance',
  'staged':               'Staged',
};
const STATUS_COLOR  = { active: EMERALD, staged: SAPPHIRE, inactive: CRIMSON, 'review-only': TEAL };
const DEPT_COLOR    = { OPERATIONS: GOLD, ENGINEERING: SAPPHIRE, CONTENT: VIOLET };

const ADAPTER_TIER_COLOR = { free: EMERALD, low: TEAL, medium: AMBER, high: CRIMSON, variable: VIOLET };
const AGENT_ICON = {
  'openclaw': '⬡', 'hermes': '⚡', 'claude-code': '◈', 'codex': '◎',
  'specialist-placeholder': '◳', 'trend-hunter': '◆', 'pattern-hunter': '◉',
  'hook-engineer': '⚡', 'creative-director': '◈', 'content-architect': '◳',
  'prompt-engineer': '⬟', 'visual-designer': '◆', 'video-producer': '▷',
  'voice-producer': '◉', 'editor': '◈', 'publisher': '◎', 'analytics-agent': '◈',
};
const ADAPTER_ICON = {
  'openclaw': '⬡', 'hermes': '⚡', 'claude-code': '◈', 'codex': '◎',
  'heygen': '▷', 'higgsfield': '▷', 'openart': '◆', 'wan': '▷', 'comfyui': '◈',
};

const stagger = { initial: {}, animate: { transition: { staggerChildren: 0.04 } } };
const fadeUp  = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0, transition: { duration: 0.22 } } };

// ── Helpers ──────────────────────────────────────────────────────────

function safeTs(ts) {
  if (!ts) return '—';
  try {
    const diff = Math.floor((Date.now() - new Date(ts)) / 60000);
    if (diff < 1)  return 'just now';
    if (diff < 60) return `${diff}m ago`;
    const h = Math.floor(diff / 60);
    if (h < 24) return `${h}h ago`;
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return '—'; }
}

function fmtCost(n) {
  if (n == null) return '—';
  if (n === 0)   return '$0';
  if (n < 0.01)  return `<$0.01`;
  return `$${n.toFixed(2)}`;
}

// ── Toast ────────────────────────────────────────────────────────────

function Toast({ msg, ok, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 3500); return () => clearTimeout(t); }, [onDone]);
  const col = ok ? EMERALD : CRIMSON;
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-sm font-mono text-[10px] tracking-wide shadow-xl max-w-xs"
      style={{ background: `${col}18`, border: `1px solid ${col}40`, color: col }}>
      {msg}
    </motion.div>
  );
}

// ── Overview card strip ──────────────────────────────────────────────

function MetStrip({ items }) {
  return (
    <div className="flex items-center gap-4 flex-wrap">
      {items.map(({ label, value, color }) => (
        <div key={label} className="flex items-center gap-2">
          <span className="font-mono text-lg font-bold leading-none" style={{ color }}>{value}</span>
          <span className="font-mono text-[8px] tracking-wider uppercase" style={{ color: 'var(--text-muted)' }}>{label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Health dot ───────────────────────────────────────────────────────

function HealthDot({ health, size = 8 }) {
  const color = HEALTH_COLOR[health] || GOLD;
  const glow  = ['Available', 'Reachable', 'Degraded'].includes(health);
  return (
    <div className="rounded-full flex-shrink-0"
      style={{ width: size, height: size, background: color,
        boxShadow: glow ? `0 0 5px ${color}` : undefined }} />
  );
}

// ── Adapter issues banner ─────────────────────────────────────────────

function AdapterIssuesBanner({ healthData }) {
  if (!healthData?.summary) return null;
  const { summary } = healthData;
  const issues = (healthData.adapters || []).filter(a =>
    a.health && !['healthy', 'staged', 'maintenance', null].includes(a.health)
  );
  const configuredButStaged = (healthData.adapters || []).filter(a => a.reason === 'configured_but_staged');

  if (issues.length === 0 && configuredButStaged.length === 0) return null;

  return (
    <motion.div variants={fadeUp} className="space-y-1.5">
      {issues.map(a => {
        const col = ADAPTER_HEALTH_COLOR[a.health] || GOLD;
        return (
          <div key={a.adapterId} className="flex items-center gap-3 px-4 py-2.5 rounded-sm"
            style={{ background: `${col}08`, border: `1px solid ${col}22` }}>
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: col, boxShadow: `0 0 4px ${col}` }} />
            <span className="font-mono text-[9px] font-semibold flex-shrink-0" style={{ color: col }}>
              {a.displayName}
            </span>
            <span className="font-mono text-[8px] px-1.5 py-0.5 rounded flex-shrink-0"
              style={{ background: `${col}12`, color: col }}>
              {ADAPTER_HEALTH_LABEL[a.health] || a.health}
            </span>
            {a.message && (
              <span className="font-mono text-[8px] truncate" style={{ color: 'var(--text-muted)' }} title={a.message}>
                {a.message.slice(0, 100)}
              </span>
            )}
            {a.checkedAt && (
              <span className="font-mono text-[7px] ml-auto flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                {safeTs(a.checkedAt)}
              </span>
            )}
          </div>
        );
      })}
      {configuredButStaged.map(a => (
        <div key={a.adapterId} className="flex items-center gap-3 px-4 py-2.5 rounded-sm"
          style={{ background: `${SAPPHIRE}08`, border: `1px solid ${SAPPHIRE}22` }}>
          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: SAPPHIRE, boxShadow: `0 0 4px ${SAPPHIRE}` }} />
          <span className="font-mono text-[9px] font-semibold flex-shrink-0" style={{ color: SAPPHIRE }}>{a.displayName}</span>
          <span className="font-mono text-[8px] px-1.5 py-0.5 rounded flex-shrink-0"
            style={{ background: `${SAPPHIRE}12`, color: SAPPHIRE }}>configured but staged</span>
          <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>
            Env vars set — change adapter status to active and implement execute()
          </span>
        </div>
      ))}
    </motion.div>
  );
}

// ── Agent row ────────────────────────────────────────────────────────

function AgentRow({ agent, onSelect, onToggle, actioning }) {
  const healthCol = HEALTH_COLOR[agent.health] || GOLD;
  const statusCol = STATUS_COLOR[agent.status] || GOLD;
  const deptCol   = DEPT_COLOR[agent.department] || GOLD;
  const isActioning = actioning === agent.id;

  return (
    <motion.div
      variants={fadeUp}
      onClick={() => onSelect(agent)}
      className="flex items-center gap-2.5 px-4 py-2.5 cursor-pointer transition-all border-b select-none"
      style={{ borderColor: 'var(--border-default)' }}
      whileHover={{ background: 'rgba(201,168,76,0.03)' }}
    >
      {/* Health bar */}
      <div className="w-0.5 h-7 rounded-full flex-shrink-0" style={{ background: healthCol, boxShadow: ['Available', 'Reachable'].includes(agent.health) ? `0 0 6px ${healthCol}` : undefined }} />

      {/* Icon */}
      <div className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center"
        style={{ background: `${deptCol}12`, border: `1px solid ${deptCol}28` }}>
        <span style={{ fontSize: 10, color: deptCol }}>{AGENT_ICON[agent.id] || '◎'}</span>
      </div>

      {/* Name + role */}
      <div className="flex-1 min-w-0">
        <div className="font-ui text-[11px] font-semibold leading-tight truncate" style={{ color: 'var(--text-primary)' }}>
          {agent.displayName}
        </div>
        <div className="font-mono text-[8px] truncate" style={{ color: 'var(--text-muted)' }}>{agent.role}</div>
      </div>

      {/* Dept */}
      <span className="font-mono text-[7px] px-1.5 py-0.5 rounded flex-shrink-0 hidden md:block"
        style={{ color: deptCol, background: `${deptCol}10` }}>{agent.department}</span>

      {/* Adapter */}
      <span className="font-mono text-[7px] px-1.5 py-0.5 rounded flex-shrink-0"
        style={{ color: GOLD, background: `${GOLD}0d`, border: `1px solid ${GOLD}20` }}>
        {agent.adapterId || '—'}
      </span>

      {/* Status */}
      <span className="font-mono text-[7px] px-1.5 py-0.5 rounded flex-shrink-0"
        style={{ color: statusCol, background: `${statusCol}10` }}>{agent.status}</span>

      {/* Runtime evidence dot */}
      <div className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ background: agent.liveConnected ? EMERALD : '#4b5563', boxShadow: agent.liveConnected ? `0 0 5px ${EMERALD}` : undefined }} />

      {/* Mode */}
      <span className="font-mono text-[7px] w-20 truncate flex-shrink-0 hidden lg:block" style={{ color: 'var(--text-muted)' }}>
        {agent.executionMode}
      </span>

      {/* Dispatches */}
      <span className="font-mono text-[9px] w-8 text-center flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>
        {agent.dispatchCount || 0}
      </span>

      {/* Health label */}
      <span className="font-mono text-[7px] w-16 text-right flex-shrink-0" style={{ color: healthCol }}>
        {agent.health}
      </span>

      {/* Controls */}
      <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
        {agent.status === 'active' && !agent.override?.maintenance && (
          <button
            onClick={() => onToggle(agent.id, agent.override?.disabled ? 'enable' : 'disable')}
            disabled={isActioning}
            className="font-mono text-[7px] px-2 py-1 rounded-sm transition-all"
            style={{
              background: agent.override?.disabled ? `${EMERALD}12` : `${CRIMSON}08`,
              border:     `1px solid ${agent.override?.disabled ? EMERALD : CRIMSON}25`,
              color:      agent.override?.disabled ? EMERALD : CRIMSON,
              opacity:    isActioning ? 0.5 : 1,
            }}>
            {agent.override?.disabled ? 'Enable' : 'Disable'}
          </button>
        )}
        <button
          onClick={() => onToggle(agent.id, agent.override?.maintenance ? 'maintenance-off' : 'maintenance-on')}
          disabled={isActioning}
          className="font-mono text-[7px] px-2 py-1 rounded-sm transition-all"
          style={{ background: `${VIOLET}08`, border: `1px solid ${VIOLET}22`, color: VIOLET, opacity: isActioning ? 0.5 : 1 }}>
          {agent.override?.maintenance ? 'Resume' : 'Maint'}
        </button>
      </div>
    </motion.div>
  );
}

// ── Adapter row ──────────────────────────────────────────────────────

function AdapterRow({ adapter, onMaintenance, onRunCheck, actioning }) {
  const health    = adapter.healthInfo?.health || null;
  const healthCol = health ? (ADAPTER_HEALTH_COLOR[health] || GOLD) : (adapter.inMaintenance ? VIOLET : '#6b7280');
  const barCol    = healthCol;
  const icon      = ADAPTER_ICON[adapter.adapterId] || '◎';
  const taskCount = adapter.supportedTaskTypes?.length || 0;
  const isActioning = actioning === adapter.adapterId;
  const hi        = adapter.healthInfo;

  return (
    <div className="border-b" style={{ borderColor: 'var(--border-default)' }}>
      <div className="flex items-center gap-3 px-4 py-2.5 transition-all"
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(201,168,76,0.02)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        {/* Health/status bar */}
        <div className="w-0.5 h-7 rounded-full flex-shrink-0"
          style={{ background: barCol, boxShadow: health === 'healthy' ? `0 0 6px ${barCol}` : undefined }} />

        {/* Icon */}
        <div className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center"
          style={{ background: `${barCol}12`, border: `1px solid ${barCol}28` }}>
          <span style={{ fontSize: 10, color: barCol }}>{icon}</span>
        </div>

        {/* Name + id */}
        <div className="flex-1 min-w-0">
          <div className="font-ui text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            {adapter.displayName}
          </div>
          <div className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>{adapter.adapterId}</div>
        </div>

        {/* Adapter status */}
        <span className="font-mono text-[7px] px-1.5 py-0.5 rounded flex-shrink-0"
          style={{ color: adapter.status === 'active' ? EMERALD : SAPPHIRE, background: `${adapter.status === 'active' ? EMERALD : SAPPHIRE}10` }}>
          {adapter.inMaintenance ? 'maintenance' : adapter.status}
        </span>

        {/* Health badge */}
        {health ? (
          <span className="font-mono text-[7px] px-1.5 py-0.5 rounded flex-shrink-0"
            style={{ color: healthCol, background: `${healthCol}12`, border: `1px solid ${healthCol}25` }}>
            {ADAPTER_HEALTH_LABEL[health] || health}
          </span>
        ) : (
          <span className="font-mono text-[7px] px-1.5 py-0.5 rounded flex-shrink-0"
            style={{ color: 'var(--text-muted)', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-default)' }}>
            not checked
          </span>
        )}

        {/* Latency */}
        {hi?.latencyMs != null && hi.health === 'healthy' && (
          <span className="font-mono text-[7px] flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{hi.latencyMs}ms</span>
        )}

        {/* Task types count */}
        <span className="font-mono text-[8px] flex-shrink-0 hidden md:inline" style={{ color: 'var(--text-muted)' }}>
          {taskCount} type{taskCount !== 1 ? 's' : ''}
        </span>

        {/* Task type pills */}
        <div className="flex gap-1 flex-wrap max-w-[180px] hidden xl:flex">
          {adapter.supportedTaskTypes?.slice(0, 3).map(t => (
            <span key={t} className="font-mono text-[6px] px-1 py-0.5 rounded"
              style={{ background: `${GOLD}08`, color: 'var(--text-muted)', border: `1px solid ${GOLD}15` }}>
              {t}
            </span>
          ))}
          {taskCount > 3 && (
            <span className="font-mono text-[6px]" style={{ color: 'var(--text-muted)' }}>+{taskCount - 3}</span>
          )}
        </div>

        {/* Last checked */}
        <span className="font-mono text-[7px] flex-shrink-0 hidden lg:inline" style={{ color: 'var(--text-muted)' }}>
          {hi?.checkedAt ? safeTs(hi.checkedAt) : '—'}
        </span>

        {/* Controls */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => onRunCheck(adapter.adapterId)}
            disabled={isActioning}
            className="font-mono text-[7px] px-2 py-1 rounded-sm transition-all"
            style={{ background: `${TEAL}08`, border: `1px solid ${TEAL}22`, color: TEAL, opacity: isActioning ? 0.5 : 1 }}>
            {isActioning ? '…' : 'Check'}
          </button>
          <button
            onClick={() => onMaintenance(adapter.adapterId, !adapter.inMaintenance)}
            disabled={isActioning}
            className="font-mono text-[7px] px-2 py-1 rounded-sm transition-all"
            style={{ background: `${VIOLET}08`, border: `1px solid ${VIOLET}22`, color: VIOLET, opacity: isActioning ? 0.5 : 1 }}>
            {adapter.inMaintenance ? 'Clear' : 'Maint'}
          </button>
        </div>
      </div>

      {/* Sub-row: env vars missing for staged adapters */}
      {hi?.envVarsMissing?.length > 0 && (
        <div className="px-4 pb-2.5 flex items-start gap-2">
          <span className="font-mono text-[7px] tracking-wider flex-shrink-0 mt-0.5" style={{ color: AMBER }}>MISSING:</span>
          <div className="flex flex-wrap gap-1">
            {hi.envVarsMissing.map(v => (
              <span key={v} className="font-mono text-[7px] px-1.5 py-0.5 rounded"
                style={{ background: `${AMBER}08`, color: AMBER, border: `1px solid ${AMBER}20` }}>
                {v}
              </span>
            ))}
          </div>
          {hi.activationNote && (
            <span className="font-mono text-[7px] ml-1" style={{ color: 'var(--text-muted)' }}>— {hi.activationNote}</span>
          )}
        </div>
      )}

      {/* Sub-row: health message for non-healthy active adapters */}
      {hi?.message && hi.health && !['healthy', 'staged'].includes(hi.health) && !hi.envVarsMissing?.length && (
        <div className="px-4 pb-2.5">
          <span className="font-mono text-[7px]" style={{ color: ADAPTER_HEALTH_COLOR[hi.health] || GOLD }}>
            {hi.message.slice(0, 120)}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Cost Preview panel ────────────────────────────────────────────────

function CostPreview({ costEstimate, adapters, adapterCostData }) {
  if (!costEstimate) return null;

  // Build cost lookup from /api/cost/adapters data
  const costMap = {};
  for (const ac of (adapterCostData || [])) costMap[ac.adapterId] = ac;

  const TIER_COL = { free: EMERALD, low: TEAL, medium: AMBER, high: CRIMSON, variable: VIOLET };

  return (
    <div className="panel-gold rounded-sm p-4 mt-4" style={{ borderColor: `${GOLD}20` }}>
      <div className="font-mono text-[8px] tracking-[0.22em] uppercase mb-3" style={{ color: GOLD }}>
        COST INTELLIGENCE — ESTIMATES ONLY
      </div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="text-center rounded-sm p-3" style={{ background: `${SAPPHIRE}08`, border: `1px solid ${SAPPHIRE}18` }}>
          <div className="font-mono text-xl font-bold" style={{ color: SAPPHIRE }}>{costEstimate.dispatchedToday}</div>
          <div className="font-mono text-[7px] tracking-widest uppercase mt-1" style={{ color: 'var(--text-muted)' }}>Today</div>
        </div>
        <div className="text-center rounded-sm p-3" style={{ background: `${GOLD}08`, border: `1px solid ${GOLD}18` }}>
          <div className="font-mono text-xl font-bold" style={{ color: GOLD }}>{fmtCost(costEstimate.estimatedDailyCost)}</div>
          <div className="font-mono text-[7px] tracking-widest uppercase mt-1" style={{ color: 'var(--text-muted)' }}>Est. Today</div>
        </div>
        <div className="text-center rounded-sm p-3" style={{ background: `${TEAL}08`, border: `1px solid ${TEAL}18` }}>
          <div className="font-mono text-xl font-bold" style={{ color: TEAL }}>{fmtCost(costEstimate.estimatedMonthlyCost)}</div>
          <div className="font-mono text-[7px] tracking-widest uppercase mt-1" style={{ color: 'var(--text-muted)' }}>Est. Month</div>
        </div>
      </div>
      {/* Per-adapter breakdown with real cost data */}
      <div className="space-y-1">
        {adapters?.map(a => {
          const cd      = costMap[a.adapterId];
          const tier    = cd?.tier || (a.status === 'active' ? (a.adapterId === 'hermes' ? 'free' : 'low') : 'staged');
          const tierCol = TIER_COL[tier] || GOLD;
          const allTime = cd?.estimatedCostTotal;
          const projMo  = cd?.projectedMonthlyCost;
          const perDisp = cd?.perDispatch;
          return (
            <div key={a.adapterId} className="flex items-center justify-between py-1 border-b" style={{ borderColor: 'var(--border-default)' }}>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[7px] px-1 py-0.5 rounded uppercase"
                  style={{ background: `${tierCol}10`, color: tierCol }}>{tier}</span>
                <span className="font-mono text-[9px]" style={{ color: 'var(--text-primary)' }}>{a.displayName}</span>
              </div>
              <div className="flex items-center gap-4 text-right">
                {cd && (
                  <>
                    <span className="font-mono text-[7px]" style={{ color: 'var(--text-muted)' }}>
                      {cd.totalDispatches} exec
                    </span>
                    <span className="font-mono text-[8px]" style={{ color: allTime > 0 ? AMBER : 'var(--text-muted)' }}>
                      {allTime > 0 ? `$${allTime.toFixed(3)}` : '$0'}
                    </span>
                    <span className="font-mono text-[7px]" style={{ color: 'var(--text-muted)' }}>
                      {perDisp > 0 ? `$${perDisp}/ea` : a.status === 'staged' ? 'staged' : 'free'}
                    </span>
                  </>
                )}
                {!cd && (
                  <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>
                    {a.status === 'active' ? (a.adapterId === 'hermes' ? 'free (VPS)' : '~$0.013/ea') : 'staged'}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="font-mono text-[7px] mt-3 pt-2 border-t" style={{ color: 'var(--text-muted)', borderColor: 'var(--border-default)' }}>
        {costEstimate.note} · Full breakdown in Cost Intelligence →
      </p>
    </div>
  );
}

// ── Detail Drawer ─────────────────────────────────────────────────────

function DetailDrawer({ agent, onClose, onToggle, actioning, agentCost, onGoToActivation }) {
  const healthCol = HEALTH_COLOR[agent.health] || GOLD;
  const deptCol   = DEPT_COLOR[agent.department] || GOLD;
  const isActioning = actioning === agent.id;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-30" onClick={onClose} style={{ background: 'rgba(0,0,0,0.3)' }} />

      {/* Drawer */}
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 220 }}
        className="fixed right-0 top-0 h-full z-40 overflow-y-auto"
        style={{ width: 380, background: 'var(--bg-sidebar)', borderLeft: '1px solid var(--border-default)', boxShadow: '-8px 0 32px rgba(0,0,0,0.3)' }}
      >
        {/* Header */}
        <div className="sticky top-0 px-5 py-4 border-b flex items-start justify-between"
          style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-default)', zIndex: 1 }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full flex items-center justify-center"
              style={{ background: `${deptCol}15`, border: `1px solid ${deptCol}35` }}>
              <span style={{ fontSize: 16, color: deptCol }}>{AGENT_ICON[agent.id] || '◎'}</span>
            </div>
            <div>
              <div className="font-ui text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{agent.displayName}</div>
              <div className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>{agent.department} · {agent.id}</div>
            </div>
          </div>
          <button onClick={onClose} className="font-mono text-lg mt-0.5" style={{ color: 'var(--text-muted)' }}>×</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Health + status */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm"
              style={{ background: `${healthCol}12`, border: `1px solid ${healthCol}28` }}>
              <HealthDot health={agent.health} size={7} />
              <span className="font-mono text-[9px]" style={{ color: healthCol }}>{agent.health}</span>
            </div>
            <span className="font-mono text-[8px] px-2 py-1 rounded-sm"
              style={{ background: `${STATUS_COLOR[agent.status] || GOLD}10`, color: STATUS_COLOR[agent.status] || GOLD }}>
              {agent.status}
            </span>
            {agent.liveConnected && (
              <span className="font-mono text-[8px] px-2 py-1 rounded-sm flex items-center gap-1"
                style={{ background: `${EMERALD}10`, color: EMERALD }}>
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: EMERALD, boxShadow: `0 0 4px ${EMERALD}` }} />
                Runtime verified
              </span>
            )}
          </div>

          {/* Read-only review notice */}
          {agent.engineeringMode === 'read-only-review' && (
            <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-sm"
              style={{ background: `${TEAL}08`, border: `1px solid ${TEAL}28` }}>
              <span className="text-[10px] flex-shrink-0 mt-0.5" style={{ color: TEAL }}>◈</span>
              <div>
                <div className="font-mono text-[8px] font-semibold mb-0.5" style={{ color: TEAL }}>READ-ONLY REVIEW MODE</div>
                <p className="font-mono text-[7px] leading-relaxed" style={{ color: `${TEAL}cc` }}>
                  Claude Code can inspect and review files in read-only mode. It cannot write files, run shell commands, or implement changes inside Mission Control.
                </p>
              </div>
            </div>
          )}

          {/* Warnings */}
          {agent.warnings?.length > 0 && (
            <div className="space-y-1">
              {agent.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-sm"
                  style={{ background: `${AMBER}08`, border: `1px solid ${AMBER}20` }}>
                  <span className="text-[9px] mt-0.5 flex-shrink-0" style={{ color: AMBER }}>⚠</span>
                  <span className="font-mono text-[8px]" style={{ color: AMBER }}>{w}</span>
                </div>
              ))}
            </div>
          )}

          {/* Registry data */}
          <Section title="REGISTRY" color={GOLD}>
            <DataRow label="Role"           value={agent.role} />
            <DataRow label="Execution Mode" value={agent.executionMode} />
            <DataRow label="System Type"    value={agent.systemType} />
            <DataRow label="System ID"      value={agent.systemId} />
            <DataRow label="Declared Status" value={agent.declaredStatus || agent.status} />
            <DataRow label="Configuration" value={agent.configurationStatus || 'declared'} />
            <DataRow label="Runtime Status" value={agent.runtimeStatus || 'unknown'} valueColor={healthCol} />
            <DataRow label="Runtime Verified" value={agent.liveConnected ? 'Yes' : 'No'} valueColor={agent.liveConnected ? EMERALD : AMBER} />
            <DataRow label="Evidence Checked" value={safeTs(agent.runtimeEvidence?.checkedAt)} />
            <DataRow label="Requires Approval" value={agent.requiresApproval ? 'Yes' : 'No'} />
            {agent.engineeringMode && (
              <DataRow label="Engineering Mode" value={agent.engineeringMode} valueColor={TEAL} />
            )}
            {agent.canWriteFiles === false && (
              <DataRow label="Write Files" value="NO — enforced" valueColor={EMERALD} />
            )}
            {agent.canRunShell === false && (
              <DataRow label="Run Shell" value="NO — enforced" valueColor={EMERALD} />
            )}
          </Section>

          {/* Adapter info */}
          <Section title="ADAPTER" color={TEAL}>
            <DataRow label="Adapter ID" value={agent.adapterId || '—'} />
            {agent.adapterInfo && <>
              <DataRow label="Adapter Status" value={agent.adapterInfo.status} valueColor={STATUS_COLOR[agent.adapterInfo.status] || GOLD} />
              <DataRow label="Is Active"      value={agent.adapterInfo.isActive ? 'Yes' : 'No'} valueColor={agent.adapterInfo.isActive ? EMERALD : CRIMSON} />
              <DataRow label="Is Staged"      value={agent.adapterInfo.isStaged ? 'Yes' : 'No'} />
            </>}
          </Section>

          {/* Governance */}
          <Section title="GOVERNANCE" color={VIOLET}>
            <DataRow label="Approval Required"  value={agent.requiresApproval ? 'Yes — all dispatches queued' : 'No — can auto-dispatch'} />
            <DataRow label="Staged Guard"        value={agent.status === 'staged' ? 'Blocked — not executable' : 'Not staged'} valueColor={agent.status === 'staged' ? AMBER : EMERALD} />
            <DataRow label="Dispatch Route"      value="Registry → Adapter → Dispatch → Execution" />
            <DataRow label="Autonomous Execution" value="Never — always queue + approval" valueColor={EMERALD} />
          </Section>

          {/* Dispatch stats */}
          <Section title="DISPATCH STATS" color={SAPPHIRE}>
            <DataRow label="Total Dispatches" value={String(agent.dispatchCount || 0)} />
            <DataRow label="Failures"         value={String(agent.failedCount || 0)} valueColor={agent.failedCount > 0 ? CRIMSON : EMERALD} />
            <DataRow label="Failure Rate"     value={`${agent.failureRate || 0}%`} valueColor={agent.failureRate > 30 ? CRIMSON : agent.failureRate > 0 ? AMBER : EMERALD} />
            <DataRow label="Last Dispatch"    value={safeTs(agent.lastDispatch?.timestamp)} />
            {agentCost && <>
              <DataRow label="Est. Cost (all-time)" value={agentCost.estimatedCostTotal > 0 ? `$${agentCost.estimatedCostTotal.toFixed(4)}` : '$0'} valueColor={agentCost.estimatedCostTotal > 0.05 ? AMBER : EMERALD} />
              <DataRow label="Est. Cost (30-day)"   value={agentCost.estimatedCostMonth > 0  ? `$${agentCost.estimatedCostMonth.toFixed(4)}`  : '$0'} valueColor={agentCost.estimatedCostMonth > 0 ? AMBER : EMERALD} />
              <DataRow label="Avg Cost/Dispatch"    value={agentCost.avgCostPerDispatch > 0  ? `$${agentCost.avgCostPerDispatch.toFixed(4)}`  : '$0 (free adapter)'} />
            </>}
          </Section>

          {/* Allowed task types */}
          <Section title="ALLOWED TASK TYPES" color={EMERALD}>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {agent.allowedTaskTypes?.map(t => (
                <span key={t} className="font-mono text-[7px] px-1.5 py-0.5 rounded"
                  style={{ background: `${EMERALD}08`, color: EMERALD, border: `1px solid ${EMERALD}18` }}>
                  {t}
                </span>
              ))}
              {!agent.allowedTaskTypes?.length && (
                <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>None specified</span>
              )}
            </div>
          </Section>

          {/* Activation path (staged only) */}
          {agent.status === 'staged' && (
            <Section title="ACTIVATION PATH" color={SAPPHIRE}>
              <div className="font-mono text-[8px] space-y-1.5" style={{ color: 'var(--text-muted)' }}>
                <p>1. Set required env vars for the provider adapter</p>
                <p>2. Run preflight check in Activation Gate</p>
                <p>3. Submit activation request → approve in REQUESTS tab</p>
                <p>4. Agent becomes executable after approval</p>
              </div>
              {onGoToActivation && (
                <button
                  onClick={onGoToActivation}
                  className="w-full mt-2 font-mono text-[9px] py-1.5 rounded-sm transition-all"
                  style={{ background: `${SAPPHIRE}14`, border: `1px solid ${SAPPHIRE}30`, color: SAPPHIRE }}>
                  → OPEN ACTIVATION GATE
                </button>
              )}
            </Section>
          )}

          {/* Controls */}
          <div className="pt-2 border-t space-y-2" style={{ borderColor: 'var(--border-default)' }}>
            <div className="font-mono text-[8px] tracking-[0.2em] uppercase mb-2" style={{ color: 'var(--text-muted)' }}>CONTROLS</div>

            {agent.status === 'staged' && (
              <div className="rounded-sm px-3 py-2.5" style={{ background: `${AMBER}08`, border: `1px solid ${AMBER}20` }}>
                <p className="font-mono text-[8px]" style={{ color: AMBER }}>
                  Staged agents are activated via the Activation Gate — preflight, request, and approve.
                </p>
              </div>
            )}

            <div className="flex gap-2">
              {agent.status === 'active' && !agent.override?.maintenance && (
                <button
                  onClick={() => onToggle(agent.id, agent.override?.disabled ? 'enable' : 'disable')}
                  disabled={isActioning}
                  className="flex-1 py-2 font-mono text-[8px] tracking-wider rounded-sm transition-all"
                  style={{
                    background: agent.override?.disabled ? `${EMERALD}15` : `${CRIMSON}10`,
                    border:     `1px solid ${agent.override?.disabled ? EMERALD : CRIMSON}30`,
                    color:      agent.override?.disabled ? EMERALD : CRIMSON,
                    opacity:    isActioning ? 0.5 : 1,
                  }}>
                  {agent.override?.disabled ? '✓ ENABLE AGENT' : '⊘ DISABLE AGENT'}
                </button>
              )}
              <button
                onClick={() => onToggle(agent.id, agent.override?.maintenance ? 'maintenance-off' : 'maintenance-on')}
                disabled={isActioning}
                className="flex-1 py-2 font-mono text-[8px] tracking-wider rounded-sm transition-all"
                style={{ background: `${VIOLET}12`, border: `1px solid ${VIOLET}30`, color: VIOLET, opacity: isActioning ? 0.5 : 1 }}>
                {agent.override?.maintenance ? 'CLEAR MAINTENANCE' : '⚙ SET MAINTENANCE'}
              </button>
            </div>

            {/* Governance note */}
            <p className="font-mono text-[7px] mt-1" style={{ color: 'var(--text-muted)' }}>
              Controls affect operational status only. Governance, dispatch, and approval rules are not modified.
            </p>
          </div>
        </div>
      </motion.div>
    </>
  );
}

function Section({ title, color, children }) {
  return (
    <div className="rounded-sm p-3" style={{ background: `${color}05`, border: `1px solid ${color}18` }}>
      <div className="font-mono text-[7px] tracking-[0.2em] uppercase mb-2" style={{ color }}>{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function DataRow({ label, value, valueColor }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="font-mono text-[8px] flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="font-mono text-[8px] text-right" style={{ color: valueColor || 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────

const AGENT_FILTER_TABS = [
  { key: 'all',         label: 'All' },
  { key: 'available',   label: 'Available' },
  { key: 'staged',      label: 'Staged' },
  { key: 'degraded',    label: 'Degraded' },
  { key: 'offline',     label: 'Offline' },
  { key: 'unknown',     label: 'Unknown' },
  { key: 'maintenance', label: 'Maintenance' },
];

const DEPT_FILTER_TABS = [
  { key: 'all',         label: 'All Depts' },
  { key: 'OPERATIONS',  label: 'Operations' },
  { key: 'ENGINEERING', label: 'Engineering' },
  { key: 'CONTENT',     label: 'Content' },
];

const ADAPTER_FILTER_TABS = [
  { key: 'all',         label: 'All' },
  { key: 'active',      label: 'Active' },
  { key: 'staged',      label: 'Staged' },
  { key: 'maintenance', label: 'Maintenance' },
];

export default function AgentControlCenter({ initialTab = 'agents' }) {
  const { setActiveSection } = useStore();
  const [data,          setData]          = useState(null);
  const [healthData,    setHealthData]    = useState(null);
  const [costData,      setCostData]      = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [healthLoading, setHealthLoading] = useState(false);
  const [tab,           setTab]           = useState(initialTab);
  const [agentFilter,   setAgentFilter]   = useState('all');
  const [deptFilter,    setDeptFilter]    = useState('all');
  const [adapterFilter, setAdapterFilter] = useState('all');
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [actioning,     setActioning]     = useState(null);
  const [toast,         setToast]         = useState(null);

  const showToast = (msg, ok = true) => setToast({ msg, ok });

  const loadHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/adapters/health');
      if (res.ok) setHealthData(await res.json());
    } catch {}
  }, []);

  const loadCost = useCallback(async () => {
    try {
      const [ar, acr] = await Promise.all([
        fetch('/api/cost/agents'),
        fetch('/api/cost/adapters'),
      ]);
      const agentCost   = ar.ok   ? await ar.json()  : null;
      const adapterCost = acr.ok  ? await acr.json() : null;
      setCostData({ agents: agentCost?.agents || [], adapters: adapterCost?.adapters || [] });
    } catch {}
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [ccRes] = await Promise.all([
        fetch('/api/agents/control-center'),
        loadHealth(),
        loadCost(),
      ]);
      if (ccRes.ok) setData(await ccRes.json());
    } catch {}
    finally { setLoading(false); }
  }, [loadHealth, loadCost]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(() => { load(true); }, 60_000);
    return () => clearInterval(id);
  }, [load]);

  // Run health checks (all or single adapter)
  const runHealthCheck = async (adapterId = null) => {
    setHealthLoading(true);
    try {
      const res = await fetch('/api/adapters/health/check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(adapterId ? { adapterId } : {}),
      });
      if (res.ok) {
        const d = await res.json();
        showToast(adapterId
          ? `${adapterId}: ${d.results[0]?.health || 'checked'}`
          : `All adapters checked — ${d.summary.healthy} healthy, ${d.summary.failed} failed`
        );
        await Promise.all([loadHealth(), load(true)]);
      } else {
        showToast('Health check failed.', false);
      }
    } catch { showToast('Health check failed.', false); }
    finally { setHealthLoading(false); }
  };

  const handleToggle = async (agentId, action) => {
    setActioning(agentId);
    try {
      const res = await fetch('/api/agents/toggle', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, action }),
      });
      const d = await res.json();
      if (res.ok) {
        showToast(`${action} applied to ${agentId}.`);
        load(true);
        if (selectedAgent?.id === agentId) setSelectedAgent(a => ({ ...a, override: d.override }));
      } else {
        showToast(d.error || 'Toggle failed.', false);
      }
    } catch { showToast('Toggle failed.', false); }
    finally { setActioning(null); }
  };

  const handleMaintenance = async (adapterId, maintenance) => {
    setActioning(adapterId);
    try {
      const res = await fetch('/api/adapters/maintenance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adapterId, maintenance }),
      });
      if (res.ok) { showToast(`${adapterId} maintenance ${maintenance ? 'set' : 'cleared'}.`); load(true); }
      else showToast('Maintenance update failed.', false);
    } catch { showToast('Maintenance update failed.', false); }
    finally { setActioning(null); }
  };

  // Cost lookup maps
  const agentCostMap   = Object.fromEntries((costData?.agents   || []).map(a => [a.agentId,   a]));
  const adapterCostMap = Object.fromEntries((costData?.adapters || []).map(a => [a.adapterId, a]));

  // Merge health data into adapters
  const enrichedAdapters = (data?.adapters || []).map(a => {
    const healthMap = {};
    for (const h of (healthData?.adapters || [])) {
      if (h.adapterId) healthMap[h.adapterId] = h;
    }
    return { ...a, healthInfo: healthMap[a.adapterId] || null };
  });

  // Filtered agents
  const filteredAgents = (data?.agents || []).filter(a => {
    const statusMatch = agentFilter === 'all'
      || (agentFilter === 'available'   && ['available', 'reachable'].includes(a.runtimeStatus))
      || (agentFilter === 'staged'      && a.runtimeStatus === 'staged')
      || (agentFilter === 'degraded'    && a.runtimeStatus === 'degraded')
      || (agentFilter === 'offline'     && a.runtimeStatus === 'offline')
      || (agentFilter === 'unknown'     && a.runtimeStatus === 'unknown')
      || (agentFilter === 'maintenance' && a.runtimeEvidence?.reason === 'maintenance');
    const deptMatch = deptFilter === 'all' || a.department === deptFilter;
    return statusMatch && deptMatch;
  });

  const filteredAdapters = enrichedAdapters.filter(a =>
    adapterFilter === 'all'
    || (adapterFilter === 'active'      && a.status === 'active' && !a.inMaintenance)
    || (adapterFilter === 'staged'      && a.status === 'staged')
    || (adapterFilter === 'maintenance' && a.inMaintenance)
  );

  if (loading) return (
    <div className="flex items-center justify-center py-32">
      <div className="flex flex-col items-center gap-3">
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
          className="w-6 h-6 rounded-full"
          style={{ border: '2px solid var(--border-default)', borderTopColor: GOLD }} />
        <span className="font-mono text-[9px] tracking-widest" style={{ color: 'var(--text-muted)' }}>
          LOADING AGENT CONTROL CENTER
        </span>
      </div>
    </div>
  );

  const { summary, adapterSummary, costEstimate } = data || {};

  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-4">
      <AnimatePresence>
        {toast && <Toast msg={toast.msg} ok={toast.ok} onDone={() => setToast(null)} />}
        {selectedAgent && (
          <DetailDrawer
            agent={selectedAgent}
            onClose={() => setSelectedAgent(null)}
            onToggle={handleToggle}
            actioning={actioning}
            agentCost={agentCostMap[selectedAgent.id] || null}
            onGoToActivation={() => { setSelectedAgent(null); setActiveSection('activation-gate'); }}
          />
        )}
      </AnimatePresence>

      {/* ── Header ── */}
      <motion.div variants={fadeUp} className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold leading-none" style={{ color: 'var(--text-primary)' }}>
            Agent Control Center
          </h1>
          <p className="font-mono text-[9px] tracking-widest mt-1.5" style={{ color: 'var(--text-muted)' }}>
            WORKFORCE COMMAND · READ ONLY MODE · ALL ACTIONS LOGGED
          </p>
        </div>
        <div className="flex items-center gap-2">
          {healthData?.checkedAt && (
            <span className="font-mono text-[7px]" style={{ color: 'var(--text-muted)' }}>
              checked {safeTs(healthData.checkedAt)}
            </span>
          )}
          <button
            onClick={() => runHealthCheck()}
            disabled={healthLoading}
            className="font-mono text-[9px] tracking-widest px-4 py-2 rounded-sm transition-all flex items-center gap-2"
            style={{ background: `${TEAL}12`, border: `1px solid ${TEAL}30`, color: TEAL, opacity: healthLoading ? 0.6 : 1 }}>
            {healthLoading
              ? <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}>↻</motion.span>
              : '⚡'}
            {healthLoading ? 'CHECKING…' : 'RUN ALL CHECKS'}
          </button>
          <button onClick={() => load(true)} className="font-mono text-[9px] tracking-widest px-3 py-2 rounded-sm transition-all"
            style={{ background: `${GOLD}0f`, border: `1px solid ${GOLD}25`, color: GOLD }}>
            ↻
          </button>
        </div>
      </motion.div>

      {/* ── Overview cards ── */}
      <motion.div variants={fadeUp} className="grid grid-cols-2 gap-4">
        {/* Workforce overview */}
        <div className="panel-gold rounded-sm p-4" style={{ borderColor: `${GOLD}22` }}>
          <div className="font-mono text-[8px] tracking-[0.22em] uppercase mb-3" style={{ color: GOLD }}>WORKFORCE OVERVIEW</div>
          <MetStrip items={[
            { label: 'Total',      value: summary?.total      || 0, color: GOLD     },
            { label: 'Declared',   value: summary?.active     || 0, color: GOLD     },
            { label: 'Staged',     value: summary?.staged     || 0, color: SAPPHIRE },
            { label: 'Available',  value: summary?.healthy    || 0, color: EMERALD  },
            { label: 'Unknown',    value: summary?.unknown    || 0, color: AMBER    },
            { label: 'Offline',    value: summary?.offline    || 0, color: CRIMSON  },
          ]} />
          <div className="flex items-center gap-4 mt-3 pt-3 border-t" style={{ borderColor: 'var(--border-default)' }}>
            <div className="flex items-center gap-1.5">
              <HealthDot health="Available" size={6} />
              <span className="font-mono text-[8px]" style={{ color: EMERALD }}>{summary?.healthy || 0} Available</span>
            </div>
            <div className="flex items-center gap-1.5">
              <HealthDot health="Reachable" size={6} />
              <span className="font-mono text-[8px]" style={{ color: TEAL }}>{summary?.reachable || 0} Reachable</span>
            </div>
            <div className="flex items-center gap-1.5">
              <HealthDot health="Degraded" size={6} />
              <span className="font-mono text-[8px]" style={{ color: AMBER }}>{summary?.warning || 0} Degraded</span>
            </div>
          </div>
        </div>

        {/* Adapter overview */}
        <div className="panel-gold rounded-sm p-4" style={{ borderColor: `${TEAL}22` }}>
          <div className="font-mono text-[8px] tracking-[0.22em] uppercase mb-3" style={{ color: TEAL }}>ADAPTER OVERVIEW</div>
          <MetStrip items={[
            { label: 'Total',   value: adapterSummary?.total  || 0, color: GOLD     },
            { label: 'Active',  value: adapterSummary?.active || 0, color: EMERALD  },
            { label: 'Staged',  value: adapterSummary?.staged || 0, color: SAPPHIRE },
            { label: 'Maint',   value: adapterSummary?.maintenance || 0, color: VIOLET   },
          ]} />
          {/* Live health counts (from health check store) */}
          {healthData?.summary && !healthData.neverChecked && (
            <div className="flex items-center gap-4 mt-3 pt-3 border-t" style={{ borderColor: 'var(--border-default)' }}>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: EMERALD, boxShadow: `0 0 4px ${EMERALD}` }} />
                <span className="font-mono text-[8px]" style={{ color: EMERALD }}>{healthData.summary.healthy} healthy</span>
              </div>
              {healthData.summary.failed > 0 && (
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: CRIMSON, boxShadow: `0 0 4px ${CRIMSON}` }} />
                  <span className="font-mono text-[8px]" style={{ color: CRIMSON }}>{healthData.summary.failed} failed</span>
                </div>
              )}
              {healthData.summary.warning > 0 && (
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: AMBER }} />
                  <span className="font-mono text-[8px]" style={{ color: AMBER }}>{healthData.summary.warning} warning</span>
                </div>
              )}
              {healthData.summary.configuredButStaged > 0 && (
                <span className="font-mono text-[7px]" style={{ color: SAPPHIRE }}>
                  {healthData.summary.configuredButStaged} ready to activate
                </span>
              )}
            </div>
          )}
          {healthData?.neverChecked && (
            <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--border-default)' }}>
              <p className="font-mono text-[7px]" style={{ color: AMBER }}>
                Health not checked yet — click "Run All Checks" to ping all adapters.
              </p>
            </div>
          )}
        </div>
      </motion.div>

      {/* ── Tab switcher ── */}
      <motion.div variants={fadeUp} className="flex items-center gap-1">
        {[{ key: 'agents', label: `Agents (${data?.agents?.length || 0})` }, { key: 'adapters', label: `Adapters (${data?.adapters?.length || 0})` }].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="font-mono text-[9px] tracking-wider px-4 py-2 rounded-sm transition-all"
            style={{
              background: tab === t.key ? `${GOLD}18` : 'transparent',
              border:     `1px solid ${tab === t.key ? GOLD : 'var(--border-default)'}`,
              color:      tab === t.key ? GOLD : 'var(--text-muted)',
            }}>
            {t.label}
          </button>
        ))}
      </motion.div>

      {/* ── Agents tab ── */}
      {tab === 'agents' && (
        <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-3">
          {/* Filters */}
          <motion.div variants={fadeUp} className="flex items-center gap-2 flex-wrap">
            {AGENT_FILTER_TABS.map(t => {
              const count = t.key === 'all' ? data?.agents?.length || 0
                : t.key === 'available' ? data?.agents?.filter(a => ['available', 'reachable'].includes(a.runtimeStatus)).length || 0
                : t.key === 'staged' ? data?.agents?.filter(a => a.runtimeStatus === 'staged').length || 0
                : t.key === 'degraded' ? data?.agents?.filter(a => a.runtimeStatus === 'degraded').length || 0
                : t.key === 'offline' ? data?.agents?.filter(a => a.runtimeStatus === 'offline').length || 0
                : t.key === 'unknown' ? data?.agents?.filter(a => a.runtimeStatus === 'unknown').length || 0
                : data?.agents?.filter(a => a.runtimeEvidence?.reason === 'maintenance').length || 0;
              const isActive = agentFilter === t.key;
              return (
                <button key={t.key} onClick={() => setAgentFilter(t.key)}
                  className="font-mono text-[8px] tracking-wider px-3 py-1.5 rounded-sm transition-all"
                  style={{ background: isActive ? `${GOLD}15` : 'transparent', border: `1px solid ${isActive ? GOLD : 'var(--border-default)'}`, color: isActive ? GOLD : 'var(--text-muted)' }}>
                  {t.label} ({count})
                </button>
              );
            })}
            <div className="ml-auto flex gap-1">
              {DEPT_FILTER_TABS.map(t => {
                const isActive = deptFilter === t.key;
                const col = t.key === 'all' ? GOLD : DEPT_COLOR[t.key] || GOLD;
                return (
                  <button key={t.key} onClick={() => setDeptFilter(t.key)}
                    className="font-mono text-[7px] tracking-wider px-2 py-1.5 rounded-sm transition-all"
                    style={{ background: isActive ? `${col}12` : 'transparent', border: `1px solid ${isActive ? col : 'var(--border-default)'}`, color: isActive ? col : 'var(--text-muted)' }}>
                    {t.label}
                  </button>
                );
              })}
            </div>
          </motion.div>

          {/* Table header */}
          <motion.div variants={fadeUp} className="panel-gold rounded-sm overflow-hidden" style={{ borderColor: 'var(--border-default)' }}>
            {/* Column headers */}
            <div className="flex items-center gap-2.5 px-4 py-2 border-b"
              style={{ borderColor: 'var(--border-default)', background: 'rgba(201,168,76,0.04)' }}>
              <div className="w-0.5 flex-shrink-0" />
              <div className="w-6 flex-shrink-0" />
              <div className="flex-1 font-mono text-[7px] tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>Agent</div>
              <div className="w-20 font-mono text-[7px] tracking-widest uppercase hidden md:block" style={{ color: 'var(--text-muted)' }}>Dept</div>
              <div className="w-20 font-mono text-[7px] tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>Adapter</div>
              <div className="w-16 font-mono text-[7px] tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>Status</div>
              <div className="w-2 flex-shrink-0" />
              <div className="w-20 font-mono text-[7px] tracking-widest uppercase hidden lg:block" style={{ color: 'var(--text-muted)' }}>Mode</div>
              <div className="w-8 font-mono text-[7px] tracking-widest uppercase text-center" style={{ color: 'var(--text-muted)' }}>Disp</div>
              <div className="w-16 font-mono text-[7px] tracking-widest uppercase text-right" style={{ color: 'var(--text-muted)' }}>Health</div>
              <div className="w-28 font-mono text-[7px] tracking-widest uppercase text-right" style={{ color: 'var(--text-muted)' }}>Controls</div>
            </div>

            {filteredAgents.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>No agents match current filters</p>
              </div>
            ) : (
              <motion.div variants={stagger} initial="initial" animate="animate">
                {filteredAgents.map(agent => (
                  <AgentRow
                    key={agent.id}
                    agent={agent}
                    onSelect={setSelectedAgent}
                    onToggle={handleToggle}
                    actioning={actioning}
                  />
                ))}
              </motion.div>
            )}
          </motion.div>
        </motion.div>
      )}

      {/* ── Adapters tab ── */}
      {tab === 'adapters' && (
        <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-3">
          {/* Issues banner */}
          <AdapterIssuesBanner healthData={healthData} />

          {/* Filters */}
          <motion.div variants={fadeUp} className="flex items-center gap-1 flex-wrap">
            {ADAPTER_FILTER_TABS.map(t => {
              const isActive = adapterFilter === t.key;
              return (
                <button key={t.key} onClick={() => setAdapterFilter(t.key)}
                  className="font-mono text-[8px] tracking-wider px-3 py-1.5 rounded-sm transition-all"
                  style={{ background: isActive ? `${GOLD}15` : 'transparent', border: `1px solid ${isActive ? GOLD : 'var(--border-default)'}`, color: isActive ? GOLD : 'var(--text-muted)' }}>
                  {t.label}
                </button>
              );
            })}
          </motion.div>

          {/* Adapter list */}
          <motion.div variants={fadeUp} className="panel-gold rounded-sm overflow-hidden" style={{ borderColor: 'var(--border-default)' }}>
            <div className="flex items-center gap-3 px-4 py-2 border-b"
              style={{ borderColor: 'var(--border-default)', background: 'rgba(13,211,197,0.04)' }}>
              <div className="w-0.5 flex-shrink-0" />
              <div className="w-6 flex-shrink-0" />
              <div className="flex-1 font-mono text-[7px] tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>Adapter</div>
              <div className="font-mono text-[7px] tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>Status</div>
              <div className="font-mono text-[7px] tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>Health</div>
              <div className="font-mono text-[7px] tracking-widest uppercase hidden md:block" style={{ color: 'var(--text-muted)' }}>Types</div>
              <div className="flex-1 font-mono text-[7px] tracking-widest uppercase hidden xl:block" style={{ color: 'var(--text-muted)' }}>Task Types</div>
              <div className="font-mono text-[7px] tracking-widest uppercase hidden lg:block" style={{ color: 'var(--text-muted)' }}>Checked</div>
              <div className="font-mono text-[7px] tracking-widest uppercase text-right" style={{ color: 'var(--text-muted)' }}>Actions</div>
            </div>
            {filteredAdapters.map(a => (
              <AdapterRow
                key={a.adapterId}
                adapter={a}
                onMaintenance={handleMaintenance}
                onRunCheck={runHealthCheck}
                actioning={actioning}
              />
            ))}
          </motion.div>

          {/* Cost Preview */}
          <motion.div variants={fadeUp}>
            <CostPreview costEstimate={costEstimate} adapters={enrichedAdapters} adapterCostData={costData?.adapters} />
          </motion.div>
        </motion.div>
      )}

      {/* ── Architecture reminder ── */}
      <motion.div variants={fadeUp} className="rounded-sm px-4 py-2.5 flex items-center gap-2 flex-wrap"
        style={{ background: `${SAPPHIRE}06`, border: `1px solid ${SAPPHIRE}15` }}>
        <span className="font-mono text-[8px] tracking-wider flex-shrink-0" style={{ color: 'var(--text-muted)' }}>ARCHITECTURE:</span>
        {['Registry', 'Adapter', 'Dispatch', 'Execution'].map((step, i, arr) => (
          <span key={step} className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>
            {step}{i < arr.length - 1 ? ' →' : ''}
          </span>
        ))}
        <span className="font-mono text-[8px] ml-auto" style={{ color: 'var(--text-muted)' }}>
          Controls affect Registry + Adapter state only — dispatch and governance are immutable
        </span>
      </motion.div>
    </motion.div>
  );
}
