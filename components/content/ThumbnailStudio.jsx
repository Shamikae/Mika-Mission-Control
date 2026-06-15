import { useState, useEffect, useRef, useCallback } from 'react';
import { FiImage, FiRefreshCw, FiAlertCircle, FiCheck, FiUpload, FiX, FiRadio } from 'react-icons/fi';
import ContentWorkspace from '../workspaces/ContentWorkspace';
import VoiceButton from '../ui/VoiceButton';
import ArtifactGallery from '../ui/ArtifactGallery';
import DispatchStream from '../sections/DispatchStream';

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
    return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
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
        fontSize: 9,
        padding: '2px 8px',
        borderRadius: 10,
        background: s.bg,
        color: s.color,
        border: `1px solid ${s.color}40`,
        letterSpacing: '0.04em',
      }}
    >
      {status}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ThumbnailStudio() {
  const [lane,        setLane]        = useState('digital-diamond');
  const [platform,    setPlatform]    = useState('YouTube');
  const [style,       setStyle]       = useState('Bold / vibrant');
  const [prompt,      setPrompt]      = useState('');
  const [variants,    setVariants]    = useState(2);
  const [refImage,    setRefImage]    = useState(null); // { dataUri, name, size }
  const [refError,    setRefError]    = useState('');
  const [submitting,  setSubmitting]  = useState(false);
  const [result,      setResult]      = useState(null);
  const [submitError, setSubmitError] = useState('');
  const [tasks,       setTasks]       = useState([]);
  const [histLoading, setHistLoading] = useState(false);
  const [watchTaskId, setWatchTaskId] = useState(null);
  const fileRef = useRef(null);

  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    try {
      const res = await fetch('/api/tasks/list', { cache: 'no-store' });
      if (!res.ok) return;
      const all = await res.json();
      setTasks(
        (Array.isArray(all) ? all : [])
          .filter(t => t.taskType === 'Image Generation')
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
      setRefError(`Image is ${(file.size / 1024 / 1024).toFixed(1)}MB — maximum is 4MB.`);
      setRefImage(null);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      setRefImage({ dataUri: e.target.result, name: file.name, size: file.size });
    };
    reader.readAsDataURL(file);
  }, []);

  const handleFileInput = useCallback((e) => {
    handleFile(e.target.files?.[0] || null);
    e.target.value = ''; // allow re-selecting same file
  }, [handleFile]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    handleFile(e.dataTransfer.files?.[0] || null);
  }, [handleFile]);

  // ── Generate ──────────────────────────────────────────────────────────────

  const generate = async () => {
    if (!prompt.trim() || submitting) return;
    setSubmitting(true);
    setResult(null);
    setSubmitError('');
    setWatchTaskId(null);

    try {
      const res = await fetch('/api/content/thumbnail/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lane,
          platform,
          style,
          prompt: prompt.trim(),
          variants,
          referenceDataUri: refImage?.dataUri || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error || `Server error ${res.status}`);
        return;
      }
      setResult(data);
      await loadHistory();
    } catch (err) {
      setSubmitError(err.message || 'Request failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const executableNow    = result?.dispatchPreview?.executableNow === true;
  const requiresApproval = result?.dispatchPreview?.approvalRequired === true;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <ContentWorkspace
      title="Thumbnail Studio"
      description="Generate AI-directed visual concepts and image prompts through Mika's governed dispatch path."
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
                {LANES.map(l => (
                  <option key={l.id} value={l.id}>{l.label}</option>
                ))}
              </select>
            </div>

            <div className="thumb-field">
              <label className="thumb-label font-ui">Platform</label>
              <select
                className="thumb-select font-mono"
                value={platform}
                onChange={e => setPlatform(e.target.value)}
              >
                {PLATFORMS.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>

            <div className="thumb-field">
              <label className="thumb-label font-ui">Style direction</label>
              <select
                className="thumb-select font-mono"
                value={style}
                onChange={e => setStyle(e.target.value)}
              >
                {STYLES.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Variant count */}
          <div className="thumb-field">
            <label className="thumb-label font-ui">Variant concepts</label>
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
                {variants === 1 ? 'concept' : 'concepts'} to brief
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
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
              />
              <div className="thumb-voice-corner">
                <VoiceButton
                  onTranscript={t => setPrompt(prev => prev ? `${prev} ${t}` : t)}
                  disabled={submitting}
                />
              </div>
            </div>
            <div className="thumb-char-count font-mono">
              {prompt.length}/2000
            </div>
          </div>

          {/* Reference image upload */}
          <div className="thumb-field">
            <label className="thumb-label font-ui">
              Reference image
              <span className="thumb-optional"> — optional</span>
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
                <span className="thumb-upload-note font-mono">PNG · JPEG · WebP · max 4MB</span>
              </div>
            ) : (
              <div className="thumb-ref-preview">
                <img
                  src={refImage.dataUri}
                  alt="Reference preview"
                  className="thumb-ref-img"
                />
                <div className="thumb-ref-meta">
                  <span className="font-mono">{refImage.name}</span>
                  <span className="font-mono">{(refImage.size / 1024).toFixed(0)} KB</span>
                  <button
                    type="button"
                    className="thumb-ref-remove"
                    onClick={() => setRefImage(null)}
                    title="Remove reference image"
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

          {/* Error + submit */}
          {submitError && (
            <div className="thumb-field-error font-mono">
              <FiAlertCircle size={11} /> {submitError}
            </div>
          )}

          <button
            type="button"
            className="thumb-generate-btn font-ui"
            disabled={!prompt.trim() || submitting || prompt.length > 2000}
            onClick={generate}
          >
            {submitting ? (
              <><FiRefreshCw size={12} className="spin" /> Generating…</>
            ) : (
              <><FiImage size={12} /> Generate thumbnail brief</>
            )}
          </button>
        </div>

        {/* ── Result panel ────────────────────────────────────────────── */}
        {result && (
          <div className="thumb-result">
            <div className="thumb-result-head">
              <FiCheck size={13} style={{ color: '#4ade80' }} />
              <span className="font-ui">Task queued</span>
              <code className="thumb-taskid font-mono">{result.taskId}</code>
            </div>

            {executableNow && !requiresApproval ? (
              <div className="thumb-result-body">
                <p className="font-mono thumb-result-note">
                  Agent is ready — watch execution live.
                </p>
                <button
                  type="button"
                  className={`thumb-watch-btn font-ui${watchTaskId ? ' thumb-watch-btn--active' : ''}`}
                  onClick={() => setWatchTaskId(prev => prev ? null : result.taskId)}
                >
                  <FiRadio size={12} />
                  {watchTaskId ? 'Hide stream' : 'Watch execution'}
                </button>
              </div>
            ) : requiresApproval ? (
              <p className="thumb-result-note font-mono">
                Approval required. Approve via the Telegram flow, then dispatch from Mission Control.
              </p>
            ) : (
              <p className="thumb-result-note font-mono">
                {result.dispatchPreview?.reason || 'Task queued — manual dispatch required.'}
              </p>
            )}
          </div>
        )}

        {/* ── Live dispatch stream ─────────────────────────────────────── */}
        {watchTaskId && (
          <div className="thumb-stream-wrap">
            <DispatchStream key={watchTaskId} taskId={watchTaskId} />
          </div>
        )}

        {/* ── Generation history ──────────────────────────────────────── */}
        <div className="thumb-section">
          <div className="thumb-section-head">
            <span className="font-ui">Recent requests</span>
            <button
              type="button"
              className="thumb-icon-btn"
              onClick={loadHistory}
              disabled={histLoading}
              title="Refresh history"
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
                  <div className="thumb-history-main">
                    <code className="thumb-history-id font-mono">{t.id.slice(-8)}</code>
                    <span className="thumb-history-title">{t.title || t.taskType}</span>
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

        {/* ── Artifact gallery ─────────────────────────────────────────── */}
        <div className="thumb-section">
          <div className="thumb-section-head">
            <span className="font-ui">Generated artifacts</span>
          </div>
          <ArtifactGallery compact limit={6} />
        </div>

      </div>
    </ContentWorkspace>
  );
}
