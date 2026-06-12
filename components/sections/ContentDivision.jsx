// components/sections/ContentDivision.jsx
// Main Content Division container. Routes between studios, analytics, video router, and Twin Studio.
// ADHD-optimized: overview mode shows only what's active. Studios accessed via tab selector.

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../../lib/store';
import { GoldDivider } from '../ui';
import ContentStudio from './ContentStudio';
import ContentPipeline from './ContentPipeline';
import VideoRouterArchitecture from './VideoRouterArchitecture';
import AnalyticsRoom from './AnalyticsRoom';
import MikaTwinStudio from './MikaTwinStudio';
import ContentBriefGenerator from './ContentBriefGenerator';
import ViralContentWorkflowPanel from './ViralContentWorkflowPanel';
import ContentArtifactsPanel from './ContentArtifactsPanel';
import VideoFactory from './VideoFactory';

// ── Studio definitions ───────────────────────────────────────────────
const STUDIOS = [
  { id: 'tiktok',    label: 'TikTok',    icon: '📱', color: '#69c9d0' },
  { id: 'instagram', label: 'Instagram', icon: '📸', color: '#e1306c' },
  { id: 'linkedin',  label: 'LinkedIn',  icon: '💼', color: '#0a7abf' },
  { id: 'youtube',   label: 'YouTube',   icon: '▶',  color: '#ef4444' },
  { id: 'pinterest', label: 'Pinterest', icon: '📌', color: '#bd081c' },
  { id: 'twitter',   label: 'X / Twitter',icon: '𝕏', color: '#1d9bf0' },
  { id: 'blog',      label: 'Blog',      icon: '✍',  color: '#c9a84c' },
  { id: 'podcast',   label: 'Podcast',   icon: '🎙', color: '#8b5cf6' },
];

const SPECIAL_VIEWS = [
  { id: 'analytics',     label: 'Analytics',     icon: '◆', color: '#10b981' },
  { id: 'video-router',  label: 'Video Router',   icon: '▷', color: '#3b82f6' },
  { id: 'twin-studio',   label: 'Mika Twin',      icon: '🪞', color: '#60a5fa' },
  { id: 'new-brief',     label: 'New Brief',      icon: '✦', color: '#3b82f6' },
  { id: 'viral-workflow',label: 'Viral Workflow', icon: '♻', color: '#4ade80' },
  { id: 'content-assets',  label: 'Asset Library',  icon: '◈', color: '#10b981' },
  { id: 'video-factory',   label: 'Video Factory',  icon: '▷', color: '#f59e0b' },
];

const ALL_TABS = [...STUDIOS, ...SPECIAL_VIEWS];

const stagger = { initial: {}, animate: { transition: { staggerChildren: 0.06 } } };
const fadeUp  = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0, transition: { duration: 0.28 } } };
const pageAnim = {
  initial: { opacity: 0, x: 8 },
  animate: { opacity: 1, x: 0, transition: { duration: 0.25 } },
  exit:    { opacity: 0, x: -8, transition: { duration: 0.15 } },
};

// ── Overview ADHD panel ──────────────────────────────────────────────
function OverviewPanel({ onSelectStudio }) {
  const { setActiveSection } = useStore();

  const quickActions = [
    { label: 'Generate 10 TikTok Hooks',       icon: '🪝', studio: 'tiktok',   section: 'task-dispatch' },
    { label: 'Research Today\'s Trends',        icon: '🔭', studio: null,       section: 'hermes-chat'   },
    { label: 'Batch This Week\'s Scripts',      icon: '📐', studio: null,       section: 'task-dispatch' },
  ];

  const contentSummary = [
    { studio: 'tiktok',    label: 'TikTok',      queued: 5, campaigns: 2, color: '#69c9d0' },
    { studio: 'instagram', label: 'Instagram',   queued: 5, campaigns: 2, color: '#e1306c' },
    { studio: 'linkedin',  label: 'LinkedIn',    queued: 4, campaigns: 2, color: '#0a7abf' },
    { studio: 'youtube',   label: 'YouTube',     queued: 4, campaigns: 1, color: '#ef4444' },
    { studio: 'pinterest', label: 'Pinterest',   queued: 3, campaigns: 2, color: '#bd081c' },
    { studio: 'twitter',   label: 'X / Twitter', queued: 4, campaigns: 1, color: '#1d9bf0' },
    { studio: 'blog',      label: 'Blog',        queued: 4, campaigns: 1, color: '#c9a84c' },
    { studio: 'podcast',   label: 'Podcast',     queued: 4, campaigns: 1, color: '#8b5cf6' },
  ];

  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-5">

      {/* ADHD Quick Actions */}
      <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4"
        style={{ borderColor: 'rgba(59,130,246,0.2)' }}>
        <div className="flex items-center justify-between mb-3">
          <div className="font-mono text-[8px] tracking-[0.2em] uppercase" style={{ color: '#3b82f6' }}>
            QUICK ACTIONS
          </div>
          <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>ADHD PRIORITY</span>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {quickActions.map((qa, i) => (
            <button
              key={i}
              onClick={() => {
                if (qa.studio) onSelectStudio(qa.studio);
                setActiveSection(qa.section);
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-sm transition-all"
              style={{
                background: 'rgba(59,130,246,0.08)',
                border: '1px solid rgba(59,130,246,0.22)',
                color: '#3b82f6',
              }}
            >
              <span style={{ fontSize: 14 }}>{qa.icon}</span>
              <span className="font-ui text-[10px] font-semibold tracking-wider">{qa.label}</span>
            </button>
          ))}
        </div>
      </motion.div>

      {/* Content Pipeline */}
      <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4">
        <div className="font-mono text-[8px] tracking-[0.2em] uppercase mb-3" style={{ color: 'var(--text-muted)' }}>
          CONTENT PIPELINE · ALL STUDIOS
        </div>
        <ContentPipeline compact />
      </motion.div>

      {/* Studio status grid */}
      <motion.div variants={fadeUp}>
        <div className="font-mono text-[8px] tracking-[0.2em] uppercase mb-3" style={{ color: 'var(--text-muted)' }}>
          STUDIO OVERVIEW
        </div>
        <div className="grid grid-cols-4 gap-3">
          {contentSummary.map((s, i) => (
            <motion.button
              key={s.studio}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              onClick={() => onSelectStudio(s.studio)}
              className="panel-gold rounded-sm p-3 text-left transition-all card-hover"
              style={{ borderColor: `${s.color}20` }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-ui text-xs font-semibold" style={{ color: s.color }}>
                  {STUDIOS.find(st => st.id === s.studio)?.icon} {s.label}
                </span>
                <span className="font-mono text-[7px] px-1.5 py-0.5 rounded-sm"
                  style={{ color: '#10b981', background: '#10b98112', border: '1px solid #10b98122' }}>
                  ACTIVE
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div>
                  <div className="font-mono text-base font-bold" style={{ color: s.color }}>{s.queued}</div>
                  <div className="font-mono text-[7px]" style={{ color: 'var(--text-muted)' }}>IN QUEUE</div>
                </div>
                <div>
                  <div className="font-mono text-base font-bold" style={{ color: s.color }}>{s.campaigns}</div>
                  <div className="font-mono text-[7px]" style={{ color: 'var(--text-muted)' }}>CAMPAIGNS</div>
                </div>
              </div>
            </motion.button>
          ))}
        </div>
      </motion.div>

    </motion.div>
  );
}

// ── ContentDivision ──────────────────────────────────────────────────
export default function ContentDivision({ initialView = 'overview' }) {
  const [activeView, setActiveView] = useState(initialView);

  const activeTab = ALL_TABS.find(t => t.id === activeView);
  const activeColor = activeTab?.color || '#c9a84c';

  return (
    <div className="space-y-4">

      {/* Division header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-display text-2xl font-light" style={{ color: 'var(--text-primary)' }}>
            Content Division
          </h2>
          <p className="font-mono text-[9px] tracking-wider mt-0.5" style={{ color: 'var(--text-muted)' }}>
            6 STUDIOS · 12 AI EMPLOYEES · ARCHITECTURE MODE
          </p>
        </div>
        {activeView !== 'overview' && (
          <button
            onClick={() => setActiveView('overview')}
            className="font-mono text-[9px] tracking-wider transition-all px-3 py-1.5 rounded-sm"
            style={{
              color: 'var(--text-muted)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            ← OVERVIEW
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 flex-wrap">
        {/* Overview */}
        <button
          onClick={() => setActiveView('overview')}
          className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-sm transition-all"
          style={{
            background: activeView === 'overview' ? 'rgba(201,168,76,0.1)' : 'rgba(255,255,255,0.02)',
            border: `1px solid ${activeView === 'overview' ? 'rgba(201,168,76,0.3)' : 'rgba(255,255,255,0.06)'}`,
            color: activeView === 'overview' ? '#c9a84c' : 'var(--text-muted)',
          }}
        >
          <span style={{ fontSize: 10 }}>⬡</span>
          <span className="font-ui text-[10px] font-semibold tracking-wider">OVERVIEW</span>
        </button>

        <div className="w-px h-4 mx-1" style={{ background: 'rgba(255,255,255,0.06)' }} />

        {/* Studio tabs */}
        {STUDIOS.map(studio => {
          const isActive = activeView === studio.id;
          return (
            <button
              key={studio.id}
              onClick={() => setActiveView(studio.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm transition-all"
              style={{
                background: isActive ? `${studio.color}12` : 'rgba(255,255,255,0.02)',
                border: `1px solid ${isActive ? `${studio.color}35` : 'rgba(255,255,255,0.06)'}`,
                color: isActive ? studio.color : 'var(--text-muted)',
              }}
            >
              <span style={{ fontSize: 11 }}>{studio.icon}</span>
              <span className="font-ui text-[10px] font-semibold tracking-wider">{studio.label}</span>
            </button>
          );
        })}

        <div className="w-px h-4 mx-1" style={{ background: 'rgba(255,255,255,0.06)' }} />

        {/* Special views */}
        {SPECIAL_VIEWS.map(view => {
          const isActive = activeView === view.id;
          return (
            <button
              key={view.id}
              onClick={() => setActiveView(view.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm transition-all"
              style={{
                background: isActive ? `${view.color}12` : 'rgba(255,255,255,0.02)',
                border: `1px solid ${isActive ? `${view.color}35` : 'rgba(255,255,255,0.06)'}`,
                color: isActive ? view.color : 'var(--text-muted)',
              }}
            >
              <span style={{ fontSize: 10 }}>{view.icon}</span>
              <span className="font-ui text-[10px] font-semibold tracking-wider">{view.label}</span>
            </button>
          );
        })}
      </div>

      {/* Content area */}
      <AnimatePresence mode="wait">
        <motion.div key={activeView} {...pageAnim}>
          {activeView === 'overview' && (
            <OverviewPanel onSelectStudio={setActiveView} />
          )}
          {STUDIOS.some(s => s.id === activeView) && (
            <ContentStudio studioId={activeView} />
          )}
          {activeView === 'analytics' && (
            <AnalyticsRoom />
          )}
          {activeView === 'video-router' && (
            <VideoRouterArchitecture />
          )}
          {activeView === 'twin-studio' && (
            <MikaTwinStudio />
          )}
          {activeView === 'new-brief' && (
            <ContentBriefGenerator />
          )}
          {activeView === 'viral-workflow' && (
            <div className="space-y-4">
              <div>
                <h3 className="font-ui text-base font-bold mb-0.5" style={{ color: 'var(--text-primary)' }}>
                  Viral Content Workflow
                </h3>
                <p className="font-mono text-[9px] tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  ENTER A CONTENT BRIEF TASK ID TO EXPAND INTO A 7-STAGE WORKFLOW
                </p>
              </div>
              <ViralContentWorkflowPanel briefTaskId={null} />
            </div>
          )}
          {activeView === 'content-assets' && (
            <ContentArtifactsPanel />
          )}
          {activeView === 'video-factory' && (
            <VideoFactory />
          )}
        </motion.div>
      </AnimatePresence>

    </div>
  );
}
