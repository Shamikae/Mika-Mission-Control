import { useState } from 'react';
import { FiCheck, FiCopy, FiDownload, FiExternalLink, FiFolder, FiPackage, FiRefreshCw } from 'react-icons/fi';

// ── Shared action row — reused by the inline preview and the modal ─────────
// Every action operates ONLY on the local Mika artifact URL. Download uses a
// same-origin link with `download` semantics (never fetches the whole file
// into JS memory first) — see the ?download=1 query param handled by the
// artifact route itself for a forced attachment Content-Disposition.

export default function ArtifactActions({ artifact, onOpenPackage, onRegenerate, compact = false }) {
  const [copied, setCopied] = useState(false);
  if (!artifact) return null;

  const downloadUrl = `${artifact.localUrl}${artifact.localUrl.includes('?') ? '&' : '?'}download=1`;

  const copyUrl = async () => {
    try {
      const absolute = typeof window !== 'undefined' ? `${window.location.origin}${artifact.localUrl}` : artifact.localUrl;
      await navigator.clipboard.writeText(absolute);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable — silently ignore, button remains usable */ }
  };

  return (
    <div className={`ov-actions${compact ? ' ov-actions--compact' : ''}`}>
      <a href={artifact.localUrl} target="_blank" rel="noopener noreferrer" className="ts-modal-btn font-ui">
        <FiExternalLink size={12} /> Open in new tab
      </a>
      <a href={downloadUrl} download={artifact.filename} className="ts-modal-btn font-ui">
        <FiDownload size={12} /> Download
      </a>
      <button type="button" className="ts-modal-btn font-ui" onClick={copyUrl}>
        {copied ? <FiCheck size={12} /> : <FiCopy size={12} />} {copied ? 'Copied' : 'Copy local URL'}
      </button>
      <button
        type="button" className="ts-modal-btn font-ui" disabled
        title="Reveal in Finder is not available from a browser session — Mika OS runs as a web app, even in local development."
      >
        <FiFolder size={12} /> Reveal in Finder
      </button>
      {onOpenPackage && (
        <button type="button" className="ts-modal-btn font-ui" onClick={onOpenPackage}>
          <FiPackage size={12} /> Open Package
        </button>
      )}
      {onRegenerate && (
        <button type="button" className="ts-modal-btn font-ui" onClick={onRegenerate}>
          <FiRefreshCw size={12} /> New Production Job
        </button>
      )}
    </div>
  );
}
