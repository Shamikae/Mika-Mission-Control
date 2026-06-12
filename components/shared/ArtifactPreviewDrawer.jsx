import { useEffect, useState } from 'react';
import { FiCopy, FiX } from 'react-icons/fi';

export default function ArtifactPreviewDrawer({ selection, onClose }) {
  const [summary, setSummary] = useState(null);
  const [stageId, setStageId] = useState(null);
  const [artifact, setArtifact] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selection) {
      setSummary(null);
      setStageId(null);
      setArtifact(null);
      return;
    }
    setLoading(true);
    setStageId(null);
    setArtifact(null);
    fetch(`/api/content-artifacts/get?laneId=${encodeURIComponent(selection.laneId)}&workflowId=${encodeURIComponent(selection.workflowId)}`, { cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(payload => {
        setSummary(payload);
        const first = payload?.artifactStages?.find(stage => stage.exists)?.stageId || null;
        setStageId(first);
      })
      .finally(() => setLoading(false));
  }, [selection]);

  useEffect(() => {
    if (!selection || !stageId) {
      setArtifact(null);
      return;
    }
    setLoading(true);
    fetch(`/api/content-artifacts/get?laneId=${encodeURIComponent(selection.laneId)}&workflowId=${encodeURIComponent(selection.workflowId)}&artifact=${encodeURIComponent(stageId)}`, { cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(setArtifact)
      .finally(() => setLoading(false));
  }, [selection, stageId]);

  if (!selection) return null;

  return (
    <div className="artifact-drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="artifact-preview-drawer" role="dialog" aria-modal="true" onMouseDown={event => event.stopPropagation()}>
        <header>
          <div><span>ARTIFACT PREVIEW</span><h2>{selection.contentGoal || selection.workflowId}</h2></div>
          <button type="button" onClick={onClose} aria-label="Close artifact preview"><FiX size={17} /></button>
        </header>
        <div className="artifact-drawer-tabs">
          {(summary?.artifactStages || []).filter(stage => stage.exists).map(stage => (
            <button
              type="button"
              key={stage.stageId}
              className={stageId === stage.stageId ? 'active' : ''}
              onClick={() => setStageId(stage.stageId)}
            >
              {stage.label}
            </button>
          ))}
        </div>
        <div className="artifact-drawer-content">
          {loading ? <p>Loading artifact…</p> : artifact?.content ? (
            <>
              <button
                type="button"
                className="artifact-copy-button"
                onClick={() => navigator.clipboard?.writeText(artifact.content)}
              >
                <FiCopy size={12} /> Copy
              </button>
              <pre>{artifact.content}</pre>
            </>
          ) : <p>No artifact is available for this stage.</p>}
        </div>
      </aside>
    </div>
  );
}
