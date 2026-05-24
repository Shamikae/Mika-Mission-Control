// components/layout/TopBar.jsx
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '../../lib/store';
import config from '../../lib/config';

const SECTION_TITLES = {
  'mission-control': ['Mission Control',       'Daily overview & active operations'],
  'agents-hub':      ['Agents',                'All AI agents at a glance'],
  'openclaw-status': ['System Status',         'Gateway health & agent sessions'],
  'telegram':        ['Approvals',             'Pending human-in-the-loop decisions'],
  'digital-diamond': ['Digital Diamond AI',    'AI consulting & automation services'],
  'managed-by-mika': ['Managed by Mika',       'AI-powered property management'],
  'medai':           ['MedAI Receptionist',    'Medical front-desk AI agent'],
  'cannaops':        ['CannaOps',              'Cannabis dispensary automation'],
  'hotel-hooker':    ['Hotel Hooker',          'Boutique hospitality content support'],
  'ai-twin':         ['AI Twin Studio',        'Personal AI content creation'],
  'lead-recovery':   ['Lead Recovery',         'Multi-channel reactivation workflows'],
  'prompt-library':  ['Prompt Library',        'Curated agent prompt arsenal'],
  'goals':           ['Goals',                 'Business milestones & progress tracking'],
  'journal':         ['Journal',               'Daily log & AI-generated debriefs'],
  'memory-vault':    ['Memory Vault',          'Persistent knowledge base & context'],
};

const SunIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5"/>
    <line x1="12" y1="1" x2="12" y2="3"/>
    <line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1" y1="12" x2="3" y2="12"/>
    <line x1="21" y1="12" x2="23" y2="12"/>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>
);

const MoonIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
);

export default function TopBar({ gatewayStatus }) {
  const { activeSection, pendingApprovals, theme, toggleTheme } = useStore();
  const [time, setTime] = useState('');
  const [date, setDate] = useState('');

  const timezone = config.ui.timezone;

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString('en-US', { hour12: false, timeZone: timezone }));
      setDate(now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: timezone }));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timezone]);

  const [title, subtitle] = SECTION_TITLES[activeSection] || ['Dashboard', ''];
  const isOnline = gatewayStatus?.online;
  const mode     = gatewayStatus?.mode || 'OFFLINE';

  return (
    <header
      className="h-14 flex items-center justify-between px-6 border-b flex-shrink-0 z-10 backdrop-blur-xl"
      style={{
        background: 'var(--bg-topbar)',
        borderColor: 'var(--border-default)',
      }}
    >
      {/* Left: section title */}
      <motion.div
        key={activeSection}
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="flex items-center gap-4"
      >
        <div>
          <h1 className="font-display text-lg font-semibold leading-none" style={{ color: 'var(--text-primary)' }}>
            {title}
          </h1>
          <p className="font-mono text-[9px] tracking-wider mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {subtitle}
          </p>
        </div>
      </motion.div>

      {/* Center: status indicators */}
      <div className="flex items-center gap-4">
        {/* Gateway mode */}
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
          style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)' }}
        >
          <div className={`status-dot ${isOnline ? 'online' : 'offline'}`} style={{ width: 6, height: 6 }} />
          <span className="font-mono text-[9px] tracking-widest" style={{ color: 'var(--text-secondary)' }}>
            {isOnline ? mode : 'OFFLINE'}
          </span>
          {isOnline && (
            <span className="font-mono text-[9px]" style={{ color: 'var(--gold)' }}>
              {gatewayStatus?.latencyMs}ms
            </span>
          )}
        </div>

        {/* Agents count */}
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>AGENTS</span>
          <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--teal)' }}>
            {gatewayStatus?.activeAgents ?? '—'} active
          </span>
        </div>

        {/* Pending approvals */}
        {pendingApprovals.length > 0 && (
          <motion.div
            animate={{ opacity: [1, 0.5, 1] }}
            transition={{ repeat: Infinity, duration: 2 }}
            className="flex items-center gap-1.5"
          >
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#ef4444', boxShadow: '0 0 6px #ef4444' }} />
            <span className="font-mono text-[9px] tracking-wider" style={{ color: '#ef4444' }}>
              {pendingApprovals.length} PENDING
            </span>
          </motion.div>
        )}
      </div>

      {/* Right: clock + theme toggle */}
      <div className="flex items-center gap-4">
        {/* Theme toggle */}
        <motion.button
          onClick={toggleTheme}
          whileTap={{ scale: 0.9 }}
          className="w-8 h-8 rounded-lg flex items-center justify-center transition-all"
          style={{
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-default)',
            color: theme === 'dark' ? 'var(--gold)' : 'var(--text-secondary)',
          }}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          <motion.span
            key={theme}
            initial={{ rotate: -20, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </motion.span>
        </motion.button>

        {/* Clock */}
        <div className="text-right">
          <div className="font-mono text-sm font-semibold tracking-wider leading-none" style={{ color: 'var(--gold)' }}>
            {time}
          </div>
          <div className="font-mono text-[8px] tracking-widest mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {date} · {timezone}
          </div>
        </div>
      </div>
    </header>
  );
}
