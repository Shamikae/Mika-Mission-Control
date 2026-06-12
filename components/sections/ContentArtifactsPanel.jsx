// components/sections/ContentArtifactsPanel.jsx
// Phase E.4 — Content Artifact Library
//
// Displays durable content assets produced by viral content workflow stages.
// Structure: content-artifacts/<laneId>/<workflowId>/<stage>.md
//
// Layout: lane selector + workflow list (left) | artifact viewer (right)

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SectionHeader } from '../ui';
import { useStore } from '../../lib/store';
import VideoRouterPromptPack from './VideoRouterPromptPack';

const GOLD     = '#c9a84c';
const EMERALD  = '#10b981';
const TEAL     = '#0dd3c5';
const PURPLE   = '#818cf8';
const SAPPHIRE = '#3b82f6';
const AMBER    = '#f59e0b';
const VIOLET   = '#8b5cf6';
const CRIMSON  = '#ef4444';

const ARTIFACT_STAGES = [
  { stageId: 'trend_research',    filename: 'research.md',    icon: '🔥', label: 'Research',      color: '#f59e0b' },
  { stageId: 'hook_generation',   filename: 'hooks.md',       icon: '🪝', label: 'Hooks',          color: '#f472b6' },
  { stageId: 'content_strategy',  filename: 'strategy.md',    icon: '🎯', label: 'Strategy',       color: PURPLE   },
  { stageId: 'script_generation', filename: 'script.md',      icon: '📝', label: 'Script',         color: TEAL     },
  { stageId: 'visual_prompting',  filename: 'video-prompt.md',icon: '🎬', label: 'Video Prompt',   color: SAPPHIRE },
  { stageId: 'caption_generation',filename: 'caption.md',     icon: '💬', label: 'Caption',        color: EMERALD  },
  { stageId: 'repurposing',       filename: 'repurposing.md', icon: '♻',  label: 'Repurposing',    color: '#4ade80' },
];

const LANE_OPTIONS = [
  { id: 'digital-diamond', label: 'Digital Diamond AI',  color: GOLD    },
  { id: 'managed-by-mika', label: 'Managed by Mika',     color: TEAL    },
  { id: 'medai',           label: 'MedAI',               color: PURPLE  },
  { id: 'cannaops',        label: 'CannaOps',            color: '#4ade80' },
  { id: 'hotel-hooker',    label: 'The Hotel Hooker',     color: '#f472b6' },
  { id: 'ai-twin',         label: 'AI Twin Studio',       color: SAPPHIRE },
];

const stagger = { initial: {}, animate: { transition: { staggerChildren: 0.05 } } };
const fadeUp  = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0, transition: { duration: 0.25 } } };

// ── Copy / download utils ─────────────────────────────────────────────────────

function copyToClipboard(text) {
  try { navigator.clipboard.writeText(text); } catch { /* silently ignore */ }
}

function downloadMarkdown(content, filename) {
  const blob = new Blob([content], { type: 'text/markdown' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Stage tab pill ────────────────────────────────────────────────────────────

function StagePill({ stage, hasArtifact, isActive, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm transition-all text-left"
      style={{
        background:  isActive ? `${stage.color}18` : 'rgba(255,255,255,0.02)',
        border:      `1px solid ${isActive ? `${stage.color}40` : 'rgba(255,255,255,0.06)'}`,
        color:       isActive ? stage.color : (hasArtifact ? '#8892a4' : '#4b5563'),
        opacity:     hasArtifact ? 1 : 0.5,
      }}
    >
      <span style={{ fontSize: 12 }}>{stage.icon}</span>
      <span className="font-mono text-[8px] font-semibold tracking-wider">{stage.label.toUpperCase()}</span>
      {hasArtifact && (
        <div className="w-1 h-1 rounded-full" style={{ background: EMERALD }} />
      )}
    </button>
  );
}

// ── Artifact viewer ───────────────────────────────────────────────────────────

function ArtifactViewer({ laneId, workflowId, stageId, onSendToQueue, onGenerateVideoPack }) {
  const [content, setContent]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const [copied, setCopied]     = useState(false);

  useEffect(() => {
    if (!laneId || !workflowId || !stageId) { setLoading(false); return; }
    setLoading(true);
    setContent(null);
    fetch(`/api/content-artifacts/get?laneId=${encodeURIComponent(laneId)}&workflowId=${encodeURIComponent(workflowId)}&artifact=${encodeURIComponent(stageId)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { setContent(d?.content || null); setLoading(false); })
      .catch(() => setLoading(false));
  }, [laneId, workflowId, stageId]);

  const stage = ARTIFACT_STAGES.find(s => s.stageId === stageId);

  function handleCopy() {
    if (!content) return;
    copyToClipboard(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleDownload() {
    if (!content || !stage) return;
    downloadMarkdown(content, stage.filename);
  }

  if (loading) return (
    <div className="flex items-center gap-2 p-4">
      <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 0.9 }}
        className="w-1.5 h-1.5 rounded-full" style={{ background: GOLD }} />
      <span className="font-mono text-[9px] text-[#4b5563]">Loading artifact…</span>
    </div>
  );

  if (!content) return (
    <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
      <span style={{ fontSize: 24, opacity: 0.4 }}>{stage?.icon || '—'}</span>
      <div>
        <p className="font-mono text-[9px] text-[#4b5563]">
          {stage?.label} artifact not yet generated.
        </p>
        <p className="font-mono text-[8px] text-[#4b5563] mt-1">
          Execute the {stage?.label} stage via Task Dispatch to create this artifact.
        </p>
      </div>
    </div>
  );

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <span style={{ fontSize: 14 }}>{stage?.icon}</span>
        <span className="font-mono text-[9px] font-semibold" style={{ color: stage?.color || GOLD }}>
          {stage?.label?.toUpperCase()}
        </span>
        <span className="font-mono text-[7px] text-[#4b5563]">{stage?.filename}</span>
        <span className="font-mono text-[7px] text-[#4b5563]">· {content.length} chars</span>
        <div className="flex items-center gap-1.5 ml-auto">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-1 rounded-sm font-mono text-[8px] tracking-wider transition-all"
            style={{
              background: copied ? `${EMERALD}15` : 'rgba(255,255,255,0.04)',
              border: `1px solid ${copied ? `${EMERALD}30` : 'rgba(255,255,255,0.08)'}`,
              color: copied ? EMERALD : '#8892a4',
              cursor: 'pointer',
            }}
          >
            {copied ? '✓ COPIED' : '⎋ COPY'}
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1 px-2 py-1 rounded-sm font-mono text-[8px] tracking-wider transition-all"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#8892a4', cursor: 'pointer' }}
          >
            ↓ .MD
          </button>
          {stageId === 'visual_prompting' && onGenerateVideoPack && (
            <button
              onClick={onGenerateVideoPack}
              className="flex items-center gap-1 px-2 py-1 rounded-sm font-mono text-[8px] tracking-wider transition-all"
              style={{ background: `${SAPPHIRE}12`, border: `1px solid ${SAPPHIRE}35`, color: SAPPHIRE, cursor: 'pointer' }}
              title="Generate provider-specific video prompts from this artifact"
            >
              🎬 VIDEO PACK
            </button>
          )}
          {onSendToQueue && (
            <button
              onClick={() => onSendToQueue({ stageId, content, stage })}
              className="flex items-center gap-1 px-2 py-1 rounded-sm font-mono text-[8px] tracking-wider transition-all"
              style={{ background: `${GOLD}10`, border: `1px solid ${GOLD}28`, color: GOLD, cursor: 'pointer' }}
            >
              + QUEUE
            </button>
          )}
        </div>
      </div>
      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        <pre
          className="font-mono text-[9px] leading-relaxed whitespace-pre-wrap"
          style={{ color: '#8892a4', margin: 0 }}
        >
          {content}
        </pre>
      </div>
    </motion.div>
  );
}

// ── Create Video Job modal ────────────────────────────────────────────────────

const VIDEO_PROVIDERS = [
  { id: 'higgsfield',   label: 'Higgsfield',   emoji: '🎥', desc: 'Luxury cinematic'           },
  { id: 'heygen',       label: 'HeyGen',       emoji: '🧑‍💻', desc: 'AI avatar / talking head'  },
  { id: 'hyperframes',  label: 'HyperFrames',  emoji: '📽', desc: 'Cinematic product / B-roll'  },
  { id: 'openart',      label: 'OpenArt',      emoji: '🎨', desc: 'Design asset / still-motion' },
  { id: 'wan',          label: 'Wan',          emoji: '🔓', desc: 'Open source (free)'          },
  { id: 'comfyui',      label: 'ComfyUI',      emoji: '⚙',  desc: 'Advanced local workflow'    },
  { id: 'kling',        label: 'Kling',        emoji: '⚡', desc: 'Fast social content'         },
  { id: 'veo',          label: 'Veo',          emoji: '🌊', desc: 'Narrative storytelling'      },
];

const CONTENT_FORMATS = [
  { id: 'short-form',      label: 'Short-form Video (9:16)' },
  { id: 'avatar',          label: 'Avatar / Talking Head'   },
  { id: 'cinematic',       label: 'Cinematic / Luxury'      },
  { id: 'cinematic-product', label: 'Cinematic Product'     },
  { id: 'b-roll',          label: 'B-Roll / Background'     },
  { id: 'ugc-ad',          label: 'UGC Ad Style'            },
  { id: 'ai-twin',         label: 'AI Twin'                 },
];

const BUDGET_MODES = [
  { id: 'low-cost',  label: 'Low Cost — Free / open-source first' },
  { id: 'balanced',  label: 'Balanced — Best price/quality'       },
  { id: 'premium',   label: 'Premium — Highest quality'           },
];

function CreateVideoJobModal({ laneId, workflow, promptPackPath, onClose, onCreated }) {
  const [provider,       setProvider]       = useState('higgsfield');
  const [contentFormat,  setContentFormat]  = useState('short-form');
  const [budgetMode,     setBudgetMode]      = useState('balanced');
  const [notes,          setNotes]          = useState('');
  const [submitting,     setSubmitting]      = useState(false);
  const [error,          setError]          = useState(null);

  const modalInputStyle = {
    width: '100%',
    background: 'rgba(0,0,0,0.4)',
    border: `1px solid rgba(201,168,76,0.18)`,
    borderRadius: 3,
    color: '#f0ede6',
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 11,
    padding: '7px 10px',
    outline: 'none',
    appearance: 'none',
    WebkitAppearance: 'none',
  };

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const pm = VIDEO_PROVIDERS.find(p => p.id === provider);
      const r  = await fetch('/api/video-jobs/create', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          workflowId:          workflow?.workflowId,
          laneId,
          sourceArtifact:      'visual_prompting',
          promptPackPath:      promptPackPath || null,
          provider,
          providerDisplayName: pm?.label || provider,
          contentFormat,
          budgetMode,
          title:               `${pm?.label || provider} — ${contentFormat} · ${workflow?.contentGoal?.slice(0,30) || laneId}`,
          notes,
        }),
      });
      const d = await r.json();
      if (r.ok) {
        onCreated?.(d.job);
        onClose();
      } else {
        setError(d.error || 'Failed to create job');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose} />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.18 }}
        className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none px-4"
      >
        <div className="pointer-events-auto rounded-sm w-full max-w-md"
          style={{ background: 'var(--bg-sidebar)', border: `1px solid ${GOLD}30`, boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b"
            style={{ borderColor: `${GOLD}18` }}>
            <div>
              <div className="font-mono text-[9px] tracking-widest" style={{ color: GOLD }}>CREATE VIDEO JOB</div>
              <div className="font-mono text-[8px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                No API call — job queued for manual approval
              </div>
            </div>
            <button onClick={onClose} className="font-mono text-lg" style={{ color: 'var(--text-muted)' }}>×</button>
          </div>

          <form onSubmit={handleSubmit} className="p-5 space-y-3">
            {/* Workflow context */}
            {workflow && (
              <div className="px-3 py-2 rounded-sm"
                style={{ background: `${TEAL}08`, border: `1px solid ${TEAL}18` }}>
                <span className="font-mono text-[7px]" style={{ color: TEAL }}>
                  Workflow: {workflow.contentGoal || workflow.workflowId?.slice(0, 30)}
                  {workflow.platform ? ` · ${workflow.platform}` : ''}
                </span>
              </div>
            )}

            {/* Provider */}
            <div>
              <label className="font-mono text-[8px] tracking-widest block mb-1.5" style={{ color: 'var(--text-muted)' }}>
                VIDEO PROVIDER
              </label>
              <select value={provider} onChange={e => setProvider(e.target.value)} style={modalInputStyle}>
                {VIDEO_PROVIDERS.map(p => (
                  <option key={p.id} value={p.id}>{p.emoji} {p.label} — {p.desc}</option>
                ))}
              </select>
            </div>

            {/* Content format */}
            <div>
              <label className="font-mono text-[8px] tracking-widest block mb-1.5" style={{ color: 'var(--text-muted)' }}>
                CONTENT FORMAT
              </label>
              <select value={contentFormat} onChange={e => setContentFormat(e.target.value)} style={modalInputStyle}>
                {CONTENT_FORMATS.map(f => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
            </div>

            {/* Budget mode */}
            <div>
              <label className="font-mono text-[8px] tracking-widest block mb-1.5" style={{ color: 'var(--text-muted)' }}>
                BUDGET MODE
              </label>
              <select value={budgetMode} onChange={e => setBudgetMode(e.target.value)} style={modalInputStyle}>
                {BUDGET_MODES.map(b => (
                  <option key={b.id} value={b.id}>{b.label}</option>
                ))}
              </select>
            </div>

            {/* Notes */}
            <div>
              <label className="font-mono text-[8px] tracking-widest block mb-1.5" style={{ color: 'var(--text-muted)' }}>
                NOTES <span style={{ color: '#4b5563' }}>(optional)</span>
              </label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                placeholder="Any production notes or special instructions…"
                style={{ ...modalInputStyle, resize: 'vertical' }}
              />
            </div>

            {error && (
              <div className="font-mono text-[8px] px-3 py-2 rounded-sm"
                style={{ background: `${CRIMSON}10`, border: `1px solid ${CRIMSON}25`, color: CRIMSON }}>
                {error}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button type="button" onClick={onClose}
                className="flex-1 font-mono text-[9px] tracking-widest py-2 rounded-sm transition-all"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-muted)' }}>
                CANCEL
              </button>
              <button type="submit" disabled={submitting}
                className="flex-1 font-mono text-[9px] tracking-widest py-2 rounded-sm transition-all"
                style={{
                  background: submitting ? 'rgba(255,255,255,0.04)' : `${GOLD}18`,
                  border:     `1px solid ${submitting ? 'rgba(255,255,255,0.08)' : `${GOLD}40`}`,
                  color:      submitting ? 'var(--text-muted)' : GOLD,
                  cursor:     submitting ? 'not-allowed' : 'pointer',
                }}>
                {submitting ? 'CREATING…' : '▷ CREATE JOB'}
              </button>
            </div>
          </form>
        </div>
      </motion.div>
    </>
  );
}

// ── Workflow card (left panel) ─────────────────────────────────────────────────

function WorkflowCard({ workflow, isActive, onClick }) {
  const laneColor = LANE_OPTIONS.find(l => l.id === workflow.metadata?.laneId)?.color || GOLD;
  const completed = workflow.stagesCompleted?.length || 0;
  const total     = 7;

  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2.5 rounded-sm transition-all"
      style={{
        background: isActive ? `${laneColor}12` : 'rgba(255,255,255,0.02)',
        border: `1px solid ${isActive ? `${laneColor}35` : 'rgba(255,255,255,0.05)'}`,
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            {workflow.platform && (
              <span className="font-mono text-[7px] px-1 py-0.5 rounded-sm"
                style={{ color: laneColor, background: `${laneColor}12` }}>
                {workflow.platform}
              </span>
            )}
            <span className="font-mono text-[7px] text-[#4b5563]">
              {completed}/{total} stages
            </span>
          </div>
          <div className="font-mono text-[8px] truncate" style={{ color: '#8892a4' }}>
            {workflow.contentGoal || workflow.contentType || 'Content workflow'}
          </div>
        </div>
        <span className="font-mono text-[7px] flex-shrink-0" style={{ color: EMERALD }}>
          {workflow.artifactCount} artifacts
        </span>
      </div>
      {/* Progress bar */}
      <div className="h-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }}>
        <div className="h-full rounded-full transition-all"
          style={{ width: `${(completed / total) * 100}%`, background: laneColor }} />
      </div>
      <div className="font-mono text-[6px] text-[#4b5563] mt-1 truncate">
        {workflow.workflowId?.slice(0, 28)}
      </div>
    </button>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function ContentArtifactsPanel() {
  const { setActiveSection } = useStore();

  const [selectedLane, setSelectedLane]         = useState('ai-twin');
  const [workflows, setWorkflows]               = useState([]);
  const [loadingWorkflows, setLoadingWorkflows] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState(null);
  const [selectedStage, setSelectedStage]       = useState(null);
  const [workflowArtifacts, setWorkflowArtifacts] = useState(null);
  const [queueFlash, setQueueFlash]             = useState(null);
  const [showPromptPack, setShowPromptPack]     = useState(false);
  const [hasVideoPack, setHasVideoPack]         = useState(false);
  const [showCreateJobModal, setShowCreateJobModal] = useState(false);
  const [jobCreatedFlash, setJobCreatedFlash]   = useState(null);

  const loadWorkflows = useCallback((resetSelection = false) => {
    if (!selectedLane) return;
    setLoadingWorkflows(true);
    if (resetSelection) {
      setSelectedWorkflow(null);
      setSelectedStage(null);
      setWorkflowArtifacts(null);
    }
    fetch(`/api/content-artifacts/list?laneId=${encodeURIComponent(selectedLane)}`)
      .then(r => r.ok ? r.json() : { workflows: [] })
      .then(d => { setWorkflows(d.workflows || []); setLoadingWorkflows(false); })
      .catch(() => setLoadingWorkflows(false));
  }, [selectedLane]);

  useEffect(() => { loadWorkflows(true); }, [selectedLane]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset prompt pack panel when workflow changes
  useEffect(() => { setShowPromptPack(false); setHasVideoPack(false); }, [selectedWorkflow]);

  // Check if a video-prompt-pack exists for the selected workflow
  useEffect(() => {
    if (!selectedWorkflow || !selectedLane) return;
    fetch(`/api/video-router/get-pack?laneId=${encodeURIComponent(selectedLane)}&workflowId=${encodeURIComponent(selectedWorkflow.workflowId)}`)
      .then(r => r.json())
      .then(d => setHasVideoPack(d.exists === true))
      .catch(() => setHasVideoPack(false));
  }, [selectedWorkflow, selectedLane]);

  // When a workflow is selected, fetch its artifact summary
  useEffect(() => {
    if (!selectedWorkflow || !selectedLane) return;
    fetch(`/api/content-artifacts/get?laneId=${encodeURIComponent(selectedLane)}&workflowId=${encodeURIComponent(selectedWorkflow.workflowId)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        setWorkflowArtifacts(d);
        // Auto-select first available artifact
        if (d?.artifactStages) {
          const first = d.artifactStages.find(s => s.exists);
          if (first) setSelectedStage(first.stageId);
        }
      })
      .catch(() => {});
  }, [selectedWorkflow, selectedLane]);

  async function handleSendToQueue({ stageId, content, stage }) {
    try {
      const res = await fetch('/api/tasks/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lane:            selectedLane,
          taskType:        'Content',
          priority:        'Normal',
          approvalRequired: true,
          description:     `ARTIFACT EDIT — ${stage?.label} from ${selectedWorkflow?.workflowId?.slice(0, 20)}\n\n${content.slice(0, 400)}`,
        }),
      });
      if (res.ok) {
        setQueueFlash({ type: 'success', msg: `${stage?.label} artifact sent to queue` });
        setTimeout(() => setQueueFlash(null), 2500);
      }
    } catch {
      setQueueFlash({ type: 'error', msg: 'Queue failed' });
      setTimeout(() => setQueueFlash(null), 2500);
    }
  }

  const laneColor = LANE_OPTIONS.find(l => l.id === selectedLane)?.color || GOLD;
  const completedStages = new Set(selectedWorkflow?.stagesCompleted || []);

  const inputStyle = {
    width: '100%',
    background: 'rgba(0,0,0,0.3)',
    border: '1px solid rgba(201,168,76,0.15)',
    borderRadius: 4,
    color: '#f0ede6',
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 11,
    padding: '6px 10px',
    outline: 'none',
    appearance: 'none',
    WebkitAppearance: 'none',
    cursor: 'pointer',
  };

  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-4">
      <SectionHeader
        icon="◈"
        title="Content Asset Library"
        subtitle="Durable content artifacts produced by viral content workflow stage executions"
      />

      {/* Governance + queue flash */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-2 rounded-sm flex-1"
          style={{ background: 'rgba(201,168,76,0.04)', border: '1px solid rgba(201,168,76,0.12)' }}>
          <span style={{ color: GOLD, fontSize: 9 }}>◈</span>
          <span className="font-mono text-[8px] text-[#6b7280]">
            Artifacts are generated by executing viral workflow stages via the Dispatch Engine.
          </span>
        </div>
        {queueFlash && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
            className="font-mono text-[8px] px-3 py-2 rounded-sm flex-shrink-0"
            style={{
              background: queueFlash.type === 'success' ? `${EMERALD}10` : '#ef444410',
              border: `1px solid ${queueFlash.type === 'success' ? `${EMERALD}25` : '#ef444425'}`,
              color: queueFlash.type === 'success' ? EMERALD : '#ef4444',
            }}>
            {queueFlash.msg}
          </motion.div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4" style={{ minHeight: 560 }}>

        {/* ── LEFT: Lane + Workflow selector ───────────────── */}
        <motion.div variants={fadeUp} className="col-span-1 space-y-3">

          {/* Lane selector */}
          <div>
            <div className="font-mono text-[7px] tracking-[0.18em] uppercase mb-1.5" style={{ color: 'var(--text-muted)' }}>
              BRAND / LANE
            </div>
            <select
              value={selectedLane}
              onChange={e => setSelectedLane(e.target.value)}
              style={{ ...inputStyle, borderColor: `${laneColor}30`, color: laneColor }}
            >
              {LANE_OPTIONS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </div>

          {/* Workflow list */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="font-mono text-[7px] tracking-[0.18em] uppercase" style={{ color: 'var(--text-muted)' }}>
                WORKFLOWS
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[7px] text-[#4b5563]">{workflows.length}</span>
                <button onClick={() => loadWorkflows(false)}
                  className="font-mono text-[7px] px-1.5 py-0.5 rounded-sm transition-all"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#6b7280', cursor: 'pointer' }}>
                  ↺
                </button>
              </div>
            </div>

            {loadingWorkflows ? (
              <div className="flex items-center gap-2 py-3">
                <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 0.9 }}
                  className="w-1.5 h-1.5 rounded-full" style={{ background: GOLD }} />
                <span className="font-mono text-[8px] text-[#4b5563]">Loading…</span>
              </div>
            ) : workflows.length === 0 ? (
              <div className="panel-gold rounded-sm p-4 text-center space-y-2">
                <p className="font-mono text-[8px] text-[#4b5563]">
                  No content artifacts yet for {LANE_OPTIONS.find(l => l.id === selectedLane)?.label}.
                </p>
                <p className="font-mono text-[7px] text-[#4b5563] opacity-70">
                  Create a brief → Start Viral Workflow → Execute stages via Dispatch Engine.
                </p>
                <button onClick={() => setActiveSection('content-division')}
                  className="font-mono text-[8px] px-2.5 py-1 rounded-sm transition-all"
                  style={{ background: `${GOLD}10`, border: `1px solid ${GOLD}25`, color: GOLD, cursor: 'pointer' }}>
                  → Content Division
                </button>
              </div>
            ) : (
              <div className="space-y-1.5 overflow-y-auto" style={{ maxHeight: 440 }}>
                {workflows.map(wf => (
                  <WorkflowCard
                    key={wf.workflowId}
                    workflow={wf}
                    isActive={selectedWorkflow?.workflowId === wf.workflowId}
                    onClick={() => setSelectedWorkflow(wf)}
                  />
                ))}
              </div>
            )}
          </div>
        </motion.div>

        {/* ── RIGHT: Artifact viewer ──────────────────────── */}
        <motion.div variants={fadeUp} className="col-span-2">
          {!selectedWorkflow ? (
            <div className="panel-gold rounded-sm h-full flex flex-col items-center justify-center gap-3 p-8 text-center">
              <span style={{ fontSize: 32, opacity: 0.3 }}>◈</span>
              <p className="font-mono text-[9px] text-[#4b5563]">Select a workflow to view its content artifacts.</p>
              {workflows.length === 0 && (
                <p className="font-mono text-[8px] text-[#4b5563] opacity-70">
                  Artifacts are created automatically when viral workflow stages are executed via the Dispatch Engine.
                </p>
              )}
            </div>
          ) : (
            <div className="panel-gold rounded-sm overflow-hidden" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              {/* Workflow header */}
              <div className="px-4 py-3 flex-shrink-0"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.02)' }}>
                <div className="flex items-center gap-2 flex-wrap">
                  {selectedWorkflow.platform && (
                    <span className="font-mono text-[7px] px-1.5 py-0.5 rounded-sm"
                      style={{ color: laneColor, background: `${laneColor}12` }}>
                      {selectedWorkflow.platform}
                    </span>
                  )}
                  <span className="font-mono text-[8px] text-[#8892a4]">
                    {selectedWorkflow.contentGoal || 'Viral Content'}
                  </span>
                  <span className="font-mono text-[7px] text-[#4b5563]">
                    {selectedWorkflow.artifactCount}/7 artifacts
                  </span>
                  <span className="font-mono text-[7px] text-[#4b5563]">
                    {selectedWorkflow.workflowId?.slice(0, 24)}
                  </span>
                  {/* Create Video Job button — only shown when a video-prompt-pack exists */}
                  {hasVideoPack && (
                    <button
                      onClick={() => setShowCreateJobModal(true)}
                      className="font-mono text-[7px] tracking-wider px-2 py-1 rounded-sm transition-all ml-auto flex items-center gap-1"
                      style={{ background: `${SAPPHIRE}12`, border: `1px solid ${SAPPHIRE}35`, color: SAPPHIRE, cursor: 'pointer' }}
                      title="Create a staged video production job from this workflow's prompt pack"
                    >
                      ▷ CREATE VIDEO JOB
                    </button>
                  )}
                </div>
                {/* Job created flash */}
                {jobCreatedFlash && (
                  <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                    className="font-mono text-[7px] mt-1.5 px-2 py-1 rounded-sm"
                    style={{ background: `${EMERALD}10`, border: `1px solid ${EMERALD}22`, color: EMERALD }}>
                    {jobCreatedFlash}
                  </motion.div>
                )}
              </div>

              {/* Stage tabs */}
              <div className="px-3 py-2 flex items-center gap-1.5 flex-wrap flex-shrink-0"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                {ARTIFACT_STAGES.map(stage => {
                  const hasArtifact = completedStages.has(stage.stageId) ||
                    (workflowArtifacts?.artifacts?.[stage.stageId] !== null &&
                     workflowArtifacts?.artifacts?.[stage.stageId] !== undefined);
                  return (
                    <StagePill
                      key={stage.stageId}
                      stage={stage}
                      hasArtifact={hasArtifact}
                      isActive={selectedStage === stage.stageId}
                      onClick={() => setSelectedStage(stage.stageId)}
                    />
                  );
                })}
              </div>

              {/* Artifact content */}
              <div className="flex-1 overflow-hidden">
                <AnimatePresence mode="wait">
                  {selectedStage ? (
                    <motion.div
                      key={selectedStage}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="h-full"
                    >
                      <ArtifactViewer
                        laneId={selectedLane}
                        workflowId={selectedWorkflow.workflowId}
                        stageId={selectedStage}
                        onSendToQueue={handleSendToQueue}
                        onGenerateVideoPack={() => setShowPromptPack(v => !v)}
                      />
                    </motion.div>
                  ) : (
                    <div className="flex items-center justify-center h-32">
                      <p className="font-mono text-[9px] text-[#4b5563]">Select a stage above to view its artifact.</p>
                    </div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          )}
        </motion.div>
      </div>

      {/* Create Video Job modal */}
      <AnimatePresence>
        {showCreateJobModal && selectedWorkflow && (
          <CreateVideoJobModal
            laneId={selectedLane}
            workflow={selectedWorkflow}
            promptPackPath={`content-artifacts/${selectedLane}/${selectedWorkflow.workflowId}/video-prompt-pack.json`}
            onClose={() => setShowCreateJobModal(false)}
            onCreated={job => {
              setJobCreatedFlash(`Video job created → ${job.providerDisplayName || job.provider} · ${job.contentFormat}`);
              setTimeout(() => setJobCreatedFlash(null), 4000);
            }}
          />
        )}
      </AnimatePresence>

      {/* Video Router Prompt Pack — rendered below when triggered from 🎬 VIDEO PACK button */}
      <AnimatePresence>
        {showPromptPack && selectedWorkflow && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.2 }}
            className="panel-gold rounded-sm p-5"
          >
            <VideoRouterPromptPack
              laneId={selectedLane}
              workflowId={selectedWorkflow.workflowId}
              onClose={() => setShowPromptPack(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
