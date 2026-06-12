// components/sections/ViralContentWorkflowPanel.jsx
// Phase E.2 — Viral Content Workflow Panel.
//
// Shows the content assembly line for a given content brief.
// Modes:
//   1. No workflow → "Start Viral Workflow" button
//   2. Workflow exists → stage pipeline with status, agents, tasks
//
// Each stage is human-controlled. No auto-execution.
// Clicking a stage shows child task details and dispatch info.

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../../lib/store';

const GOLD    = '#c9a84c';
const TEAL    = '#0dd3c5';
const PURPLE  = '#818cf8';
const CRIMSON = '#ef4444';
const EMERALD = '#10b981';
const SAPPHIRE = '#3b82f6';

const STAGE_COLORS = {
  trend_research:  '#f59e0b',
  hook_generation: '#f472b6',
  content_strategy:'#818cf8',
  script_generation:'#0dd3c5',
  visual_prompting: '#3b82f6',
  caption_generation:'#10b981',
  repurposing:      '#4ade80',
};

const STATUS_META = {
  pending:    { label: 'PENDING',   color: '#4b5563' },
  queued:     { label: 'QUEUED',    color: '#8892a4' },
  approved:   { label: 'APPROVED',  color: GOLD      },
  dispatched: { label: 'SENT',      color: PURPLE     },
  running:    { label: 'RUNNING',   color: TEAL       },
  complete:   { label: 'DONE',      color: EMERALD    },
  failed:     { label: 'FAILED',    color: CRIMSON    },
};

const NEXT_ACTION_META = {
  READY_TO_DISPATCH:   { label: 'READY',    color: EMERALD  },
  AWAIT_APPROVAL:      { label: 'APPROVAL', color: GOLD     },
  STAGED_DISPLAY_ONLY: { label: 'STAGED',   color: PURPLE   },
  MANUAL_REVIEW:       { label: 'REVIEW',   color: CRIMSON  },
};

const stagger = { initial: {}, animate: { transition: { staggerChildren: 0.05 } } };
const fadeUp  = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0, transition: { duration: 0.25 } } };

// ── Stage pill (compact) ──────────────────────────────────────────────────────

function StagePill({ stage, isActive, onClick }) {
  const color  = STAGE_COLORS[stage.stageId] || GOLD;
  const status = STATUS_META[stage.status] || STATUS_META.pending;
  const exec   = stage.dispatchPreview?.executableNow;

  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1 px-3 py-2 rounded-sm transition-all"
      style={{
        background:  isActive ? `${color}18` : 'rgba(255,255,255,0.02)',
        border:      `1px solid ${isActive ? `${color}45` : 'rgba(255,255,255,0.06)'}`,
        minWidth:    72,
      }}
    >
      <span style={{ fontSize: 16 }}>{stage.icon}</span>
      <span className="font-mono text-[7px] font-semibold tracking-wider text-center" style={{ color: isActive ? color : '#8892a4' }}>
        {stage.displayName.toUpperCase()}
      </span>
      <div className="flex items-center gap-1">
        <div className="w-1 h-1 rounded-full" style={{ background: status.color }} />
        <span className="font-mono text-[6px]" style={{ color: exec ? EMERALD : '#4b5563' }}>
          {exec ? 'EXEC' : 'STAGED'}
        </span>
      </div>
    </button>
  );
}

// ── Stage detail card ─────────────────────────────────────────────────────────

function StageDetailCard({ stage, briefId, onGoToDispatch, onGoToApprovals }) {
  const color    = STAGE_COLORS[stage.stageId] || GOLD;
  const status   = STATUS_META[stage.status] || STATUS_META.pending;
  const preview  = stage.dispatchPreview;
  const exec     = preview?.executableNow;
  const agent    = preview?.selectedAgent;
  const fallback = preview?.fallbackAgent;
  const nextMeta = NEXT_ACTION_META[preview?.nextAction] || { label: preview?.nextAction, color: '#8892a4' };

  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      className="rounded-sm p-4 space-y-3"
      style={{ background: `${color}06`, border: `1px solid ${color}25` }}
    >
      {/* Stage header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span style={{ fontSize: 22 }}>{stage.icon}</span>
          <div>
            <div className="font-ui text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
              {stage.displayName}
            </div>
            <div className="font-mono text-[8px]" style={{ color }}>
              Stage {stage.order} of 7 · {stage.mappedTaskType}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[7px] px-1.5 py-0.5 rounded-sm"
            style={{ color: status.color, background: `${status.color}15` }}>
            {status.label}
          </span>
          {stage.approvalRequired && (
            <span className="font-mono text-[7px] px-1.5 py-0.5 rounded-sm"
              style={{ color: GOLD, background: `${GOLD}12` }}>
              APPROVAL REQ
            </span>
          )}
        </div>
      </div>

      {/* Dispatch route */}
      {preview && (
        <div className="rounded-sm p-2.5 space-y-2"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[7px] tracking-widest" style={{ color: PURPLE }}>DISPATCH ROUTE</span>
            <span className="font-mono text-[7px] px-1.5 py-0.5 rounded-sm"
              style={{ color: exec ? EMERALD : PURPLE, background: `${exec ? EMERALD : PURPLE}15` }}>
              {exec ? 'EXECUTABLE NOW' : 'STAGED'}
            </span>
            <span className="font-mono text-[7px] px-1.5 py-0.5 rounded-sm font-semibold"
              style={{ color: nextMeta.color, background: `${nextMeta.color}15`, border: `1px solid ${nextMeta.color}30` }}>
              {nextMeta.label}
            </span>
          </div>
          <div className="flex items-start gap-4">
            {agent && (
              <div>
                <div className="font-mono text-[6px] text-[#4b5563] mb-0.5">SELECTED</div>
                <div className="font-mono text-[9px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {agent.displayName}
                </div>
                <div className="font-mono text-[7px] text-[#6b7280]">{agent.role}</div>
                <div className="font-mono text-[7px] text-[#4b5563]">{agent.executionMode}</div>
              </div>
            )}
            {fallback && (
              <div style={{ opacity: 0.7 }}>
                <div className="font-mono text-[6px] text-[#4b5563] mb-0.5">FALLBACK</div>
                <div className="font-mono text-[8px]" style={{ color: '#8892a4' }}>
                  {fallback.displayName}
                </div>
                <div className="font-mono text-[7px] text-[#4b5563]">{fallback.role}</div>
              </div>
            )}
          </div>
          {preview.warnings?.length > 0 && (
            <div className="space-y-0.5">
              {preview.warnings.slice(0, 2).map((w, i) => (
                <div key={i} className="flex items-start gap-1">
                  <span style={{ color: '#f59e0b', fontSize: 7, flexShrink: 0 }}>⚠</span>
                  <span className="font-mono text-[7px] text-[#6b7280]">{w}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Task IDs */}
      {stage.taskId && (
        <div className="flex items-center gap-4">
          <div>
            <div className="font-mono text-[6px] text-[#4b5563] mb-0.5">TASK ID</div>
            <div className="font-mono text-[8px] text-[#8892a4] truncate max-w-[160px]">{stage.taskId}</div>
          </div>
          {stage.queueId && (
            <div>
              <div className="font-mono text-[6px] text-[#4b5563] mb-0.5">QUEUE ID</div>
              <div className="font-mono text-[8px] text-[#8892a4] truncate max-w-[160px]">{stage.queueId}</div>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        {exec ? (
          <button
            onClick={onGoToDispatch}
            className="font-ui text-[9px] font-bold px-3 py-1.5 rounded-sm tracking-wider transition-all"
            style={{ background: `${EMERALD}15`, border: `1px solid ${EMERALD}30`, color: EMERALD }}
          >
            GO TO AGENT DISPATCH →
          </button>
        ) : (
          <button
            onClick={onGoToApprovals}
            className="font-ui text-[9px] font-bold px-3 py-1.5 rounded-sm tracking-wider transition-all"
            style={{ background: `${GOLD}12`, border: `1px solid ${GOLD}28`, color: GOLD }}
          >
            REVIEW IN APPROVALS →
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ── Workflow stats bar ────────────────────────────────────────────────────────

function WorkflowStats({ workflow }) {
  const stages     = workflow.stages || [];
  const executable = stages.filter(s => s.dispatchPreview?.executableNow).length;
  const staged     = stages.filter(s => !s.dispatchPreview?.executableNow).length;
  const needApprv  = stages.filter(s => s.approvalRequired).length;

  const stats = [
    { label: 'STAGES',     value: stages.length, color: GOLD    },
    { label: 'EXECUTABLE', value: executable,     color: EMERALD },
    { label: 'STAGED',     value: staged,         color: PURPLE  },
    { label: 'NEED APPRV', value: needApprv,      color: '#f59e0b' },
  ];

  return (
    <div className="grid grid-cols-4 gap-2">
      {stats.map(({ label, value, color }) => (
        <div key={label} className="rounded-sm p-2.5 text-center"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="font-mono text-lg font-semibold leading-none mb-0.5" style={{ color }}>{value}</div>
          <div className="font-mono text-[7px] tracking-wider" style={{ color: '#4b5563' }}>{label}</div>
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ViralContentWorkflowPanel({ briefTaskId, compact = false }) {
  const { setActiveSection } = useStore();

  const [workflow, setWorkflow]       = useState(null);
  const [loading, setLoading]         = useState(true);
  const [creating, setCreating]       = useState(false);
  const [artifactMeta, setArtifactMeta] = useState(null);
  const [refreshing, setRefreshing]   = useState(false);
  const pollRef = useRef(null);
  const [error, setError]             = useState('');
  const [activeStageId, setActiveStageId] = useState(null);

  const loadWorkflow = useCallback(() => {
    if (!briefTaskId) { setLoading(false); return; }
    setLoading(true);
    fetch(`/api/workflows/viral-content/status?briefId=${encodeURIComponent(briefTaskId)}`)
      .then(r => r.json())
      .then(d => {
        const wf = d.exists ? d.workflow : null;
        setWorkflow(wf);
        setLoading(false);
        if (d.exists && d.workflow?.stages?.length > 0) {
          setActiveStageId(prev => prev || d.workflow.stages[0].stageId);
        }
        // Load artifact metadata for the workflow
        if (wf?.workflowId && wf?.lane) {
          fetch(`/api/content-artifacts/get?laneId=${encodeURIComponent(wf.lane)}&workflowId=${encodeURIComponent(wf.workflowId)}`)
            .then(r => r.ok ? r.json() : null)
            .then(a => setArtifactMeta(a?.metadata || null))
            .catch(() => {});
        }
      })
      .catch(() => setLoading(false));
  }, [briefTaskId]);

  useEffect(() => {
    loadWorkflow();
    pollRef.current = setInterval(loadWorkflow, 10000);
    return () => clearInterval(pollRef.current);
  }, [loadWorkflow]);

  async function handleRefresh() {
    setRefreshing(true);
    await loadWorkflow();
    setRefreshing(false);
  }

  async function handleStartWorkflow() {
    if (!briefTaskId || creating) return;
    setCreating(true);
    setError('');
    try {
      const res = await fetch('/api/workflows/viral-content/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentBriefTaskId: briefTaskId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Workflow creation failed');
      setWorkflow(data.workflow);
      if (data.workflow?.stages?.length > 0) {
        setActiveStageId(data.workflow.stages[0].stageId);
      }
    } catch (err) {
      setError(err.message || 'Failed to create workflow');
    } finally {
      setCreating(false);
    }
  }

  const activeStage = workflow?.stages?.find(s => s.stageId === activeStageId);

  // ── Loading ─────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3">
        <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 0.9 }}
          className="w-1.5 h-1.5 rounded-full" style={{ background: GOLD }} />
        <span className="font-mono text-[8px] text-[#4b5563]">Checking workflow…</span>
      </div>
    );
  }

  // ── No brief ID ──────────────────────────────────────────────────────────
  if (!briefTaskId) {
    return (
      <div className="panel-gold rounded-sm p-6 text-center">
        <p className="font-mono text-[9px] text-[#4b5563]">
          Create a content brief first, then expand it into a viral workflow.
        </p>
      </div>
    );
  }

  // ── No workflow yet — start prompt ───────────────────────────────────────
  if (!workflow) {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="rounded-sm p-5 text-center space-y-4"
        style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(201,168,76,0.12)' }}>

        {/* Pipeline preview */}
        <div className="flex items-center justify-center gap-1.5 flex-wrap">
          {[
            { icon: '🔥', label: 'TRENDS' },
            { icon: '🪝', label: 'HOOKS'  },
            { icon: '🎯', label: 'STRATEGY'},
            { icon: '📝', label: 'SCRIPT' },
            { icon: '🎬', label: 'VISUAL' },
            { icon: '💬', label: 'CAPTION'},
            { icon: '♻',  label: 'REPURPOSE'},
          ].map((s, i, arr) => (
            <div key={s.label} className="flex items-center gap-1.5">
              <div className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-sm"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', minWidth: 54 }}>
                <span style={{ fontSize: 13 }}>{s.icon}</span>
                <span className="font-mono text-[6px] tracking-wider" style={{ color: '#6b7280' }}>{s.label}</span>
              </div>
              {i < arr.length - 1 && (
                <span className="font-mono text-[8px]" style={{ color: 'rgba(255,255,255,0.12)' }}>→</span>
              )}
            </div>
          ))}
        </div>

        <div>
          <p className="font-body text-sm mb-0.5" style={{ color: 'var(--text-secondary)' }}>
            Expand this brief into a full viral content workflow
          </p>
          <p className="font-mono text-[8px]" style={{ color: '#4b5563' }}>
            Creates 7 queued child tasks · Each requires approval · No auto-execution
          </p>
        </div>

        <button
          onClick={handleStartWorkflow}
          disabled={creating}
          className="font-ui text-[10px] font-bold px-6 py-2.5 rounded-sm tracking-wider transition-all mx-auto block"
          style={{
            background: creating ? 'rgba(201,168,76,0.06)' : 'rgba(201,168,76,0.15)',
            border: `1px solid ${creating ? 'rgba(201,168,76,0.2)' : 'rgba(201,168,76,0.45)'}`,
            color: creating ? '#4b5563' : GOLD,
            cursor: creating ? 'not-allowed' : 'pointer',
          }}
        >
          {creating ? (
            <span className="flex items-center gap-2">
              <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 0.8 }}>◈</motion.span>
              Creating Workflow…
            </span>
          ) : '✦ Start Viral Workflow'}
        </button>

        {error && (
          <p className="font-mono text-[8px]" style={{ color: CRIMSON }}>{error}</p>
        )}
      </motion.div>
    );
  }

  // ── Workflow exists ──────────────────────────────────────────────────────
  const stages = workflow.stages || [];

  if (compact) {
    // Compact mode: just the pipeline pills + stats
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-mono text-[8px] tracking-widest" style={{ color: GOLD }}>
            VIRAL WORKFLOW ACTIVE
          </div>
          <span className="font-mono text-[7px] text-[#4b5563]">
            {stages.filter(s => s.dispatchPreview?.executableNow).length}/{stages.length} EXECUTABLE
          </span>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {stages.map((stage, i) => {
            const color  = STAGE_COLORS[stage.stageId] || GOLD;
            const exec   = stage.dispatchPreview?.executableNow;
            return (
              <div key={stage.stageId} className="flex items-center gap-1">
                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-sm"
                  style={{ background: `${color}12`, border: `1px solid ${color}25` }}>
                  <span style={{ fontSize: 9 }}>{stage.icon}</span>
                  <span className="font-mono text-[7px]" style={{ color }}>
                    {stage.displayName.split(' ')[0].toUpperCase()}
                  </span>
                  <div className="w-1 h-1 rounded-full" style={{ background: exec ? EMERALD : '#4b5563' }} />
                </div>
                {i < stages.length - 1 && (
                  <span className="font-mono text-[7px]" style={{ color: 'rgba(255,255,255,0.1)' }}>→</span>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setActiveSection('agent-dispatch')}
            className="font-mono text-[8px] px-2.5 py-1 rounded-sm transition-all"
            style={{ background: `${EMERALD}10`, border: `1px solid ${EMERALD}25`, color: EMERALD, cursor: 'pointer' }}>
            GO TO DISPATCH →
          </button>
          <span className="font-mono text-[7px] text-[#4b5563]">
            {stages.filter(s => s.status === 'complete').length}/{stages.length} stages complete
          </span>
        </div>
      </div>
    );
  }

  // Full mode
  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-4">

      {/* Header */}
      <motion.div variants={fadeUp} className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-[7px] tracking-[0.2em] uppercase px-1.5 py-0.5 rounded-sm"
              style={{ color: GOLD, background: `${GOLD}12`, border: `1px solid ${GOLD}25` }}>
              ACTIVE
            </span>
            <span className="font-mono text-[7px] tracking-wider text-[#4b5563]">
              {workflow.workflowType?.toUpperCase()} · {stages.length} STAGES
            </span>
          </div>
          <h3 className="font-ui text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
            Viral Content Workflow
          </h3>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="font-mono text-[8px]" style={{ color: '#8892a4' }}>
              {workflow.platform} · {workflow.contentGoal}
            </span>
            <span className="font-mono text-[7px] text-[#4b5563]">
              ID: {workflow.workflowId?.slice(0, 24)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleRefresh} disabled={refreshing}
            className="font-mono text-[8px] px-2 py-1 rounded-sm transition-all"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: refreshing ? '#4b5563' : '#8892a4' }}>
            {refreshing ? '…' : '↻'}
          </button>
          <button onClick={() => setActiveSection('agent-dispatch')}
            className="font-ui text-[9px] font-bold px-3 py-1.5 rounded-sm tracking-wider transition-all"
            style={{ background: `${EMERALD}12`, border: `1px solid ${EMERALD}28`, color: EMERALD }}>
            AGENT DISPATCH →
          </button>
          <button onClick={() => setActiveSection('telegram')}
            className="font-ui text-[9px] font-bold px-3 py-1.5 rounded-sm tracking-wider transition-all"
            style={{ background: `${GOLD}10`, border: `1px solid ${GOLD}25`, color: GOLD }}>
            APPROVALS →
          </button>
          {artifactMeta?.stagesCompleted?.length > 0 && (
            <button onClick={() => setActiveSection('content-division')}
              className="font-ui text-[9px] font-bold px-3 py-1.5 rounded-sm tracking-wider transition-all"
              style={{ background: 'rgba(16,185,129,0.1)', border: `1px solid ${EMERALD}28`, color: EMERALD }}>
              ◈ {artifactMeta.stagesCompleted.length} ARTIFACTS
            </button>
          )}
        </div>
      </motion.div>

      {/* Stats */}
      <motion.div variants={fadeUp}>
        <WorkflowStats workflow={workflow} />
      </motion.div>

      {/* Governance notice */}
      <motion.div variants={fadeUp} className="flex items-center gap-2 px-3 py-2 rounded-sm"
        style={{ background: 'rgba(201,168,76,0.04)', border: '1px solid rgba(201,168,76,0.12)' }}>
        <span style={{ color: GOLD, fontSize: 9 }}>◈</span>
        <span className="font-mono text-[8px] text-[#6b7280]">
          Governance enforced — each stage requires human approval before dispatch. No auto-execution.
        </span>
      </motion.div>

      {/* Stage pipeline selector */}
      <motion.div variants={fadeUp}>
        <div className="font-mono text-[7px] tracking-[0.18em] uppercase mb-2" style={{ color: 'var(--text-muted)' }}>
          CONTENT ASSEMBLY LINE
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {stages.map((stage, i) => (
            <div key={stage.stageId} className="flex items-center gap-1">
              <StagePill
                stage={stage}
                isActive={activeStageId === stage.stageId}
                onClick={() => setActiveStageId(
                  activeStageId === stage.stageId ? null : stage.stageId
                )}
              />
              {i < stages.length - 1 && (
                <span className="font-mono text-[10px]" style={{ color: 'rgba(255,255,255,0.08)' }}>→</span>
              )}
            </div>
          ))}
        </div>
      </motion.div>

      {/* Stage detail */}
      <AnimatePresence mode="wait">
        {activeStage && (
          <motion.div
            key={activeStage.stageId}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
          >
            <StageDetailCard
              stage={activeStage}
              briefId={workflow.parentBriefId}
              onGoToDispatch={() => setActiveSection('agent-dispatch')}
              onGoToApprovals={() => setActiveSection('telegram')}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Compact stage list (all stages at a glance) */}
      <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4">
        <div className="font-mono text-[7px] tracking-[0.18em] uppercase mb-3" style={{ color: 'var(--text-muted)' }}>
          ALL STAGES
        </div>
        <div className="space-y-1.5">
          {stages.map(stage => {
            const color       = STAGE_COLORS[stage.stageId] || GOLD;
            const status      = STATUS_META[stage.status] || STATUS_META.pending;
            const exec        = stage.dispatchPreview?.executableNow;
            const agent       = stage.dispatchPreview?.selectedAgent;
            const isActive    = activeStageId === stage.stageId;
            const hasArtifact = artifactMeta?.stagesCompleted?.includes(stage.stageId);

            return (
              <button
                key={stage.stageId}
                onClick={() => setActiveStageId(isActive ? null : stage.stageId)}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-sm text-left transition-all"
                style={{
                  background: isActive ? `${color}12` : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${isActive ? `${color}30` : 'rgba(255,255,255,0.05)'}`,
                }}
              >
                <div className="w-0.5 h-5 rounded-full flex-shrink-0" style={{ background: color }} />
                <span style={{ fontSize: 13, flexShrink: 0 }}>{stage.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[9px] font-semibold" style={{ color: isActive ? color : '#8892a4' }}>
                      {stage.displayName}
                    </span>
                    <span className="font-mono text-[7px] text-[#4b5563]">{stage.mappedTaskType}</span>
                  </div>
                  {agent && (
                    <div className="font-mono text-[7px] text-[#4b5563]">
                      {agent.displayName} · {agent.executionMode}
                    </div>
                  )}
                </div>
                <span className="font-mono text-[7px] flex-shrink-0"
                  style={{ color: exec ? EMERALD : PURPLE }}>
                  {exec ? 'EXEC' : 'STAGED'}
                </span>
                <span className="font-mono text-[7px] flex-shrink-0 w-14 text-right"
                  style={{ color: status.color }}>
                  {status.label}
                </span>
                {hasArtifact && (
                  <span className="font-mono text-[6px] flex-shrink-0 flex items-center gap-0.5"
                    style={{ color: EMERALD, background: `${EMERALD}12`, padding: '1px 4px', borderRadius: 2 }}>
                    ◈ ARTIFACT
                  </span>
                )}
                {stage.approvalRequired && (
                  <span className="font-mono text-[6px] flex-shrink-0"
                    style={{ color: GOLD, background: `${GOLD}12`, padding: '1px 4px', borderRadius: 2 }}>
                    APPRV
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </motion.div>

    </motion.div>
  );
}
