import { useState, useEffect } from 'react';
import { FiPackage, FiRefreshCw, FiAlertCircle } from 'react-icons/fi';

// Stage definitions duplicated here to avoid importing the server-only
// lib/content-artifacts/saveContentArtifact.js (which uses fs/path).
const ARTIFACT_STAGES = [
  { stageId: 'trend_research',    icon: '🔥', label: 'Research'     },
  { stageId: 'hook_generation',   icon: '🪝', label: 'Hooks'         },
  { stageId: 'content_strategy',  icon: '🎯', label: 'Strategy'      },
  { stageId: 'script_generation', icon: '📝', label: 'Script'        },
  { stageId: 'visual_prompting',  icon: '🎬', label: 'Video Prompt'  },
  { stageId: 'caption_generation',icon: '💬', label: 'Caption'       },
  { stageId: 'repurposing',       icon: '♻',  label: 'Repurposing'   },
];

const TOTAL_STAGES = ARTIFACT_STAGES.length;

const STAGE_MAP = Object.fromEntries(
  ARTIFACT_STAGES.map(s => [s.stageId, s])
);

const LANE_LABELS = {
  'digital-diamond': 'Digital Diamond AI',
  'managed-by-mika': 'Managed by Mika',
  'medai':           'MedAI',
  'cannaops':        'CannaOps',
  'hotel-hooker':    'The Hotel Hooker',
  'ai-twin':         'AI Twin Studio',
};

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString([], {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return '—'; }
}

function StageChip({ stageId }) {
  const stage = STAGE_MAP[stageId];
  if (!stage) return null;
  return (
    <span className="artifact-stage-chip" title={stage.label}>
      {stage.icon} {stage.label}
    </span>
  );
}

function ArtifactCard({ artifact }) {
  const laneLabel  = LANE_LABELS[artifact.laneId] || artifact.laneId;
  const stageCount = artifact.stagesCompleted?.length ?? 0;
  const pct        = Math.round((stageCount / TOTAL_STAGES) * 100);

  return (
    <div className="artifact-card">
      <div className="artifact-card-header">
        <span className="artifact-lane-label">{laneLabel}</span>
        <time className="artifact-date">{formatDate(artifact.updatedAt)}</time>
      </div>

      <div className="artifact-workflow-id font-mono">{artifact.workflowId}</div>

      {artifact.contentGoal && (
        <p className="artifact-goal">{artifact.contentGoal}</p>
      )}

      <div className="artifact-progress">
        <div className="artifact-progress-bar">
          <div className="artifact-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="artifact-progress-label font-mono">
          {stageCount}/{TOTAL_STAGES} stages
        </span>
      </div>

      {stageCount > 0 && (
        <div className="artifact-stages">
          {artifact.stagesCompleted.map(stageId => (
            <StageChip key={stageId} stageId={stageId} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ArtifactGallery({ compact = false, limit = null }) {
  const [artifacts, setArtifacts] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/content/artifacts/list');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setArtifacts(Array.isArray(data.artifacts) ? data.artifacts : []);
    } catch (err) {
      setError(err.message || 'Failed to load artifacts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const displayed = limit != null ? artifacts.slice(0, limit) : artifacts;

  if (loading) {
    return (
      <div className="artifact-gallery-state">
        <FiRefreshCw size={14} className="spin" />
        <span>Loading artifacts…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="artifact-gallery-state artifact-gallery-state--error">
        <FiAlertCircle size={14} />
        <span>Could not load artifacts — {error}</span>
      </div>
    );
  }

  if (!artifacts.length) {
    return (
      <div className="artifact-gallery-state">
        <FiPackage size={14} />
        <span>No content artifacts yet. Run a viral content workflow to generate artifacts.</span>
      </div>
    );
  }

  return (
    <div className={`artifact-gallery${compact ? ' artifact-gallery--compact' : ''}`}>
      <div className="artifact-gallery-bar">
        <span className="artifact-gallery-count font-mono">
          {artifacts.length} workflow{artifacts.length !== 1 ? 's' : ''}
        </span>
        <button
          type="button"
          onClick={load}
          className="artifact-refresh-btn"
          title="Refresh"
          aria-label="Refresh artifacts"
        >
          <FiRefreshCw size={11} />
        </button>
      </div>

      <div className="artifact-grid">
        {displayed.map(artifact => (
          <ArtifactCard key={artifact.id} artifact={artifact} />
        ))}
      </div>

      {limit != null && artifacts.length > limit && (
        <p className="artifact-more-note font-mono">
          +{artifacts.length - limit} more workflow{artifacts.length - limit !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  );
}