import { useCallback, useEffect, useState } from 'react';
import { FiArrowLeft, FiArrowRight, FiRefreshCw, FiX, FiRadio } from 'react-icons/fi';
import { useStore } from '../../lib/store';
import ContentWorkspace from '../workspaces/ContentWorkspace';
import ArtifactGallery from '../ui/ArtifactGallery';
import MarkdownViewer from '../ui/MarkdownViewer';
import DispatchStream from '../sections/DispatchStream';

const STAGES = [
  { id: 'inbox',     label: 'Inbox',     accent: 'var(--text-muted)' },
  { id: 'brief',     label: 'Brief',     accent: '#60a5fa' },
  { id: 'script',    label: 'Script',    accent: '#a78bfa' },
  { id: 'review',    label: 'Review',    accent: '#f59e0b' },
  { id: 'published', label: 'Published', accent: 'var(--gold)' },
];

const STAGE_IDS = STAGES.map(s => s.id);

function resolveStage(task) {
  if (task.pipelineStage && STAGE_IDS.includes(task.pipelineStage)) return task.pipelineStage;
  const status = task.status || '';
  if (['complete', 'done'].includes(status)) return 'published';
  if (['running', 'dispatched', 'in_progress'].includes(status)) return 'review';
  const type = String(task.taskType || '').toLowerCase();
  if (type.includes('brief') || type.includes('idea')) return 'brief';
  if (type.includes('script') || type.includes('hook') || type.includes('research')) return 'script';
  return 'inbox';
}

function isContentTask(task) {
  return (
    String(task.taskType || '').toLowerCase().includes('content')
    || task.workflowType === 'viral-content'
    || task.source === 'content-brief'
    || task.source === 'workflow-child'
    || task.pipelineStage != null
  );
}

function formatDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' }); }
  catch { return '—'; }
}

function TaskCard({ task, stageIndex, onOpen, onMove }) {
  const canPromote = stageIndex < STAGES.length - 1;
  const canDemote  = stageIndex > 0;

  return (
    <article
      className="pipeline-b-card"
      onClick={() => onOpen(task)}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onOpen(task)}
    >
      <div className="pipeline-b-card-top">
        <strong>{task.title || task.taskType || 'Untitled task'}</strong>
        {task.approvalRequired && (
          <span className="content-approval-flag">approval</span>
        )}
      </div>

      {task.description && (
        <p className="pipeline-b-card-desc">
          {task.description.length > 90
            ? `${task.description.slice(0, 90)}…`
            : task.description}
        </p>
      )}

      <div className="pipeline-b-card-footer">
        <span className="pipeline-b-lane font-mono">{task.lane || '—'}</span>
        <div className="pipeline-b-card-actions">
          {canDemote && (
            <button
              type="button"
              className="pipeline-b-move-btn"
              title={`Move to ${STAGES[stageIndex - 1].label}`}
              onClick={e => { e.stopPropagation(); onMove(task, STAGES[stageIndex - 1].id); }}
            >
              <FiArrowLeft size={10} />
            </button>
          )}
          {canPromote && (
            <button
              type="button"
              className="pipeline-b-move-btn pipeline-b-move-btn--fwd"
              title={`Advance to ${STAGES[stageIndex + 1].label}`}
              onClick={e => { e.stopPropagation(); onMove(task, STAGES[stageIndex + 1].id); }}
            >
              <FiArrowRight size={10} />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function TaskDrawer({ task, stageIndex, onClose, onMove }) {
  const canPromote  = stageIndex < STAGES.length - 1;
  const canDemote   = stageIndex > 0;
  const [showStream, setShowStream] = useState(false);
  const isPending   = task.status === 'pending';

  return (
    <div
      className="pipeline-b-overlay"
      onClick={onClose}
      role="presentation"
    >
      <aside
        className="pipeline-b-drawer"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Task detail"
      >
        <div className="pipeline-b-drawer-head">
          <span className="pipeline-b-drawer-stage font-ui">
            {STAGES[stageIndex]?.label || 'Task'}
          </span>
          <button
            type="button"
            className="pipeline-b-drawer-close"
            onClick={onClose}
            aria-label="Close"
          >
            <FiX size={15} />
          </button>
        </div>

        <div className="pipeline-b-drawer-body">
          <h2 className="pipeline-b-drawer-title">
            {task.title || task.taskType || 'Untitled task'}
          </h2>

          <div className="pipeline-b-meta-row">
            {task.lane     && <span className="pipeline-b-chip font-mono">{task.lane}</span>}
            {task.taskType && <span className="pipeline-b-chip">{task.taskType}</span>}
            {task.priority && <span className="pipeline-b-chip">{task.priority}</span>}
            {task.status   && (
              <span className={`pipeline-b-chip pipeline-b-chip--${task.status}`}>
                {task.status}
              </span>
            )}
          </div>

          {task.description ? (
            <div className="pipeline-b-drawer-content">
              <MarkdownViewer content={task.description} />
            </div>
          ) : (
            <p className="pipeline-b-drawer-empty">No description.</p>
          )}

          <div className="pipeline-b-drawer-dates font-mono">
            {task.createdAt && (
              <span>Created {formatDate(task.createdAt)}</span>
            )}
            {task.updatedAt && task.updatedAt !== task.createdAt && (
              <span>Updated {formatDate(task.updatedAt)}</span>
            )}
          </div>
        </div>

        <div className="pipeline-b-drawer-footer">
          {canDemote && (
            <button
              type="button"
              className="pipeline-b-drawer-btn"
              onClick={() => onMove(task, STAGES[stageIndex - 1].id)}
            >
              <FiArrowLeft size={12} /> {STAGES[stageIndex - 1].label}
            </button>
          )}
          {isPending && (
            <button
              type="button"
              className={`pipeline-b-drawer-btn pipeline-b-drawer-btn--watch${showStream ? '--active' : ''}`}
              onClick={() => setShowStream(v => !v)}
              title="Watch live execution progress"
            >
              <FiRadio size={12} /> {showStream ? 'Hide stream' : 'Watch'}
            </button>
          )}
          {canPromote && (
            <button
              type="button"
              className="pipeline-b-drawer-btn pipeline-b-drawer-btn--advance"
              onClick={() => onMove(task, STAGES[stageIndex + 1].id)}
            >
              {STAGES[stageIndex + 1].label} <FiArrowRight size={12} />
            </button>
          )}
        </div>

        {showStream && (
          <div className="pipeline-b-drawer-stream">
            <DispatchStream key={task.id} taskId={task.id} />
          </div>
        )}
      </aside>
    </div>
  );
}

export default function ContentPipelineBoard() {
  const setActiveSection = useStore(state => state.setActiveSection);
  const [tasks,      setTasks]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [drawerTask, setDrawerTask] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/tasks/list', { cache: 'no-store' });
      if (!res.ok) throw new Error('Tasks unavailable.');
      const payload = await res.json();
      setTasks(Array.isArray(payload) ? payload.filter(isContentTask) : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const moveTask = useCallback(async (task, targetStage) => {
    setDrawerTask(null);
    // Optimistic update
    setTasks(prev =>
      prev.map(t =>
        t.id === task.id
          ? { ...t, pipelineStage: targetStage, updatedAt: new Date().toISOString() }
          : t,
      ),
    );
    try {
      const res = await fetch('/api/tasks/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id, pipelineStage: targetStage }),
      });
      if (!res.ok) throw new Error('Move failed');
    } catch {
      load(); // revert on failure
    }
  }, [load]);

  // Group tasks by resolved stage
  const grouped = Object.fromEntries(STAGES.map(s => [s.id, []]));
  for (const task of tasks) {
    const stage = resolveStage(task);
    grouped[stage].push(task);
  }

  const drawerStageIndex = drawerTask
    ? STAGES.findIndex(s => s.id === resolveStage(drawerTask))
    : -1;

  return (
    <ContentWorkspace
      title="Content Pipeline"
      description="Inbox → Brief → Script → Review → Published"
      actions={(
        <>
          <button
            type="button"
            className="content-icon-button"
            onClick={() => setActiveSection('task-dispatch')}
          >
            New task
          </button>
          <button
            type="button"
            className="content-icon-button"
            onClick={load}
            disabled={loading}
          >
            <FiRefreshCw size={13} className={loading ? 'spin' : ''} /> Refresh
          </button>
        </>
      )}
    >
      <div className="pipeline-b-board">
        {STAGES.map((stage, stageIndex) => {
          const stageTasks = grouped[stage.id] || [];
          return (
            <section key={stage.id} className="pipeline-b-col">
              <div
                className="pipeline-b-col-header"
                style={{ borderTopColor: stage.accent }}
              >
                <strong style={{ color: stage.accent }}>{stage.label}</strong>
                <span className="pipeline-b-count font-mono">{stageTasks.length}</span>
              </div>

              <div className="pipeline-b-col-body">
                {loading ? (
                  <div className="content-compact-empty">
                    <FiRefreshCw size={11} className="spin" /> Loading…
                  </div>
                ) : error ? (
                  <div className="content-compact-empty error">{error}</div>
                ) : stageTasks.map(task => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    stageIndex={stageIndex}
                    onOpen={setDrawerTask}
                    onMove={moveTask}
                  />
                ))}

                {!loading && stageTasks.length === 0 && stage.id !== 'published' && (
                  <div className="content-compact-empty">Empty</div>
                )}

                {stage.id === 'published' && (
                  <div className="pipeline-b-artifacts">
                    <ArtifactGallery compact limit={null} />
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {drawerTask && drawerStageIndex !== -1 && (
        <TaskDrawer
          task={drawerTask}
          stageIndex={drawerStageIndex}
          onClose={() => setDrawerTask(null)}
          onMove={moveTask}
        />
      )}
    </ContentWorkspace>
  );
}
