import { formatBytes, formatDuration } from '../../lib/artifacts/normalizeArtifact';

function formatDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return '—'; }
}

// ── Compact metadata chip grid shared by the inline preview and the modal ──
// job/pkg are optional extra context (mode, aspect ratio) beyond what's on
// the normalized artifact itself.
export default function ArtifactMetadata({ artifact, job }) {
  if (!artifact) return null;

  const rows = [
    ['Provider', artifact.provider || '—'],
    job?.selectedMode ? ['Mode', job.selectedMode.replaceAll('_', ' ')] : null,
    job?.outputSpec?.aspectRatio ? ['Aspect ratio', job.outputSpec.aspectRatio] : null,
    artifact.duration != null ? ['Duration', formatDuration(artifact.duration)] : null,
    artifact.width && artifact.height ? ['Dimensions', `${artifact.width}×${artifact.height}`] : null,
    ['MIME type', artifact.mimeType],
    ['Size', formatBytes(artifact.sizeBytes)],
    ['Completed', formatDate(artifact.createdAt)],
  ].filter(Boolean);

  return (
    <div className="ov-meta-grid font-mono">
      {rows.map(([label, value]) => (
        <div key={label}>
          <span className="ov-meta-label font-ui">{label}</span>
          <span className="ov-meta-value">{value}</span>
        </div>
      ))}
    </div>
  );
}
