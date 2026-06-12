// components/sections/ContentBriefGenerator.jsx
// Phase E.1 — Content Brief Generator through Dispatch Engine.
//
// Creates structured content briefs that flow through:
//   Queue → Approval → Agent Dispatch Engine → OpenClaw / Hermes
//
// This component does NOT generate content directly.
// It creates a typed, routable task that the Dispatch Engine handles.

import { useState, useMemo, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../../lib/store';
import { createContentBrief, fetchContentBriefs, previewDispatch } from '../../lib/api';
import { AGENT_AVATARS } from '../../lib/agent-avatars';
import ViralContentWorkflowPanel from './ViralContentWorkflowPanel';

// ── Constants ──────────────────────────────────────────────────────────────────

const LANE_OPTIONS = [
  { id: 'digital-diamond', label: 'Digital Diamond AI',  color: '#c9a84c' },
  { id: 'managed-by-mika', label: 'Managed by Mika',     color: '#0dd3c5' },
  { id: 'medai',           label: 'MedAI',               color: '#818cf8' },
  { id: 'cannaops',        label: 'CannaOps',            color: '#4ade80' },
  { id: 'hotel-hooker',    label: 'The Hotel Hooker',     color: '#f472b6' },
  { id: 'ai-twin',         label: 'AI Twin Studio',       color: '#60a5fa' },
];

const PLATFORMS = ['TikTok', 'Instagram', 'LinkedIn', 'YouTube', 'Pinterest', 'X / Twitter', 'Blog', 'Podcast'];

const PLATFORM_COLOR = {
  TikTok: '#69c9d0', Instagram: '#e1306c', LinkedIn: '#0a7abf',
  YouTube: '#ef4444', Pinterest: '#bd081c', 'X / Twitter': '#1d9bf0',
  Blog: '#c9a84c', Podcast: '#8b5cf6',
};

const CONTENT_GOALS = [
  'Grow followers',
  'Generate leads',
  'Sell digital product',
  'Build authority',
  'Teach AI',
  'Promote service',
  'Drive traffic',
  'Nurture audience',
];

// Cross-platform content types with dispatch task type mapping
const CONTENT_TYPES = [
  { label: 'Trend post',        taskType: 'Trend Research',   icon: '🔥' },
  { label: 'Educational post',  taskType: 'Script Creation',  icon: '📚' },
  { label: 'Storytelling post', taskType: 'Content Strategy', icon: '✍' },
  { label: 'AI twin video',     taskType: 'Video Prompting',  icon: '🪞' },
  { label: 'UGC ad concept',    taskType: 'Hook Creation',    icon: '🪝' },
  { label: 'Carousel',          taskType: 'Script Creation',  icon: '🗂' },
  { label: 'Short-form video',  taskType: 'Script Creation',  icon: '📱' },
  { label: 'Long-form script',  taskType: 'Script Creation',  icon: '📄' },
  { label: 'Repurposing pack',  taskType: 'Repurposing',      icon: '♻' },
];

const CONTENT_TYPE_TO_TASK_TYPE = Object.fromEntries(
  CONTENT_TYPES.map(t => [t.label, t.taskType])
);

const TONES = [
  'Energetic & Authentic',
  'Professional & Authoritative',
  'Educational & Clear',
  'Bold & Provocative',
  'Warm & Personal',
  'Inspiring & Motivational',
];

const URGENCIES = [
  { label: 'Low',    priority: 'Low'    },
  { label: 'Normal', priority: 'Normal' },
  { label: 'Urgent', priority: 'High'   },
];

// Suggested agent pipelines (display only — actual routing comes from Dispatch Engine)
const AGENT_PIPELINE = {
  TikTok:        ['trend-hunter', 'hook-engineer', 'content-architect', 'twin', 'publisher'],
  Instagram:     ['trend-hunter', 'hook-engineer', 'visual-designer', 'hookr', 'twin', 'publisher'],
  LinkedIn:      ['content-architect', 'editor', 'diamond', 'twin', 'publisher'],
  YouTube:       ['content-architect', 'visual-designer', 'video-producer', 'twin', 'editor', 'publisher'],
  Pinterest:     ['visual-designer', 'prompt-engineer', 'hookr', 'publisher'],
  'X / Twitter': ['hook-engineer', 'content-architect', 'twin', 'editor', 'publisher'],
  Blog:          ['content-architect', 'editor', 'diamond', 'twin', 'publisher'],
  Podcast:       ['content-architect', 'voice-producer', 'twin', 'editor', 'publisher'],
};

const EMPTY_FORM = {
  lane: '', platform: '', contentGoal: '', contentType: '',
  audience: '', tone: '', urgency: 'Normal',
  primaryOffer: '', instructions: '', approvalRequired: true,
};

const GOLD     = '#c9a84c';
const SAPPHIRE = '#3b82f6';
const EMERALD  = '#10b981';
const CRIMSON  = '#ef4444';
const PURPLE   = '#818cf8';

const stagger = { initial: {}, animate: { transition: { staggerChildren: 0.06 } } };
const fadeUp  = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0, transition: { duration: 0.28 } } };

// ── Shared input styles ────────────────────────────────────────────────────────

const selectStyle = {
  width: '100%',
  background: 'rgba(0,0,0,0.3)',
  border: '1px solid rgba(201,168,76,0.15)',
  borderRadius: 4,
  color: '#f0ede6',
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: 11,
  padding: '7px 10px',
  outline: 'none',
  appearance: 'none',
  WebkitAppearance: 'none',
  cursor: 'pointer',
};

const inputStyle = {
  ...selectStyle,
  fontFamily: 'DM Sans, sans-serif',
  fontSize: 12,
  cursor: 'text',
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function FieldLabel({ children }) {
  return (
    <div className="font-mono text-[8px] tracking-[0.18em] uppercase mb-1.5" style={{ color: 'var(--text-muted)' }}>
      {children}
    </div>
  );
}

function ChipGroup({ options, value, onChange, activeColor = GOLD, small }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(opt => {
        const label  = typeof opt === 'string' ? opt : opt.label;
        const val    = typeof opt === 'string' ? opt : opt.priority;
        const active = value === val;
        return (
          <button
            key={val}
            type="button"
            onClick={() => onChange(val)}
            className={`font-ui font-semibold px-2.5 py-1 rounded-sm tracking-wider transition-all ${small ? 'text-[8px]' : 'text-[9px]'}`}
            style={{
              background: active ? `${activeColor}18` : 'rgba(255,255,255,0.03)',
              border: `1px solid ${active ? `${activeColor}40` : 'rgba(255,255,255,0.07)'}`,
              color: active ? activeColor : 'var(--text-muted)',
            }}
          >
            {typeof opt !== 'string' && opt.icon ? `${opt.icon} ${label}` : label}
          </button>
        );
      })}
    </div>
  );
}

// ── Dispatch preview chip ─────────────────────────────────────────────────────

function DispatchPreviewChip({ preview, loading }) {
  if (loading) return (
    <div className="flex items-center gap-1.5">
      <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 0.9 }}
        className="w-1.5 h-1.5 rounded-full" style={{ background: PURPLE }} />
      <span className="font-mono text-[8px] text-[#6b7280]">Computing route…</span>
    </div>
  );
  if (!preview) return null;

  const agent   = preview.selectedAgent;
  const execOk  = preview.executableNow;
  const apprvl  = preview.approvalRequired;
  const NEXT_META = {
    READY_TO_DISPATCH:   { label: 'READY',    color: EMERALD },
    AWAIT_APPROVAL:      { label: 'APPROVAL', color: GOLD   },
    STAGED_DISPLAY_ONLY: { label: 'STAGED',   color: PURPLE  },
    MANUAL_REVIEW:       { label: 'REVIEW',   color: CRIMSON },
  };
  const nextMeta = NEXT_META[preview.nextAction] || { label: preview.nextAction, color: '#8892a4' };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-sm p-3 space-y-2"
      style={{ background: `${PURPLE}06`, border: `1px solid ${PURPLE}25` }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-[7px] tracking-widest" style={{ color: PURPLE }}>ROUTE PREVIEW</span>
        <span className="font-mono text-[7px] px-1.5 py-0.5 rounded-sm"
          style={{ color: execOk ? EMERALD : PURPLE, background: `${execOk ? EMERALD : PURPLE}15` }}>
          {execOk ? 'EXECUTABLE' : 'STAGED'}
        </span>
        <span className="font-mono text-[7px] px-1.5 py-0.5 rounded-sm font-semibold"
          style={{ color: nextMeta.color, background: `${nextMeta.color}15`, border: `1px solid ${nextMeta.color}30` }}>
          {nextMeta.label}
        </span>
        {apprvl && (
          <span className="font-mono text-[7px] px-1 py-0.5 rounded-sm" style={{ color: GOLD, background: `${GOLD}12` }}>
            APPROVAL REQ
          </span>
        )}
      </div>
      {agent && (
        <div className="flex items-center gap-2">
          <div>
            <div className="font-mono text-[7px] text-[#4b5563] mb-0.5">SELECTED AGENT</div>
            <div className="font-mono text-[9px] font-semibold" style={{ color: '#f0ede6' }}>{agent.displayName}</div>
            <div className="font-mono text-[7px] text-[#6b7280]">{agent.role} · {agent.executionMode}</div>
          </div>
        </div>
      )}
      {preview.warnings?.length > 0 && (
        <div className="space-y-0.5">
          {preview.warnings.slice(0, 2).map((w, i) => (
            <div key={i} className="flex items-start gap-1">
              <span style={{ color: '#f59e0b', fontSize: 8 }}>⚠</span>
              <span className="font-mono text-[7px] text-[#6b7280]">{w}</span>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ── Success panel ─────────────────────────────────────────────────────────────

function SuccessPanel({ result, platform, onAnother, onGoToApprovals, onGoToDispatch, taskId }) {
  const [showWorkflow, setShowWorkflow] = useState(false);
  const preview   = result.dispatchPreview;
  const agentName = preview?.selectedAgent?.displayName || '—';
  const execOk    = preview?.executableNow;
  const nextAct   = preview?.nextAction;
  const agents    = AGENT_PIPELINE[platform] || [];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className="panel-gold rounded-sm p-8 flex flex-col items-center gap-5 text-center"
      style={{ borderColor: `${EMERALD}30` }}
    >
      <div className="w-14 h-14 rounded-full flex items-center justify-center text-2xl"
        style={{ background: `${EMERALD}15`, border: `1px solid ${EMERALD}30` }}>
        ✓
      </div>

      <div>
        <h3 className="font-display text-xl font-light mb-1" style={{ color: 'var(--text-primary)' }}>
          Content Brief Queued
        </h3>
        <p className="font-body text-sm" style={{ color: 'var(--text-secondary)' }}>
          Brief created, queued, and Telegram notification sent.
        </p>
      </div>

      {/* Task details */}
      <div className="grid grid-cols-2 gap-2.5 w-full max-w-sm">
        {[
          { label: 'TASK ID',  value: result.taskId?.slice(0, 20) + '…' },
          { label: 'QUEUE ID', value: result.queueId?.slice(0, 20) + '…' },
          { label: 'STATUS',   value: 'QUEUED FOR APPROVAL', color: EMERALD },
          { label: 'TASK TYPE', value: result.task?.taskType, color: GOLD },
        ].map(item => (
          <div key={item.label} className="rounded-sm p-2"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="font-mono text-[7px] tracking-wider mb-0.5" style={{ color: 'var(--text-muted)' }}>
              {item.label}
            </div>
            <div className="font-mono text-[8px] font-bold truncate" style={{ color: item.color || 'var(--text-primary)' }}>
              {item.value || '—'}
            </div>
          </div>
        ))}
      </div>

      {/* Dispatch route */}
      {preview && (
        <div className="w-full max-w-sm rounded-sm p-3"
          style={{ background: `${PURPLE}06`, border: `1px solid ${PURPLE}22` }}>
          <div className="font-mono text-[7px] tracking-widest mb-2" style={{ color: PURPLE }}>DISPATCH ROUTE</div>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-mono text-[9px] font-semibold" style={{ color: '#f0ede6' }}>{agentName}</div>
              <div className="font-mono text-[7px] text-[#6b7280]">{preview.selectedAgent?.role}</div>
            </div>
            <span className="font-mono text-[7px] px-1.5 py-0.5 rounded-sm"
              style={{ color: execOk ? EMERALD : PURPLE, background: `${execOk ? EMERALD : PURPLE}15` }}>
              {execOk ? 'EXECUTABLE NOW' : 'STAGED'}
            </span>
          </div>
          {nextAct === 'AWAIT_APPROVAL' && (
            <p className="font-mono text-[7px] mt-1.5" style={{ color: GOLD }}>
              Awaiting approval before execution.
            </p>
          )}
        </div>
      )}

      {/* Suggested agents */}
      {agents.length > 0 && (
        <div className="w-full max-w-sm">
          <div className="font-mono text-[7px] tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>
            SUGGESTED PIPELINE
          </div>
          <div className="flex items-center gap-1.5 flex-wrap justify-center">
            {agents.map((id, i) => {
              const avatar = AGENT_AVATARS[id] || {};
              return (
                <div key={id} className="flex items-center gap-1">
                  <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-sm"
                    style={{ background: `${avatar.color || GOLD}10`, border: `1px solid ${avatar.color || GOLD}22` }}>
                    <div className="w-3.5 h-3.5 rounded-full flex items-center justify-center"
                      style={{ background: avatar.gradient || 'rgba(255,255,255,0.1)' }}>
                      <span style={{ fontSize: 7 }}>{avatar.emoji || '🤖'}</span>
                    </div>
                    <span className="font-mono text-[7px]" style={{ color: avatar.color || GOLD }}>{id}</span>
                  </div>
                  {i < agents.length - 1 && (
                    <span className="font-mono text-[7px]" style={{ color: 'rgba(255,255,255,0.12)' }}>→</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap justify-center">
        <button
          onClick={onGoToApprovals}
          className="font-ui text-[10px] font-bold px-4 py-2 rounded-sm tracking-wider transition-all"
          style={{ background: `${EMERALD}15`, border: `1px solid ${EMERALD}30`, color: EMERALD }}
        >
          REVIEW IN APPROVALS →
        </button>
        <button
          onClick={onGoToDispatch}
          className="font-ui text-[10px] font-bold px-4 py-2 rounded-sm tracking-wider transition-all"
          style={{ background: `${PURPLE}15`, border: `1px solid ${PURPLE}30`, color: PURPLE }}
        >
          AGENT DISPATCH →
        </button>
        <button
          onClick={onAnother}
          className="font-ui text-[10px] font-bold px-4 py-2 rounded-sm tracking-wider transition-all"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-muted)' }}
        >
          NEW BRIEF
        </button>
      </div>

      {/* Viral Workflow expander */}
      <div className="w-full max-w-sm">
        {!showWorkflow ? (
          <button
            onClick={() => setShowWorkflow(true)}
            className="w-full font-ui text-[10px] font-bold px-4 py-2.5 rounded-sm tracking-wider transition-all"
            style={{
              background: 'rgba(201,168,76,0.1)',
              border: '1px solid rgba(201,168,76,0.3)',
              color: '#c9a84c',
            }}
          >
            ✦ EXPAND TO VIRAL WORKFLOW
          </button>
        ) : (
          <div className="w-full text-left">
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-[8px] tracking-widest" style={{ color: '#c9a84c' }}>
                VIRAL CONTENT WORKFLOW
              </span>
              <button onClick={() => setShowWorkflow(false)}
                className="font-mono text-[8px] text-[#4b5563] hover:text-[#8892a4]">
                ✕
              </button>
            </div>
            <ViralContentWorkflowPanel briefTaskId={taskId} compact={false} />
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Recent content briefs panel ───────────────────────────────────────────────

const STATUS_COLOR = {
  pending:  '#8892a4',
  running:  '#c9a84c',
  complete: '#0dd3c5',
  failed:   '#ef4444',
};

function RecentBriefs({ refreshTrigger, onExpand }) {
  const [briefs, setBriefs]   = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetchContentBriefs(8)
      .then(b => { setBriefs(b); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load, refreshTrigger]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="panel-gold rounded-sm p-4"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="font-mono text-[8px] tracking-[0.18em] uppercase" style={{ color: GOLD }}>
          Recent Content Briefs
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[7px] text-[#4b5563]">{briefs.length} BRIEFS</span>
          <button onClick={load}
            className="font-mono text-[7px] px-1.5 py-0.5 rounded-sm transition-all"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#6b7280', cursor: 'pointer' }}>
            REFRESH
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 h-8">
          <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 0.9 }}
            className="w-1.5 h-1.5 rounded-full" style={{ background: GOLD }} />
          <span className="font-mono text-[8px] text-[#4b5563]">Loading…</span>
        </div>
      ) : briefs.length === 0 ? (
        <div className="flex items-center justify-center h-8">
          <span className="font-mono text-[8px] text-[#4b5563]">
            No content briefs yet — create one above
          </span>
        </div>
      ) : (
        <div className="space-y-1 overflow-y-auto" style={{ maxHeight: 200 }}>
          {briefs.map(b => {
            const sc         = STATUS_COLOR[b.status] || '#4b5563';
            const laneColor  = LANE_OPTIONS.find(l => l.id === b.lane)?.color || GOLD;
            const platColor  = PLATFORM_COLOR[b.platform] || '#8892a4';
            const ctype      = CONTENT_TYPES.find(t => t.label === b.contentType);

            return (
              <div key={b.id} className="flex items-center gap-2 px-2 py-1.5 rounded-sm"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>
                {/* Lane bar */}
                <div className="w-0.5 h-5 rounded-full flex-shrink-0" style={{ background: laneColor }} />
                {/* Title / type */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono text-[8px] truncate" style={{ color: '#8892a4' }}>
                      {ctype?.icon} {b.contentType || 'Content'}
                    </span>
                    {b.platform && (
                      <span className="font-mono text-[7px] px-1 py-0.5 rounded-sm"
                        style={{ color: platColor, background: `${platColor}12` }}>
                        {b.platform}
                      </span>
                    )}
                  </div>
                  {b.contentGoal && (
                    <div className="font-mono text-[7px] text-[#4b5563] truncate">{b.contentGoal}</div>
                  )}
                </div>
                {/* Task type (route) */}
                <span className="font-mono text-[7px] flex-shrink-0 text-right" style={{ color: PURPLE }}>
                  {b.taskType}
                </span>
                {/* Status */}
                <span className="font-mono text-[7px] flex-shrink-0" style={{ color: sc }}>
                  {b.status?.toUpperCase()}
                </span>
                {/* Viral workflow button */}
                <button
                  onClick={() => onExpand?.(b.id)}
                  className="font-mono text-[7px] px-1.5 py-0.5 rounded-sm flex-shrink-0 transition-all"
                  style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.25)', color: '#c9a84c' }}
                >
                  ✦ WORKFLOW
                </button>
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}

// ── ContentBriefGenerator ──────────────────────────────────────────────────────

export default function ContentBriefGenerator() {
  const { setActiveSection } = useStore();

  const [form, setForm]               = useState(EMPTY_FORM);
  const [submitting, setSubmitting]   = useState(false);
  const [result, setResult]           = useState(null);
  const [error, setError]             = useState('');
  const [dispatchPreview, setDispatchPreview] = useState(null);
  const [previewLoading, setPreviewLoading]   = useState(false);
  const [refreshTrigger, setRefreshTrigger]   = useState(0);
  const [expandedBriefId, setExpandedBriefId] = useState(null);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const isValid       = form.lane && form.platform && form.contentGoal && form.contentType && form.tone;
  const suggestedAgents = AGENT_PIPELINE[form.platform] || [];
  const platformColor   = PLATFORM_COLOR[form.platform] || GOLD;
  const laneColor       = LANE_OPTIONS.find(l => l.id === form.lane)?.color || GOLD;
  const mappedTaskType  = CONTENT_TYPE_TO_TASK_TYPE[form.contentType] || null;

  // Clear dispatch preview when taskType-affecting fields change
  const prevKey = `${form.contentType}|${form.lane}|form.urgency`;
  const [lastPrevKey, setLastPrevKey] = useState('');
  if (prevKey !== lastPrevKey && dispatchPreview) {
    setDispatchPreview(null);
    setLastPrevKey(prevKey);
  }

  async function handlePreviewRoute() {
    if (!mappedTaskType || !form.lane) return;
    setPreviewLoading(true);
    setDispatchPreview(null);
    try {
      const res = await previewDispatch({
        taskType: mappedTaskType,
        laneId:   form.lane,
        priority: form.urgency || 'Normal',
        title:    `${form.contentType || 'Content'} — ${form.platform || ''} · ${LANE_OPTIONS.find(l => l.id === form.lane)?.label || form.lane}`,
      });
      setDispatchPreview(res.decision);
    } catch (err) {
      setDispatchPreview({ error: err.message });
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValid || submitting) return;
    setSubmitting(true);
    setError('');

    try {
      const res = await createContentBrief({
        lane:            form.lane,
        platform:        form.platform,
        contentGoal:     form.contentGoal,
        contentType:     form.contentType,
        audience:        form.audience,
        tone:            form.tone,
        urgency:         form.urgency,
        primaryOffer:    form.primaryOffer,
        instructions:    form.instructions,
        approvalRequired:form.approvalRequired,
      });
      setResult(res);
      setRefreshTrigger(n => n + 1);
    } catch (err) {
      setError(err.message || 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="space-y-5">
        <SuccessPanel
          result={result}
          platform={form.platform}
          taskId={result.taskId}
          onAnother={() => { setResult(null); setForm(EMPTY_FORM); setError(''); setDispatchPreview(null); }}
          onGoToApprovals={() => setActiveSection('telegram')}
          onGoToDispatch={() => setActiveSection('agent-dispatch')}
        />
        <RecentBriefs refreshTrigger={refreshTrigger} onExpand={setExpandedBriefId} />
      </div>
    );
  }

  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-5">

      {/* Header */}
      <motion.div variants={fadeUp} className="flex items-start justify-between">
        <div>
          <h3 className="font-ui text-base font-bold mb-0.5" style={{ color: 'var(--text-primary)' }}>
            Content Brief Generator
          </h3>
          <p className="font-mono text-[9px] tracking-wider" style={{ color: 'var(--text-muted)' }}>
            QUEUE → APPROVAL → AGENT DISPATCH ENGINE → OPENCLAW / HERMES
          </p>
        </div>
        {mappedTaskType && (
          <div className="font-mono text-[8px] px-2.5 py-1 rounded-sm"
            style={{ background: `${PURPLE}10`, border: `1px solid ${PURPLE}25`, color: PURPLE }}>
            → {mappedTaskType}
          </div>
        )}
      </motion.div>

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-5 gap-5">

          {/* ── LEFT: Form (3 cols) ─────────────────────────── */}
          <motion.div variants={fadeUp} className="col-span-3 space-y-4">

            {/* Row 1: Brand + Platform */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel>Brand / Project</FieldLabel>
                <select
                  value={form.lane}
                  onChange={e => set('lane', e.target.value)}
                  style={{ ...selectStyle, borderColor: form.lane ? `${laneColor}35` : 'rgba(201,168,76,0.15)', color: form.lane ? laneColor : '#4b5563' }}
                  required
                >
                  <option value="">Select brand…</option>
                  {LANE_OPTIONS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
              </div>
              <div>
                <FieldLabel>Platform</FieldLabel>
                <ChipGroup
                  options={PLATFORMS}
                  value={form.platform}
                  onChange={v => set('platform', v)}
                  activeColor={platformColor}
                  small
                />
              </div>
            </div>

            {/* Row 2: Goal + Content Type */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel>Content Goal</FieldLabel>
                <select
                  value={form.contentGoal}
                  onChange={e => set('contentGoal', e.target.value)}
                  style={{ ...selectStyle }}
                  required
                >
                  <option value="">Select goal…</option>
                  {CONTENT_GOALS.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              <div>
                <FieldLabel>Content Type → Task Route</FieldLabel>
                <div className="space-y-1">
                  <select
                    value={form.contentType}
                    onChange={e => set('contentType', e.target.value)}
                    style={{ ...selectStyle }}
                    required
                  >
                    <option value="">Select type…</option>
                    {CONTENT_TYPES.map(t => (
                      <option key={t.label} value={t.label}>{t.icon} {t.label}</option>
                    ))}
                  </select>
                  {mappedTaskType && (
                    <div className="font-mono text-[7px]" style={{ color: PURPLE }}>
                      routes as: {mappedTaskType}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Tone */}
            <div>
              <FieldLabel>Tone</FieldLabel>
              <ChipGroup options={TONES} value={form.tone} onChange={v => set('tone', v)} activeColor={platformColor} small />
            </div>

            {/* Target Audience */}
            <div>
              <FieldLabel>Target Audience</FieldLabel>
              <input
                type="text"
                value={form.audience}
                onChange={e => set('audience', e.target.value)}
                placeholder="e.g. ADHD founders aged 25-40 building AI businesses"
                style={{ ...inputStyle }}
              />
            </div>

            {/* Primary Offer */}
            <div>
              <FieldLabel>Primary Offer <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></FieldLabel>
              <input
                type="text"
                value={form.primaryOffer}
                onChange={e => set('primaryOffer', e.target.value)}
                placeholder="e.g. Digital Diamond AI onboarding, $2,500 package"
                style={{ ...inputStyle }}
              />
            </div>

            {/* Urgency + Approval */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel>Urgency</FieldLabel>
                <ChipGroup
                  options={URGENCIES}
                  value={form.urgency}
                  onChange={v => set('urgency', v)}
                  activeColor={form.urgency === 'High' ? CRIMSON : form.urgency === 'Low' ? '#4ade80' : GOLD}
                  small
                />
              </div>
              <div>
                <FieldLabel>Approval Required</FieldLabel>
                <div className="flex items-center gap-2 mt-1">
                  {[true, false].map(val => (
                    <button
                      key={String(val)}
                      type="button"
                      onClick={() => set('approvalRequired', val)}
                      className="font-ui text-[9px] font-semibold px-3 py-1 rounded-sm tracking-wider transition-all"
                      style={{
                        background: form.approvalRequired === val ? `${GOLD}18` : 'rgba(255,255,255,0.03)',
                        border: `1px solid ${form.approvalRequired === val ? `${GOLD}40` : 'rgba(255,255,255,0.07)'}`,
                        color: form.approvalRequired === val ? GOLD : 'var(--text-muted)',
                      }}
                    >
                      {val ? 'Required' : 'Auto'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Instructions */}
            <div>
              <FieldLabel>Instructions <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></FieldLabel>
              <textarea
                value={form.instructions}
                onChange={e => set('instructions', e.target.value)}
                placeholder="Any specific angles, hooks, references, constraints, or context for the content team…"
                rows={3}
                style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
              />
            </div>

            {/* Buttons row */}
            <div className="flex items-center gap-2 flex-wrap pt-1">
              {/* Preview Route button */}
              <button
                type="button"
                onClick={handlePreviewRoute}
                disabled={!mappedTaskType || !form.lane || previewLoading}
                className="font-ui text-[9px] font-bold px-4 py-2 rounded-sm tracking-wider transition-all"
                style={{
                  background: (!mappedTaskType || !form.lane) ? 'rgba(255,255,255,0.03)' : `${PURPLE}12`,
                  border: `1px solid ${(!mappedTaskType || !form.lane) ? 'rgba(255,255,255,0.07)' : `${PURPLE}35`}`,
                  color: (!mappedTaskType || !form.lane) ? 'var(--text-muted)' : PURPLE,
                  cursor: (!mappedTaskType || !form.lane || previewLoading) ? 'not-allowed' : 'pointer',
                }}
              >
                {previewLoading ? '…' : '◎ Preview Route'}
              </button>

              {/* Submit button */}
              <button
                type="submit"
                disabled={!isValid || submitting}
                className="font-ui text-[10px] font-bold px-5 py-2 rounded-sm tracking-wider transition-all"
                style={{
                  background: isValid ? `${SAPPHIRE}18` : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${isValid ? `${SAPPHIRE}40` : 'rgba(255,255,255,0.08)'}`,
                  color: isValid ? SAPPHIRE : 'var(--text-muted)',
                  cursor: isValid && !submitting ? 'pointer' : 'not-allowed',
                }}
              >
                {submitting ? 'CREATING…' : 'CREATE & QUEUE BRIEF →'}
              </button>

              {!isValid && (
                <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>
                  Brand, Platform, Goal, Type, Tone required
                </span>
              )}
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="font-mono text-[9px] px-3 py-2 rounded-sm"
                style={{ color: CRIMSON, background: `${CRIMSON}10`, border: `1px solid ${CRIMSON}25` }}
              >
                {error}
              </motion.div>
            )}
          </motion.div>

          {/* ── RIGHT: Preview column (2 cols) ───────────── */}
          <motion.div variants={fadeUp} className="col-span-2 space-y-3">

            <div className="font-mono text-[8px] tracking-[0.18em] uppercase" style={{ color: 'var(--text-muted)' }}>
              DISPATCH ROUTE
            </div>

            {/* Route preview */}
            <AnimatePresence>
              {(previewLoading || dispatchPreview) && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  {dispatchPreview?.error ? (
                    <div className="font-mono text-[8px] px-2 py-1.5 rounded-sm"
                      style={{ color: CRIMSON, background: `${CRIMSON}08`, border: `1px solid ${CRIMSON}20` }}>
                      {dispatchPreview.error}
                    </div>
                  ) : (
                    <DispatchPreviewChip preview={dispatchPreview} loading={previewLoading} />
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Brief preview */}
            <div className="font-mono text-[8px] tracking-[0.18em] uppercase mt-3" style={{ color: 'var(--text-muted)' }}>
              BRIEF PREVIEW
            </div>

            <div className="rounded-sm p-3 overflow-auto"
              style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.06)', minHeight: 180, maxHeight: 260 }}>
              {form.lane || form.platform ? (
                <pre className="font-mono text-[8px] leading-relaxed whitespace-pre-wrap m-0"
                  style={{ color: 'var(--text-secondary)' }}>
                  {[
                    `CONTENT BRIEF`,
                    `Platform: ${form.platform || '—'} · Brand: ${LANE_OPTIONS.find(l => l.id === form.lane)?.label || '—'}`,
                    `Goal: ${form.contentGoal || '—'}`,
                    `Type: ${form.contentType || '—'}${mappedTaskType ? ` → ${mappedTaskType}` : ''}`,
                    form.audience ? `Audience: ${form.audience}` : '',
                    form.tone ? `Tone: ${form.tone}` : '',
                    form.primaryOffer ? `Offer: ${form.primaryOffer}` : '',
                    form.instructions ? `\nInstructions:\n${form.instructions}` : '',
                  ].filter(Boolean).join('\n')}
                </pre>
              ) : (
                <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>
                  Select brand and platform to preview brief.
                </span>
              )}
            </div>

            {/* Suggested pipeline */}
            {suggestedAgents.length > 0 && (
              <div className="panel-gold rounded-sm p-3">
                <div className="font-mono text-[7px] tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
                  SUGGESTED PIPELINE
                </div>
                <div className="flex flex-wrap gap-1">
                  {suggestedAgents.map((id, i) => {
                    const avatar = AGENT_AVATARS[id] || {};
                    return (
                      <div key={id} className="flex items-center gap-0.5">
                        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-sm"
                          style={{ background: `${avatar.color || platformColor}10`, border: `1px solid ${avatar.color || platformColor}20` }}>
                          <span style={{ fontSize: 7 }}>{avatar.emoji || '🤖'}</span>
                          <span className="font-mono text-[7px]" style={{ color: avatar.color || platformColor }}>{id}</span>
                        </div>
                        {i < suggestedAgents.length - 1 && (
                          <span className="font-mono text-[7px]" style={{ color: 'rgba(255,255,255,0.12)' }}>→</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="font-mono text-[6px] mt-1.5" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>
                  Suggested only. Actual dispatch determined by Dispatch Engine.
                </p>
              </div>
            )}

            {/* Governance notice */}
            <div className="flex items-center gap-1.5 px-2.5 py-2 rounded-sm"
              style={{ background: 'rgba(201,168,76,0.04)', border: '1px solid rgba(201,168,76,0.12)' }}>
              <span style={{ color: GOLD, fontSize: 9 }}>◈</span>
              <span className="font-mono text-[7px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                Governance enforced through task routing, approval, and execution-mode controls.
              </span>
            </div>

          </motion.div>
        </div>
      </form>

      {/* Recent Briefs */}
      <motion.div variants={fadeUp}>
        <RecentBriefs refreshTrigger={refreshTrigger} onExpand={setExpandedBriefId} />
      </motion.div>

      {/* Viral Workflow Panel — expands when a brief row is clicked */}
      <AnimatePresence>
        {expandedBriefId && (
          <motion.div
            key={expandedBriefId}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="panel-gold rounded-sm p-4"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="font-mono text-[8px] tracking-widest" style={{ color: '#c9a84c' }}>
                ✦ VIRAL CONTENT WORKFLOW
              </span>
              <button
                onClick={() => setExpandedBriefId(null)}
                className="font-mono text-[8px] text-[#4b5563] hover:text-[#8892a4]"
              >
                ✕ CLOSE
              </button>
            </div>
            <ViralContentWorkflowPanel briefTaskId={expandedBriefId} compact={false} />
          </motion.div>
        )}
      </AnimatePresence>

    </motion.div>
  );
}
