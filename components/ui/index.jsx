// components/ui/index.jsx
import { motion } from 'framer-motion';
import clsx from 'clsx';

// ── Section Header ─────────────────────────────────────────────────
export function SectionHeader({ icon, title, subtitle, action }) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div className="flex items-center gap-3">
        {icon && (
          <div className="w-8 h-8 rounded-sm flex items-center justify-center text-base"
            style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.2)' }}>
            {icon}
          </div>
        )}
        <div>
          <h2 className="font-display text-xl font-semibold text-[#f0ede6]">{title}</h2>
          {subtitle && <p className="font-mono text-[10px] text-[#4b5563] tracking-wider mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

// ── Metric Card ────────────────────────────────────────────────────
export function MetricCard({ label, value, sub, color = '#c9a84c', icon, trend, className }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={clsx('panel-gold rounded-sm p-4 card-hover relative overflow-hidden', className)}
    >
      {/* Background glow */}
      <div
        className="absolute top-0 right-0 w-16 h-16 rounded-full blur-2xl opacity-10"
        style={{ background: color }}
      />

      <div className="flex items-start justify-between mb-2">
        <span className="font-mono text-[9px] tracking-[0.2em] text-[#4b5563] uppercase">{label}</span>
        {icon && <span className="text-base opacity-60">{icon}</span>}
      </div>

      <div className="font-mono text-2xl font-semibold leading-none" style={{ color }}>
        {value}
      </div>

      {sub && <div className="font-mono text-[10px] text-[#4b5563] mt-1.5">{sub}</div>}

      {trend !== undefined && (
        <div className={clsx(
          'font-mono text-[9px] mt-2 flex items-center gap-1',
          trend >= 0 ? 'text-[#4ade80]' : 'text-[#ef4444]'
        )}>
          {trend >= 0 ? '▲' : '▼'} {Math.abs(trend)}%
        </div>
      )}
    </motion.div>
  );
}

// ── Status Badge ───────────────────────────────────────────────────
const STATUS_MAP = {
  running:          { dot: 'running', label: 'RUNNING',  color: '#0dd3c5' },
  idle:             { dot: 'idle',    label: 'IDLE',     color: '#c9a84c' },
  paused:           { dot: 'paused',  label: 'PAUSED',   color: '#f59e0b' },
  error:            { dot: 'error',   label: 'ERROR',    color: '#ef4444' },
  offline:          { dot: 'offline', label: 'OFFLINE',  color: '#4b5563' },
  online:           { dot: 'online',  label: 'ONLINE',   color: '#0dd3c5' },
  complete:         { dot: 'online',  label: 'DONE',     color: '#0dd3c5' },
  pending:          { dot: 'idle',    label: 'PENDING',  color: '#c9a84c' },
  awaiting_approval:{ dot: 'paused',  label: 'AWAITING', color: '#f59e0b' },
  ready_for_review: { dot: 'idle',    label: 'REVIEW',   color: '#c9a84c' },
  generating:       { dot: 'running', label: 'GEN',      color: '#0dd3c5' },
  pending_approval: { dot: 'paused',  label: 'APPROVAL', color: '#f59e0b' },
  scripting:        { dot: 'running', label: 'SCRIPTING',color: '#0dd3c5' },
  stale:            { dot: 'paused',  label: 'STALE',    color: '#f59e0b' },
  green:            { dot: 'online',  label: 'GREEN',    color: '#4ade80' },
};

export function StatusBadge({ status }) {
  const s = STATUS_MAP[status] || STATUS_MAP.offline;
  return (
    <span
      className="tag"
      style={{ color: s.color, borderColor: `${s.color}30`, background: `${s.color}10` }}
    >
      <span className={`status-dot ${s.dot} mr-1.5`} style={{ width: 5, height: 5 }} />
      {s.label}
    </span>
  );
}

// ── Agent Card ─────────────────────────────────────────────────────
const PROJECT_COLORS = {
  'digital-diamond': '#c9a84c',
  'managed-by-mika': '#0dd3c5',
  'medai':           '#818cf8',
  'cannaops':        '#4ade80',
  'hotel-hooker':    '#f472b6',
  'ai-twin':         '#60a5fa',
  'lead-recovery':   '#fb923c',
};

export function AgentCard({ agent, onRestart, onStop }) {
  const color = PROJECT_COLORS[agent.project] || '#c9a84c';
  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      className="panel rounded-sm p-3 card-hover border-l-2 mb-2"
      style={{ borderLeftColor: color }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-ui text-sm font-semibold text-[#f0ede6]">{agent.label}</span>
            <StatusBadge status={agent.status} />
          </div>
          <p className="font-body text-xs text-[#8892a4] truncate">{agent.task}</p>
          <div className="flex items-center gap-3 mt-1.5">
            <span className="font-mono text-[9px] text-[#4b5563]">{agent.model}</span>
            <span className="font-mono text-[9px] text-[#4b5563]">{(agent.tokens / 1000).toFixed(1)}k tokens</span>
          </div>
        </div>
        <div className="flex gap-1 flex-shrink-0">
          {agent.status === 'error' && (
            <button onClick={() => onRestart?.(agent.id)} className="btn-ghost text-[10px] px-2 py-1">↺</button>
          )}
          {(agent.status === 'running' || agent.status === 'paused') && (
            <button onClick={() => onStop?.(agent.id)} className="btn-danger text-[10px] px-2 py-1">■</button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ── Progress Ring ──────────────────────────────────────────────────
export function ProgressRing({ value, size = 64, strokeWidth = 4, color = '#c9a84c' }) {
  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (value / 100) * circ;

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={strokeWidth} />
      <motion.circle
        cx={size/2} cy={size/2} r={r}
        fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeDasharray={circ}
        initial={{ strokeDashoffset: circ }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 1, delay: 0.3, ease: 'easeOut' }}
        strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 4px ${color})` }}
      />
    </svg>
  );
}

// ── Divider ────────────────────────────────────────────────────────
export function GoldDivider({ className }) {
  return (
    <div className={clsx('flex items-center gap-3 my-4', className)}>
      <div className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(201,168,76,0.2))' }} />
      <div className="w-1 h-1 rotate-45 bg-[#c9a84c] opacity-30" />
      <div className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, rgba(201,168,76,0.2), transparent)' }} />
    </div>
  );
}

// ── Mini chart bar ─────────────────────────────────────────────────
export function SparkBar({ data, color = '#c9a84c', height = 32 }) {
  const max = Math.max(...data);
  return (
    <div className="flex items-end gap-0.5" style={{ height }}>
      {data.map((v, i) => (
        <motion.div
          key={i}
          className="flex-1 rounded-t-sm"
          style={{ background: color, opacity: 0.4 + (v / max) * 0.6 }}
          initial={{ scaleY: 0 }}
          animate={{ scaleY: 1 }}
          transition={{ delay: i * 0.05, duration: 0.4 }}
          style={{ height: `${(v / max) * 100}%`, background: color, opacity: 0.4 + (v / max) * 0.6 }}
        />
      ))}
    </div>
  );
}
