import { FiClock, FiPlus } from 'react-icons/fi';

function formatDate(timestamp) {
  try {
    return new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export default function BoardroomHistory({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
}) {
  return (
    <aside className="boardroom-panel boardroom-history">
      <div className="boardroom-panel-heading">
        <div>
          <span className="boardroom-panel-kicker">LOCAL HISTORY</span>
          <h2>Sessions</h2>
        </div>
        <FiClock size={15} />
      </div>

      <button type="button" className="boardroom-new-session" onClick={onNewSession}>
        <FiPlus size={13} />
        New planning session
      </button>

      {sessions.length === 0 ? (
        <div className="boardroom-empty compact">No Boardroom sessions yet.</div>
      ) : (
        <div className="boardroom-session-list">
          {sessions.map(session => (
            <button
              type="button"
              key={session.id}
              className={session.id === activeSessionId ? 'active' : ''}
              onClick={() => onSelectSession(session)}
            >
              <span>{session.title}</span>
              <small>
                {session.type} · {formatDate(session.updatedAt)}
              </small>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
