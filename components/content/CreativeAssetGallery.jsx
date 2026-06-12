import { useCallback, useEffect, useState } from 'react';
import { FiFileText, FiRefreshCw } from 'react-icons/fi';
import ArtifactPreviewDrawer from '../shared/ArtifactPreviewDrawer';

const LANE_LABELS = {
  'digital-diamond': 'Digital Diamond AI',
  'managed-by-mika': 'Managed by Mika',
  medai: 'MedAI',
  cannaops: 'CannaOps',
  'hotel-hooker': 'The Hotel Hooker',
  'ai-twin': 'AI Twin Studio',
};

export default function CreativeAssetGallery() {
  const [workflows, setWorkflows] = useState([]);
  const [selection, setSelection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const laneResponse = await fetch('/api/content-artifacts/list', { cache: 'no-store' });
      if (!laneResponse.ok) throw new Error('Artifact storage is unavailable.');
      const lanePayload = await laneResponse.json();
      const laneIds = (lanePayload.lanes || []).map(lane => lane.laneId);
      const responses = await Promise.all(laneIds.map(async laneId => {
        const response = await fetch(`/api/content-artifacts/list?laneId=${encodeURIComponent(laneId)}`, { cache: 'no-store' });
        const payload = response.ok ? await response.json() : { workflows: [] };
        return (payload.workflows || []).map(workflow => ({ ...workflow, laneId }));
      }));
      setWorkflows(responses.flat().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <section className="creative-asset-gallery">
      <div className="creative-asset-gallery-heading">
        <div><span>ARTIFACT STORAGE</span><h2>Creative Asset Gallery</h2></div>
        <button type="button" onClick={load}><FiRefreshCw size={12} /> Refresh</button>
      </div>

      {loading ? (
        <div className="content-honest-empty">Loading artifacts…</div>
      ) : error ? (
        <div className="content-honest-empty error">{error}</div>
      ) : workflows.length === 0 ? (
        <div className="content-honest-empty">No generated content artifacts are stored.</div>
      ) : (
        <div className="creative-asset-grid">
          {workflows.map(workflow => (
            <article key={`${workflow.laneId}-${workflow.workflowId}`}>
              <div className="creative-asset-icon"><FiFileText size={17} /></div>
              <span>{LANE_LABELS[workflow.laneId] || workflow.laneId}</span>
              <h3>{workflow.contentGoal || workflow.contentType || 'Content workflow'}</h3>
              <p>{workflow.platform || 'Multi-platform'} · {workflow.artifactCount} artifacts</p>
              <div className="creative-asset-stages">
                {(workflow.stagesCompleted || []).map(stage => <small key={stage}>{stage.replaceAll('_', ' ')}</small>)}
              </div>
              <button type="button" onClick={() => setSelection(workflow)}>Preview artifacts</button>
            </article>
          ))}
        </div>
      )}

      <ArtifactPreviewDrawer selection={selection} onClose={() => setSelection(null)} />
    </section>
  );
}
