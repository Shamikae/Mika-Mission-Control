import { useCallback, useEffect, useMemo, useState } from 'react';
import { FiAlertCircle, FiCheck, FiClock, FiRefreshCw } from 'react-icons/fi';
import { useStore } from '../../lib/store';
import ContentWorkspace from '../workspaces/ContentWorkspace';

const STAGES = [
  { id: 'idea', label: 'Idea', matches: ['content brief', 'brief', 'idea'] },
  { id: 'research', label: 'Research', matches: ['trend_research', 'research', 'trend discovery'] },
  { id: 'script', label: 'Script', matches: ['script_generation', 'script creation', 'hook_generation', 'content_strategy'] },
  { id: 'asset-prompt', label: 'Asset Prompt', matches: ['visual_prompting', 'video prompting', 'image prompt', 'asset prompt'] },
  { id: 'generate', label: 'Generate', matches: ['video generation', 'image generation', 'voice generation', 'generation'] },
  { id: 'edit', label: 'Edit', matches: ['caption_generation', 'editing', 'final review', 'artifact edit'] },
  { id: 'schedule', label: 'Schedule', matches: ['publishing prep', 'schedule', 'publish'] },
  { id: 'track', label: 'Track', matches: ['analytics', 'performance', 'track', 'repurposing'] },
];

function searchableTask(task) {
  return [
    task.stageId,
    task.stageName,
    task.taskType,
    task.title,
    task.description,
  ].filter(Boolean).join(' ').toLowerCase();
}

function stageForTask(task) {
  const searchable = searchableTask(task);
  return STAGES.find(stage => stage.matches.some(match => searchable.includes(match)))?.id || 'idea';
}

function stateMeta(status) {
  if (status === 'complete') return { label: 'complete', icon: FiCheck, className: 'complete' };
  if (status === 'failed') return { label: 'failed', icon: FiAlertCircle, className: 'failed' };
  if (['running', 'dispatched', 'in_progress'].includes(status)) {
    return { label: 'in progress', icon: FiClock, className: 'active' };
  }
  return { label: status || 'pending', icon: FiClock, className: 'pending' };
}

export default function ContentPipelineBoard() {
  const setActiveSection = useStore(state => state.setActiveSection);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/tasks/list', { cache: 'no-store' });
      if (!response.ok) throw new Error('Content tasks are unavailable.');
      const payload = await response.json();
      setTasks(Array.isArray(payload) ? payload.filter(task => (
        task.taskType?.toLowerCase().includes('content')
        || task.workflowType === 'viral-content'
        || task.source === 'content-brief'
        || task.source === 'workflow-child'
      )) : []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const grouped = useMemo(() => Object.fromEntries(
    STAGES.map(stage => [stage.id, tasks.filter(task => stageForTask(task) === stage.id)]),
  ), [tasks]);

  return (
    <ContentWorkspace
      title="Content Pipeline"
      description="Idea → Research → Script → Asset Prompt → Generate → Edit → Schedule → Track"
      actions={(
        <>
          <button type="button" className="content-icon-button" onClick={() => setActiveSection('task-dispatch')}>
            Open Task Dispatch
          </button>
          <button type="button" className="content-icon-button" onClick={load} disabled={loading}>
            <FiRefreshCw size={13} /> Refresh
          </button>
        </>
      )}
    >
      <div className="content-pipeline-board">
        {STAGES.map((stage, index) => (
          <section className="content-pipeline-stage" key={stage.id}>
            <div className="content-pipeline-stage-heading">
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{stage.label}</strong>
              <small>{grouped[stage.id].length}</small>
            </div>
            <div className="content-pipeline-stage-body">
              {loading ? (
                <div className="content-compact-empty">Loading…</div>
              ) : error ? (
                <div className="content-compact-empty error">{error}</div>
              ) : grouped[stage.id].length === 0 ? (
                <div className="content-compact-empty">No work in this stage.</div>
              ) : grouped[stage.id].slice(0, 8).map(task => {
                const meta = stateMeta(task.status);
                const StateIcon = meta.icon;
                return (
                  <article className="content-task-card" key={task.id}>
                    <div>
                      <strong>{task.title || task.stageName || task.taskType}</strong>
                      <p>{task.platform || task.lane || 'Content workflow'}</p>
                    </div>
                    <span className={`content-task-state ${meta.className}`}>
                      <StateIcon size={9} /> {meta.label}
                    </span>
                    {task.approvalRequired && <small className="content-approval-flag">approval</small>}
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <p className="content-data-note">
        This board reflects existing Mika task records. It does not dispatch or advance work.
      </p>
    </ContentWorkspace>
  );
}
