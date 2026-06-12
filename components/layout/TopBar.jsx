import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { FiCheckSquare, FiMoon, FiSun } from 'react-icons/fi';
import { useStore } from '../../lib/store';
import config from '../../lib/config';
import { getWorkspaceMeta } from '../../lib/navigation/workspaceRegistry';

const GROUP_NUMERALS = {
  Workspace: 'I.',
  Agents: 'II.',
  Self: 'III.',
  Content: 'IV.',
  Business: 'V.',
};

export default function TopBar({ gatewayStatus, openclawStatus }) {
  const { activeSection, activeAgentId, pendingApprovals, theme, toggleTheme, setActiveSection } = useStore();
  const [time, setTime] = useState('');

  useEffect(() => {
    const tick = () => {
      setTime(new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: config.ui.timezone,
      }));
    };
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, []);

  const currentId = activeAgentId || activeSection;
  const meta = getWorkspaceMeta(currentId, config.agents);
  const title = meta?.label || 'Mission Control';
  const group = meta?.group || 'Workspace';
  const chapter = meta?.parentLabel ? `${meta.parentLabel} · ${title}` : `${group} · ${title}`;
  const subtitle = meta?.description || 'Status of every agent, workflow, approval, and business signal.';
  const gatewayVerified = gatewayStatus?.online === true && openclawStatus?.source !== 'mock';
  const gatewayLabel = gatewayVerified ? 'Gateway verified' : 'Gateway unknown';

  return (
    <header className="agent-os-topbar">
      <motion.div
        key={currentId}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="min-w-0"
      >
        <div className="agent-os-eyebrow">
          <span className="agent-os-numeral">{GROUP_NUMERALS[group] || 'I.'}</span>
          <span className="agent-os-rule" />
          <span>{chapter}</span>
        </div>
        <h1 className="agent-os-page-title">{title}</h1>
        <p className="agent-os-page-subtitle">{subtitle}</p>
        <div className="agent-os-page-meta">
          <span>{time}</span>
          <span>·</span>
          <span>{gatewayLabel}</span>
          <span>·</span>
          <span>{config.ui.timezone}</span>
        </div>
      </motion.div>

      <div className="agent-os-top-actions">
        {pendingApprovals.length > 0 && (
          <button className="agent-os-action-button" onClick={() => setActiveSection('telegram')}>
            <FiCheckSquare size={15} />
            {pendingApprovals.length} pending
          </button>
        )}
        <button
          className="agent-os-icon-button"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <FiSun size={16} /> : <FiMoon size={16} />}
        </button>
      </div>
    </header>
  );
}
