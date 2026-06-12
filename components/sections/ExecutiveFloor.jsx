// components/sections/ExecutiveFloor.jsx
import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import { useStore } from '../../lib/store';
import { GoldDivider, StatusBadge } from '../ui';
import { AGENT_AVATARS } from '../../lib/agent-avatars';

// ── Design tokens (luxury tech palette) ─────────────────────────────
const SAPPHIRE      = '#3b82f6';
const SAPPHIRE_GLOW = 'rgba(59,130,246,0.12)';
const EMERALD       = '#10b981';
const EMERALD_GLOW  = 'rgba(16,185,129,0.12)';
const GOLD          = '#c9a84c';
const TEAL          = '#0dd3c5';
const CRIMSON       = '#ef4444';
const AMBER         = '#f59e0b';

const PROJECT_COLORS = {
  'digital-diamond': '#c9a84c', 'managed-by-mika': '#0dd3c5',
  'medai': '#818cf8',           'cannaops': '#4ade80',
  'hotel-hooker': '#f472b6',    'ai-twin': '#60a5fa',
  'lead-recovery': '#fb923c',   'hermes': '#a78bfa',
};

const URGENCY_COLOR = { high: CRIMSON, medium: AMBER, low: EMERALD };

const MODES = [
  { id: 'focus',      label: 'Focus',       icon: '◎', tip: 'Emphasize top priorities' },
  { id: 'deep-work',  label: 'Deep Work',   icon: '◈', tip: 'Single task, no noise'   },
  { id: 'low-energy', label: 'Low Energy',  icon: '◷', tip: 'Easy wins only'           },
  { id: 'high-energy',label: 'Full Command',icon: '◆', tip: 'All panels expanded'      },
];

const MOCK_MONEY_OPS = [
  { id: 'mo-1', text: 'Proposal ready — TechCo AI Audit ($8.5k)',  urgency: 'high',   agent: 'diamond',  project: 'digital-diamond' },
  { id: 'mo-2', text: '3 warm leads engaged — follow-up window open', urgency: 'medium', agent: 'recovery', project: 'lead-recovery'  },
  { id: 'mo-3', text: 'MedAI: 2 consultation slots open tomorrow',  urgency: 'low',    agent: 'medbot',   project: 'medai'          },
];

const stagger = { initial: {}, animate: { transition: { staggerChildren: 0.06 } } };
const fadeUp  = { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0, transition: { duration: 0.32 } } };

const safeFormat = (ts, fmt) => { try { return format(parseISO(ts), fmt); } catch { return '—'; } };

// ── Mode Selector ────────────────────────────────────────────────────
function ModeSelector({ mode, onChange }) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {MODES.map(m => {
        const active = mode === m.id;
        return (
          <button
            key={m.id}
            onClick={() => onChange(active ? 'normal' : m.id)}
            title={m.tip}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm transition-all"
            style={{
              background: active ? SAPPHIRE_GLOW : 'rgba(255,255,255,0.03)',
              border: `1px solid ${active ? `${SAPPHIRE}50` : 'rgba(255,255,255,0.06)'}`,
              color: active ? SAPPHIRE : 'var(--text-muted)',
            }}
          >
            <span style={{ fontSize: 11 }}>{m.icon}</span>
            <span className="font-ui text-[10px] font-semibold tracking-wider uppercase">{m.label}</span>
          </button>
        );
      })}
      <div className="ml-auto font-mono text-[9px] tracking-widest" style={{ color: 'var(--text-muted)' }}>
        {today}
      </div>
    </div>
  );
}

// ── Daily Briefing Strip ─────────────────────────────────────────────
function DailyBriefing({ briefing }) {
  return (
    <motion.div
      variants={fadeUp}
      className="panel-gold rounded-sm px-5 py-4 relative overflow-hidden"
      style={{ borderColor: `${SAPPHIRE}28` }}
    >
      <div className="absolute top-0 right-0 w-40 h-40 rounded-full blur-3xl pointer-events-none"
        style={{ background: SAPPHIRE_GLOW }} />
      <div className="flex items-start justify-between gap-6 relative">
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[8px] tracking-[0.22em] mb-1.5 uppercase" style={{ color: SAPPHIRE }}>
            EXECUTIVE FLOOR · DAILY BRIEFING
          </div>
          <p className="font-display text-xl font-light leading-snug" style={{ color: 'var(--text-primary)' }}>
            {briefing.greeting}
          </p>
          <p className="font-body text-sm mt-1 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {briefing.summary}
          </p>
        </div>
        <div className="flex gap-6 flex-shrink-0">
          {briefing.stats.map(s => (
            <div key={s.label} className="text-right">
              <div className="font-mono text-2xl font-bold leading-none" style={{ color: s.color }}>
                {s.value}
              </div>
              <div className="font-mono text-[8px] tracking-wider mt-1" style={{ color: 'var(--text-muted)' }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

// ── Today's Focus ────────────────────────────────────────────────────
function TodaysFocus({ items, onDispatch, onAgentOpen, emphasized }) {
  return (
    <div
      className="panel-gold rounded-sm p-4 flex flex-col transition-all duration-300"
      style={{
        borderColor: emphasized ? `${SAPPHIRE}45` : 'rgba(201,168,76,0.22)',
        boxShadow: emphasized
          ? `0 0 28px rgba(59,130,246,0.12), var(--shadow-card)`
          : 'var(--shadow-card)',
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="font-mono text-[8px] tracking-[0.22em] uppercase" style={{ color: SAPPHIRE }}>
          TODAY'S FOCUS
        </div>
        <div className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>MAX 3</div>
      </div>

      {items.length === 0 ? (
        <div className="flex items-center justify-center flex-1 py-8">
          <div className="text-center">
            <div className="text-lg mb-1" style={{ color: EMERALD }}>◉</div>
            <span className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>All clear</span>
          </div>
        </div>
      ) : (
        <div className="space-y-2 flex-1">
          {items.map((item, i) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.08 }}
              className="flex items-start gap-2.5 p-2.5 rounded-sm"
              style={{ background: `${item.color}08`, border: `1px solid ${item.color}22` }}
            >
              <div
                className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
                style={{
                  background: item.color,
                  boxShadow: `0 0 6px ${item.color}80`,
                }}
              />
              <div className="flex-1 min-w-0">
                <p className="font-body text-[12px] leading-snug" style={{ color: 'var(--text-primary)' }}>
                  {item.text}
                </p>
                <div className="font-mono text-[8px] mt-0.5 tracking-wider" style={{ color: item.color }}>
                  {item.type.toUpperCase()}
                </div>
              </div>
              <button
                onClick={() =>
                  item.agentId ? onAgentOpen(item.agentId) : onDispatch(item.section || 'task-dispatch')
                }
                className="flex-shrink-0 font-ui text-[9px] font-bold px-2 py-1 rounded-sm tracking-wider transition-all"
                style={{
                  background: `${item.color}15`,
                  border: `1px solid ${item.color}35`,
                  color: item.color,
                }}
              >
                {item.action} →
              </button>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Money Opportunities ──────────────────────────────────────────────
function MoneyOpportunities({ items, onAgentOpen, faded, bright }) {
  return (
    <div
      className="panel-gold rounded-sm p-4 transition-all duration-300"
      style={{
        opacity: faded ? 0.42 : 1,
        borderColor: bright ? `${EMERALD}35` : 'rgba(201,168,76,0.22)',
        boxShadow: bright ? `0 0 24px ${EMERALD_GLOW}, var(--shadow-card)` : 'var(--shadow-card)',
      }}
    >
      <div className="font-mono text-[8px] tracking-[0.22em] uppercase mb-3" style={{ color: EMERALD }}>
        MONEY OPPORTUNITIES
      </div>
      <div className="space-y-2">
        {items.map((item, i) => (
          <motion.button
            key={item.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07 }}
            onClick={() => onAgentOpen(item.agent)}
            className="w-full text-left flex items-start gap-2.5 p-2.5 rounded-sm transition-all"
            style={{ background: `${EMERALD}06`, border: `1px solid ${EMERALD}14` }}
          >
            <div
              className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
              style={{ background: URGENCY_COLOR[item.urgency] }}
            />
            <div className="flex-1 min-w-0">
              <p className="font-body text-[12px] leading-snug" style={{ color: 'var(--text-primary)' }}>
                {item.text}
              </p>
              <div className="font-mono text-[8px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {item.project.replace(/-/g, ' ')}
              </div>
            </div>
            <div
              className="font-mono text-[8px] px-1.5 py-0.5 rounded-sm flex-shrink-0 self-start"
              style={{
                color: URGENCY_COLOR[item.urgency],
                background: `${URGENCY_COLOR[item.urgency]}14`,
                border: `1px solid ${URGENCY_COLOR[item.urgency]}28`,
              }}
            >
              {item.urgency.toUpperCase()}
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

// ── Quick Wins ───────────────────────────────────────────────────────
function QuickWins({ outputs, onAgentOpen, faded, bright }) {
  const wins = outputs.filter(o => o.status === 'ready_for_review').slice(0, 4);
  return (
    <div
      className="panel-gold rounded-sm p-4 transition-all duration-300"
      style={{ opacity: faded ? 0.42 : 1 }}
    >
      <div className="font-mono text-[8px] tracking-[0.22em] uppercase mb-3" style={{ color: GOLD }}>
        QUICK WINS
      </div>
      {wins.length === 0 ? (
        <div className="flex items-center justify-center py-8">
          <span className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>
            No outputs ready yet
          </span>
        </div>
      ) : (
        <div className="space-y-2">
          {wins.map((out, i) => (
            <motion.button
              key={out.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07 }}
              onClick={() => onAgentOpen(out.agent?.toLowerCase())}
              className="w-full text-left p-2.5 rounded-sm transition-all"
              style={{ background: `${GOLD}06`, border: `1px solid ${GOLD}18` }}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-body text-[12px] leading-snug flex-1" style={{ color: 'var(--text-primary)' }}>
                  {out.title}
                </p>
                <StatusBadge status={out.status} />
              </div>
              <div className="font-mono text-[8px] mt-1" style={{ color: GOLD }}>
                {out.agent} · {safeFormat(out.ts, 'HH:mm')}
              </div>
            </motion.button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Revenue Snapshot ─────────────────────────────────────────────────
function RevenueSnapshot({ metrics, brands = [] }) {
  const weekRevenue = metrics.reduce((s, m) => s + (m.revenue || 0), 0);
  const brandRevenue = brands.reduce((s, b) => s + (b.weekTotal || 0), 0);
  const total = brandRevenue > 0 ? brandRevenue : weekRevenue;
  const display = brands.length > 0 ? brands : [];

  return (
    <motion.div
      variants={fadeUp}
      className="panel-gold rounded-sm p-4"
      style={{ borderColor: `${EMERALD}28` }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="font-mono text-[8px] tracking-[0.22em] uppercase" style={{ color: EMERALD }}>
          REVENUE SNAPSHOT
        </div>
        <div className="text-right">
          <div className="font-mono text-2xl font-bold leading-none" style={{ color: EMERALD }}>
            ${total >= 1000 ? `${(total / 1000).toFixed(1)}k` : total.toLocaleString()}
          </div>
          <div className="font-mono text-[8px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            THIS WEEK
          </div>
        </div>
      </div>
      {display.length > 0 ? (
        <div className="grid grid-cols-5 gap-2">
          {display.map((p, i) => (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07 }}
              className="rounded-sm p-3"
              style={{ background: `${p.color}08`, border: `1px solid ${p.color}22` }}
            >
              <div className="font-mono text-[7px] truncate mb-1.5 tracking-wide" style={{ color: 'var(--text-muted)' }}>
                {p.label.toUpperCase()}
              </div>
              <div className="font-mono text-sm font-bold leading-none" style={{ color: p.color }}>
                ${p.weekTotal >= 1000 ? `${(p.weekTotal / 1000).toFixed(1)}k` : (p.weekTotal || 0).toLocaleString()}
              </div>
              <div className="font-mono text-[8px] mt-1 flex items-center gap-0.5"
                style={{ color: (p.trend || 0) >= 0 ? EMERALD : CRIMSON }}>
                {(p.trend || 0) >= 0 ? '▲' : '▼'} {Math.abs(p.trend || 0)}%
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="flex items-center justify-center py-4">
          <span className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>
            No revenue data — edit data/revenue.json to add figures
          </span>
        </div>
      )}
    </motion.div>
  );
}

// ── AI Activity Feed ─────────────────────────────────────────────────
function AIActivityFeed({ agents, outputs, faded }) {
  const activities = useMemo(() => {
    const agentActs = agents
      .filter(a => a.status === 'running' || a.status === 'idle')
      .slice(0, 4)
      .map(a => ({
        id: `ag-${a.id}`,
        agent: a.label,
        agentId: a.id,
        text: a.task || 'Standing by',
        ts: new Date().toISOString(),
        color: a.status === 'running' ? TEAL : 'var(--text-muted)',
        pulse: a.status === 'running',
      }));
    const outActs = outputs.slice(0, 3).map(o => ({
      id: `out-${o.id}`,
      agent: o.agent,
      agentId: o.agent?.toLowerCase(),
      text: o.title,
      ts: o.ts,
      color: EMERALD,
      pulse: false,
    }));
    return [...agentActs, ...outActs].slice(0, 6);
  }, [agents, outputs]);

  return (
    <div
      className="panel-gold rounded-sm p-4 transition-all duration-300"
      style={{ opacity: faded ? 0.4 : 1 }}
    >
      <div className="font-mono text-[8px] tracking-[0.22em] uppercase mb-3" style={{ color: 'var(--text-secondary)' }}>
        AI ACTIVITY
      </div>
      <div className="space-y-2.5 overflow-y-auto" style={{ maxHeight: 196 }}>
        {activities.length === 0 ? (
          <div className="flex items-center justify-center py-6">
            <span className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>No recent activity</span>
          </div>
        ) : activities.map((a, i) => (
          <motion.div
            key={a.id}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.06 }}
            className="flex items-start gap-2.5"
          >
            <div
              className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
              style={{
                background: a.color,
                boxShadow: a.pulse ? `0 0 6px ${a.color}` : 'none',
              }}
            />
            <div className="flex-1 min-w-0">
              <p className="font-body text-[11px] leading-snug truncate" style={{ color: 'var(--text-primary)' }}>
                {a.text}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="font-mono text-[8px] font-semibold" style={{ color: a.color }}>
                  {a.agent}
                </span>
                <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>
                  {safeFormat(a.ts, 'HH:mm')}
                </span>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ── Waiting On ───────────────────────────────────────────────────────
function WaitingOn({ approvals, onDispatch, faded }) {
  return (
    <div
      className="panel-gold rounded-sm p-4 transition-all duration-300"
      style={{ opacity: faded ? 0.4 : 1 }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="font-mono text-[8px] tracking-[0.22em] uppercase" style={{ color: AMBER }}>
          WAITING ON YOU
        </div>
        {approvals.length > 0 && (
          <span
            className="font-mono text-[8px] font-bold w-5 h-5 rounded-full flex items-center justify-center"
            style={{ background: AMBER, color: '#07090f' }}
          >
            {approvals.length}
          </span>
        )}
      </div>
      {approvals.length === 0 ? (
        <div className="flex items-center justify-center py-6">
          <div className="text-center">
            <div className="text-lg mb-1" style={{ color: EMERALD }}>◉</div>
            <span className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>Nothing blocked</span>
          </div>
        </div>
      ) : (
        <div className="space-y-2 overflow-y-auto" style={{ maxHeight: 196 }}>
          {approvals.slice(0, 4).map((a, i) => (
            <motion.div
              key={a.id}
              initial={{ opacity: 0, x: 6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.07 }}
              className="p-2.5 rounded-sm"
              style={{ background: `${AMBER}06`, border: `1px solid ${AMBER}20` }}
            >
              <p className="font-body text-[11px] leading-snug" style={{ color: 'var(--text-primary)' }}>
                {a.summary}
              </p>
              <div className="flex items-center justify-between mt-1.5 gap-2">
                <span className="font-mono text-[8px] truncate" style={{ color: AMBER }}>
                  {a.agent} · {a.channel}
                </span>
                <button
                  onClick={() => onDispatch('telegram')}
                  className="font-ui text-[8px] font-bold px-2 py-0.5 rounded-sm tracking-wider transition-all flex-shrink-0"
                  style={{
                    background: `${AMBER}14`,
                    border: `1px solid ${AMBER}30`,
                    color: AMBER,
                  }}
                >
                  REVIEW →
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Active Agents Mini ───────────────────────────────────────────────
function ActiveAgentsMini({ agents, onAgentOpen, faded }) {
  const running = agents.filter(a => a.status === 'running').length;
  const errors  = agents.filter(a => a.status === 'error').length;

  return (
    <div
      className="panel-gold rounded-sm p-4 transition-all duration-300"
      style={{ opacity: faded ? 0.4 : 1 }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="font-mono text-[8px] tracking-[0.22em] uppercase" style={{ color: TEAL }}>
          ACTIVE AGENTS
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[8px]" style={{ color: TEAL }}>{running} LIVE</span>
          {errors > 0 && (
            <span className="font-mono text-[8px]" style={{ color: CRIMSON }}>{errors} ERR</span>
          )}
        </div>
      </div>
      <div className="space-y-1.5 overflow-y-auto" style={{ maxHeight: 196 }}>
        {agents.slice(0, 6).map((agent, i) => {
          const avatar = AGENT_AVATARS[agent.id];
          const statusColor =
            agent.status === 'running' ? TEAL    :
            agent.status === 'error'   ? CRIMSON :
            agent.status === 'paused'  ? AMBER   : 'var(--text-muted)';
          return (
            <motion.button
              key={agent.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => onAgentOpen(agent.id)}
              className="w-full flex items-center gap-2 py-1 text-left group transition-all"
            >
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: avatar?.gradient || 'rgba(255,255,255,0.08)' }}
              >
                <span style={{ fontSize: 9 }}>{avatar?.emoji || '🤖'}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-ui text-[10px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {agent.label}
                  </span>
                  <div
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{
                      background: statusColor,
                      boxShadow: agent.status === 'running' ? `0 0 5px ${statusColor}` : 'none',
                    }}
                  />
                </div>
                <p className="font-mono text-[8px] truncate" style={{ color: 'var(--text-muted)' }}>
                  {agent.task}
                </p>
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

// ── Deep Work View ───────────────────────────────────────────────────
function DeepWorkView({ items, onDispatch, onAgentOpen }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center gap-6 py-4"
    >
      <div className="w-full max-w-lg">
        <TodaysFocus
          items={items}
          onDispatch={onDispatch}
          onAgentOpen={onAgentOpen}
          emphasized
        />
      </div>
      <p className="font-mono text-[9px] tracking-[0.25em]" style={{ color: 'var(--text-muted)' }}>
        DEEP WORK ACTIVE · ALL NON-CRITICAL PANELS HIDDEN
      </p>
    </motion.div>
  );
}

// ── Executive Floor ──────────────────────────────────────────────────
export default function ExecutiveFloor({ data }) {
  const {
    operatingMode,
    setOperatingMode,
    setActiveAgentId,
    setActiveSection,
  } = useStore();

  const {
    agents        = [],
    approvals     = [],
    queue         = [],
    outputs       = [],
    metrics       = [],
    revenueBrands = [],
  } = data || {};

  const runningAgents = agents.filter(a => a.status === 'running');
  const errorAgents   = agents.filter(a => a.status === 'error');
  const readyOutputs  = outputs.filter(o => o.status === 'ready_for_review');

  // Derive Today's Focus (max 3 items, priority-ordered)
  const focusItems = useMemo(() => {
    const items = [];

    errorAgents.slice(0, 1).forEach(a => {
      items.push({
        id: `error-${a.id}`, type: 'error',
        text: `${a.label} — ${a.task}`,
        agentId: a.id, action: 'Fix',
        color: CRIMSON,
      });
    });

    if (approvals.length > 0 && items.length < 3) {
      items.push({
        id: 'approvals', type: 'approval',
        text: `${approvals.length} action${approvals.length !== 1 ? 's' : ''} waiting for your approval`,
        agentId: null, action: 'Review',
        color: AMBER, section: 'telegram',
      });
    }

    queue.filter(q => q.status === 'running').slice(0, 1).forEach(q => {
      if (items.length < 3) items.push({
        id: q.id, type: 'running',
        text: q.label,
        agentId: null, action: 'Monitor',
        color: TEAL, section: 'mission-control',
      });
    });

    queue.filter(q => q.status === 'pending').forEach(q => {
      if (items.length < 3) items.push({
        id: q.id, type: 'pending',
        text: q.label,
        agentId: null, action: 'Dispatch',
        color: GOLD, section: 'task-dispatch',
      });
    });

    return items.slice(0, 3);
  }, [errorAgents, approvals, queue]);

  // Build briefing
  const briefing = useMemo(() => {
    const hour = new Date().getHours();
    const greeting =
      hour < 12 ? 'Good morning, Mika.' :
      hour < 17 ? 'Good afternoon, Mika.' :
                  'Good evening, Mika.';

    const parts = [];
    if (runningAgents.length > 0)
      parts.push(`${runningAgents.length} agent${runningAgents.length !== 1 ? 's' : ''} working`);
    if (approvals.length > 0)
      parts.push(`${approvals.length} approval${approvals.length !== 1 ? 's' : ''} waiting`);
    if (errorAgents.length > 0)
      parts.push(`${errorAgents.length} error${errorAgents.length !== 1 ? 's' : ''} need attention`);
    if (readyOutputs.length > 0)
      parts.push(`${readyOutputs.length} output${readyOutputs.length !== 1 ? 's' : ''} ready to review`);

    const summary = parts.length > 0
      ? parts.join(' · ') + '.'
      : 'All systems nominal. Nothing requires immediate attention.';

    const stats = [
      { label: 'AGENTS LIVE',   value: runningAgents.length, color: TEAL  },
      { label: 'APPROVALS',     value: approvals.length,      color: approvals.length > 0 ? AMBER : EMERALD },
      { label: 'READY TO SHIP', value: readyOutputs.length,   color: GOLD  },
    ];

    return { greeting, summary, stats };
  }, [runningAgents, approvals, errorAgents, readyOutputs]);

  // Mode flags
  const isDeepWork  = operatingMode === 'deep-work';
  const isFocus     = operatingMode === 'focus';
  const isLowEnergy = operatingMode === 'low-energy';
  const isHighEnergy = operatingMode === 'high-energy';
  const showRevenue = isHighEnergy || (operatingMode === 'normal');

  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-4">

      {/* Mode Selector */}
      <motion.div variants={fadeUp}>
        <ModeSelector mode={operatingMode} onChange={setOperatingMode} />
      </motion.div>

      {/* Daily Briefing — always visible */}
      <DailyBriefing briefing={briefing} />

      {/* Deep Work — Today's Focus only */}
      {isDeepWork && (
        <DeepWorkView
          items={focusItems}
          onDispatch={setActiveSection}
          onAgentOpen={setActiveAgentId}
        />
      )}

      {/* All other modes — full layout with emphasis shifts */}
      {!isDeepWork && (
        <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-4">

          {/* Top Row: Today's Focus · Money Opportunities · Quick Wins */}
          <motion.div variants={fadeUp} className="grid grid-cols-3 gap-4">
            <TodaysFocus
              items={focusItems}
              onDispatch={setActiveSection}
              onAgentOpen={setActiveAgentId}
              emphasized={isFocus}
            />
            <MoneyOpportunities
              items={MOCK_MONEY_OPS}
              onAgentOpen={setActiveAgentId}
              faded={isFocus}
              bright={isLowEnergy}
            />
            <QuickWins
              outputs={readyOutputs}
              onAgentOpen={setActiveAgentId}
              faded={isFocus}
              bright={isLowEnergy}
            />
          </motion.div>

          {/* Revenue Snapshot — normal + high energy */}
          <AnimatePresence>
            {showRevenue && (
              <motion.div
                key="revenue"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.28 }}
              >
                <RevenueSnapshot metrics={metrics} brands={revenueBrands} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Bottom Row: AI Activity · Waiting On · Active Agents */}
          <motion.div variants={fadeUp} className="grid grid-cols-3 gap-4">
            <AIActivityFeed
              agents={agents}
              outputs={outputs}
              faded={isFocus || isLowEnergy}
            />
            <WaitingOn
              approvals={approvals}
              onDispatch={setActiveSection}
              faded={isLowEnergy}
            />
            <ActiveAgentsMini
              agents={agents}
              onAgentOpen={setActiveAgentId}
              faded={isFocus || isLowEnergy}
            />
          </motion.div>

        </motion.div>
      )}

    </motion.div>
  );
}
