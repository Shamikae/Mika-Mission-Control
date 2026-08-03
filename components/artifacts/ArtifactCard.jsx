import { FiFile, FiFileText, FiImage, FiMusic, FiVideo } from 'react-icons/fi';
import { formatBytes, formatDuration } from '../../lib/artifacts/normalizeArtifact';

const TYPE_ICON = {
  video: FiVideo,
  audio: FiMusic,
  image: FiImage,
  json: FiFileText,
  markdown: FiFileText,
  text: FiFileText,
  pdf: FiFileText,
  unsupported: FiFile,
};

// ── Small selectable artifact card — used both for "all outputs" under the
// main preview and (compact) for job-library thumbnails. Media thumbnails
// are rendered from the LOCAL artifact URL only — never a provider URL,
// since `artifact` here is always already-normalized (normalizeArtifact
// excludes anything without a safe local URL).

export default function ArtifactCard({ artifact, selected = false, compact = false, onSelect }) {
  if (!artifact) return null;
  const Icon = TYPE_ICON[artifact.type] || FiFile;

  return (
    <button
      type="button"
      className={`ov-artifact-card${selected ? ' ov-artifact-card--selected' : ''}${compact ? ' ov-artifact-card--compact' : ''}`}
      onClick={() => onSelect?.(artifact)}
    >
      <span className="ov-artifact-card-thumb">
        {artifact.type === 'image' ? (
          <img src={artifact.localUrl} alt="" loading="lazy" />
        ) : artifact.type === 'video' ? (
          <video src={artifact.localUrl} preload="metadata" muted playsInline aria-hidden="true" />
        ) : (
          <Icon size={compact ? 14 : 18} />
        )}
      </span>
      <span className="ov-artifact-card-info">
        <span className="ov-artifact-card-filename font-mono">{artifact.filename}</span>
        <span className="ov-artifact-card-meta font-mono">
          {artifact.duration != null ? formatDuration(artifact.duration) : formatBytes(artifact.sizeBytes)}
        </span>
      </span>
    </button>
  );
}
