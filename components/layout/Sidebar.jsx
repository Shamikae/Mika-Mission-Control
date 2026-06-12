import { motion } from 'framer-motion';
import {
  FiBookOpen,
  FiBox,
  FiBriefcase,
  FiCircle,
  FiCommand,
  FiCpu,
  FiDollarSign,
  FiEdit3,
  FiFilm,
  FiFolder,
  FiGrid,
  FiImage,
  FiInbox,
  FiLayers,
  FiMessageSquare,
  FiPenTool,
  FiTarget,
  FiTrendingUp,
  FiUsers,
} from 'react-icons/fi';
import { useEffect, useState } from 'react';
import { useStore } from '../../lib/store';
import { AGENT_AVATARS } from '../../lib/agent-avatars';
import { buildWorkspaceNavigation, resolveSectionId } from '../../lib/navigation/workspaceRegistry';
import { fetchHermesStatus } from '../../lib/api';

const NAV_ICONS = {
  'mission-control': FiGrid,
  paperclip: FiBriefcase,
  boardroom: FiMessageSquare,
  'diamond-control': FiCommand,
  goals: FiTarget,
  journal: FiEdit3,
  'memory-vault': FiCpu,
  notebook: FiBookOpen,
  'build-guide': FiBookOpen,
  pipeline: FiLayers,
  studio: FiPenTool,
  video: FiFilm,
  thumbnails: FiImage,
  seo: FiTrendingUp,
  kanban: FiGrid,
  leads: FiUsers,
  offers: FiBox,
  clients: FiUsers,
  revenue: FiDollarSign,
  projects: FiFolder,
};

const AGENT_AVATAR_IDS = {
  'openclaw-status': 'openclaw',
  'hermes-workspace': 'hermes',
};

function AgentGlyph({ itemId, label }) {
  const avatar = AGENT_AVATARS[AGENT_AVATAR_IDS[itemId]];
  return (
    <span
      className="agent-os-avatar"
      style={{ background: avatar?.gradient || 'linear-gradient(135deg,#334155,#0f172a)' }}
    >
      {avatar?.initials || label.slice(0, 2)}
    </span>
  );
}

export default function Sidebar() {
  const { activeSection, setActiveSection, activeAgentId } = useStore();
  const navigation = buildWorkspaceNavigation();
  const [hermesStatus, setHermesStatus] = useState(null);

  useEffect(() => {
    let active = true;
    fetchHermesStatus().then(status => {
      if (active) setHermesStatus(status);
    });
    return () => { active = false; };
  }, []);

  const hermesWiredLabel = {
    verified: 'verified',
    configured_unverified: 'configured',
    not_configured: 'not configured',
    failed: 'failed',
    unknown: 'unknown',
  }[hermesStatus?.status] || 'unknown';

  function isItemActive(item) {
    if (activeAgentId) return activeAgentId === item.id;
    return resolveSectionId(activeSection) === item.id;
  }

  return (
    <aside className="agent-os-sidebar">
      <button className="agent-os-brand" onClick={() => setActiveSection('mission-control')}>
        <span className="agent-os-brand-kicker">Local · Command Center</span>
        <span className="agent-os-brand-name">MIKA <em>OS</em></span>
        <span className="agent-os-brand-subtitle">AGENTIC OS™</span>
      </button>

      <nav className="agent-os-nav">
        {navigation.map(group => (
          <section key={group.id} className="agent-os-nav-section">
            <div className="agent-os-section-label">{group.label}</div>
            {group.items.map(item => {
              const active = isItemActive(item);
              const Icon = NAV_ICONS[item.id] || FiCircle;

              return (
                <button
                  key={item.id}
                  className={`agent-os-nav-item ${active ? 'active' : ''}`}
                  onClick={() => setActiveSection(item.id)}
                  title={item.description}
                >
                  {active && (
                    <motion.span
                      layoutId="mika-agent-os-nav-indicator"
                      className="agent-os-active-indicator"
                      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                    />
                  )}
                  <span className="agent-os-nav-icon">
                    {item.agent ? <AgentGlyph itemId={item.id} label={item.label} /> : <Icon size={17} />}
                  </span>
                  <span className="agent-os-nav-label">{item.label}</span>
                </button>
              );
            })}
          </section>
        ))}
      </nav>

      <div className="agent-os-sidebar-footer">
        <div className="agent-os-section-label">Wired</div>
        <p>claude · openclaw · hermes {hermesWiredLabel}</p>
        <button onClick={() => setActiveSection('knowledge-graph')}>
          <span>+</span> Obsidian vault
        </button>
      </div>
    </aside>
  );
}
