// components/sections/VideoFactory.jsx
// Phase E.6 — Content Video Factory
//
// Staged video production job management.
// All jobs require human approval — no API calls to video providers here.
// Provider connections are made later through Activation Gate + adapter layer.

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const GOLD     = '#c9a84c';
const TEAL     = '#0dd3c5';
const EMERALD  = '#10b981';
const SAPPHIRE = '#3b82f6';
const CRIMSON  = '#ef4444';
const AMBER    = '#f59e0b';
const VIOLET   = '#8b5cf6';

const STATUS_COLOR = {
  pending:   AMBER,
  approved:  SAPPHIRE,
  rendering: TEAL,
  complete:  EMERALD,
  failed:    CRIMSON,
  archived:  '#4b5563',
};
const STATUS_LABEL = {
  pending:   'PENDING',
  approved:  'APPROVED',
  rendering: 'RENDERING',
  complete:  'COMPLETE',
  failed:    'FAILED',
  archived:  'ARCHIVED',
};

const PROVIDER_META = {
  higgsfield:  { label: 'Higgsfield',  emoji: '🎥', color: GOLD,     desc: 'Luxury cinematic' },
  heygen:      { label: 'HeyGen',      emoji: '🧑‍💻', color: SAPPHIRE, desc: 'AI avatar' },
  hyperframes: { label: 'HyperFrames', emoji: '📽', color: TEAL,     desc: 'Cinematic product / B-roll' },
  openart:     { label: 'OpenArt',     emoji: '🎨', color: VIOLET,   desc: 'Design asset / still-to-motion' },
  wan:         { label: 'Wan',         emoji: '🔓', color: EMERALD,  desc: 'Open source' },
  comfyui:     { label: 'ComfyUI',     emoji: '⚙',  color: AMBER,    desc: 'Advanced local workflow' },
  kling:       { label: 'Kling',       emoji: '⚡', color: '#fb923c', desc: 'Fast social content' },
  veo:         { label: 'Veo',         emoji: '🌊', color: '#a78bfa', desc: 'Narrative storytelling' },
};

const LANE_LABELS = {
  'digital-diamond': 'Digital Diamond AI',
  'managed-by-mika': 'Managed by Mika',
  'medai':           'MedAI',
  'cannaops':        'CannaOps',
  'hotel-hooker':    'The Hotel Hooker',
  'ai-twin':         'AI Twin Studio',
};

const stagger = { initial: {}, animate: { transition: { staggerChildren: 0.04 } } };
const fadeUp  = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0, transition: { duration: 0.22 } } };

function safeTs(ts) {
  if (!ts) return '—';
  try {
    const diff = Math.floor((Date.now() - new Date(ts)) / 60000);
    if (diff < 1)  return 'just now';
    if (diff < 60) return `${diff}m ago`;
    const h = Math.floor(diff / 60);
    if (h < 24)    return `${h}h ago`;
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return '—'; }
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ msg, ok, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 3000); return () => clearTimeout(t); }, [onDone]);
  const col = ok ? EMERALD : CRIMSON;
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-sm font-mono text-[10px] shadow-xl"
      style={{ background: `${col}18`, border: `1px solid ${col}40`, color: col, maxWidth: 320 }}>
      {msg}
    </motion.div>
  );
}

// ── Summary card ──────────────────────────────────────────────────────────────

function SummaryCard({ label, value, color }) {
  return (
    <div className="rounded-sm p-3 text-center"
      style={{ background: `${color}08`, border: `1px solid ${color}20` }}>
      <div className="font-mono text-xl font-bold leading-none mb-1" style={{ color }}>{value}</div>
      <div className="font-mono text-[7px] tracking-widest uppercase" style={{ color: `${color}80` }}>{label}</div>
    </div>
  );
}

// ── Job card ──────────────────────────────────────────────────────────────────

function JobCard({ job, onAction, actioning }) {
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const pm      = PROVIDER_META[job.provider] || { label: job.providerDisplayName || job.provider, emoji: '▷', color: GOLD };
  const scol    = STATUS_COLOR[job.status] || GOLD;
  const isBusy  = actioning === job.jobId;

  async function copyPrompt() {
    if (!job.promptPackPath) return;
    try {
      // Parse the prompt pack path to extract laneId + workflowId
      // Path format: content-artifacts/<laneId>/<workflowId>/video-prompt-pack.json
      const parts = job.promptPackPath.replace(/^content-artifacts\//, '').split('/');
      const [laneId, workflowId] = parts;
      const r = await fetch(`/api/video-router/get-pack?laneId=${encodeURIComponent(laneId)}&workflowId=${encodeURIComponent(workflowId)}`);
      if (!r.ok) return;
      const d = await r.json();
      const pack = d.pack;
      if (!pack) return;
      const providerSection = pack.providers?.[job.provider];
      const text = providerSection
        ? JSON.stringify(providerSection, null, 2)
        : JSON.stringify(pack, null, 2);
      navigator.clipboard?.writeText(text);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 1800);
    } catch { /* silently ignore */ }
  }

  const actions = {
    pending:   [{ key: 'approved', label: 'APPROVE',         color: SAPPHIRE }, { key: 'archived', label: 'ARCHIVE', color: '#4b5563' }],
    approved:  [{ key: 'rendering', label: 'MARK RENDERING', color: TEAL },     { key: 'failed',   label: 'FAIL',    color: CRIMSON },  { key: 'archived', label: 'ARCHIVE', color: '#4b5563' }],
    rendering: [{ key: 'complete',  label: 'MARK COMPLETE',  color: EMERALD },  { key: 'failed',   label: 'FAIL',    color: CRIMSON }],
    complete:  [{ key: 'archived',  label: 'ARCHIVE',        color: '#4b5563' }],
    failed:    [{ key: 'pending',   label: 'RETRY',          color: AMBER },    { key: 'archived', label: 'ARCHIVE', color: '#4b5563' }],
    archived:  [],
  };

  const cardActions = actions[job.status] || [];

  return (
    <motion.div variants={fadeUp}
      className="rounded-sm p-3.5 flex flex-col gap-2.5"
      style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${scol}22` }}>

      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span style={{ fontSize: 14 }}>{pm.emoji}</span>
          <div className="min-w-0">
            <div className="font-ui text-[11px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {job.title}
            </div>
            <div className="font-mono text-[8px]" style={{ color: pm.color }}>
              {pm.label} · {pm.desc}
            </div>
          </div>
        </div>
        <span className="font-mono text-[7px] px-1.5 py-0.5 rounded flex-shrink-0"
          style={{ background: `${scol}12`, color: scol, border: `1px solid ${scol}30` }}>
          {STATUS_LABEL[job.status] || job.status}
        </span>
      </div>

      {/* Meta grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        {job.laneId && (
          <>
            <span className="font-mono text-[7px]" style={{ color: 'var(--text-muted)' }}>Lane</span>
            <span className="font-mono text-[7px]" style={{ color: 'var(--text-secondary)' }}>{LANE_LABELS[job.laneId] || job.laneId}</span>
          </>
        )}
        {job.contentFormat && (
          <>
            <span className="font-mono text-[7px]" style={{ color: 'var(--text-muted)' }}>Format</span>
            <span className="font-mono text-[7px]" style={{ color: 'var(--text-secondary)' }}>{job.contentFormat}</span>
          </>
        )}
        {job.budgetMode && (
          <>
            <span className="font-mono text-[7px]" style={{ color: 'var(--text-muted)' }}>Budget</span>
            <span className="font-mono text-[7px]" style={{ color: 'var(--text-secondary)' }}>{job.budgetMode}</span>
          </>
        )}
        {job.workflowId && (
          <>
            <span className="font-mono text-[7px]" style={{ color: 'var(--text-muted)' }}>Workflow</span>
            <span className="font-mono text-[7px] truncate" style={{ color: 'var(--text-muted)' }}>{job.workflowId.slice(0, 24)}</span>
          </>
        )}
        <span className="font-mono text-[7px]" style={{ color: 'var(--text-muted)' }}>Created</span>
        <span className="font-mono text-[7px]" style={{ color: 'var(--text-muted)' }}>{safeTs(job.createdAt)}</span>
      </div>

      {/* Notes */}
      {job.notes && (
        <p className="font-mono text-[8px] px-2 py-1.5 rounded-sm"
          style={{ background: 'rgba(255,255,255,0.03)', color: 'var(--text-muted)', border: '1px solid rgba(255,255,255,0.06)' }}>
          {job.notes}
        </p>
      )}

      {/* Output URL */}
      {job.outputUrl && (
        <div className="font-mono text-[7px] px-2 py-1 rounded-sm"
          style={{ background: `${EMERALD}08`, color: EMERALD, border: `1px solid ${EMERALD}20` }}>
          ▷ {job.outputUrl}
        </div>
      )}

      {/* Actions */}
      {(cardActions.length > 0 || job.promptPackPath) && (
        <div className="flex items-center gap-1.5 flex-wrap pt-1" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          {cardActions.map(({ key, label, color }) => (
            <button key={key}
              onClick={() => onAction(job.jobId, key)}
              disabled={isBusy}
              className="font-mono text-[7px] tracking-wider px-2 py-1 rounded-sm transition-all"
              style={{
                background: `${color}10`,
                border:     `1px solid ${color}28`,
                color,
                opacity:    isBusy ? 0.5 : 1,
                cursor:     isBusy ? 'not-allowed' : 'pointer',
              }}>
              {label}
            </button>
          ))}
          {job.promptPackPath && (
            <button onClick={copyPrompt}
              className="font-mono text-[7px] tracking-wider px-2 py-1 rounded-sm transition-all ml-auto"
              style={{
                background: copiedPrompt ? `${EMERALD}12` : `${GOLD}08`,
                border:     `1px solid ${copiedPrompt ? EMERALD : GOLD}25`,
                color:      copiedPrompt ? EMERALD : GOLD,
                cursor: 'pointer',
              }}>
              {copiedPrompt ? '✓ COPIED' : '⎋ COPY PROMPT'}
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}

// ── Filter pills ──────────────────────────────────────────────────────────────

function FilterPill({ label, active, color = GOLD, onClick }) {
  return (
    <button onClick={onClick}
      className="font-mono text-[8px] tracking-wider px-2.5 py-1 rounded-sm transition-all"
      style={{
        background: active ? `${color}15` : 'transparent',
        border:     `1px solid ${active ? color : 'rgba(255,255,255,0.07)'}`,
        color:      active ? color : 'var(--text-muted)',
      }}>
      {label}
    </button>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <motion.div variants={fadeUp}
      className="panel-gold rounded-sm p-10 text-center flex flex-col items-center gap-3"
      style={{ borderColor: `${GOLD}18` }}>
      <span style={{ fontSize: 32, opacity: 0.3 }}>▷</span>
      <div>
        <p className="font-mono text-[10px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
          No video jobs yet
        </p>
        <p className="font-mono text-[8px] mt-1" style={{ color: 'var(--text-muted)' }}>
          Go to Asset Library → select a workflow with a Video Prompt Pack → click "Create Video Job"
        </p>
      </div>
      <div className="flex flex-col gap-1 text-left mt-2 max-w-xs w-full">
        {[
          '1. Create a content brief',
          '2. Run viral workflow → execute stages',
          '3. Generate Video Prompt Pack from visual_prompting artifact',
          '4. Click "Create Video Job" to queue for production',
        ].map((s, i) => (
          <span key={i} className="font-mono text-[7px]" style={{ color: 'var(--text-muted)' }}>{s}</span>
        ))}
      </div>
    </motion.div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const PROVIDERS_FILTER = [
  { key: 'all',        label: 'All Providers', color: GOLD },
  { key: 'higgsfield', label: 'Higgsfield',    color: GOLD },
  { key: 'heygen',     label: 'HeyGen',        color: SAPPHIRE },
  { key: 'hyperframes',label: 'HyperFrames',   color: TEAL },
  { key: 'openart',    label: 'OpenArt',       color: VIOLET },
  { key: 'wan',        label: 'Wan',           color: EMERALD },
  { key: 'comfyui',    label: 'ComfyUI',       color: AMBER },
];

const STATUS_FILTERS = [
  { key: 'all',       label: 'All', color: GOLD },
  { key: 'pending',   label: 'Pending',   color: AMBER },
  { key: 'approved',  label: 'Approved',  color: SAPPHIRE },
  { key: 'rendering', label: 'Rendering', color: TEAL },
  { key: 'complete',  label: 'Complete',  color: EMERALD },
  { key: 'failed',    label: 'Failed',    color: CRIMSON },
  { key: 'archived',  label: 'Archived',  color: '#4b5563' },
];

export default function VideoFactory() {
  const [jobs,          setJobs]          = useState([]);
  const [summary,       setSummary]       = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [provFilter,    setProvFilter]    = useState('all');
  const [statusFilter,  setStatusFilter]  = useState('all');
  const [actioning,     setActioning]     = useState(null);
  const [toast,         setToast]         = useState(null);

  const showToast = (msg, ok = true) => setToast({ msg, ok });

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const r = await fetch('/api/video-jobs/list');
      if (r.ok) {
        const d = await r.json();
        setJobs(d.jobs || []);
        setSummary(d.summary || null);
      }
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAction(jobId, newStatus) {
    setActioning(jobId);
    try {
      const r = await fetch('/api/video-jobs/update', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ jobId, status: newStatus }),
      });
      const d = await r.json();
      if (r.ok) {
        showToast(`Job ${newStatus}.`);
        load(true);
      } else {
        showToast(d.error || 'Update failed.', false);
      }
    } catch { showToast('Update failed.', false); }
    finally { setActioning(null); }
  }

  // Filtered view
  const filtered = jobs.filter(j => {
    const pm = provFilter   === 'all' || j.provider === provFilter;
    const sm = statusFilter === 'all' || j.status   === statusFilter;
    return pm && sm;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="flex flex-col items-center gap-3">
          <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
            className="w-6 h-6 rounded-full"
            style={{ border: '2px solid rgba(255,255,255,0.08)', borderTopColor: GOLD }} />
          <span className="font-mono text-[9px] tracking-widest" style={{ color: 'var(--text-muted)' }}>
            LOADING VIDEO FACTORY
          </span>
        </div>
      </div>
    );
  }

  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-4">
      <AnimatePresence>
        {toast && <Toast msg={toast.msg} ok={toast.ok} onDone={() => setToast(null)} />}
      </AnimatePresence>

      {/* ── Header ── */}
      <motion.div variants={fadeUp} className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display text-2xl font-light" style={{ color: 'var(--text-primary)' }}>
            Video Factory
          </h2>
          <p className="font-mono text-[9px] tracking-widest mt-0.5" style={{ color: 'var(--text-muted)' }}>
            STAGED VIDEO JOBS · ALL PROVIDERS · APPROVAL REQUIRED
          </p>
        </div>
        <button onClick={() => load(true)}
          className="font-mono text-[9px] tracking-widest px-3 py-2 rounded-sm transition-all"
          style={{ background: `${GOLD}0f`, border: `1px solid ${GOLD}25`, color: GOLD }}>
          ↻ REFRESH
        </button>
      </motion.div>

      {/* ── Governance notice ── */}
      <motion.div variants={fadeUp}
        className="flex items-start gap-2.5 px-3 py-2.5 rounded-sm"
        style={{ background: `${TEAL}06`, border: `1px solid ${TEAL}20` }}>
        <span className="font-mono text-[9px] flex-shrink-0 mt-0.5" style={{ color: TEAL }}>◈</span>
        <p className="font-mono text-[7px] leading-relaxed" style={{ color: `${TEAL}99` }}>
          All video jobs are staged. No API calls are made to any video provider until a job is approved and a
          provider adapter is activated through the Activation Gate. Approved jobs are queued for manual execution.
        </p>
      </motion.div>

      {/* ── Summary cards ── */}
      {summary && (
        <motion.div variants={fadeUp} className="grid grid-cols-5 gap-3">
          <SummaryCard label="Total Jobs" value={summary.total}    color={GOLD}     />
          <SummaryCard label="Pending"    value={summary.pending}  color={AMBER}    />
          <SummaryCard label="Approved"   value={summary.approved} color={SAPPHIRE} />
          <SummaryCard label="Complete"   value={summary.complete} color={EMERALD}  />
          <SummaryCard label="Failed"     value={summary.failed}   color={CRIMSON}  />
        </motion.div>
      )}

      {/* ── Filters ── */}
      <motion.div variants={fadeUp} className="space-y-2">
        {/* Provider filter */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-mono text-[7px] tracking-widest mr-1" style={{ color: 'var(--text-muted)' }}>PROVIDER:</span>
          {PROVIDERS_FILTER.map(f => (
            <FilterPill key={f.key} label={f.label} active={provFilter === f.key} color={f.color}
              onClick={() => setProvFilter(f.key)} />
          ))}
        </div>
        {/* Status filter */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-mono text-[7px] tracking-widest mr-1" style={{ color: 'var(--text-muted)' }}>STATUS:</span>
          {STATUS_FILTERS.map(f => (
            <FilterPill key={f.key} label={f.label} active={statusFilter === f.key} color={f.color}
              onClick={() => setStatusFilter(f.key)} />
          ))}
        </div>
      </motion.div>

      {/* ── Jobs grid ── */}
      {filtered.length === 0 ? (
        jobs.length === 0 ? <EmptyState /> : (
          <motion.div variants={fadeUp} className="text-center py-8">
            <p className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>No jobs match current filters</p>
          </motion.div>
        )
      ) : (
        <motion.div variants={stagger} initial="initial" animate="animate"
          className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map(job => (
            <JobCard key={job.jobId} job={job} onAction={handleAction} actioning={actioning} />
          ))}
        </motion.div>
      )}

      {/* ── Provider routing reference ── */}
      <motion.div variants={fadeUp}
        className="rounded-sm px-4 py-3 flex flex-col gap-1.5"
        style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="font-mono text-[7px] tracking-widest mb-0.5" style={{ color: 'var(--text-muted)' }}>PROVIDER ROUTING GUIDE</div>
        {[
          ['AI Twin / Avatar',                 'HeyGen',      SAPPHIRE],
          ['Luxury Cinematic',                 'Higgsfield',  GOLD    ],
          ['Cinematic Product / B-Roll',        'HyperFrames', TEAL    ],
          ['Design Asset / Still-to-Motion',   'OpenArt',     VIOLET  ],
          ['Low-Cost Open Source',             'Wan',         EMERALD ],
          ['Advanced Local Workflow',          'ComfyUI',     AMBER   ],
        ].map(([scenario, provider, color]) => (
          <div key={scenario} className="flex items-center gap-2">
            <span className="font-mono text-[7px] w-52" style={{ color: 'var(--text-muted)' }}>{scenario}</span>
            <span className="font-mono text-[7px]" style={{ color }}>→ {provider}</span>
          </div>
        ))}
      </motion.div>
    </motion.div>
  );
}
