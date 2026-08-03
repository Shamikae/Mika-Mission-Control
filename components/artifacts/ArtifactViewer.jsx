import { useEffect, useRef, useState } from 'react';
import {
  FiAlertTriangle, FiCheck, FiCopy, FiFile, FiFileText, FiMinus,
  FiPlus, FiRefreshCw, FiRotateCcw,
} from 'react-icons/fi';
import MarkdownViewer from '../ui/MarkdownViewer';
import { formatBytes } from '../../lib/artifacts/normalizeArtifact';

// ── Safe textual-artifact fetch ─────────────────────────────────────────────
// Local-URL-only (enforced upstream by normalizeArtifact — this component
// never receives a provider URL), bounded response size, bounded time.

const MAX_TEXT_BYTES = 2 * 1024 * 1024; // 2MB — generous for any brief/manifest this system produces
const FETCH_TIMEOUT_MS = 15000;

function useArtifactText(url, enabled) {
  const [state, setState] = useState({ text: null, loading: true, error: null });

  useEffect(() => {
    if (!enabled || !url) return undefined;
    let cancelled = false;
    setState({ text: null, loading: true, error: null });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    fetch(url, { signal: controller.signal, cache: 'no-store' })
      .then(async res => {
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const declaredLength = Number(res.headers.get('content-length') || 0);
        if (declaredLength && declaredLength > MAX_TEXT_BYTES) {
          throw new Error(`File is too large to preview (${formatBytes(declaredLength)} > ${formatBytes(MAX_TEXT_BYTES)}).`);
        }
        const text = await res.text();
        if (text.length > MAX_TEXT_BYTES) {
          throw new Error(`File is too large to preview (exceeds ${formatBytes(MAX_TEXT_BYTES)}).`);
        }
        return text;
      })
      .then(text => { if (!cancelled) setState({ text, loading: false, error: null }); })
      .catch(err => {
        if (cancelled) return;
        const message = err.name === 'AbortError' ? 'Loading the preview timed out.' : (err.message || 'Could not load this artifact.');
        setState({ text: null, loading: false, error: message });
      })
      .finally(() => clearTimeout(timeout));

    return () => { cancelled = true; controller.abort(); clearTimeout(timeout); };
  }, [url, enabled]);

  return state;
}

function LoadingBlock({ label = 'Loading preview…' }) {
  return (
    <div className="ov-state-block font-mono">
      <FiRefreshCw size={16} className="spin" />
      <span>{label}</span>
    </div>
  );
}

function ErrorBlock({ message, onRetry }) {
  return (
    <div className="ov-state-block ov-state-block--error font-mono">
      <FiAlertTriangle size={16} />
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="ov-retry-btn font-ui" onClick={onRetry}>
          <FiRotateCcw size={11} /> Retry
        </button>
      )}
    </div>
  );
}

// ── Video ────────────────────────────────────────────────────────────────

function VideoArtifactView({ artifact, posterUrl }) {
  const videoRef = useRef(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => { setStatus('loading'); }, [artifact.localUrl, reloadKey]);

  const retry = () => {
    setReloadKey(k => k + 1);
    videoRef.current?.load();
  };

  const vertical = artifact.width && artifact.height ? artifact.height > artifact.width : true;

  return (
    <div className={`ov-media-wrap ov-media-wrap--video${vertical ? ' ov-media-wrap--vertical' : ''}`}>
      {status === 'loading' && <LoadingBlock label="Loading video…" />}
      {status === 'error' && <ErrorBlock message="This video could not be played." onRetry={retry} />}
      <video
        key={reloadKey}
        ref={videoRef}
        className="ov-video"
        style={{ display: status === 'error' ? 'none' : undefined }}
        src={artifact.localUrl}
        poster={posterUrl || undefined}
        controls
        preload="metadata"
        playsInline
        aria-label={`Video preview: ${artifact.filename}`}
        onLoadedMetadata={() => setStatus('ready')}
        onCanPlay={() => setStatus('ready')}
        onError={() => setStatus('error')}
      >
        Your browser does not support inline video playback.
      </video>
    </div>
  );
}

// ── Audio ────────────────────────────────────────────────────────────────

function AudioArtifactView({ artifact }) {
  const [status, setStatus] = useState('loading');
  const audioRef = useRef(null);

  const retry = () => { setStatus('loading'); audioRef.current?.load(); };

  return (
    <div className="ov-media-wrap ov-media-wrap--audio">
      <div className="ov-audio-meta font-mono">
        <span>{artifact.filename}</span>
      </div>
      {status === 'error' ? (
        <ErrorBlock message="This audio file could not be played." onRetry={retry} />
      ) : (
        <audio
          ref={audioRef}
          className="ov-audio"
          src={artifact.localUrl}
          controls
          preload="metadata"
          aria-label={`Audio preview: ${artifact.filename}`}
          onLoadedMetadata={() => setStatus('ready')}
          onError={() => setStatus('error')}
        />
      )}
    </div>
  );
}

// ── Image ────────────────────────────────────────────────────────────────

function ImageArtifactView({ artifact, zoomable = false, onRequestFullscreen }) {
  const [status, setStatus] = useState('loading');
  const [zoom, setZoom] = useState(1);

  const zoomIn = () => setZoom(z => Math.min(3, +(z + 0.25).toFixed(2)));
  const zoomOut = () => setZoom(z => Math.max(0.5, +(z - 0.25).toFixed(2)));
  const resetZoom = () => setZoom(1);

  return (
    <div className="ov-media-wrap ov-media-wrap--image">
      {status === 'loading' && <LoadingBlock label="Loading image…" />}
      {status === 'error' && <ErrorBlock message="This image could not be loaded." />}
      <div
        className={`ov-image-frame${zoomable ? ' ov-image-frame--zoomable' : ' ov-image-frame--clickable'}`}
        onClick={!zoomable && onRequestFullscreen ? onRequestFullscreen : undefined}
        role={!zoomable && onRequestFullscreen ? 'button' : undefined}
        tabIndex={!zoomable && onRequestFullscreen ? 0 : undefined}
        onKeyDown={!zoomable && onRequestFullscreen ? (e => (e.key === 'Enter' || e.key === ' ') && onRequestFullscreen()) : undefined}
        aria-label={!zoomable && onRequestFullscreen ? 'Open full-size preview' : undefined}
      >
        <img
          src={artifact.localUrl}
          alt={artifact.filename}
          className="ov-image"
          style={{ display: status === 'error' ? 'none' : undefined, transform: zoomable ? `scale(${zoom})` : undefined }}
          onLoad={() => setStatus('ready')}
          onError={() => setStatus('error')}
        />
      </div>
      {zoomable && status === 'ready' && (
        <div className="ov-zoom-controls font-mono">
          <button type="button" onClick={zoomOut} aria-label="Zoom out" title="Zoom out"><FiMinus size={13} /></button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={zoomIn} aria-label="Zoom in" title="Zoom in"><FiPlus size={13} /></button>
          <button type="button" onClick={resetZoom} aria-label="Reset zoom" title="Reset zoom">Fit</button>
        </div>
      )}
    </div>
  );
}

// ── JSON ─────────────────────────────────────────────────────────────────

function JsonArtifactView({ artifact }) {
  const { text, loading, error } = useArtifactText(artifact.localUrl, true);
  if (loading) return <LoadingBlock label="Loading JSON…" />;
  if (error) return <ErrorBlock message={error} />;

  let parsed = null;
  let parseError = null;
  try { parsed = JSON.parse(text); } catch (e) { parseError = e.message; }

  if (parseError || parsed === null || typeof parsed !== 'object') {
    // Fallback to escaped raw text — React children are always escaped, never dangerouslySetInnerHTML.
    return (
      <div className="ov-text-view">
        {parseError && <div className="ov-warning font-mono"><FiAlertTriangle size={11} /> Could not parse as JSON — showing raw text.</div>}
        <pre className="ov-text-block font-mono">{parsed === null || parseError ? text : JSON.stringify(parsed, null, 2)}</pre>
      </div>
    );
  }

  const entries = Array.isArray(parsed) ? parsed.map((v, i) => [String(i), v]) : Object.entries(parsed);

  return (
    <div className="ov-json-view">
      {entries.map(([key, value]) => (
        <details key={key} className="ov-json-entry" open={entries.length <= 3}>
          <summary className="font-mono">{key}</summary>
          <pre className="ov-text-block font-mono">{JSON.stringify(value, null, 2)}</pre>
        </details>
      ))}
    </div>
  );
}

// ── Markdown ─────────────────────────────────────────────────────────────

function MarkdownArtifactView({ artifact }) {
  const { text, loading, error } = useArtifactText(artifact.localUrl, true);
  if (loading) return <LoadingBlock label="Loading document…" />;
  if (error) return <ErrorBlock message={error} />;
  return (
    <div className="ov-markdown-frame">
      <MarkdownViewer content={text} />
    </div>
  );
}

// ── Plain text ───────────────────────────────────────────────────────────

function PlainTextArtifactView({ artifact }) {
  const { text, loading, error } = useArtifactText(artifact.localUrl, true);
  const [copied, setCopied] = useState(false);
  if (loading) return <LoadingBlock label="Loading text…" />;
  if (error) return <ErrorBlock message={error} />;

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* ignore */ }
  };

  return (
    <div className="ov-text-view">
      <button type="button" className="ov-copy-btn font-ui" onClick={copy}>
        {copied ? <FiCheck size={11} /> : <FiCopy size={11} />} {copied ? 'Copied' : 'Copy'}
      </button>
      <pre className="ov-text-block font-mono">{text}</pre>
    </div>
  );
}

// ── PDF ──────────────────────────────────────────────────────────────────

function PdfArtifactView({ artifact }) {
  return (
    <div className="ov-media-wrap ov-media-wrap--pdf">
      <iframe src={artifact.localUrl} title={`PDF preview: ${artifact.filename}`} className="ov-pdf-frame" />
      <p className="pr-reason-text font-mono">
        If the preview above doesn't render, use Open in new tab or Download below.
      </p>
    </div>
  );
}

// ── Unsupported fallback ────────────────────────────────────────────────

function UnsupportedArtifactView({ artifact }) {
  return (
    <div className="ov-unsupported font-mono">
      <FiFile size={28} />
      <span className="ov-unsupported-filename">{artifact.filename}</span>
      <span>{artifact.mimeType} · {formatBytes(artifact.sizeBytes)}</span>
      <span className="pr-reason-text">Preview isn't available for this file type — use Open or Download below.</span>
    </div>
  );
}

// ── Router ───────────────────────────────────────────────────────────────

export default function ArtifactViewer({ artifact, variant = 'inline', posterUrl, onRequestFullscreen }) {
  if (!artifact) {
    return (
      <div className="ov-state-block font-mono">
        <FiFileText size={16} />
        <span>No output selected.</span>
      </div>
    );
  }

  switch (artifact.type) {
    case 'video':
      return <VideoArtifactView artifact={artifact} posterUrl={posterUrl} />;
    case 'audio':
      return <AudioArtifactView artifact={artifact} />;
    case 'image':
      return <ImageArtifactView artifact={artifact} zoomable={variant === 'modal'} onRequestFullscreen={onRequestFullscreen} />;
    case 'json':
      return <JsonArtifactView artifact={artifact} />;
    case 'markdown':
      return <MarkdownArtifactView artifact={artifact} />;
    case 'text':
      return <PlainTextArtifactView artifact={artifact} />;
    case 'pdf':
      return <PdfArtifactView artifact={artifact} />;
    default:
      return <UnsupportedArtifactView artifact={artifact} />;
  }
}

export { LoadingBlock, ErrorBlock };
