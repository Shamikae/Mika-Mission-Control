import { useState, useEffect, useRef, useCallback } from 'react';
import {
  FiAlertCircle, FiCheck, FiClock, FiImage, FiRefreshCw,
  FiUpload, FiX, FiZap,
} from 'react-icons/fi';
import ContentWorkspace from '../workspaces/ContentWorkspace';
import VoiceButton from '../ui/VoiceButton';

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

function StatusChip({ status }) {
  const map = {
    pending:  { bg: 'rgba(96,165,250,0.1)',  color: '#60a5fa' },
    running:  { bg: 'rgba(167,139,250,0.1)', color: '#a78bfa' },
    complete: { bg: 'rgba(74,222,128,0.1)',  color: '#4ade80' },
    failed:   { bg: 'rgba(248,113,113,0.1)', color: '#f87171' },
  };
  const s = map[status] || map.pending;
  return (
    <span
      className="font-mono"
      style={{
        fontSize: 9, padding: '2px 8px', borderRadius: 10,
        background: s.bg, color: s.color, border: `1px solid ${s.color}40`,
        letterSpacing: '0.04em',
      }}
    >
      {status}
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

// Displays the execution output — images (OpenArt) or text brief (Hermes).
// No provider URLs, no filesystem paths, no fake placeholders.
function ImageOutput({ execResult }) {
  const { ok, executionTarget, error, output, executionStatus } = execResult;
  const imageFiles = execResult.task?.imageFiles || [];
  const textOutput = execResult.task?.hermesOutput
    || execResult.task?.openclawReply
    || output
    || '';

  if (!ok) {
    const isStaged   = executionStatus === 'staged' || executionStatus === 'manual_required';
    const isApproval = executionStatus === 'manual_required' && error?.includes('Approval');
    return (
      <div className="ts-exec-state ts-exec-state--error">
        <FiAlertCircle size={14} style={{ color: '#f87171', flexShrink: 0 }} />
        <div className="ts-exec-state-body">
          <div className="ts-exec-state-title font-ui">
            {isApproval ? 'Approval required'
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

  // Task/execution state
  const [submitting,  setSubmitting]  = useState(false);  // creating task
  const [executing,   setExecuting]   = useState(false);  // running execute
  const [submitError, setSubmitError] = useState('');
  const [result,      setResult]      = useState(null);   // task creation result
  const [execResult,  setExecResult]  = useState(null);   // execution result

  // History
  const [tasks,       setTasks]       = useState([]);
  const [histLoading, setHistLoading] = useState(false);

  const fileRef = useRef(null);

  // ── History ───────────────────────────────────────────────────────────────

  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    try {
      const res = await fetch('/api/tasks/list', { cache: 'no-store' });
      if (!res.ok) return;
      const all = await res.json();
      setTasks(
        (Array.isArray(all) ? all : [])
          .filter(t => t.taskType === 'Image Generation' && t.source === 'thumbnail-studio')
          .slice(0, 10)
      );
    } finally {
      setHistLoading(false);
    }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

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

  const generate = async () => {
    if (!prompt.trim() || submitting || executing) return;

    setSubmitting(true);
    setResult(null);
    setExecResult(null);
    setSubmitError('');

    // Phase 1: create the task
    let taskData;
    try {
      const res = await fetch('/api/content/thumbnail/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lane,
          platform,
          style,
          prompt:           prompt.trim(),
          variants,
          referenceDataUri: refImage?.dataUri || null,
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

    // Phase 2: auto-execute if the agent is immediately available and no approval needed
    const preview  = taskData?.dispatchPreview;
    const canExec  = preview?.executableNow === true && preview?.approvalRequired !== true;

    if (!canExec) return; // task sits in queue — handled by result panel messaging

    setExecuting(true);
    try {
      const execRes = await fetch('/api/dispatch/execute', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ taskId: taskData.taskId }),
      });
      const execData = await execRes.json();
      setExecResult(execData);
      await loadHistory();
    } catch (err) {
      setExecResult({ ok: false, error: err.message || 'Execution failed.', executionStatus: 'failed' });
    } finally {
      setExecuting(false);
    }
  };

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
      <div className="thumb-studio">

        {/* ── Generation form ─────────────────────────────────────────── */}
        <div className="thumb-form">

          {/* Row 1: Lane · Platform · Style */}
          <div className="thumb-row-3">
            <div className="thumb-field">
              <label className="thumb-label font-ui">Lane</label>
              <select
                className="thumb-select font-mono"
                value={lane}
                onChange={e => setLane(e.target.value)}
              >
                {LANES.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </div>

            <div className="thumb-field">
              <label className="thumb-label font-ui">Platform</label>
              <select
                className="thumb-select font-mono"
                value={platform}
                onChange={e => setPlatform(e.target.value)}
              >
                {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            <div className="thumb-field">
              <label className="thumb-label font-ui">Style direction</label>
              <select
                className="thumb-select font-mono"
                value={style}
                onChange={e => setStyle(e.target.value)}
              >
                {STYLES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* Variant count */}
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
              <span className="thumb-variant-note font-mono">
                {variants === 1 ? 'image' : 'images'}
              </span>
            </div>
          </div>

          {/* Prompt + voice input */}
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
          </div>

          {/* Reference image upload */}
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
                  <button
                    type="button"
                    className="thumb-ref-remove"
                    onClick={() => setRefImage(null)}
                    aria-label="Remove reference image"
                  >
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

          {/* Submit error */}
          {submitError && (
            <div className="thumb-field-error font-mono">
              <FiAlertCircle size={11} /> {submitError}
            </div>
          )}

          {/* Generate button */}
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

        {/* ── Result panel (task queued) ───────────────────────────── */}
        {result && (
          <div className="thumb-result">
            <div className="thumb-result-head">
              {executing ? (
                <FiRefreshCw size={13} className="spin" style={{ color: '#a78bfa' }} />
              ) : execResult?.ok ? (
                <FiCheck size={13} style={{ color: '#4ade80' }} />
              ) : execResult && !execResult.ok ? (
                <FiAlertCircle size={13} style={{ color: '#f87171' }} />
              ) : (
                <FiClock size={13} style={{ color: '#60a5fa' }} />
              )}
              <span className="font-ui ts-result-status">
                {executing ? 'Executing'
                  : execResult?.ok ? 'Complete'
                  : execResult ? 'Failed'
                  : 'Queued'}
              </span>
              <code className="thumb-taskid font-mono">{result.taskId}</code>
              {preview?.selectedAgent && <RouteBadge preview={preview} />}
            </div>

            {/* Execution-in-progress message */}
            {executing && (
              <p className="thumb-result-note font-mono">
                {preview?.selectedAgent?.id === 'openart'
                  ? 'Generating images via OpenArt… This may take up to 2 minutes.'
                  : `Dispatching to ${preview?.selectedAgent?.displayName || 'agent'}…`}
              </p>
            )}

            {/* Queued but not auto-executed (approval needed / agent unavailable) */}
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

        {/* ── Image / text output (after execution) ────────────────── */}
        {execResult && <ImageOutput execResult={execResult} />}

        {/* ── Recent requests ──────────────────────────────────────── */}
        <div className="thumb-section">
          <div className="thumb-section-head">
            <span className="font-ui">Recent requests</span>
            <button
              type="button"
              className="thumb-icon-btn"
              onClick={loadHistory}
              disabled={histLoading}
              title="Refresh"
              aria-label="Refresh history"
            >
              <FiRefreshCw size={11} className={histLoading ? 'spin' : ''} />
            </button>
          </div>

          {tasks.length === 0 ? (
            <div className="thumb-empty font-mono">
              No thumbnail requests yet. Generate a brief above to start.
            </div>
          ) : (
            <div className="thumb-history">
              {tasks.map(t => (
                <div key={t.id} className="thumb-history-row">
                  {/* Thumbnail preview for completed image tasks */}
                  {t.imageFiles?.length > 0 && (
                    <img
                      src={`/api/image/artifacts/${encodeURIComponent(t.imageFiles[0].filename)}`}
                      alt=""
                      className="ts-history-thumb"
                      loading="lazy"
                    />
                  )}
                  <div className="thumb-history-main">
                    <code className="thumb-history-id font-mono">{t.id.slice(-8)}</code>
                    <span className="thumb-history-title">
                      {t.title || t.taskType}
                      {t.imageFiles?.length > 0 && (
                        <span className="ts-history-img-count font-mono">
                          {' '}· {t.imageFiles.length} img
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="thumb-history-meta">
                    <StatusChip status={t.status} />
                    <time className="font-mono thumb-history-date">{formatDate(t.createdAt)}</time>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </ContentWorkspace>
  );
}
