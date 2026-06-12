// components/sections/ProjectRoom.jsx
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import { useStore } from '../../lib/store';
import { StatusBadge, GoldDivider } from '../ui';
import { AGENT_AVATARS } from '../../lib/agent-avatars';
import config from '../../lib/config';

// ── constants ────────────────────────────────────────────────────────
const TABS = [
  { id: 'overview', label: 'OVERVIEW', icon: '⬡' },
  { id: 'kanban',   label: 'KANBAN',   icon: '◭' },
  { id: 'journal',  label: 'JOURNAL',  icon: '◳' },
  { id: 'ai-team',  label: 'AI TEAM',  icon: '◈' },
  { id: 'revenue',  label: 'REVENUE',  icon: '◆' },
];

const PRIORITY = {
  high:   { color: '#ef4444', label: 'HIGH' },
  medium: { color: '#f59e0b', label: 'MED'  },
  low:    { color: '#4ade80', label: 'LOW'  },
};

const EMERALD = '#10b981';
const GOLD    = '#c9a84c';
const CRIMSON = '#ef4444';
const TEAL    = '#0dd3c5';

const safeFormat = (d, fmt) => { try { return format(parseISO(d), fmt); } catch { return d; } };

const fadeUp = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.28 } },
  exit:    { opacity: 0, y: -6, transition: { duration: 0.18 } },
};

// ── Kanban Board ─────────────────────────────────────────────────────
function KanbanBoard({ kanban = {}, projectColor, onDispatch }) {
  const columns = [
    { id: 'todo',       label: 'TODO',        items: kanban.todo || [],       dotColor: 'var(--text-muted)' },
    { id: 'inProgress', label: 'IN PROGRESS', items: kanban.inProgress || [], dotColor: projectColor        },
    { id: 'done',       label: 'DONE',         items: kanban.done || [],       dotColor: EMERALD             },
  ];

  return (
    <motion.div variants={fadeUp} initial="initial" animate="animate" className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        {columns.map(col => (
          <div key={col.id} className="panel-gold rounded-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: col.dotColor }} />
                <span className="font-mono text-[8px] tracking-[0.2em]" style={{ color: 'var(--text-muted)' }}>
                  {col.label}
                </span>
              </div>
              <span className="font-mono text-[8px]" style={{ color: col.dotColor }}>
                {col.items.length}
              </span>
            </div>

            <div className="space-y-2 min-h-[120px]">
              {col.items.map((card, i) => {
                const p = PRIORITY[card.priority] || PRIORITY.low;
                const avatar = AGENT_AVATARS[card.assignedAgent];
                return (
                  <motion.div
                    key={card.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="rounded-sm p-2.5 group"
                    style={{
                      background: 'rgba(255,255,255,0.02)',
                      border: '1px solid rgba(255,255,255,0.05)',
                    }}
                  >
                    <p className="font-body text-[11px] leading-snug mb-2"
                      style={{ color: 'var(--text-primary)' }}>
                      {card.title}
                    </p>
                    <div className="flex items-center justify-between">
                      <span
                        className="font-mono text-[7px] px-1.5 py-0.5 rounded-sm"
                        style={{
                          color: p.color,
                          background: `${p.color}14`,
                          border: `1px solid ${p.color}28`,
                        }}
                      >
                        {p.label}
                      </span>
                      {avatar && (
                        <div
                          className="w-4 h-4 rounded-full flex items-center justify-center"
                          style={{ background: avatar.gradient }}
                          title={card.assignedAgent}
                        >
                          <span style={{ fontSize: 7 }}>{avatar.emoji}</span>
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {col.id === 'todo' && (
              <button
                onClick={() => onDispatch('task-dispatch')}
                className="w-full mt-2 font-ui text-[9px] font-semibold py-1.5 rounded-sm tracking-wider transition-all"
                style={{
                  color: 'var(--text-muted)',
                  border: '1px dashed rgba(255,255,255,0.08)',
                }}
              >
                + ADD TASK
              </button>
            )}
          </div>
        ))}
      </div>
    </motion.div>
  );
}

// ── Journal ──────────────────────────────────────────────────────────
function JournalTab({ projectId, journal: initialJournal = [], projectColor }) {
  const [entries, setEntries] = useState(initialJournal);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const textRef = useRef(null);

  useEffect(() => { setEntries(initialJournal); }, [initialJournal]);

  const saveEntry = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/journal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entry: draft.trim() }),
      });
      if (res.ok) {
        const newEntry = await res.json();
        setEntries(prev => [newEntry, ...prev]);
        setDraft('');
      }
    } catch {}
    setSaving(false);
  };

  return (
    <motion.div variants={fadeUp} initial="initial" animate="animate" className="space-y-4">
      {/* Add entry */}
      <div className="panel-gold rounded-sm p-4">
        <div className="font-mono text-[8px] tracking-[0.2em] uppercase mb-2" style={{ color: projectColor }}>
          NEW ENTRY · {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
        <textarea
          ref={textRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveEntry(); }}
          placeholder="What happened today? What did the AI do? What's next? (⌘+Enter to save)"
          rows={3}
          className="w-full font-body text-sm rounded-sm resize-none transition-all outline-none"
          style={{
            background: 'rgba(0,0,0,0.25)',
            border: `1px solid rgba(255,255,255,0.06)`,
            color: 'var(--text-primary)',
            padding: '10px 12px',
          }}
          onFocus={e => { e.target.style.borderColor = `${projectColor}40`; }}
          onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.06)'; }}
        />
        <div className="flex items-center justify-between mt-2">
          <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>⌘+Enter to save</span>
          <button
            onClick={saveEntry}
            disabled={!draft.trim() || saving}
            className="font-ui text-[9px] font-bold px-3 py-1.5 rounded-sm tracking-wider transition-all"
            style={{
              background: draft.trim() ? `${projectColor}18` : 'rgba(255,255,255,0.03)',
              border: `1px solid ${draft.trim() ? `${projectColor}35` : 'rgba(255,255,255,0.06)'}`,
              color: draft.trim() ? projectColor : 'var(--text-muted)',
            }}
          >
            {saving ? 'SAVING…' : 'SAVE ENTRY'}
          </button>
        </div>
      </div>

      {/* Entry list */}
      <div className="space-y-3">
        {entries.length === 0 ? (
          <div className="flex items-center justify-center h-24">
            <span className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>No journal entries yet</span>
          </div>
        ) : entries.map((entry, i) => (
          <motion.div
            key={entry.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className="panel-gold rounded-sm p-4"
          >
            <div className="flex items-center gap-2 mb-2">
              <div className="w-1 h-3 rounded-full" style={{ background: projectColor }} />
              <span className="font-mono text-[8px] tracking-wider" style={{ color: projectColor }}>
                {safeFormat(entry.date, 'MMMM d, yyyy')}
              </span>
            </div>
            <p className="font-body text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {entry.entry}
            </p>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

// ── AI Team ──────────────────────────────────────────────────────────
function AITeamTab({ projectAgents, onAgentOpen }) {
  return (
    <motion.div variants={fadeUp} initial="initial" animate="animate">
      {projectAgents.length === 0 ? (
        <div className="flex items-center justify-center h-32">
          <span className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>
            No agents assigned to this project
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {projectAgents.map((agent, i) => {
            const avatar = AGENT_AVATARS[agent.id] || {};
            return (
              <motion.div
                key={agent.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                className="panel-gold rounded-sm p-4 card-hover cursor-pointer"
                onClick={() => onAgentOpen(agent.id)}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 text-xl"
                    style={{
                      background: avatar.gradient || 'rgba(255,255,255,0.08)',
                      boxShadow: `0 4px 16px ${avatar.color || '#c9a84c'}20`,
                    }}
                  >
                    {avatar.emoji || '🤖'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-ui text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                        {agent.label}
                      </span>
                    </div>
                    <p className="font-body text-[11px] leading-snug mb-2"
                      style={{ color: 'var(--text-secondary)' }}>
                      {agent.description}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {(agent.capabilities || []).slice(0, 3).map(cap => (
                        <span
                          key={cap}
                          className="font-mono text-[7px] px-1.5 py-0.5 rounded-sm"
                          style={{
                            color: avatar.color || GOLD,
                            background: `${avatar.color || GOLD}12`,
                            border: `1px solid ${avatar.color || GOLD}22`,
                          }}
                        >
                          {cap.replace(/_/g, ' ')}
                        </span>
                      ))}
                      {(agent.capabilities || []).length > 3 && (
                        <span className="font-mono text-[7px] px-1.5 py-0.5 rounded-sm"
                          style={{ color: 'var(--text-muted)', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                          +{agent.capabilities.length - 3} more
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t flex items-center justify-between"
                  style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                  <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>
                    {agent.model || 'Model not set'}
                  </span>
                  <span className="font-ui text-[9px] font-semibold tracking-wider"
                    style={{ color: avatar.color || GOLD }}>
                    OPEN WORKSPACE →
                  </span>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}

// ── Revenue ──────────────────────────────────────────────────────────
function RevenueTab({ revenue = {}, projectColor }) {
  const { monthly = 0, target = 0, trend = 0, history = [], currency = 'USD' } = revenue;
  const progress = target > 0 ? Math.min((monthly / target) * 100, 100) : 0;
  const maxHistory = Math.max(...history, 1);
  const isInternal = target === 0;

  return (
    <motion.div variants={fadeUp} initial="initial" animate="animate" className="space-y-4">

      {isInternal ? (
        <div className="panel-gold rounded-sm p-8 flex items-center justify-center">
          <div className="text-center">
            <div className="font-mono text-[10px] tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>
              INTERNAL INFRASTRUCTURE
            </div>
            <p className="font-body text-sm" style={{ color: 'var(--text-secondary)' }}>
              This project is an internal tool — no direct revenue tracked.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Main metric */}
          <div className="grid grid-cols-3 gap-4">
            <div className="panel-gold rounded-sm p-5 col-span-1 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-20 h-20 rounded-full blur-2xl pointer-events-none"
                style={{ background: `${EMERALD}10` }} />
              <div className="font-mono text-[8px] tracking-[0.2em] uppercase mb-2"
                style={{ color: EMERALD }}>MONTHLY REVENUE</div>
              <div className="font-mono text-3xl font-bold leading-none" style={{ color: EMERALD }}>
                ${monthly.toLocaleString()}
              </div>
              <div className="flex items-center gap-1.5 mt-2">
                <span className="font-mono text-[9px]"
                  style={{ color: trend >= 0 ? EMERALD : CRIMSON }}>
                  {trend >= 0 ? '▲' : '▼'} {Math.abs(trend)}%
                </span>
                <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>
                  vs last month
                </span>
              </div>
            </div>

            <div className="panel-gold rounded-sm p-5 col-span-1">
              <div className="font-mono text-[8px] tracking-[0.2em] uppercase mb-2"
                style={{ color: 'var(--text-muted)' }}>MONTHLY TARGET</div>
              <div className="font-mono text-3xl font-bold leading-none" style={{ color: projectColor }}>
                ${target.toLocaleString()}
              </div>
              <div className="mt-3">
                <div className="flex justify-between mb-1">
                  <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>
                    Progress
                  </span>
                  <span className="font-mono text-[8px]" style={{ color: projectColor }}>
                    {progress.toFixed(0)}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <motion.div
                    className="h-full rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 1, delay: 0.2, ease: 'easeOut' }}
                    style={{
                      background: `linear-gradient(90deg, ${projectColor}80, ${projectColor})`,
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="panel-gold rounded-sm p-5 col-span-1">
              <div className="font-mono text-[8px] tracking-[0.2em] uppercase mb-2"
                style={{ color: 'var(--text-muted)' }}>REMAINING TO TARGET</div>
              <div className="font-mono text-3xl font-bold leading-none"
                style={{ color: target - monthly > 0 ? GOLD : EMERALD }}>
                {target - monthly > 0 ? `$${(target - monthly).toLocaleString()}` : 'TARGET HIT'}
              </div>
              <p className="font-mono text-[8px] mt-2" style={{ color: 'var(--text-muted)' }}>
                PLACEHOLDER · CONNECT REVENUE API
              </p>
            </div>
          </div>

          {/* Historical chart */}
          <div className="panel-gold rounded-sm p-4">
            <div className="font-mono text-[8px] tracking-[0.2em] uppercase mb-4"
              style={{ color: 'var(--text-muted)' }}>6-MONTH HISTORY</div>
            <div className="flex items-end gap-2" style={{ height: 72 }}>
              {history.map((v, i) => {
                const months = ['Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May'];
                const isLast = i === history.length - 1;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
                    <motion.div
                      className="w-full rounded-t-sm"
                      initial={{ scaleY: 0 }}
                      animate={{ scaleY: 1 }}
                      transition={{ delay: i * 0.08, duration: 0.5, ease: 'easeOut' }}
                      style={{
                        height: `${(v / maxHistory) * 100}%`,
                        background: isLast
                          ? `linear-gradient(180deg, ${projectColor}, ${projectColor}80)`
                          : `linear-gradient(180deg, ${projectColor}50, ${projectColor}25)`,
                        transformOrigin: 'bottom',
                        minHeight: v > 0 ? 4 : 0,
                      }}
                    />
                    <span className="font-mono text-[7px]" style={{ color: 'var(--text-muted)' }}>
                      {months[i]}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </motion.div>
  );
}

// ── Project Room ─────────────────────────────────────────────────────
export default function ProjectRoom({ projectId, children }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [projectData, setProjectData] = useState(null);
  const { setActiveAgentId, setActiveSection } = useStore();

  const projectMeta  = config.projects.find(p => p.id === projectId) || {};
  const projectColor = projectMeta.color || GOLD;
  const projectAgents = config.agents.filter(a => a.project === projectId);

  useEffect(() => {
    setActiveTab('overview');
    setProjectData(null);
    fetch(`/api/projects/${projectId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setProjectData(d))
      .catch(() => {});
  }, [projectId]);

  return (
    <div className="space-y-0">

      {/* ── Project header + tab bar ──────────────────────────────── */}
      <div
        className="rounded-t-sm mb-0 px-4 pt-3 pb-0"
        style={{
          background: 'var(--bg-panel)',
          border: `1px solid ${projectColor}22`,
          borderBottom: 'none',
        }}
      >
        {/* Project identity */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <span className="text-lg">{projectMeta.icon || '◆'}</span>
            <div>
              <div className="font-ui text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                {projectMeta.label || projectId}
              </div>
              {projectMeta.description && (
                <div className="font-mono text-[8px] tracking-wide mt-0.5"
                  style={{ color: 'var(--text-muted)' }}>
                  {projectMeta.description}
                </div>
              )}
            </div>
          </div>

          {/* Quick stats from projectData */}
          {projectData && (
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="font-mono text-xs font-bold"
                  style={{ color: EMERALD }}>
                  ${(projectData.revenue?.monthly || 0).toLocaleString()}
                </div>
                <div className="font-mono text-[7px] tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  MRR
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-xs font-bold" style={{ color: projectColor }}>
                  {(projectData.kanban?.todo?.length || 0) + (projectData.kanban?.inProgress?.length || 0)}
                </div>
                <div className="font-mono text-[7px] tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  OPEN TASKS
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-xs font-bold" style={{ color: TEAL }}>
                  {projectAgents.length}
                </div>
                <div className="font-mono text-[7px] tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  AI AGENTS
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-0">
          {TABS.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="relative flex items-center gap-1.5 px-4 py-2.5 transition-all"
                style={{
                  color: isActive ? projectColor : 'var(--text-muted)',
                  background: isActive ? `${projectColor}08` : 'transparent',
                }}
              >
                <span style={{ fontSize: 10, opacity: isActive ? 1 : 0.5 }}>{tab.icon}</span>
                <span className="font-mono text-[9px] tracking-[0.15em]">{tab.label}</span>
                {isActive && (
                  <motion.div
                    layoutId={`tab-underline-${projectId}`}
                    className="absolute bottom-0 left-0 right-0 h-0.5"
                    style={{
                      background: projectColor,
                      boxShadow: `0 0 8px ${projectColor}`,
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Tab content ───────────────────────────────────────────── */}
      <div
        className="rounded-b-sm p-5"
        style={{
          background: 'var(--bg-panel)',
          border: `1px solid ${projectColor}22`,
          borderTop: `1px solid ${projectColor}14`,
        }}
      >
        <AnimatePresence mode="wait">
          {activeTab === 'overview' && (
            <motion.div key="overview" {...fadeUp}>
              {children}
            </motion.div>
          )}

          {activeTab === 'kanban' && projectData && (
            <motion.div key="kanban" {...fadeUp}>
              <KanbanBoard
                kanban={projectData.kanban}
                projectColor={projectColor}
                onDispatch={setActiveSection}
              />
            </motion.div>
          )}

          {activeTab === 'journal' && (
            <motion.div key="journal" {...fadeUp}>
              <JournalTab
                projectId={projectId}
                journal={projectData?.journal || []}
                projectColor={projectColor}
              />
            </motion.div>
          )}

          {activeTab === 'ai-team' && (
            <motion.div key="ai-team" {...fadeUp}>
              <AITeamTab
                projectAgents={projectAgents}
                onAgentOpen={setActiveAgentId}
              />
            </motion.div>
          )}

          {activeTab === 'revenue' && (
            <motion.div key="revenue" {...fadeUp}>
              <RevenueTab
                revenue={projectData?.revenue}
                projectColor={projectColor}
              />
            </motion.div>
          )}

          {/* Loading state */}
          {!projectData && activeTab !== 'overview' && activeTab !== 'ai-team' && (
            <motion.div key="loading" {...fadeUp} className="flex items-center justify-center py-16">
              <div className="flex flex-col items-center gap-3">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
                  className="w-6 h-6 rounded-full"
                  style={{ border: `2px solid ${projectColor}30`, borderTopColor: projectColor }}
                />
                <span className="font-mono text-[9px] tracking-widest" style={{ color: 'var(--text-muted)' }}>
                  LOADING PROJECT DATA
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

    </div>
  );
}
