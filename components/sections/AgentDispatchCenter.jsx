// components/sections/AgentDispatchCenter.jsx
// Phase D.1 — Agent Dispatch Engine UI
// Shows dispatch decisions: selected agent, fallback, approval state,
// executable status, reason, warnings, and next action.
// Read-only view of routing intelligence — execution stays in Task Dispatch.

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SectionHeader } from '../ui';

// ── Colours ───────────────────────────────────────────────────────────────────

const DEPT_COLOR = {
  OPERATIONS:    '#0dd3c5',
  ENGINEERING:   '#818cf8',
  CONTENT:       '#f472b6',
  GROWTH:        '#4ade80',
  SALES:         '#f59e0b',
  CLIENT_OPS:    '#60a5fa',
  REVENUE:       '#fbbf24',
};

const NEXT_ACTION_META = {
  READY_TO_DISPATCH:  { label: 'READY',    color: '#0dd3c5' },
  AWAIT_APPROVAL:     { label: 'APPROVAL', color: '#c9a84c' },
  STAGED_DISPLAY_ONLY:{ label: 'STAGED',   color: '#818cf8' },
  MANUAL_REVIEW:      { label: 'REVIEW',   color: '#ef4444' },
};

const COST_TIER_COLOR = {
  free:   '#4b5563',
  low:    '#0dd3c5',
  medium: '#c9a84c',
  high:   '#ef4444',
};

const PRIORITY_COLOR = { Low: '#4b5563', Normal: '#c9a84c', High: '#ef4444' };

const LANE_COLOR = {
  'digital-diamond':  '#c9a84c',
  'managed-by-mika':  '#0dd3c5',
  'medai':            '#818cf8',
  'cannaops':         '#4ade80',
  'hotel-hooker':     '#f472b6',
  'ai-twin':          '#60a5fa',
  'lead-recovery':    '#f59e0b',
};

const ALL_TASK_TYPES = [
  'Research', 'Market Research', 'Trend Research', 'Hook Creation',
  'Script Creation', 'Content Strategy', 'Video Prompting', 'Repurposing',
  'Publishing Prep', 'Analytics Review', 'Code Architecture', 'Code Review',
  'Documentation', 'Operations', 'Revenue Strategy', 'Content',
  'Lead Recovery', 'Automation', 'Client Delivery', 'System Maintenance',
];

const ALL_DEPARTMENTS = ['All', 'OPERATIONS', 'ENGINEERING', 'CONTENT', 'SALES', 'REVENUE'];
const ALL_PRIORITIES   = ['All', 'High', 'Normal', 'Low'];
const EXEC_FILTERS     = ['All', 'Executable', 'Staged'];

// ── Animation ─────────────────────────────────────────────────────────────────

const stagger = { initial: {}, animate: { transition: { staggerChildren: 0.06 } } };
const fadeUp  = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0, transition: { duration: 0.3 } } };

// ── Sub-components ────────────────────────────────────────────────────────────

function AgentChip({ agent, label, dim }) {
  if (!agent) return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-sm" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <span className="font-mono text-[8px] tracking-wider text-[#4b5563]">{label}: NONE</span>
    </div>
  );
  const deptColor = DEPT_COLOR[agent.department] || '#8892a4';
  return (
    <div
      className="flex flex-col gap-0.5 px-2 py-1.5 rounded-sm"
      style={{
        background: `${deptColor}08`,
        border: `1px solid ${deptColor}${dim ? '18' : '30'}`,
        opacity: dim ? 0.6 : 1,
      }}
    >
      <div className="flex items-center gap-1.5">
        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: deptColor }} />
        <span className="font-mono text-[9px] font-semibold" style={{ color: deptColor }}>{agent.displayName}</span>
        <span className="font-mono text-[7px] text-[#4b5563] ml-auto">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[8px] text-[#6b7280]">{agent.role}</span>
        <span
          className="font-mono text-[7px] px-1 py-0.5 rounded-sm"
          style={{ color: agent.liveConnected ? '#0dd3c5' : '#818cf8', background: agent.liveConnected ? 'rgba(13,211,197,0.08)' : 'rgba(129,140,248,0.08)' }}
        >
          {agent.status?.toUpperCase()}
        </span>
      </div>
    </div>
  );
}

function NextActionBadge({ nextAction }) {
  const meta = NEXT_ACTION_META[nextAction] || { label: nextAction, color: '#8892a4' };
  return (
    <span
      className="font-mono text-[8px] tracking-wider px-2 py-0.5 rounded-sm font-semibold"
      style={{ color: meta.color, background: `${meta.color}18`, border: `1px solid ${meta.color}35` }}
    >
      {meta.label}
    </span>
  );
}

function WarningList({ warnings }) {
  if (!warnings || warnings.length === 0) return null;
  return (
    <div className="space-y-0.5 mt-1.5">
      {warnings.map((w, i) => (
        <div key={i} className="flex items-start gap-1.5">
          <span className="text-[#f59e0b] text-[9px] flex-shrink-0 mt-0.5">⚠</span>
          <span className="font-mono text-[9px] leading-relaxed text-[#6b7280]">{w}</span>
        </div>
      ))}
    </div>
  );
}

function DecisionCard({ decision, index }) {
  const [expanded, setExpanded] = useState(false);
  const execMeta = decision.executableNow
    ? { label: 'EXECUTABLE', color: '#0dd3c5' }
    : { label: 'NOT EXECUTABLE', color: '#6b7280' };
  const approvalMeta = decision.approvalRequired
    ? { label: 'APPROVAL REQUIRED', color: '#c9a84c' }
    : { label: 'AUTO-DISPATCH', color: '#4b5563' };
  const laneColor = LANE_COLOR[decision.laneId] || '#8892a4';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className="rounded-sm overflow-hidden"
      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(201,168,76,0.1)' }}
    >
      {/* Header row — always visible */}
      <button
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-all"
        onClick={() => setExpanded(v => !v)}
        style={{ background: expanded ? 'rgba(201,168,76,0.03)' : undefined }}
      >
        {/* Lane bar */}
        <div className="w-0.5 h-8 rounded-full flex-shrink-0" style={{ background: laneColor }} />

        {/* Task info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="font-ui text-[11px] font-semibold text-[#f0ede6] truncate">{decision.title || decision.taskType}</span>
            <span className="font-mono text-[8px] px-1.5 py-0.5 rounded-sm flex-shrink-0"
              style={{ color: laneColor, background: `${laneColor}18`, border: `1px solid ${laneColor}30` }}>
              {decision.laneId || '—'}
            </span>
            <span className="font-mono text-[8px] px-1.5 py-0.5 rounded-sm flex-shrink-0"
              style={{ color: PRIORITY_COLOR[decision.priority] || '#4b5563', background: `${PRIORITY_COLOR[decision.priority] || '#4b5563'}18` }}>
              {decision.priority?.toUpperCase() || 'NORMAL'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[9px] text-[#8892a4]">{decision.taskType}</span>
            {decision.route?.costTier && (
              <span className="font-mono text-[8px]" style={{ color: COST_TIER_COLOR[decision.route.costTier] || '#4b5563' }}>
                {decision.route.costTier.toUpperCase()} COST
              </span>
            )}
          </div>
        </div>

        {/* Status chips */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="font-mono text-[8px] px-2 py-0.5 rounded-sm"
            style={{ color: execMeta.color, background: `${execMeta.color}15` }}>
            {execMeta.label}
          </span>
          <NextActionBadge nextAction={decision.nextAction} />
          <span className="font-mono text-[9px] text-[#4b5563] ml-1">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* Agent row — always visible */}
      <div className="px-3 pb-2 flex items-stretch gap-2 flex-wrap">
        <AgentChip agent={decision.selectedAgent} label="SELECTED" dim={false} />
        {decision.fallbackAgent && (
          <>
            <span className="font-mono text-[9px] text-[#4b5563] self-center">→</span>
            <AgentChip agent={decision.fallbackAgent} label="FALLBACK" dim={true} />
          </>
        )}
        {/* Skill badge — visible without expanding */}
        {decision.skillInfo?.skillLoaded && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-sm self-center"
            style={{ background: 'rgba(129,140,248,0.08)', border: '1px solid rgba(129,140,248,0.25)' }}>
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#10b981' }} />
            <span className="font-mono text-[7px] font-semibold" style={{ color: '#818cf8' }}>
              skill: {decision.skillInfo.skillId}.md
            </span>
            <span className="font-mono text-[6px] text-[#4b5563]">
              via {decision.skillInfo.executionEngine}
            </span>
          </div>
        )}
        <div className="flex-1" />
        <div className="flex flex-col items-end justify-center gap-0.5">
          <span className="font-mono text-[8px]" style={{ color: approvalMeta.color }}>{approvalMeta.label}</span>
          {decision.route?.maxRuntimeSeconds && (
            <span className="font-mono text-[8px] text-[#4b5563]">MAX {decision.route.maxRuntimeSeconds}s</span>
          )}
        </div>
      </div>

      {/* Expanded detail */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-1 space-y-3" style={{ borderTop: '1px solid rgba(201,168,76,0.07)' }}>
              {/* Reason */}
              <div>
                <div className="font-mono text-[8px] tracking-widest text-[#4b5563] mb-1">DECISION REASON</div>
                <p className="font-body text-[11px] leading-relaxed" style={{ color: '#8892a4' }}>{decision.reason}</p>
              </div>

              {/* Warnings */}
              {decision.warnings?.length > 0 && (
                <div>
                  <div className="font-mono text-[8px] tracking-widest text-[#4b5563] mb-0.5">WARNINGS</div>
                  <WarningList warnings={decision.warnings} />
                </div>
              )}

              {/* Skill + Engine block */}
              {(() => {
                const skill  = decision.skillInfo;
                if (!skill) return null;
                const engine = skill.executionEngine;
                const loaded = skill.skillLoaded;
                const skillId = skill.skillId;
                const intended = skill.intendedAgentId;

                return (
                  <div className="rounded-sm p-2.5 space-y-2"
                    style={{ background: 'rgba(129,140,248,0.05)', border: '1px solid rgba(129,140,248,0.2)' }}>
                    <div className="font-mono text-[7px] tracking-[0.2em] uppercase" style={{ color: '#818cf8' }}>
                      SKILL + EXECUTION
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {/* Agent */}
                      <div>
                        <div className="font-mono text-[6px] text-[#4b5563] mb-0.5">SPECIALIST AGENT</div>
                        <div className="font-mono text-[8px] font-semibold" style={{ color: intended ? '#f0ede6' : '#4b5563' }}>
                          {intended || '—'}
                        </div>
                        <div className="font-mono text-[7px] text-[#6b7280]">Intended role</div>
                      </div>
                      {/* Skill */}
                      <div>
                        <div className="font-mono text-[6px] text-[#4b5563] mb-0.5">SKILL LOADED</div>
                        <div className="flex items-center gap-1">
                          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                            style={{ background: loaded ? '#10b981' : '#4b5563' }} />
                          <span className="font-mono text-[8px] font-semibold"
                            style={{ color: loaded ? '#10b981' : '#4b5563' }}>
                            {loaded ? skillId + '.md' : 'none'}
                          </span>
                        </div>
                        <div className="font-mono text-[7px] text-[#6b7280]">
                          {loaded ? 'injected into prompt' : 'generic fallback'}
                        </div>
                      </div>
                      {/* Engine */}
                      <div>
                        <div className="font-mono text-[6px] text-[#4b5563] mb-0.5">EXECUTION ENGINE</div>
                        <div className="font-mono text-[8px] font-semibold"
                          style={{ color: engine ? '#0dd3c5' : '#4b5563' }}>
                          {engine || (decision.executableNow ? '—' : 'N/A')}
                        </div>
                        <div className="font-mono text-[7px] text-[#6b7280]">
                          {engine === 'hermes' ? 'SSH bridge' : engine ? 'gateway' : 'not executable'}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Route notes */}
              {decision.route?.notes && (
                <div>
                  <div className="font-mono text-[8px] tracking-widest text-[#4b5563] mb-0.5">ROUTE NOTES</div>
                  <p className="font-mono text-[9px] leading-relaxed text-[#6b7280]">{decision.route.notes}</p>
                </div>
              )}

              {/* Allowed modes */}
              {decision.route?.allowedExecutionModes?.length > 0 && (
                <div>
                  <div className="font-mono text-[8px] tracking-widest text-[#4b5563] mb-1">ALLOWED EXECUTION MODES</div>
                  <div className="flex items-center gap-1 flex-wrap">
                    {decision.route.allowedExecutionModes.map(m => (
                      <span key={m} className="font-mono text-[8px] px-1.5 py-0.5 rounded-sm"
                        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#8892a4' }}>
                        {m}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Governance note */}
              <div className="flex items-center gap-1.5 pt-1" style={{ borderTop: '1px solid rgba(201,168,76,0.06)' }}>
                <span className="text-[#c9a84c] text-[9px]">◈</span>
                <span className="font-mono text-[8px] text-[#4b5563]">{decision.governanceNote}</span>
              </div>

              {/* Timestamp */}
              <div className="flex items-center justify-between">
                <span className="font-mono text-[8px] text-[#4b5563]">DECIDED AT</span>
                <span className="font-mono text-[8px] text-[#4b5563]">
                  {decision.decidedAt ? new Date(decision.decidedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function PreviewPanel({ taskType, laneId, priority, onClose }) {
  const [decision, setDecision] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch('/api/dispatch/route-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskType, laneId, priority: priority || 'Normal', title: taskType }),
    })
      .then(r => r.json())
      .then(d => { setDecision(d.decision); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [taskType, laneId, priority]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-sm p-4 mt-2"
      style={{ background: 'rgba(201,168,76,0.04)', border: '1px solid rgba(201,168,76,0.2)' }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-[9px] tracking-widest" style={{ color: '#c9a84c' }}>DISPATCH PREVIEW — {taskType}</span>
        <button onClick={onClose} className="font-mono text-[9px] text-[#4b5563] hover:text-[#8892a4] transition-colors">✕ CLOSE</button>
      </div>
      {loading && (
        <div className="flex items-center gap-2">
          <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 0.9 }}
            className="w-1.5 h-1.5 rounded-full" style={{ background: '#c9a84c' }} />
          <span className="font-mono text-[9px] text-[#4b5563]">Computing route...</span>
        </div>
      )}
      {error && <p className="font-mono text-[9px]" style={{ color: '#ef4444' }}>Error: {error}</p>}
      {decision && !loading && <DecisionCard decision={decision} index={0} />}
    </motion.div>
  );
}

// ── Live preview simulator (manual input) ─────────────────────────────────────

function RouteSimulator() {
  const [taskType, setTaskType]   = useState('');
  const [laneId, setLaneId]       = useState('');
  const [priority, setPriority]   = useState('Normal');
  const [decision, setDecision]   = useState(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);

  const inputStyle = {
    width: '100%',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(201,168,76,0.15)',
    borderRadius: 4,
    color: '#f0ede6',
    fontFamily: 'var(--font-ui)',
    fontSize: 11,
    padding: '7px 9px',
    outline: 'none',
    appearance: 'none',
    WebkitAppearance: 'none',
  };

  const handlePreview = async () => {
    if (!taskType) return;
    setLoading(true);
    setError(null);
    setDecision(null);
    try {
      const res = await fetch('/api/dispatch/route-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskType, laneId: laneId || null, priority, title: taskType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Route failed');
      setDecision(data.decision);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel-gold rounded-sm p-5">
      <h3 className="font-ui text-xs font-semibold tracking-wider uppercase mb-4" style={{ color: '#f0ede6' }}>
        Route Simulator
      </h3>
      <p className="font-body text-[11px] text-[#6b7280] mb-4">
        Preview which agent would handle any task type before dispatching.
      </p>

      <div className="space-y-3 mb-4">
        <div>
          <label className="font-mono text-[9px] tracking-widest text-[#4b5563] uppercase block mb-1">Task Type</label>
          <select value={taskType} onChange={e => setTaskType(e.target.value)} style={inputStyle}>
            <option value="">— Select task type —</option>
            {ALL_TASK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="font-mono text-[9px] tracking-widest text-[#4b5563] uppercase block mb-1">Lane (optional)</label>
            <select value={laneId} onChange={e => setLaneId(e.target.value)} style={inputStyle}>
              <option value="">— Any lane —</option>
              {Object.keys(LANE_COLOR).map(id => <option key={id} value={id}>{id}</option>)}
            </select>
          </div>
          <div>
            <label className="font-mono text-[9px] tracking-widest text-[#4b5563] uppercase block mb-1">Priority</label>
            <select value={priority} onChange={e => setPriority(e.target.value)} style={inputStyle}>
              {['Low', 'Normal', 'High'].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>

        <button
          onClick={handlePreview}
          disabled={!taskType || loading}
          className="w-full py-2 rounded-sm font-ui text-xs font-semibold tracking-widest uppercase transition-all"
          style={{
            background:  (!taskType || loading) ? 'rgba(201,168,76,0.05)' : 'linear-gradient(135deg, rgba(201,168,76,0.2), rgba(201,168,76,0.08))',
            border:      '1px solid rgba(201,168,76,0.35)',
            color:       (!taskType || loading) ? '#4b5563' : '#c9a84c',
            cursor:      (!taskType || loading) ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Computing...' : 'Preview Route'}
        </button>
      </div>

      {error && <p className="font-mono text-[9px] mb-2" style={{ color: '#ef4444' }}>Error: {error}</p>}

      <AnimatePresence>
        {decision && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <DecisionCard decision={decision} index={0} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Log viewer ────────────────────────────────────────────────────────────────

function DispatchLogPanel() {
  const [log, setLog]       = useState([]);
  const [loading, setLoading] = useState(true);

  const loadLog = useCallback(() => {
    setLoading(true);
    fetch('/api/dispatch/log')
      .then(r => r.ok ? r.json() : [])
      .then(d => { setLog(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { loadLog(); }, [loadLog]);

  return (
    <div className="panel-gold rounded-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-ui text-xs font-semibold tracking-wider uppercase" style={{ color: '#f0ede6' }}>
          Dispatch Log
        </h3>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[8px] text-[#4b5563]">{log.length} ENTRIES</span>
          <button onClick={loadLog} className="font-mono text-[8px] px-2 py-0.5 rounded-sm transition-all"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#8892a4', cursor: 'pointer' }}>
            REFRESH
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 h-12">
          <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 0.9 }}
            className="w-1.5 h-1.5 rounded-full" style={{ background: '#c9a84c' }} />
          <span className="font-mono text-[9px] text-[#4b5563]">Loading log...</span>
        </div>
      ) : log.length === 0 ? (
        <div className="flex items-center justify-center h-12">
          <span className="font-mono text-[9px] text-[#4b5563]">No dispatch events yet — preview a route to begin</span>
        </div>
      ) : (
        <div className="space-y-1 overflow-y-auto" style={{ maxHeight: 260 }}>
          {log.slice(0, 20).map((entry, i) => {
            const execColor  = entry.executableNow  ? '#0dd3c5' : '#4b5563';
            const apprvColor = entry.approvalRequired ? '#c9a84c' : '#4b5563';
            return (
              <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded-sm text-[9px]"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>
                <span className="font-mono text-[8px] text-[#4b5563] flex-shrink-0 w-16">
                  {entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                </span>
                <span className="font-mono text-[9px] text-[#8892a4] flex-1 truncate">{entry.taskType}</span>
                <span className="font-mono text-[8px] flex-shrink-0" style={{ color: execColor }}>
                  {entry.executableNow ? 'EXEC' : 'STAGED'}
                </span>
                <span className="font-mono text-[8px] flex-shrink-0" style={{ color: apprvColor }}>
                  {entry.approvalRequired ? 'APPRV' : 'AUTO'}
                </span>
                <span className="font-mono text-[8px] text-[#6b7280] flex-shrink-0 truncate max-w-[80px]">
                  {entry.selectedAgentId || '—'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Stats bar ─────────────────────────────────────────────────────────────────

function StatsBar({ decisions }) {
  const total      = decisions.length;
  const executable = decisions.filter(d => d.executableNow).length;
  const staged     = decisions.filter(d => !d.executableNow).length;
  const needApproval = decisions.filter(d => d.approvalRequired).length;
  const ready      = decisions.filter(d => d.nextAction === 'READY_TO_DISPATCH').length;

  const stats = [
    { label: 'ROUTES',      value: total,       color: '#c9a84c' },
    { label: 'EXECUTABLE',  value: executable,  color: '#0dd3c5' },
    { label: 'STAGED',      value: staged,       color: '#818cf8' },
    { label: 'NEED APPROVAL', value: needApproval, color: '#f59e0b' },
    { label: 'READY NOW',   value: ready,        color: '#4ade80' },
  ];

  return (
    <div className="grid grid-cols-5 gap-3">
      {stats.map(({ label, value, color }) => (
        <div key={label} className="panel-gold rounded-sm p-3 text-center">
          <div className="font-mono text-xl font-semibold leading-none mb-1" style={{ color }}>{value}</div>
          <div className="font-mono text-[8px] tracking-[0.15em] text-[#4b5563]">{label}</div>
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AgentDispatchCenter() {
  const [allDecisions, setAllDecisions] = useState([]);
  const [loading, setLoading]           = useState(true);
  const [filterDept, setFilterDept]     = useState('All');
  const [filterExec, setFilterExec]     = useState('All');
  const [filterPriority, setFilterPriority] = useState('All');
  const [filterType, setFilterType]     = useState('');
  const [activeTab, setActiveTab]       = useState('routes'); // 'routes' | 'simulator' | 'log'

  // On mount: compute decisions for all known task types to populate the table
  const loadAllDecisions = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.all(
        ALL_TASK_TYPES.map(taskType =>
          fetch('/api/dispatch/route-task', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskType, title: taskType, priority: 'Normal' }),
          })
            .then(r => r.json())
            .then(d => d.decision)
            .catch(() => null)
        )
      );
      setAllDecisions(results.filter(Boolean));
    } catch {
      setAllDecisions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAllDecisions(); }, [loadAllDecisions]);

  // Apply filters
  const filtered = allDecisions.filter(d => {
    if (filterDept !== 'All' && d.selectedAgent?.department !== filterDept) return false;
    if (filterExec === 'Executable' && !d.executableNow) return false;
    if (filterExec === 'Staged' && d.executableNow) return false;
    if (filterPriority !== 'All' && d.priority !== filterPriority) return false;
    if (filterType && !d.taskType?.toLowerCase().includes(filterType.toLowerCase())) return false;
    return true;
  });

  const chipStyle = (active) => ({
    background: active ? 'rgba(201,168,76,0.15)' : 'rgba(255,255,255,0.03)',
    border: `1px solid ${active ? 'rgba(201,168,76,0.4)' : 'rgba(255,255,255,0.07)'}`,
    color: active ? '#c9a84c' : '#6b7280',
    cursor: 'pointer',
    borderRadius: 4,
    padding: '3px 10px',
    fontFamily: 'var(--font-mono)',
    fontSize: 9,
    fontWeight: 600,
    letterSpacing: '0.1em',
    transition: 'all 0.15s',
  });

  const TAB_ITEMS = [
    { id: 'routes',    label: 'ROUTING TABLE' },
    { id: 'simulator', label: 'ROUTE SIMULATOR' },
    { id: 'log',       label: 'DISPATCH LOG' },
  ];

  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-5">
      <SectionHeader
        icon="◎"
        title="Agent Dispatch Center"
        subtitle="Deterministic routing layer — task type → agent selection → approval + execution decision"
      />

      {/* Governance notice */}
      <motion.div variants={fadeUp}
        className="flex items-center gap-3 px-4 py-2.5 rounded-sm"
        style={{ background: 'rgba(201,168,76,0.04)', border: '1px solid rgba(201,168,76,0.15)' }}>
        <span className="text-[#c9a84c]">◈</span>
        <span className="font-mono text-[9px] text-[#8892a4]">
          Governance enforced through task routing, approval, and execution-mode controls.
        </span>
        <span className="font-mono text-[8px] text-[#4b5563] ml-auto">AGENT_GOVERNANCE.md active</span>
      </motion.div>

      {/* Stats bar */}
      {!loading && <motion.div variants={fadeUp}><StatsBar decisions={allDecisions} /></motion.div>}

      {/* Tab bar */}
      <motion.div variants={fadeUp} className="flex items-center gap-1">
        {TAB_ITEMS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={chipStyle(activeTab === tab.id)}>
            {tab.label}
          </button>
        ))}
      </motion.div>

      {/* ── ROUTING TABLE ── */}
      {activeTab === 'routes' && (
        <motion.div variants={fadeUp} className="space-y-4">
          {/* Filters */}
          <div className="panel-gold rounded-sm p-4">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[8px] tracking-widest text-[#4b5563]">DEPT</span>
                <div className="flex items-center gap-1 flex-wrap">
                  {ALL_DEPARTMENTS.map(d => (
                    <button key={d} onClick={() => setFilterDept(d)} style={chipStyle(filterDept === d)}>{d}</button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[8px] tracking-widest text-[#4b5563]">EXEC</span>
                <div className="flex items-center gap-1">
                  {EXEC_FILTERS.map(f => (
                    <button key={f} onClick={() => setFilterExec(f)} style={chipStyle(filterExec === f)}>{f}</button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[8px] tracking-widest text-[#4b5563]">PRIORITY</span>
                <div className="flex items-center gap-1">
                  {ALL_PRIORITIES.map(p => (
                    <button key={p} onClick={() => setFilterPriority(p)} style={chipStyle(filterPriority === p)}>{p}</button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1.5 ml-auto">
                <input
                  value={filterType}
                  onChange={e => setFilterType(e.target.value)}
                  placeholder="Filter by type..."
                  className="rounded-sm px-2 py-1 font-mono text-[9px] outline-none"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(201,168,76,0.15)', color: '#f0ede6', width: 140 }}
                />
                {filterType && (
                  <button onClick={() => setFilterType('')} className="font-mono text-[9px] text-[#4b5563]">✕</button>
                )}
              </div>
            </div>
          </div>

          {/* Decision list */}
          {loading ? (
            <div className="flex items-center justify-center h-24 gap-3">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
                className="w-5 h-5 rounded-full"
                style={{ border: '1.5px solid rgba(201,168,76,0.15)', borderTopColor: '#c9a84c' }}
              />
              <span className="font-mono text-[10px] tracking-widest text-[#4b5563]">COMPUTING ROUTES...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center h-16">
              <span className="font-mono text-[10px] text-[#4b5563]">No routes match current filters</span>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <span className="font-mono text-[8px] text-[#4b5563]">{filtered.length} ROUTES</span>
              </div>
              <AnimatePresence mode="popLayout">
                {filtered.map((decision, i) => (
                  <DecisionCard key={decision.taskType} decision={decision} index={i} />
                ))}
              </AnimatePresence>
            </div>
          )}
        </motion.div>
      )}

      {/* ── ROUTE SIMULATOR ── */}
      {activeTab === 'simulator' && (
        <motion.div variants={fadeUp}>
          <RouteSimulator />
        </motion.div>
      )}

      {/* ── DISPATCH LOG ── */}
      {activeTab === 'log' && (
        <motion.div variants={fadeUp}>
          <DispatchLogPanel />
        </motion.div>
      )}
    </motion.div>
  );
}
