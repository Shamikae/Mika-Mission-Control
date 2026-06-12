import { FiClock, FiTrash2 } from 'react-icons/fi';

function formatTime(timestamp) {
  try {
    return new Date(timestamp).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export default function DiamondRecentCommands({ commands, activeId, onSelect, onClear }) {
  return (
    <aside className="diamond-panel diamond-recent-commands">
      <div className="diamond-panel-heading">
        <div>
          <span>LOCAL HISTORY</span>
          <h2>Recent commands</h2>
        </div>
        <FiClock size={15} />
      </div>

      {commands.length > 0 && (
        <button type="button" className="diamond-clear-history" onClick={onClear}>
          <FiTrash2 size={11} />
          Clear local history
        </button>
      )}

      {commands.length === 0 ? (
        <div className="diamond-empty-state compact">No recent commands.</div>
      ) : (
        <div className="diamond-command-history">
          {commands.map(command => (
            <button
              type="button"
              key={command.id}
              className={command.id === activeId ? 'active' : ''}
              onClick={() => onSelect(command)}
            >
              <strong>{command.command}</strong>
              <span>{command.type} · {formatTime(command.createdAt)}</span>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
