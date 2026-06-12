// components/sections/WorkforceDivision.jsx
import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../../lib/store';
import { AGENT_AVATARS } from '../../lib/agent-avatars';

// ── Department definitions ───────────────────────────────────────────
const DEPARTMENTS = [
  { id: 'ALL',         label: 'All',         color: '#c9a84c' },
  { id: 'OPERATIONS',  label: 'Operations',  color: '#0dd3c5' },
  { id: 'CONTENT',     label: 'Content',     color: '#f472b6' },
  { id: 'SALES',       label: 'Sales',       color: '#c9a84c' },
  { id: 'CLIENT OPS',  label: 'Client Ops',  color: '#818cf8' },
  { id: 'ENGINEERING', label: 'Engineering', color: '#3b82f6' },
  { id: 'SPECIALIST',  label: 'Specialist',  color: '#f59e0b' },
];

const DEPT_COLOR = Object.fromEntries(DEPARTMENTS.map(d => [d.id, d.color]));

const STATUS_META = {
  available: { label: 'AVAILABLE', color: '#0dd3c5', pulse: true },
  reachable: { label: 'REACHABLE', color: '#60a5fa', pulse: false },
  degraded:  { label: 'DEGRADED',  color: '#f59e0b', pulse: false },
  offline:   { label: 'OFFLINE',   color: '#ef4444', pulse: false },
  staged:    { label: 'STAGED',    color: '#4b5563', pulse: false },
  unknown:   { label: 'UNKNOWN',   color: '#6b7280', pulse: false },
};

const EXEC_LABEL = {
  'gateway':     'VPS Gateway',
  'ssh-http':    'SSH Bridge',
  'openclaw':    'OpenClaw',
  'local-cli':   'Local CLI',
  'api':         'API',
  'local-docker':'Docker',
  'custom':      'Custom HTTP',
};

const stagger = { initial: {}, animate: { transition: { staggerChildren: 0.05 } } };
const fadeUp  = { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0, transition: { duration: 0.28 } } };

// ── Department Badge ─────────────────────────────────────────────────
function DeptBadge({ dept }) {
  const color = DEPT_COLOR[dept] || '#c9a84c';
  return (
    <span
      className="font-mono text-[7px] px-1.5 py-0.5 rounded-sm tracking-wider"
      style={{
        color,
        background: `${color}14`,
        border: `1px solid ${color}28`,
      }}
    >
      {dept}
    </span>
  );
}

// ── Employee Card ────────────────────────────────────────────────────
function EmployeeCard({ agent, onOpen }) {
  const avatar  = AGENT_AVATARS[agent.avatarType] || AGENT_AVATARS[agent.id] || {};
  const statusKey = agent.runtimeStatus || 'unknown';
  const isStaged = statusKey === 'staged';
  const sm = STATUS_META[statusKey] || STATUS_META.unknown;
  const deptColor = DEPT_COLOR[agent.department] || '#c9a84c';

  return (
    <motion.div
      variants={fadeUp}
      className="panel-gold rounded-sm p-4 flex flex-col gap-3 relative overflow-hidden transition-all"
      style={{
        opacity: isStaged ? 0.72 : 1,
        borderColor: isStaged ? 'rgba(255,255,255,0.06)' : `${deptColor}20`,
      }}
    >
      {/* Ambient glow */}
      <div
        className="absolute top-0 right-0 w-24 h-24 rounded-full blur-3xl pointer-events-none"
        style={{ background: isStaged ? 'transparent' : `${deptColor}08` }}
      />

      {/* Staged ribbon */}
      {isStaged && (
        <div
          className="absolute top-3 right-3 font-mono text-[7px] px-2 py-0.5 rounded-sm tracking-wider"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-muted)' }}
        >
          STAGED
        </div>
      )}

      {/* Avatar + identity */}
      <div className="flex items-start gap-3">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 text-xl"
          style={{
            background: avatar.gradient || `linear-gradient(135deg, ${deptColor}40, ${deptColor}20)`,
            boxShadow: isStaged ? 'none' : `0 4px 16px ${deptColor}20`,
            filter: isStaged ? 'grayscale(0.4)' : 'none',
          }}
        >
          {avatar.emoji || '🤖'}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="font-ui text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
              {agent.displayName}
            </span>
            <DeptBadge dept={agent.department} />
          </div>
          <p className="font-mono text-[9px] tracking-wide" style={{ color: deptColor }}>
            {agent.role}
          </p>
        </div>
      </div>

      {/* Status */}
      <div className="flex items-center gap-2">
        <div
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{
            background: sm.color,
            boxShadow: sm.pulse ? `0 0 6px ${sm.color}` : 'none',
          }}
        />
        <span className="font-mono text-[9px] tracking-wider" style={{ color: sm.color }}>
          {sm.label}
        </span>
        {agent.model && !isStaged && (
          <>
            <span className="font-mono text-[7px]" style={{ color: 'var(--text-muted)' }}>·</span>
            <span className="font-mono text-[7px]" style={{ color: 'var(--text-muted)' }}>
              {agent.model}
            </span>
          </>
        )}
      </div>

      {/* Description */}
      <p className="font-body text-[11px] leading-snug" style={{ color: 'var(--text-secondary)' }}>
        {agent.description}
      </p>

      {/* Metadata row */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1">
          <span className="font-mono text-[7px] tracking-wider" style={{ color: 'var(--text-muted)' }}>
            MODE
          </span>
          <span
            className="font-mono text-[7px] px-1.5 py-0.5 rounded-sm"
            style={{
              color: deptColor,
              background: `${deptColor}10`,
              border: `1px solid ${deptColor}20`,
            }}
          >
            {EXEC_LABEL[agent.executionMode] || agent.executionMode}
          </span>
        </div>
        {agent.schedule && (
          <div className="flex items-center gap-1">
            <span className="font-mono text-[7px] tracking-wider" style={{ color: 'var(--text-muted)' }}>
              CRON
            </span>
            <span className="font-mono text-[7px]" style={{ color: 'var(--text-muted)' }}>
              {agent.schedule}
            </span>
          </div>
        )}
      </div>

      {/* Allowed task types */}
      {agent.allowedTaskTypes.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {agent.allowedTaskTypes.slice(0, 4).map(t => (
            <span
              key={t}
              className="font-mono text-[7px] px-1.5 py-0.5 rounded-sm"
              style={{
                color: 'var(--text-muted)',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              {t.replace(/_/g, ' ')}
            </span>
          ))}
          {agent.allowedTaskTypes.length > 4 && (
            <span
              className="font-mono text-[7px] px-1.5 py-0.5 rounded-sm"
              style={{
                color: 'var(--text-muted)',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              +{agent.allowedTaskTypes.length - 4}
            </span>
          )}
        </div>
      )}

      {/* CTA */}
      <button
        onClick={() => !isStaged && onOpen(agent.id)}
        disabled={isStaged}
        className="w-full font-ui text-[9px] font-bold py-2 rounded-sm tracking-wider transition-all mt-auto"
        style={isStaged ? {
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.06)',
          color: 'var(--text-muted)',
          cursor: 'not-allowed',
        } : {
          background: `${deptColor}12`,
          border: `1px solid ${deptColor}30`,
          color: deptColor,
          cursor: 'pointer',
        }}
      >
        {isStaged ? 'COMING SOON' : 'OPEN WORKSPACE →'}
      </button>
    </motion.div>
  );
}

// ── Workforce Division ───────────────────────────────────────────────
export default function WorkforceDivision() {
  const { setActiveAgentId } = useStore();

  const [agents, setAgents]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeDept, setActiveDept] = useState('ALL');
  const [query, setQuery]     = useState('');

  useEffect(() => {
    fetch('/api/agents/registry')
      .then(r => r.ok ? r.json() : [])
      .then(data => { setAgents(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    return agents.filter(a => {
      const inDept = activeDept === 'ALL' || a.department === activeDept;
      const inQuery = !query.trim() ||
        a.displayName.toLowerCase().includes(query.toLowerCase()) ||
        a.role.toLowerCase().includes(query.toLowerCase()) ||
        a.department.toLowerCase().includes(query.toLowerCase());
      return inDept && inQuery;
    });
  }, [agents, activeDept, query]);

  const liveCount = agents.filter(a => ['available', 'reachable'].includes(a.runtimeStatus)).length;

  const deptCounts = useMemo(() => {
    const counts = {};
    agents.forEach(a => { counts[a.department] = (counts[a.department] || 0) + 1; });
    return counts;
  }, [agents]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="flex flex-col items-center gap-3">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
            className="w-7 h-7 rounded-full"
            style={{ border: '2px solid rgba(13,211,197,0.2)', borderTopColor: '#0dd3c5' }}
          />
          <span className="font-mono text-[9px] tracking-widest" style={{ color: 'var(--text-muted)' }}>
            LOADING WORKFORCE
          </span>
        </div>
      </div>
    );
  }

  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-5">

      {/* Header */}
      <motion.div variants={fadeUp} className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-light" style={{ color: 'var(--text-primary)' }}>
            AI Workforce Division
          </h2>
          <div className="flex items-center gap-4 mt-1">
            <span className="font-mono text-[9px] tracking-wider" style={{ color: 'var(--text-muted)' }}>
              {agents.length} AGENTS DEPLOYED
            </span>
            <span className="font-mono text-[9px] tracking-wider" style={{ color: '#0dd3c5' }}>
              {liveCount} VERIFIED
            </span>
            <span className="font-mono text-[9px] tracking-wider" style={{ color: 'var(--text-muted)' }}>
              {agents.filter(a => a.runtimeStatus === 'unknown').length} UNKNOWN
            </span>
          </div>
        </div>

        {/* Search */}
        <div className="relative flex-shrink-0">
          <input
            type="text"
            placeholder="Search agents…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="font-mono text-[11px] pl-3 pr-8 py-2 rounded-sm outline-none transition-all w-48"
            style={{
              background: 'rgba(0,0,0,0.25)',
              border: '1px solid rgba(255,255,255,0.06)',
              color: 'var(--text-primary)',
            }}
            onFocus={e => { e.target.style.borderColor = 'rgba(201,168,76,0.35)'; }}
            onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.06)'; }}
          />
          <span
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs pointer-events-none"
            style={{ color: 'var(--text-muted)' }}
          >
            ⌕
          </span>
        </div>
      </motion.div>

      {/* Department tabs */}
      <motion.div variants={fadeUp} className="flex items-center gap-1 flex-wrap">
        {DEPARTMENTS.filter(d => d.id === 'ALL' || deptCounts[d.id]).map(dept => {
          const isActive = activeDept === dept.id;
          const count = dept.id === 'ALL' ? agents.length : (deptCounts[dept.id] || 0);
          return (
            <button
              key={dept.id}
              onClick={() => setActiveDept(dept.id)}
              className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-sm transition-all"
              style={{
                background: isActive ? `${dept.color}12` : 'rgba(255,255,255,0.02)',
                border: `1px solid ${isActive ? `${dept.color}35` : 'rgba(255,255,255,0.06)'}`,
                color: isActive ? dept.color : 'var(--text-muted)',
              }}
            >
              <span className="font-ui text-[10px] font-semibold tracking-wider">{dept.label}</span>
              <span
                className="font-mono text-[8px] px-1 py-0.5 rounded-sm"
                style={{
                  background: isActive ? `${dept.color}20` : 'rgba(255,255,255,0.04)',
                  color: isActive ? dept.color : 'var(--text-muted)',
                }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </motion.div>

      {/* Agent grid */}
      <AnimatePresence mode="wait">
        {filtered.length === 0 ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center justify-center py-24"
          >
            <div className="text-center">
              <div className="font-display text-4xl mb-3" style={{ color: 'var(--text-muted)', opacity: 0.3 }}>◈</div>
              <p className="font-mono text-[10px] tracking-widest" style={{ color: 'var(--text-muted)' }}>
                NO AGENTS FOUND
              </p>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key={`${activeDept}-${query}`}
            variants={stagger}
            initial="initial"
            animate="animate"
            className="grid grid-cols-3 gap-4"
          >
            {filtered.map(agent => (
              <EmployeeCard
                key={agent.id}
                agent={agent}
                onOpen={setActiveAgentId}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

    </motion.div>
  );
}
