// components/sections/AgentsHub.jsx — clickable grid of all agents
import { motion } from 'framer-motion';
import { useStore } from '../../lib/store';
import { AGENT_AVATARS } from '../../lib/agent-avatars';

const MOCK_STATUS = {
  mika: 'running', diamond: 'running', medbot: 'running', cannabot: 'error',
  hookr: 'paused', twin: 'running', recovery: 'idle', hermes: 'idle', sentinel: 'running',
};

const STATUS_META = {
  running: { label: 'Running',  color: '#0dd3c5', bg: 'rgba(13,211,197,0.1)',  dot: 'running' },
  idle:    { label: 'Idle',     color: '#c9a84c', bg: 'rgba(201,168,76,0.1)',  dot: 'idle' },
  paused:  { label: 'Paused',   color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  dot: 'paused' },
  error:   { label: 'Error',    color: '#ef4444', bg: 'rgba(239,68,68,0.1)',   dot: 'error' },
  stopped: { label: 'Stopped',  color: '#6b7280', bg: 'rgba(107,114,128,0.1)', dot: 'offline' },
};

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};
const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.4, 0, 0.2, 1] } },
};

export default function AgentsHub({ agents = [] }) {
  const { setActiveAgentId, agentStatusOverrides } = useStore();
  const liveCount = Object.values(MOCK_STATUS).filter(s => s === 'running').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h2 className="font-display text-3xl font-semibold" style={{ color: 'var(--text-primary)' }}>AI Agents</h2>
          <p className="font-mono text-[10px] tracking-wider mt-1" style={{ color: 'var(--text-muted)' }}>
            {agents.length} AGENTS CONFIGURED · {liveCount} LIVE
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full"
          style={{ background: 'rgba(13,211,197,0.08)', border: '1px solid rgba(13,211,197,0.2)' }}>
          <motion.div
            className="status-dot running"
            animate={{ scale: [1, 1.3, 1] }}
            transition={{ repeat: Infinity, duration: 2 }}
          />
          <span className="font-mono text-[10px] font-semibold" style={{ color: '#0dd3c5' }}>
            {liveCount} ONLINE
          </span>
        </div>
      </div>

      {/* Grid */}
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid grid-cols-2 xl:grid-cols-3 gap-4"
      >
        {agents.map((agent) => {
          const avatar   = AGENT_AVATARS[agent.id] || { emoji: '🤖', color: '#8892a4', gradient: 'linear-gradient(135deg,#374151,#1f2937)' };
          const rawStatus = agentStatusOverrides[agent.id] || MOCK_STATUS[agent.id] || 'idle';
          const statusMeta = STATUS_META[rawStatus] || STATUS_META.idle;

          return (
            <motion.div
              key={agent.id}
              variants={item}
              onClick={() => setActiveAgentId(agent.id)}
              className="agent-card group cursor-pointer"
              style={{
                background: 'var(--bg-panel)',
                border: `1px solid var(--border-default)`,
                borderRadius: 12,
                padding: '20px',
                transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
              }}
              whileHover={{
                y: -4,
                boxShadow: `0 12px 40px rgba(0,0,0,0.3), 0 0 0 1px ${avatar.color}30`,
                borderColor: `${avatar.color}35`,
              }}
              whileTap={{ scale: 0.98 }}
            >
              {/* Color accent bar */}
              <div
                className="absolute inset-x-0 top-0 h-0.5 rounded-t-xl opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: avatar.gradient }}
              />

              {/* Top row: avatar + status */}
              <div className="flex items-start justify-between mb-4">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shadow-lg"
                  style={{
                    background: avatar.gradient,
                    boxShadow: `0 4px 16px ${avatar.color}30`,
                  }}
                >
                  {avatar.emoji}
                </div>

                <div
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-mono font-semibold"
                  style={{ background: statusMeta.bg, color: statusMeta.color }}
                >
                  <div className={`status-dot ${statusMeta.dot}`} style={{ width: 5, height: 5 }} />
                  {statusMeta.label}
                </div>
              </div>

              {/* Name + description */}
              <div className="mb-4">
                <h3 className="font-ui text-base font-bold mb-1 group-hover:transition-colors"
                  style={{ color: 'var(--text-primary)' }}>
                  {agent.label}
                </h3>
                <p className="text-xs leading-relaxed line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
                  {agent.description}
                </p>
              </div>

              {/* Meta row */}
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="font-mono text-[9px] px-2 py-0.5 rounded-md"
                  style={{
                    background: `${avatar.color}10`,
                    color: avatar.color,
                    border: `1px solid ${avatar.color}25`,
                  }}
                >
                  {agent.model.replace('gpt-4o', 'GPT-4o').replace('claude-3-5-sonnet-20241022', 'Sonnet 3.5')}
                </span>
                {agent.memory && (
                  <span className="font-mono text-[9px] px-2 py-0.5 rounded-md"
                    style={{ background: 'rgba(13,211,197,0.08)', color: '#0dd3c5', border: '1px solid rgba(13,211,197,0.15)' }}>
                    memory
                  </span>
                )}
                {agent.schedule && (
                  <span className="font-mono text-[9px] px-2 py-0.5 rounded-md"
                    style={{ background: 'var(--bg-overlay)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}>
                    scheduled
                  </span>
                )}
              </div>

              {/* Open hint */}
              <div
                className="mt-4 pt-3 border-t flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                <span className="font-ui text-[10px] font-semibold tracking-wide" style={{ color: avatar.color }}>
                  Open Workspace
                </span>
                <span style={{ color: avatar.color }}>→</span>
              </div>
            </motion.div>
          );
        })}
      </motion.div>
    </div>
  );
}
