import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  FiAlertCircle, FiCheck, FiClock, FiCopy, FiDownload, FiExternalLink,
  FiEye, FiFilter, FiImage, FiLayers, FiLock, FiRefreshCw,
  FiSearch, FiTrendingUp, FiUpload, FiX, FiZap,
} from 'react-icons/fi';
import ContentWorkspace from '../workspaces/ContentWorkspace';
import VoiceButton from '../ui/VoiceButton';

// Matches the artifact route's own filename contract — never trust a task
// record's filename blindly, even though it's server-written.
const SAFE_ARTIFACT_FILENAME_RE = /^[a-zA-Z0-9_-]+\.(png|jpg|webp)$/;
const LIBRARY_LIMIT = 50;
const HISTORY_LIMIT = 30;

// ── Constants ─────────────────────────────────────────────────────────────────

const LANES = [
  { id: 'digital-diamond', label: 'Digital Diamond AI' },
  { id: 'managed-by-mika', label: 'Managed by Mika'   },
  { id: 'medai',           label: 'MedAI'              },
  { id: 'cannaops',        label: 'CannaOps'            },
  { id: 'hotel-hooker',    label: 'The Hotel Hooker'   },
  { id: 'ai-twin',         label: 'AI Twin Studio'     },
];

const PLATFORMS = ['YouTube', 'TikTok', 'Instagram', 'LinkedIn'];

const STYLES = [
  'Bold / vibrant',
  'Clean / minimal',
  'Dark / dramatic',
  'Bright / energetic',
];

const DATE_RANGES = [
  { id: 'all',   label: 'All time' },
  { id: 'today', label: 'Today' },
  { id: '7d',    label: 'Last 7 days' },
  { id: '30d',   label: 'Last 30 days' },
];

// Display-status vocabulary. 'saving' is reserved for a future incremental
// progress signal — the current synchronous dispatch has no way to honestly
// distinguish it from 'generating', so it is styled but never assigned.
const STATUS_META = {
  pending:                  { label: 'Pending',                  color: '#60a5fa' },
  generating:               { label: 'Generating',                color: '#a78bfa' },
  saving:                   { label: 'Saving',                    color: '#38bdf8' },
  complete:                 { label: 'Complete',                  color: '#4ade80' },
  failed:                   { label: 'Failed',                    color: '#f87171' },
  budget_exceeded:          { label: 'Budget Exceeded',           color: '#f59e0b' },
  authentication_required:  { label: 'Authentication Required',   color: '#fb923c' },
};

const STATUS_FILTERS = ['all', 'complete', 'pending', 'generating', 'failed', 'budget_exceeded', 'authentication_required'];

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_FILE_BYTES = 4 * 1024 * 1024;

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString([], {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return ''; }
}

function shortenPrompt(text, max = 90) {
  if (!text) return '';
  const clean = String(text).trim();
  return clean.length > max ? `${clean.slice(0, max).trim()}…` : clean;
}

// Derives a richer display status from the persisted task record without
// touching the dispatch/generation pipeline — pure read-side classification
// over fields the pipeline already writes (task.status, task.dispatchError).
function deriveDisplayStatus(task) {
  if (!task) return 'pending';
  if (task.status === 'complete') return 'complete';
  if (task.status === 'running')  return 'generating';
  if (task.status === 'pending')  return 'pending';
  if (task.status === 'failed') {
    const msg = String(task.dispatchError || '').toLowerCase();
    if (msg.includes('exceeds the allowed maximum')) return 'budget_exceeded';
    if (msg.includes('not authenticated') || msg.includes('authorization is missing') || msg.includes('reconnect via')) {
      return 'authentication_required';
    }
    return 'failed';
  }
  return 'pending';
}

function downloadArtifact(item) {
  if (!item?.url) return;
  const a = document.createElement('a');
  a.href = item.url;
  a.download = item.filename || 'image';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ── Status badge — shared by the library grid and the history timeline ────────

function StatusBadge({ status, size = 'sm' }) {
  const meta = STATUS_META[status] || STATUS_META.pending;
  return (
    <span
      className={`ts-status-badge ts-status-badge--${size} font-mono`}
      style={{ color: meta.color, background: `${meta.color}1f`, borderColor: `${meta.color}40` }}
    >
      {meta.label}
    </span>
  );
}

// Reserves visual space for future version groups. Only v1 exists today —
// this never fabricates additional versions, it just renders the pattern.
function VersionPips({ count = 1, active = 1 }) {
  if (count <= 1) {
    return <span className="ts-version-pip ts-version-pip--solo font-mono">v{active}</span>;
  }
  return (
    <span className="ts-version-pips">
      {Array.from({ length: count }, (_, i) => i + 1).map(n => (
        <span key={n} className={`ts-version-pip font-mono${n === active ? ' ts-version-pip--active' : ''}`}>
          v{n}
        </span>
      ))}
    </span>
  );
}

// Shows which agent will handle the task and what output to expect.
// Never shows internal agent IDs or filesystem paths.
function RouteBadge({ preview }) {
  const agent = preview?.selectedAgent;
  if (!agent) return null;
  const isImage    = agent.id === 'openart';
  const isFallback = preview.usingFallback === true;
  return (
    <span className={`ts-route-badge${isImage ? ' ts-route-badge--image' : ' ts-route-badge--text'} font-mono`}>
      <FiZap size={9} />
      {isImage ? 'OpenArt · images' : 'Hermes · text brief'}
      {isFallback && ' · fallback'}
    </span>
  );
}

// Prompt-selection-required state: renders the deterministic-local variants
// plus the original for the user to pick, then resubmits with selectedPrompt.
// Never claims an LLM wrote these — enhancementMethod is shown verbatim.
function PromptChoices({ promptChoices, onSelect, submitting }) {
  if (!promptChoices) return null;
  const { originalPrompt, polishedPromptA, polishedPromptB, enhancementMethod } = promptChoices;
  const options = [
    { key: 'original', label: 'Your original prompt', text: originalPrompt },
    { key: 'A',         label: 'Polished — variant A', text: polishedPromptA },
    { key: 'B',         label: 'Polished — variant B', text: polishedPromptB },
  ].filter(o => o.text);

  return (
    <div className="ts-exec-state ts-exec-state--prompt-choice">
      <FiAlertCircle size={14} style={{ color: '#60a5fa', flexShrink: 0 }} />
      <div className="ts-exec-state-body">
        <div className="ts-exec-state-title font-ui">Choose a prompt before generating</div>
        <div className="ts-exec-state-msg ts-exec-state-msg--neutral font-mono">
          Polishing method: {enhancementMethod || 'deterministic-local'} (rule-based, not an LLM).
        </div>
        <div className="thumb-prompt-choices">
          {options.map(o => (
            <button
              key={o.key}
              type="button"
              className="thumb-prompt-choice-btn"
              disabled={submitting}
              onClick={() => onSelect(o.text)}
            >
              <span className="thumb-prompt-choice-label font-ui">{o.label}</span>
              <span className="thumb-prompt-choice-text font-mono">{o.text}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Displays the execution output — images (OpenArt) or text brief (Hermes).
// No provider URLs, no filesystem paths, no fake placeholders.
function ImageOutput({ execResult, onSelectPrompt, resubmitting }) {
  const { ok, executionTarget, error, output, executionStatus } = execResult;
  const imageFiles = execResult.task?.imageFiles || [];
  const selectedModel    = execResult.task?.selectedModel;
  const estimatedCredits = execResult.task?.estimatedCredits;
  const textOutput = execResult.task?.hermesOutput
    || execResult.task?.openclawReply
    || output
    || '';

  if (executionStatus === 'prompt_selection_required') {
    return (
      <PromptChoices
        promptChoices={execResult.task?.promptChoices}
        onSelect={onSelectPrompt}
        submitting={resubmitting}
      />
    );
  }

  if (!ok) {
    const isStaged        = executionStatus === 'staged' || executionStatus === 'manual_required';
    const isApproval       = executionStatus === 'manual_required' && error?.includes('Approval');
    const isBudgetExceeded = executionStatus === 'budget_exceeded';
    return (
      <div className="ts-exec-state ts-exec-state--error">
        <FiAlertCircle size={14} style={{ color: '#f87171', flexShrink: 0 }} />
        <div className="ts-exec-state-body">
          <div className="ts-exec-state-title font-ui">
            {isBudgetExceeded ? 'Credit budget exceeded'
              : isApproval ? 'Approval required'
              : isStaged ? 'Agent unavailable'
              : 'Execution failed'}
          </div>
          <div className="ts-exec-state-msg font-mono">
            {error || 'The task could not be executed at this time.'}
          </div>
          {isStaged && !isApproval && (
            <div className="ts-exec-state-hint font-mono">
              OpenArt has no recent health evidence. Run an adapter health check from the Agent Registry
              to activate image generation, or dispatch this task manually once OpenArt is available.
            </div>
          )}
          {isApproval && (
            <div className="ts-exec-state-hint font-mono">
              Approve via Telegram, then re-dispatch from the Mission Control queue.
            </div>
          )}
          {!isStaged && !isApproval && !isBudgetExceeded && executionTarget === 'openart' && (
            <div className="ts-exec-state-hint font-mono">
              OpenArt did not complete this generation. Nothing was silently routed to Hermes — submit a new
              request above to retry.
            </div>
          )}
        </div>
      </div>
    );
  }

  // OpenArt path: real images available
  if (executionTarget === 'openart' && imageFiles.length > 0) {
    return (
      <div className="ts-image-result">
        <div className="ts-image-result-head">
          <span className="ts-image-result-label font-ui">Generated images</span>
          <span className="ts-image-result-count font-mono">
            {imageFiles.length} image{imageFiles.length !== 1 ? 's' : ''} · via OpenArt
          </span>
        </div>
        {(selectedModel || estimatedCredits != null) && (
          <div className="ts-image-result-meta font-mono">
            {selectedModel && <span>model: {selectedModel}</span>}
            {estimatedCredits != null && <span>· {estimatedCredits} credits</span>}
          </div>
        )}
        <div className="ts-image-grid">
          {imageFiles.map(f => (
            <div key={f.filename} className="ts-image-card">
              <img
                src={`/api/image/artifacts/${encodeURIComponent(f.filename)}`}
                alt="Generated thumbnail"
                className="ts-image"
                loading="lazy"
              />
              <span className="ts-image-size font-mono">
                {(f.sizeBytes / 1024).toFixed(0)} KB
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Hermes or OpenClaw text brief
  if (textOutput) {
    return (
      <div className="ts-text-result">
        <div className="ts-text-result-head">
          <span className="ts-text-result-label font-ui">Visual Brief</span>
          {executionTarget === 'hermes' && (
            <span className="ts-fallback-note font-mono">
              OpenArt unavailable — Hermes generated a text brief
            </span>
          )}
        </div>
        <pre className="ts-text-output font-mono">{textOutput}</pre>
      </div>
    );
  }

  // Success but nothing displayable (shouldn't happen but honest fallback)
  return (
    <div className="ts-exec-state ts-exec-state--ok">
      <FiCheck size={13} style={{ color: '#4ade80' }} />
      <span className="font-mono">{output || 'Task completed.'}</span>
    </div>
  );
}

// ── Today's Activity summary bar ────────────────────────────────────────────
// Derived entirely from already-loaded task records — no new API calls.

function ActivityBar({ stats }) {
  return (
    <div className="ts-activity-bar">
      <div className="ts-activity-stat">
        <FiImage size={13} />
        <div>
          <span className="ts-activity-value font-mono">{stats.imagesGenerated}</span>
          <span className="ts-activity-label font-ui">Images today</span>
        </div>
      </div>
      <div className="ts-activity-stat">
        <FiTrendingUp size={13} />
        <div>
          <span className="ts-activity-value font-mono">{stats.creditsUsed}</span>
          <span className="ts-activity-label font-ui">Credits today</span>
        </div>
      </div>
      <div className="ts-activity-stat">
        <FiCopy size={13} />
        <div>
          <span className="ts-activity-value font-mono">{stats.mostRecentModel || '—'}</span>
          <span className="ts-activity-label font-ui">Latest model</span>
        </div>
      </div>
      <div className="ts-activity-stat">
        <FiClock size={13} />
        <div>
          <span className="ts-activity-value font-mono">{stats.lastGenerationAt ? formatDate(stats.lastGenerationAt) : '—'}</span>
          <span className="ts-activity-label font-ui">Last generation</span>
        </div>
      </div>
    </div>
  );
}

// ── Creative Library — card ──────────────────────────────────────────────────

function LibraryCard({ item, onOpen, onRegenerate }) {
  const [broken, setBroken] = useState(false);
  const hasImage = !!item.url && !broken;

  return (
    <div className="ts-lib-card">
      <div
        className="ts-lib-card-media"
        onClick={() => onOpen(item)}
        role="button"
        tabIndex={0}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onOpen(item)}
        aria-label={hasImage ? 'Open generated image preview' : `View ${STATUS_META[item.status]?.label || 'task'} details`}
      >
        {hasImage ? (
          <img
            src={item.url}
            alt=""
            className="ts-lib-card-img"
            loading="lazy"
            onError={() => setBroken(true)}
          />
        ) : (
          <div className={`ts-lib-card-status-fill ts-lib-card-status-fill--${item.status}`}>
            {item.status === 'generating' ? <FiRefreshCw size={22} className="spin" />
              : item.status === 'authentication_required' ? <FiLock size={22} />
              : item.status === 'failed' || item.status === 'budget_exceeded' ? <FiAlertCircle size={22} />
              : <FiClock size={22} />}
            <span className="font-mono">{broken ? 'Image unavailable' : (STATUS_META[item.status]?.label || 'Pending')}</span>
          </div>
        )}

        <div className="ts-lib-card-badges">
          <StatusBadge status={item.status} />
          <VersionPips count={1} active={1} />
        </div>

        {hasImage && (
          <div className="ts-lib-card-hover">
            <button
              type="button"
              className="ts-lib-hover-btn"
              onClick={e => { e.stopPropagation(); onOpen(item); }}
              title="Preview"
            >
              <FiEye size={13} />
            </button>
            <button
              type="button"
              className="ts-lib-hover-btn"
              onClick={e => { e.stopPropagation(); downloadArtifact(item); }}
              title="Download"
            >
              <FiDownload size={13} />
            </button>
            <button
              type="button"
              className="ts-lib-hover-btn"
              onClick={e => { e.stopPropagation(); onRegenerate(item); }}
              title="Regenerate"
            >
              <FiRefreshCw size={13} />
            </button>
            <button
              type="button"
              className="ts-lib-hover-btn"
              disabled
              onClick={e => e.stopPropagation()}
              title="Create Variants — coming soon"
            >
              <FiLayers size={13} />
            </button>
          </div>
        )}
      </div>

      <div className="ts-lib-card-body">
        {(item.selectedModel || item.estimatedCredits != null) && (
          <div className="ts-lib-card-meta font-mono">
            {item.selectedModel && <span>{item.selectedModel}</span>}
            {item.estimatedCredits != null && <span>· {item.estimatedCredits}cr</span>}
          </div>
        )}
        {(item.finalPrompt || item.originalPrompt) && (
          <div className="ts-lib-card-prompt font-mono">
            {shortenPrompt(item.finalPrompt || item.originalPrompt)}
          </div>
        )}
        <div className="ts-lib-card-date font-mono">{formatDate(item.timestamp)}</div>
      </div>
    </div>
  );
}

// ── Large preview — Lightroom-style ─────────────────────────────────────────

function PreviewModal({ item, onClose, onRegenerate }) {
  if (!item) return null;

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  const showOriginal = item.originalPrompt && item.originalPrompt !== item.finalPrompt;

  return (
    <div className="ts-modal-backdrop" onClick={handleBackdropClick} role="presentation">
      <div className="ts-modal" role="dialog" aria-modal="true" aria-label="Generated image preview">
        <button type="button" className="ts-modal-close" onClick={onClose} aria-label="Close preview">
          <FiX size={18} />
        </button>

        <div className="ts-modal-image-wrap">
          {item.url ? (
            <img src={item.url} alt="" className="ts-modal-image" />
          ) : (
            <div className="ts-modal-image-placeholder font-mono">
              <FiImage size={28} />
              <span>{STATUS_META[item.status]?.label || 'No image yet'}</span>
            </div>
          )}
        </div>

        <div className="ts-modal-info">
          <div className="ts-modal-top-row">
            <StatusBadge status={item.status} size="lg" />
            <VersionPips count={1} active={1} />
          </div>

          {item.finalPrompt && (
            <div className="ts-modal-row">
              <span className="ts-modal-label font-ui">Final optimized prompt</span>
              <p className="ts-modal-text font-mono">{item.finalPrompt}</p>
            </div>
          )}
          {showOriginal && (
            <div className="ts-modal-row">
              <span className="ts-modal-label font-ui">Original prompt</span>
              <p className="ts-modal-text font-mono">{item.originalPrompt}</p>
            </div>
          )}
          {!item.finalPrompt && item.originalPrompt && (
            <div className="ts-modal-row">
              <span className="ts-modal-label font-ui">Prompt</span>
              <p className="ts-modal-text font-mono">{item.originalPrompt}</p>
            </div>
          )}

          <div className="ts-modal-meta-grid font-mono">
            {item.selectedModel && (
              <div><span className="ts-modal-meta-label">Model</span>{item.selectedModel}</div>
            )}
            {item.estimatedCredits != null && (
              <div><span className="ts-modal-meta-label">Credits</span>{item.estimatedCredits}</div>
            )}
            {item.workflowId && (
              <div><span className="ts-modal-meta-label">Workflow</span>{item.workflowId}</div>
            )}
            {item.timestamp && (
              <div><span className="ts-modal-meta-label">Created</span>{formatDate(item.timestamp)}</div>
            )}
          </div>

          <div className="ts-modal-actions">
            {item.url && (
              <a href={item.url} target="_blank" rel="noopener noreferrer" className="ts-modal-btn font-ui">
                <FiExternalLink size={12} /> Open full size
              </a>
            )}
            {item.url && (
              <button type="button" className="ts-modal-btn font-ui" onClick={() => downloadArtifact(item)}>
                <FiDownload size={12} /> Save image
              </button>
            )}
            <button type="button" className="ts-modal-btn font-ui" onClick={() => onRegenerate(item)}>
              <FiRefreshCw size={12} /> Regenerate
            </button>
            <button type="button" className="ts-modal-btn font-ui" disabled title="Coming soon">
              <FiLayers size={12} /> Create Variants
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Generation History — merged timeline row ────────────────────────────────

function HistoryRow({ row, onOpen, onRegenerate }) {
  return (
    <div className="ts-hist-row">
      <div className="ts-hist-thumb-wrap">
        {row.thumbFilename ? (
          <img
            src={`/api/image/artifacts/${encodeURIComponent(row.thumbFilename)}`}
            alt=""
            className="ts-hist-thumb"
            loading="lazy"
          />
        ) : (
          <div className="ts-hist-thumb-empty"><FiImage size={12} /></div>
        )}
      </div>

      <div className="ts-hist-main">
        <span className="ts-hist-title font-ui">
          {row.title}
          {row.imageCount > 1 && <span className="ts-hist-count font-mono"> · {row.imageCount} img</span>}
        </span>
        <span className="ts-hist-id font-mono">{row.taskId.slice(-8)}</span>
      </div>

      <span className="ts-hist-model font-mono">{row.selectedModel || '—'}</span>
      <span className="ts-hist-credits font-mono">{row.estimatedCredits != null ? `${row.estimatedCredits}cr` : '—'}</span>
      <span className="ts-hist-workflow font-mono" title={row.workflowId || ''}>{row.workflowId ? row.workflowId.slice(-8) : '—'}</span>
      <span className="ts-hist-date font-mono">{formatDate(row.timestamp)}</span>

      <StatusBadge status={row.status} />

      <div className="ts-hist-actions">
        {row.thumbFilename && (
          <button type="button" className="ts-hist-action-btn" onClick={() => onOpen(row)} title="Preview">
            <FiEye size={12} />
          </button>
        )}
        <button type="button" className="ts-hist-action-btn" onClick={() => onRegenerate(row)} title="Regenerate">
          <FiRefreshCw size={12} />
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ThumbnailStudio() {
  // Form state
  const [lane,        setLane]        = useState('digital-diamond');
  const [platform,    setPlatform]    = useState('YouTube');
  const [style,       setStyle]       = useState('Bold / vibrant');
  const [prompt,      setPrompt]      = useState('');
  const [variants,    setVariants]    = useState(2);
  const [refImage,    setRefImage]    = useState(null);
  const [refError,    setRefError]    = useState('');
  const [exactPrompt, setExactPrompt] = useState(false);  // promptMode: exact vs automatic (default)

  // Task/execution state
  const [submitting,  setSubmitting]  = useState(false);  // creating task
  const [executing,   setExecuting]   = useState(false);  // running execute
  const [resubmitting, setResubmitting] = useState(false); // resubmitting with a selected prompt
  const [submitError, setSubmitError] = useState('');
  const [result,      setResult]      = useState(null);   // task creation result
  const [execResult,  setExecResult]  = useState(null);   // execution result

  // Shared task data (drives both the Creative Library and Generation History)
  const [imageTasks,   setImageTasks]   = useState([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksLoaded,  setTasksLoaded]  = useState(false);

  // Creative Library filters/search
  const [modalItem,       setModalItem]       = useState(null);
  const [searchQuery,     setSearchQuery]     = useState('');
  const [filterLane,      setFilterLane]      = useState('all');
  const [filterPlatform,  setFilterPlatform]  = useState('all');
  const [filterStatus,    setFilterStatus]    = useState('all');
  const [filterDateRange, setFilterDateRange] = useState('all');

  const fileRef = useRef(null);

  // ── Shared task data load ───────────────────────────────────────────────────
  // One fetch feeds both the Creative Library grid and the Generation History
  // timeline below — no duplicate requests, no new storage.

  const loadImageTasks = useCallback(async () => {
    setTasksLoading(true);
    try {
      const res = await fetch('/api/tasks/list', { cache: 'no-store' });
      if (!res.ok) return;
      const all = await res.json();
      const filtered = (Array.isArray(all) ? all : [])
        .filter(t => t.taskType === 'Image Generation' && t.source === 'thumbnail-studio')
        .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
      setImageTasks(filtered);
    } finally {
      setTasksLoading(false);
      setTasksLoaded(true);
    }
  }, []);

  useEffect(() => { loadImageTasks(); }, [loadImageTasks]);

  // Escape closes the preview modal.
  useEffect(() => {
    if (!modalItem) return undefined;
    const onKeyDown = (e) => { if (e.key === 'Escape') setModalItem(null); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modalItem]);

  // ── Derived: Creative Library items (flattened per image, newest first) ────

  const libraryItems = useMemo(() => {
    const seen  = new Set();
    const items = [];
    for (const t of imageTasks) {
      const status = deriveDisplayStatus(t);
      const timestamp = t.completedAt || t.updatedAt || t.createdAt || null;
      const base = {
        taskId:           t.id,
        status,
        lane:             t.lane || null,
        platform:         t.platform || null,
        style:            t.style || null,
        variants:         t.variants || t.numImages || 1,
        originalPrompt:   t.originalPrompt || t.prompt || null,
        finalPrompt:      t.finalPrompt || null,
        promptMode:       t.promptMode || 'automatic',
        selectedModel:    t.selectedModel || null,
        estimatedCredits: t.estimatedCredits ?? null,
        workflowId:       t.workflowId || null,
        provider:         t.provider || null,
        timestamp,
      };

      if (Array.isArray(t.imageFiles) && t.imageFiles.length > 0) {
        for (const f of t.imageFiles) {
          const filename = f?.filename;
          if (!filename || seen.has(filename) || !SAFE_ARTIFACT_FILENAME_RE.test(filename)) continue;
          seen.add(filename);
          items.push({ ...base, key: filename, filename, url: `/api/image/artifacts/${encodeURIComponent(filename)}` });
        }
      } else {
        items.push({ ...base, key: t.id, filename: null, url: null });
      }
    }
    items.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
    return items.slice(0, LIBRARY_LIMIT);
  }, [imageTasks]);

  const filteredLibraryItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const now = Date.now();
    return libraryItems.filter(item => {
      if (filterLane !== 'all' && item.lane !== filterLane) return false;
      if (filterPlatform !== 'all' && item.platform !== filterPlatform) return false;
      if (filterStatus !== 'all' && item.status !== filterStatus) return false;
      if (filterDateRange !== 'all') {
        const t = item.timestamp ? new Date(item.timestamp).getTime() : 0;
        let cutoff;
        if (filterDateRange === 'today') {
          cutoff = new Date().setHours(0, 0, 0, 0);
        } else {
          const days = filterDateRange === '7d' ? 7 : 30;
          cutoff = now - days * 86400000;
        }
        if (!t || t < cutoff) return false;
      }
      if (q) {
        const hay = `${item.originalPrompt || ''} ${item.finalPrompt || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [libraryItems, filterLane, filterPlatform, filterStatus, filterDateRange, searchQuery]);

  // ── Derived: Generation History rows (one per task) ─────────────────────────

  const historyRows = useMemo(() => imageTasks.slice(0, HISTORY_LIMIT).map(t => {
    const thumb = t.imageFiles?.[0]?.filename;
    return {
      taskId:           t.id,
      status:           deriveDisplayStatus(t),
      title:            t.title || t.taskType,
      lane:             t.lane || null,
      platform:         t.platform || null,
      style:            t.style || null,
      variants:         t.variants || t.numImages || 1,
      originalPrompt:   t.originalPrompt || t.prompt || null,
      finalPrompt:      t.finalPrompt || null,
      promptMode:       t.promptMode || 'automatic',
      selectedModel:    t.selectedModel || null,
      estimatedCredits: t.estimatedCredits ?? null,
      workflowId:       t.workflowId || null,
      timestamp:        t.completedAt || t.updatedAt || t.createdAt || null,
      thumbFilename:    thumb && SAFE_ARTIFACT_FILENAME_RE.test(thumb) ? thumb : null,
      imageCount:       t.imageFiles?.length || 0,
    };
  }), [imageTasks]);

  // ── Derived: Today's Activity ────────────────────────────────────────────────

  const todayStats = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayTasks = imageTasks.filter(t => {
      const ts = t.completedAt ? new Date(t.completedAt).getTime() : null;
      return ts && ts >= startOfToday.getTime();
    });
    const imagesGenerated = todayTasks.reduce((sum, t) => sum + (t.imageFiles?.length || 0), 0);
    const creditsUsed     = todayTasks.reduce((sum, t) => sum + (Number(t.estimatedCredits) || 0), 0);
    const mostRecentWithModel = imageTasks.find(t => t.selectedModel);
    const mostRecentCompleted = imageTasks.find(t => t.completedAt);
    return {
      imagesGenerated,
      creditsUsed,
      mostRecentModel:  mostRecentWithModel?.selectedModel || null,
      lastGenerationAt: mostRecentCompleted?.completedAt || null,
    };
  }, [imageTasks]);

  // ── Reference image ───────────────────────────────────────────────────────

  const handleFile = useCallback((file) => {
    setRefError('');
    if (!file) { setRefImage(null); return; }
    if (!ALLOWED_TYPES.has(file.type)) {
      setRefError('Only PNG, JPEG, and WebP images are allowed.');
      setRefImage(null);
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setRefError(`Image is ${(file.size / 1024 / 1024).toFixed(1)} MB — maximum is 4 MB.`);
      setRefImage(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => setRefImage({ dataUri: e.target.result, name: file.name, size: file.size });
    reader.readAsDataURL(file);
  }, []);

  const handleFileInput = useCallback((e) => {
    handleFile(e.target.files?.[0] || null);
    e.target.value = '';
  }, [handleFile]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    handleFile(e.dataTransfer.files?.[0] || null);
  }, [handleFile]);

  // ── Generate + auto-execute ───────────────────────────────────────────────

  // Shared execute call — used for the initial auto-execute and for
  // approval-mode resubmission with a user-picked prompt.
  const runExecute = useCallback(async (taskId, selectedPrompt, setBusy) => {
    setBusy(true);
    try {
      const execRes = await fetch('/api/dispatch/execute', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(selectedPrompt ? { taskId, selectedPrompt } : { taskId }),
      });
      const execData = await execRes.json();
      setExecResult(execData);
      await loadImageTasks();
    } catch (err) {
      setExecResult({ ok: false, error: err.message || 'Execution failed.', executionStatus: 'failed' });
    } finally {
      setBusy(false);
    }
  }, [loadImageTasks]);

  const resubmitWithPrompt = useCallback((selectedPrompt) => {
    if (!result?.taskId || !selectedPrompt) return;
    runExecute(result.taskId, selectedPrompt, setResubmitting);
  }, [result, runExecute]);

  // Single submission path — used by the form's Generate button and by
  // Regenerate (library card / history row / preview modal).
  const submitGeneration = useCallback(async ({ lane: l, platform: p, style: s, prompt: pr, variants: v, promptMode, referenceDataUri }) => {
    if (!pr?.trim() || submitting || executing) return;

    setSubmitting(true);
    setResult(null);
    setExecResult(null);
    setSubmitError('');

    let taskData;
    try {
      const res = await fetch('/api/content/thumbnail/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lane: l, platform: p, style: s,
          prompt: pr.trim(), variants: v,
          referenceDataUri: referenceDataUri || null,
          promptMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setSubmitError(data.error || `Server error ${res.status}`); return; }
      taskData = data;
      setResult(data);
    } catch (err) {
      setSubmitError(err.message || 'Request failed — please retry.');
      return;
    } finally {
      setSubmitting(false);
    }

    const preview = taskData?.dispatchPreview;
    const canExec = preview?.executableNow === true && preview?.approvalRequired !== true;
    if (!canExec) return;

    await runExecute(taskData.taskId, null, setExecuting);
  }, [submitting, executing, runExecute]);

  const generate = useCallback(() => submitGeneration({
    lane, platform, style, prompt, variants,
    promptMode: exactPrompt ? 'exact' : 'automatic',
    referenceDataUri: refImage?.dataUri,
  }), [submitGeneration, lane, platform, style, prompt, variants, exactPrompt, refImage]);

  // Reuses the existing generate + execute endpoints with the item's original
  // brief — no pipeline changes, just re-invoking the same governed path.
  const handleRegenerate = useCallback((item) => {
    if (!item?.originalPrompt) return;
    setModalItem(null);
    const nextLane     = item.lane || lane;
    const nextPlatform = item.platform || platform;
    const nextStyle    = item.style || style;
    const nextVariants = item.variants || variants;
    setLane(nextLane);
    setPlatform(nextPlatform);
    setStyle(nextStyle);
    setVariants(nextVariants);
    setPrompt(item.originalPrompt);
    setExactPrompt(item.promptMode === 'exact');
    submitGeneration({
      lane: nextLane, platform: nextPlatform, style: nextStyle,
      prompt: item.originalPrompt, variants: nextVariants,
      promptMode: item.promptMode || 'automatic',
    });
  }, [submitGeneration, lane, platform, style, variants]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const preview          = result?.dispatchPreview;
  const executableNow    = preview?.executableNow === true;
  const requiresApproval = preview?.approvalRequired === true;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <ContentWorkspace
      title="Thumbnail Studio"
      description="Generate AI image concepts through Mika's governed dispatch path."
    >
      <div className="ts-workspace">

        {/* ══════════════════════════ LEFT — Generation form ══════════════════════════ */}
        <div className="ts-workspace-left">
          <div className="thumb-form">

            <div className="thumb-row-3">
              <div className="thumb-field">
                <label className="thumb-label font-ui">Lane</label>
                <select className="thumb-select font-mono" value={lane} onChange={e => setLane(e.target.value)}>
                  {LANES.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
              </div>

              <div className="thumb-field">
                <label className="thumb-label font-ui">Platform</label>
                <select className="thumb-select font-mono" value={platform} onChange={e => setPlatform(e.target.value)}>
                  {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>

              <div className="thumb-field">
                <label className="thumb-label font-ui">Style direction</label>
                <select className="thumb-select font-mono" value={style} onChange={e => setStyle(e.target.value)}>
                  {STYLES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <div className="thumb-field">
              <label className="thumb-label font-ui">Variant count</label>
              <div className="thumb-variants">
                {[1, 2, 3, 4].map(n => (
                  <button
                    key={n}
                    type="button"
                    className={`thumb-variant-btn${variants === n ? ' thumb-variant-btn--active' : ''}`}
                    onClick={() => setVariants(n)}
                  >
                    {n}
                  </button>
                ))}
                <span className="thumb-variant-note font-mono">{variants === 1 ? 'image' : 'images'}</span>
              </div>
            </div>

            <div className="thumb-field">
              <label className="thumb-label font-ui">Visual brief</label>
              <div className="thumb-prompt-wrap">
                <textarea
                  className="thumb-textarea"
                  placeholder="Describe what the thumbnail should communicate — subject, emotion, composition, background, text overlay ideas, key visual elements…"
                  rows={4}
                  maxLength={2000}
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                />
                <div className="thumb-voice-corner">
                  <VoiceButton
                    onTranscript={t => setPrompt(prev => prev ? `${prev} ${t}` : t)}
                    disabled={submitting || executing}
                  />
                </div>
              </div>
              <div className="thumb-char-count font-mono">{prompt.length}/2000</div>
              <label className="thumb-exact-toggle font-mono">
                <input
                  type="checkbox"
                  checked={exactPrompt}
                  onChange={e => setExactPrompt(e.target.checked)}
                  disabled={submitting || executing}
                />
                Use my prompt exactly — skip Mika's deterministic polish
              </label>
            </div>

            <div className="thumb-field">
              <label className="thumb-label font-ui">
                Reference image <span className="thumb-optional">— optional</span>
              </label>

              {!refImage ? (
                <div
                  className="thumb-upload-zone"
                  onClick={() => fileRef.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={handleDrop}
                  role="button"
                  tabIndex={0}
                  aria-label="Upload reference image"
                  onKeyDown={e => e.key === 'Enter' && fileRef.current?.click()}
                >
                  <FiUpload size={16} style={{ opacity: 0.35 }} />
                  <span>Drop image or click to upload</span>
                  <span className="thumb-upload-note font-mono">PNG · JPEG · WebP · max 4 MB</span>
                </div>
              ) : (
                <div className="thumb-ref-preview">
                  <img src={refImage.dataUri} alt="Reference" className="thumb-ref-img" />
                  <div className="thumb-ref-meta">
                    <span className="font-mono">{refImage.name}</span>
                    <span className="font-mono">{(refImage.size / 1024).toFixed(0)} KB</span>
                    <button type="button" className="thumb-ref-remove" onClick={() => setRefImage(null)} aria-label="Remove reference image">
                      <FiX size={11} />
                    </button>
                  </div>
                </div>
              )}

              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                style={{ display: 'none' }}
                onChange={handleFileInput}
              />

              {refError && (
                <div className="thumb-field-error font-mono">
                  <FiAlertCircle size={11} /> {refError}
                </div>
              )}
            </div>

            {submitError && (
              <div className="thumb-field-error font-mono">
                <FiAlertCircle size={11} /> {submitError}
              </div>
            )}

            <button
              type="button"
              className="thumb-generate-btn font-ui"
              disabled={!prompt.trim() || prompt.length > 2000 || submitting || executing}
              onClick={generate}
            >
              {submitting ? (
                <><FiRefreshCw size={12} className="spin" /> Creating task…</>
              ) : executing ? (
                <><FiRefreshCw size={12} className="spin" /> Generating…</>
              ) : (
                <><FiImage size={12} /> Generate</>
              )}
            </button>
          </div>

          {/* ── Task status ─────────────────────────────────────────── */}
          {result && (
            <div className="thumb-result">
              <div className="thumb-result-head">
                {executing || resubmitting ? (
                  <FiRefreshCw size={13} className="spin" style={{ color: '#a78bfa' }} />
                ) : execResult?.ok ? (
                  <FiCheck size={13} style={{ color: '#4ade80' }} />
                ) : execResult?.executionStatus === 'prompt_selection_required' ? (
                  <FiAlertCircle size={13} style={{ color: '#60a5fa' }} />
                ) : execResult && !execResult.ok ? (
                  <FiAlertCircle size={13} style={{ color: '#f87171' }} />
                ) : (
                  <FiClock size={13} style={{ color: '#60a5fa' }} />
                )}
                <span className="font-ui ts-result-status">
                  {executing ? 'Connecting to OpenArt · generating · saving…'
                    : resubmitting ? 'Generating with selected prompt…'
                    : execResult?.ok ? 'Complete'
                    : execResult?.executionStatus === 'prompt_selection_required' ? 'Choose a prompt'
                    : execResult?.executionStatus === 'budget_exceeded' ? 'Budget exceeded'
                    : execResult ? 'Failed'
                    : 'Queued'}
                </span>
                <code className="thumb-taskid font-mono">{result.taskId}</code>
                {preview?.selectedAgent && <RouteBadge preview={preview} />}
              </div>

              {executing && (
                <p className="thumb-result-note font-mono">
                  {preview?.selectedAgent?.id === 'openart'
                    ? 'Authenticating and generating via OpenArt… this may take up to a few minutes.'
                    : `Dispatching to ${preview?.selectedAgent?.displayName || 'agent'}…`}
                </p>
              )}

              {!executing && !execResult && (
                requiresApproval ? (
                  <p className="thumb-result-note font-mono">
                    Approval required. Approve via Telegram, then dispatch from Mission Control.
                  </p>
                ) : !executableNow ? (
                  <p className="thumb-result-note font-mono">
                    {preview?.reason || 'Task queued — dispatch manually from Mission Control.'}
                  </p>
                ) : null
              )}
            </div>
          )}

          {execResult && (
            <ImageOutput execResult={execResult} onSelectPrompt={resubmitWithPrompt} resubmitting={resubmitting} />
          )}
        </div>

        {/* ══════════════════════════ RIGHT — Creative Library ══════════════════════════ */}
        <div className="ts-workspace-right">

          <ActivityBar stats={todayStats} />

          <div className="ts-library-toolbar">
            <div className="ts-library-search">
              <FiSearch size={13} />
              <input
                type="text"
                placeholder="Search by prompt…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="ts-library-filters">
              <FiFilter size={11} className="ts-filter-icon" />
              <select className="ts-filter-select font-mono" value={filterLane} onChange={e => setFilterLane(e.target.value)}>
                <option value="all">All lanes</option>
                {LANES.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
              <select className="ts-filter-select font-mono" value={filterPlatform} onChange={e => setFilterPlatform(e.target.value)}>
                <option value="all">All platforms</option>
                {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <select className="ts-filter-select font-mono" value={filterDateRange} onChange={e => setFilterDateRange(e.target.value)}>
                {DATE_RANGES.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
              <select className="ts-filter-select font-mono" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                {STATUS_FILTERS.map(s => (
                  <option key={s} value={s}>{s === 'all' ? 'All statuses' : (STATUS_META[s]?.label || s)}</option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="thumb-icon-btn"
              onClick={loadImageTasks}
              disabled={tasksLoading}
              title="Refresh"
              aria-label="Refresh creative library"
            >
              <FiRefreshCw size={13} className={tasksLoading ? 'spin' : ''} />
            </button>
          </div>

          <div className="ts-library-scroll">
            {tasksLoading && !tasksLoaded ? (
              <div className="thumb-empty font-mono">Loading generated images…</div>
            ) : filteredLibraryItems.length === 0 ? (
              <div className="thumb-empty font-mono">
                {libraryItems.length === 0
                  ? 'No generations yet. Create a brief on the left to start your library.'
                  : 'No generations match these filters.'}
              </div>
            ) : (
              <div className="ts-library-grid">
                {filteredLibraryItems.map(item => (
                  <LibraryCard key={item.key} item={item} onOpen={setModalItem} onRegenerate={handleRegenerate} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ══════════════════════════ Generation History (full width) ══════════════════════════ */}
      <div className="ts-history-section">
        <div className="thumb-section-head">
          <span className="font-ui">Generation History</span>
          <button
            type="button"
            className="thumb-icon-btn"
            onClick={loadImageTasks}
            disabled={tasksLoading}
            title="Refresh"
            aria-label="Refresh generation history"
          >
            <FiRefreshCw size={11} className={tasksLoading ? 'spin' : ''} />
          </button>
        </div>

        {historyRows.length === 0 ? (
          <div className="thumb-empty font-mono">No thumbnail requests yet. Generate a brief above to start.</div>
        ) : (
          <div className="ts-hist-table">
            <div className="ts-hist-head font-mono">
              <span></span>
              <span>Task</span>
              <span>Model</span>
              <span>Credits</span>
              <span>Workflow</span>
              <span>Created</span>
              <span>Status</span>
              <span>Actions</span>
            </div>
            {historyRows.map(row => (
              <HistoryRow
                key={row.taskId}
                row={row}
                onOpen={r => setModalItem({
                  key: r.taskId, taskId: r.taskId, status: r.status, filename: r.thumbFilename,
                  url: r.thumbFilename ? `/api/image/artifacts/${encodeURIComponent(r.thumbFilename)}` : null,
                  originalPrompt: r.originalPrompt, finalPrompt: r.finalPrompt, promptMode: r.promptMode,
                  selectedModel: r.selectedModel, estimatedCredits: r.estimatedCredits,
                  workflowId: r.workflowId, timestamp: r.timestamp,
                  lane: r.lane, platform: r.platform, style: r.style, variants: r.variants,
                })}
                onRegenerate={handleRegenerate}
              />
            ))}
          </div>
        )}
      </div>

      <PreviewModal item={modalItem} onClose={() => setModalItem(null)} onRegenerate={handleRegenerate} />
    </ContentWorkspace>
  );
}
