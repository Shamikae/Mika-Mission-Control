// components/layout/Sidebar.jsx
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../../lib/store';
import { AGENT_AVATARS } from '../../lib/agent-avatars';
import config from '../../lib/config';
import clsx from 'clsx';

const NAV_SECTIONS = [
  { id: 'mission-control',  label: 'Mission Control',    icon: '⬡', group: 'core' },
  { id: 'agents-hub',       label: 'All Agents',         icon: '◈', group: 'core' },
  { id: 'openclaw-status',  label: 'System Status',      icon: '◉', group: 'core' },
  { id: 'telegram',         label: 'Approvals',          icon: '✉', group: 'core', badge: 'approvals' },
  { id: 'digital-diamond',  label: 'Digital Diamond AI', icon: '◆', group: 'brands' },
  { id: 'managed-by-mika',  label: 'Managed by Mika',   icon: '⬟', group: 'brands' },
  { id: 'medai',            label: 'MedAI',              icon: '✚', group: 'brands' },
  { id: 'cannaops',         label: 'CannaOps',           icon: '◉', group: 'brands' },
  { id: 'hotel-hooker',     label: 'Hotel Hooker',       icon: '♦', group: 'brands' },
  { id: 'ai-twin',          label: 'AI Twin Studio',     icon: '⬡', group: 'brands' },
  { id: 'lead-recovery',    label: 'Lead Recovery',      icon: '◎', group: 'brands' },
  { id: 'prompt-library',   label: 'Prompt Library',     icon: '⌘', group: 'intel' },
  { id: 'goals',            label: 'Goals',              icon: '◭', group: 'intel' },
  { id: 'journal',          label: 'Journal',            icon: '◳', group: 'intel' },
  { id: 'memory-vault',     label: 'Memory Vault',       icon: '⬡', group: 'intel' },
];

const GROUPS = {
  core:   'COMMAND',
  brands: 'BRANDS',
  intel:  'INTELLIGENCE',
};

const PROJECT_COLORS = Object.fromEntries(config.projects.map(project => [project.id, project.color]));

const MOCK_AGENT_STATUS = {
  mika:     'running',
  diamond:  'running',
  medbot:   'running',
  cannabot: 'error',
  hookr:    'paused',
  twin:     'running',
  recovery: 'idle',
  hermes:   'idle',
  sentinel: 'running',
};

const STATUS_DOT_COLOR = {
  running: '#0dd3c5',
  idle:    '#c9a84c',
  paused:  '#f59e0b',
  error:   '#ef4444',
  stopped: '#4b5563',
};

function AgentAvatar({ agentId, size = 28, showStatus, status }) {
  const avatar = AGENT_AVATARS[agentId] || { emoji: '🤖', color: '#8892a4', gradient: 'linear-gradient(135deg,#374151,#1f2937)' };
  const dotColor = STATUS_DOT_COLOR[status] || '#4b5563';
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <div
        className="w-full h-full rounded-full flex items-center justify-center text-sm"
        style={{ background: avatar.gradient, boxShadow: `0 2px 8px ${avatar.color}30` }}
      >
        <span style={{ fontSize: size * 0.42 }}>{avatar.emoji}</span>
      </div>
      {showStatus && (
        <div
          className="absolute -bottom-0.5 -right-0.5 rounded-full border-2"
          style={{
            width: 9,
            height: 9,
            background: dotColor,
            borderColor: 'var(--bg-sidebar)',
            boxShadow: status === 'running' ? `0 0 6px ${dotColor}` : undefined,
          }}
        />
      )}
    </div>
  );
}

export default function Sidebar() {
  const {
    activeSection, setActiveSection,
    activeAgentId, setActiveAgentId,
    sidebarCollapsed, toggleSidebar,
    pendingApprovals,
    agentStatusOverrides,
  } = useStore();

  const approvalCount = pendingApprovals.length;
  const grouped = NAV_SECTIONS.reduce((acc, item) => {
    if (!acc[item.group]) acc[item.group] = [];
    acc[item.group].push(item);
    return acc;
  }, {});

  const liveCount = Object.values(MOCK_AGENT_STATUS).filter(s => s === 'running').length;

  return (
    <motion.aside
      animate={{ width: sidebarCollapsed ? 60 : 232 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      className="relative flex flex-col h-full border-r z-20 flex-shrink-0 overflow-hidden"
      style={{
        background: 'var(--bg-sidebar)',
        borderColor: 'var(--border-default)',
        boxShadow: '2px 0 20px rgba(0,0,0,0.15)',
      }}
    >
      <div className="absolute inset-0 scanlines pointer-events-none opacity-50" />

      {/* ── Logo ─────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-3 px-4 py-4 border-b flex-shrink-0"
        style={{ borderColor: 'var(--border-default)' }}
      >
        <motion.div
          className="w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center shadow-lg"
          style={{ background: 'linear-gradient(135deg, #c9a84c 0%, #e5d080 50%, #c9a84c 100%)' }}
          animate={{ rotate: [0, 360] }}
          transition={{ duration: 24, repeat: Infinity, ease: 'linear' }}
        >
          <span className="font-ui font-black text-[10px] text-[#07090f] tracking-tighter">MM</span>
        </motion.div>
        <AnimatePresence>
          {!sidebarCollapsed && (
            <motion.div
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.2 }}
            >
              <div className="font-ui font-bold text-sm leading-none tracking-wide" style={{ color: 'var(--text-primary)' }}>MIKA</div>
              <div className="font-mono text-[8px] tracking-[0.18em] mt-0.5" style={{ color: 'var(--gold)' }}>MISSION CONTROL</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Nav ──────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2">

        {Object.entries(grouped).map(([group, items]) => (
          <div key={group} className="mb-1">
            <AnimatePresence>
              {!sidebarCollapsed && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="font-mono text-[8px] tracking-[0.2em] px-4 py-2"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {GROUPS[group]}
                </motion.div>
              )}
            </AnimatePresence>

            {items.map((item) => {
              const isActive = activeSection === item.id && !activeAgentId;
              const color    = PROJECT_COLORS[item.id] || 'var(--gold)';
              const badge    = item.badge === 'approvals' && approvalCount > 0 ? approvalCount : null;

              return (
                <motion.button
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                  whileTap={{ scale: 0.97 }}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left transition-all relative group"
                  style={{
                    color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                    background: isActive ? `linear-gradient(90deg, ${color}12, transparent)` : undefined,
                    borderRadius: '0 6px 6px 0',
                    marginRight: 8,
                    width: 'calc(100% - 8px)',
                  }}
                >
                  {isActive && (
                    <motion.div
                      layoutId="sectionActiveBar"
                      className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r"
                      style={{ background: color, boxShadow: `0 0 8px ${color}` }}
                    />
                  )}
                  <span
                    className="text-[13px] flex-shrink-0 w-5 text-center"
                    style={{ color: isActive ? color : undefined, opacity: isActive ? 1 : 0.5 }}
                  >
                    {item.icon}
                  </span>
                  <AnimatePresence>
                    {!sidebarCollapsed && (
                      <motion.span
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="font-ui text-[11px] font-medium truncate flex-1"
                      >
                        {item.label}
                      </motion.span>
                    )}
                  </AnimatePresence>
                  {badge && !sidebarCollapsed && (
                    <span className="flex-shrink-0 font-mono text-[8px] font-bold w-4 h-4 rounded-full flex items-center justify-center text-white"
                      style={{ background: '#ef4444', boxShadow: '0 0 8px rgba(239,68,68,0.5)' }}>
                      {badge}
                    </span>
                  )}
                </motion.button>
              );
            })}
          </div>
        ))}

        {/* ── AGENTS ─────────────────────────────────────────── */}
        <div className="mb-2 mt-1">
          <AnimatePresence>
            {!sidebarCollapsed && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="font-mono text-[8px] tracking-[0.2em] px-4 py-2 flex items-center justify-between"
                style={{ color: 'var(--text-muted)' }}
              >
                <span>AGENTS</span>
                <span className="font-semibold" style={{ color: 'var(--teal)' }}>{liveCount} LIVE</span>
              </motion.div>
            )}
          </AnimatePresence>

          {config.agents.map((agent) => {
            const isActive  = activeAgentId === agent.id;
            const projColor = PROJECT_COLORS[agent.project] || AGENT_AVATARS[agent.id]?.color || '#8892a4';
            const rawStatus = agentStatusOverrides[agent.id] || MOCK_AGENT_STATUS[agent.id] || 'idle';

            return (
              <motion.button
                key={agent.id}
                onClick={() => setActiveAgentId(agent.id)}
                whileTap={{ scale: 0.97 }}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-all relative"
                style={{
                  color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                  background: isActive ? `linear-gradient(90deg, ${projColor}12, transparent)` : undefined,
                  borderRadius: '0 6px 6px 0',
                  marginRight: 8,
                  width: 'calc(100% - 8px)',
                }}
              >
                {isActive && (
                  <motion.div
                    layoutId="agentActiveBar"
                    className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r"
                    style={{ background: projColor, boxShadow: `0 0 8px ${projColor}` }}
                  />
                )}

                <AgentAvatar
                  agentId={agent.id}
                  size={sidebarCollapsed ? 26 : 26}
                  showStatus
                  status={rawStatus}
                />

                <AnimatePresence>
                  {!sidebarCollapsed && (
                    <motion.span
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="font-ui text-[11px] font-semibold truncate flex-1"
                      style={{ color: isActive ? projColor : undefined }}
                    >
                      {agent.label}
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.button>
            );
          })}

          <AnimatePresence>
            {!sidebarCollapsed && (
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-all mt-1"
                style={{ color: 'var(--text-muted)' }}
              >
                <div
                  className="w-6 h-6 rounded-full border-dashed border flex items-center justify-center flex-shrink-0"
                  style={{ borderColor: 'var(--text-muted)', opacity: 0.5 }}
                >
                  <span className="text-xs">+</span>
                </div>
                <span className="font-ui text-[10px] tracking-wider opacity-60">ADD AGENT</span>
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </nav>

      {/* ── Footer ───────────────────────────────────────────── */}
      <div className="border-t p-3 flex-shrink-0" style={{ borderColor: 'var(--border-default)' }}>
        <button
          onClick={toggleSidebar}
          className="w-full flex items-center justify-center gap-2 py-1.5 rounded-lg transition-all"
          style={{ color: 'var(--text-muted)' }}
        >
          <span className="text-xs">{sidebarCollapsed ? '▶' : '◀'}</span>
          <AnimatePresence>
            {!sidebarCollapsed && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="font-mono text-[9px] tracking-widest"
              >
                COLLAPSE
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
    </motion.aside>
  );
}
