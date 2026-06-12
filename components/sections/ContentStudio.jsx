// components/sections/ContentStudio.jsx
// Generic studio view — rendered for every platform. Driven by data/content-studios/[id].json.

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../../lib/store';
import { StatusBadge } from '../ui';
import { AGENT_AVATARS } from '../../lib/agent-avatars';
import config from '../../lib/config';

const PRIORITY_COLOR = { high: '#ef4444', medium: '#f59e0b', low: '#4ade80' };
const STAGE_COLOR = {
  trend: '#10b981', research: '#3b82f6', hooks: '#c9a84c', script: '#c9a84c',
  visuals: '#818cf8', video: '#f472b6', editing: '#f59e0b',
  publishing: '#0dd3c5', analytics: '#10b981', repurpose: '#c9a84c',
};
const QUEUE_STATUS_COLOR = {
  ready:            '#10b981',
  in_progress:      '#0dd3c5',
  awaiting_approval:'#f59e0b',
  todo:             'var(--text-muted)',
};

const stagger = { initial: {}, animate: { transition: { staggerChildren: 0.06 } } };
const fadeUp  = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0, transition: { duration: 0.28 } } };

// ── Progress bar ─────────────────────────────────────────────────────
function StageProgressBar({ stage, progress, color }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[8px] tracking-wider w-16 flex-shrink-0" style={{ color }}>
        {stage.toUpperCase()}
      </span>
      <div className="flex-1 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <motion.div
          className="h-full rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          style={{ background: color }}
        />
      </div>
      <span className="font-mono text-[8px] flex-shrink-0" style={{ color }}>
        {progress}%
      </span>
    </div>
  );
}

// ── Campaign card ────────────────────────────────────────────────────
function CampaignCard({ campaign, studioColor }) {
  const stageColor = STAGE_COLOR[campaign.stage] || studioColor;
  return (
    <motion.div
      variants={fadeUp}
      className="panel-gold rounded-sm p-3"
      style={{ borderColor: `${stageColor}22` }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="font-ui text-xs font-semibold leading-snug flex-1" style={{ color: 'var(--text-primary)' }}>
          {campaign.name}
        </p>
        <span
          className="font-mono text-[7px] px-1.5 py-0.5 rounded-sm flex-shrink-0"
          style={{
            color: campaign.status === 'active' ? '#10b981' : '#f59e0b',
            background: campaign.status === 'active' ? '#10b98114' : '#f59e0b14',
            border: `1px solid ${campaign.status === 'active' ? '#10b98128' : '#f59e0b28'}`,
          }}
        >
          {campaign.status.replace('_', ' ').toUpperCase()}
        </span>
      </div>

      <StageProgressBar
        stage={campaign.stage}
        progress={campaign.progress}
        color={stageColor}
      />

      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>
            {campaign.published}/{campaign.pieces} published
          </span>
          <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>
            Due {campaign.dueDate}
          </span>
        </div>
        <span className="font-mono text-[7px]" style={{ color: stageColor }}>
          🎯 {campaign.target}
        </span>
      </div>
    </motion.div>
  );
}

// ── Queue item ───────────────────────────────────────────────────────
function QueueItem({ item, studioColor, onDispatch }) {
  const statusColor = QUEUE_STATUS_COLOR[item.status] || 'var(--text-muted)';
  const priorityColor = PRIORITY_COLOR[item.priority] || 'var(--text-muted)';

  return (
    <motion.div
      variants={fadeUp}
      className="flex items-start gap-2.5 py-2 border-b"
      style={{ borderColor: 'rgba(255,255,255,0.04)' }}
    >
      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5"
        style={{ background: statusColor }} />
      <div className="flex-1 min-w-0">
        <p className="font-body text-[11px] leading-snug" style={{ color: 'var(--text-primary)' }}>
          {item.title}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="font-mono text-[7px]" style={{ color: studioColor }}>
            {item.type.replace('_', ' ')}
          </span>
          <span className="font-mono text-[7px]" style={{ color: 'var(--text-muted)' }}>
            → {item.agent}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span
          className="font-mono text-[7px] px-1 py-0.5 rounded-sm"
          style={{ color: priorityColor, background: `${priorityColor}14`, border: `1px solid ${priorityColor}25` }}
        >
          {item.priority?.toUpperCase()}
        </span>
        {item.status === 'todo' && (
          <button
            onClick={() => onDispatch('task-dispatch')}
            className="font-mono text-[7px] px-1.5 py-0.5 rounded-sm transition-all"
            style={{
              color: studioColor,
              background: `${studioColor}12`,
              border: `1px solid ${studioColor}25`,
            }}
          >
            DISPATCH
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ── Agent team row ────────────────────────────────────────────────────
function AgentTeamRow({ agentIds, studioColor, onAgentOpen }) {
  const allAgents = config.agents;
  const assigned = agentIds
    .map(id => allAgents.find(a => a.id === id))
    .filter(Boolean);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {agentIds.map(id => {
        const agent = allAgents.find(a => a.id === id);
        const avatar = AGENT_AVATARS[id] || {};
        const isLive = !!agent;
        return (
          <button
            key={id}
            onClick={() => isLive && onAgentOpen(id)}
            disabled={!isLive}
            title={agent?.label || id}
            className="flex items-center gap-1.5 px-2 py-1 rounded-sm transition-all"
            style={{
              background: isLive ? `${avatar.color || studioColor}10` : 'rgba(255,255,255,0.03)',
              border: `1px solid ${isLive ? `${avatar.color || studioColor}25` : 'rgba(255,255,255,0.06)'}`,
              cursor: isLive ? 'pointer' : 'default',
              opacity: isLive ? 1 : 0.5,
            }}
          >
            <div
              className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: avatar.gradient || 'rgba(255,255,255,0.08)' }}
            >
              <span style={{ fontSize: 8 }}>{avatar.emoji || '🤖'}</span>
            </div>
            <span className="font-mono text-[8px]" style={{ color: isLive ? (avatar.color || studioColor) : 'var(--text-muted)' }}>
              {agent?.label || id}
            </span>
            {!isLive && (
              <span className="font-mono text-[6px]" style={{ color: 'var(--text-muted)' }}>STAGED</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Analytics strip ──────────────────────────────────────────────────
function AnalyticsStrip({ analytics, studioColor }) {
  if (!analytics) return null;
  const stats = [
    { label: 'VIEWS',       value: analytics.views > 0 ? `${(analytics.views / 1000).toFixed(1)}k` : '—', trend: analytics.viewsTrend },
    { label: 'ENGAGEMENT',  value: analytics.engagement > 0 ? `${analytics.engagement}%` : '—',            trend: null },
    { label: 'FOLLOWERS',   value: analytics.followers > 0 ? `${(analytics.followers / 1000).toFixed(1)}k` : analytics.followers === 0 && analytics.views === 0 ? 'Not live' : '—', trend: analytics.followersTrend },
    { label: 'SAVES',       value: analytics.saves > 0 ? `${(analytics.saves / 1000).toFixed(1)}k` : '—',  trend: null },
  ].filter(s => s.value !== null);

  return (
    <div className="flex items-center gap-4 flex-wrap">
      {stats.map(s => (
        <div key={s.label}>
          <div className="font-mono text-[7px] tracking-wider mb-0.5" style={{ color: 'var(--text-muted)' }}>
            {s.label}
          </div>
          <div className="flex items-center gap-1">
            <span className="font-mono text-sm font-bold" style={{ color: studioColor }}>
              {s.value}
            </span>
            {s.trend !== null && s.trend !== undefined && (
              <span className="font-mono text-[7px]"
                style={{ color: s.trend >= 0 ? '#10b981' : '#ef4444' }}>
                {s.trend >= 0 ? '▲' : '▼'}{Math.abs(s.trend)}%
              </span>
            )}
          </div>
        </div>
      ))}
      <p className="font-mono text-[7px] ml-auto" style={{ color: 'var(--text-muted)', opacity: 0.5 }}>
        PLACEHOLDER · CONNECT ANALYTICS API
      </p>
    </div>
  );
}

// ── ContentStudio ────────────────────────────────────────────────────
export default function ContentStudio({ studioId }) {
  const [studio, setStudio] = useState(null);
  const [loading, setLoading] = useState(true);
  const { setActiveSection, setActiveAgentId } = useStore();

  useEffect(() => {
    setStudio(null);
    setLoading(true);
    fetch(`/api/content-studios/${studioId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { setStudio(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [studioId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="flex flex-col items-center gap-3">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
            className="w-6 h-6 rounded-full"
            style={{ border: '2px solid rgba(201,168,76,0.2)', borderTopColor: '#c9a84c' }}
          />
          <span className="font-mono text-[9px] tracking-widest" style={{ color: 'var(--text-muted)' }}>
            LOADING STUDIO
          </span>
        </div>
      </div>
    );
  }

  if (!studio) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>Studio not found: {studioId}</p>
      </div>
    );
  }

  const color = studio.color;

  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-5">

      {/* Studio header */}
      <motion.div variants={fadeUp} className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-sm flex items-center justify-center text-xl flex-shrink-0"
            style={{ background: `${color}12`, border: `1px solid ${color}30` }}
          >
            {studio.icon}
          </div>
          <div>
            <h3 className="font-ui text-base font-bold" style={{ color: 'var(--text-primary)' }}>{studio.name}</h3>
            <p className="font-mono text-[8px] tracking-wider" style={{ color }}>{studio.tagline}</p>
          </div>
        </div>
        {/* Analytics strip */}
        <div className="flex-1 max-w-lg">
          <AnalyticsStrip analytics={studio.analytics} studioColor={color} />
        </div>
      </motion.div>

      {/* Quick Actions — ADHD priority */}
      <motion.div variants={fadeUp} className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-[8px] tracking-widest mr-1" style={{ color: 'var(--text-muted)' }}>
          QUICK ACTION
        </span>
        {(studio.quickActions || []).map(qa => (
          <button
            key={qa.id}
            onClick={() => setActiveSection(qa.dispatch)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm transition-all"
            style={{
              background: `${color}10`,
              border: `1px solid ${color}28`,
              color,
            }}
          >
            <span style={{ fontSize: 11 }}>{qa.icon}</span>
            <span className="font-ui text-[10px] font-semibold tracking-wider">{qa.label}</span>
          </button>
        ))}
      </motion.div>

      {/* Main grid: Campaigns + Queue */}
      <div className="grid grid-cols-2 gap-4">

        {/* Active Campaigns */}
        <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="font-mono text-[8px] tracking-[0.2em] uppercase" style={{ color }}>
              ACTIVE CAMPAIGNS
            </div>
            <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>
              {studio.activeCampaigns?.length || 0} RUNNING
            </span>
          </div>
          {!studio.activeCampaigns?.length ? (
            <div className="flex items-center justify-center py-8">
              <span className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>No active campaigns</span>
            </div>
          ) : (
            <div className="space-y-3">
              {studio.activeCampaigns.map(c => (
                <CampaignCard key={c.id} campaign={c} studioColor={color} />
              ))}
            </div>
          )}
        </motion.div>

        {/* Content Queue */}
        <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="font-mono text-[8px] tracking-[0.2em] uppercase" style={{ color }}>
              CONTENT QUEUE
            </div>
            <button
              onClick={() => setActiveSection('task-dispatch')}
              className="font-mono text-[8px] transition-all"
              style={{ color }}
            >
              + ADD
            </button>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 240 }}>
            {!studio.contentQueue?.length ? (
              <div className="flex items-center justify-center py-8">
                <span className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>Queue empty</span>
              </div>
            ) : (
              <motion.div variants={stagger} initial="initial" animate="animate">
                {studio.contentQueue.map(item => (
                  <QueueItem
                    key={item.id}
                    item={item}
                    studioColor={color}
                    onDispatch={setActiveSection}
                  />
                ))}
              </motion.div>
            )}
          </div>
        </motion.div>
      </div>

      {/* AI Team + Repurposing */}
      <div className="grid grid-cols-2 gap-4">

        {/* Assigned AI Team */}
        <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4">
          <div className="font-mono text-[8px] tracking-[0.2em] uppercase mb-3" style={{ color }}>
            AI TEAM
          </div>
          <AgentTeamRow
            agentIds={studio.assignedAgents || []}
            studioColor={color}
            onAgentOpen={setActiveAgentId}
          />
        </motion.div>

        {/* Repurposing Options */}
        <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4">
          <div className="font-mono text-[8px] tracking-[0.2em] uppercase mb-3" style={{ color }}>
            REPURPOSE THIS CONTENT
          </div>
          <div className="flex flex-wrap gap-2">
            {(studio.repurposingOptions || []).map(opt => (
              <div
                key={opt.to}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm"
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.07)',
                }}
              >
                <span className="font-mono text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                  {opt.label}
                </span>
                <span
                  className="font-mono text-[7px] px-1 py-0.5 rounded-sm"
                  style={{
                    color: opt.effort === 'low' ? '#10b981' : '#f59e0b',
                    background: opt.effort === 'low' ? '#10b98112' : '#f59e0b12',
                  }}
                >
                  {opt.effort}
                </span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Publishing schedule */}
      {studio.publishingSchedule?.length > 0 && (
        <motion.div variants={fadeUp} className="panel-gold rounded-sm px-4 py-3">
          <div className="flex items-center gap-6 flex-wrap">
            <div className="font-mono text-[8px] tracking-[0.2em] uppercase" style={{ color }}>
              SCHEDULE
            </div>
            {studio.publishingSchedule.map((s, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="font-mono text-[9px] font-bold" style={{ color }}>{s.time}</span>
                <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>
                  {s.days.join(' · ')} · {s.type}
                </span>
              </div>
            ))}
          </div>
        </motion.div>
      )}

    </motion.div>
  );
}
