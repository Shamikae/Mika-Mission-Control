import { useCallback, useEffect, useMemo, useState } from 'react';
import { FiRefreshCw } from 'react-icons/fi';
import ContentWorkspace from '../workspaces/ContentWorkspace';

const COLUMNS = [
  { id: 'backlog', label: 'Backlog', statuses: ['pending', 'queued', 'todo'] },
  { id: 'active', label: 'In Progress', statuses: ['running', 'dispatched', 'in_progress'] },
  { id: 'review', label: 'Review / Approval', statuses: ['awaiting_approval', 'approved'] },
  { id: 'done', label: 'Done', statuses: ['complete'] },
  { id: 'blocked', label: 'Blocked', statuses: ['failed', 'blocked'] },
];

function isContentTask(task) {
  return task.taskType?.toLowerCase().includes('content')
    || task.workflowType === 'viral-content'
    || task.source === 'content-brief'
    || task.source === 'workflow-child';
}

export default function ContentKanban() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/tasks/list', { cache: 'no-store' });
      if (!response.ok) throw new Error('Task data is unavailable.');
      const payload = await response.json();
      setTasks(Array.isArray(payload) ? payload.filter(isContentTask) : []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const grouped = useMemo(() => Object.fromEntries(COLUMNS.map(column => [
    column.id,
    tasks.filter(task => (
      (column.statuses.includes(task.status)
        && !(column.id === 'backlog' && task.approvalRequired))
      || (column.id === 'review' && task.approvalRequired && task.status === 'pending')
    )),
  ])), [tasks]);

  return (
    <ContentWorkspace
      title="Content Kanban"
      description="Read-only production view backed by Mika's existing workflow and task records."
      actions={<button type="button" className="content-icon-button" onClick={load}><FiRefreshCw size={13} /> Refresh</button>}
    >
      {error ? (
        <div className="content-honest-empty error">{error}</div>
      ) : !loading && tasks.length === 0 ? (
        <div className="content-honest-empty">No content workflow tasks are available.</div>
      ) : (
        <div className="content-kanban-board">
          {COLUMNS.map(column => (
            <section key={column.id} className="content-kanban-column">
              <header><strong>{column.label}</strong><span>{grouped[column.id].length}</span></header>
              <div>
                {loading ? <p>Loading…</p> : grouped[column.id].map(task => (
                  <article key={task.id}>
                    <strong>{task.title || task.taskType}</strong>
                    <p>{task.platform || task.lane || 'Content'}</p>
                    <div>
                      <span>{task.status || 'unknown'}</span>
                      {task.approvalRequired && <small>approval required</small>}
                    </div>
                  </article>
                ))}
                {!loading && grouped[column.id].length === 0 && <p>No items.</p>}
              </div>
            </section>
          ))}
        </div>
      )}
      <p className="content-data-note">Status changes remain in existing Mika task, dispatch, and approval workflows.</p>
    </ContentWorkspace>
  );
}
