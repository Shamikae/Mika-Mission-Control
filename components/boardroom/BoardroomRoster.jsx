import { FiRefreshCw, FiUsers } from 'react-icons/fi';

function getAgentState(agent) {
  if (agent.runtimeStatus === 'staged') {
    return { label: 'staged', className: 'staged' };
  }
  if (agent.runtimeStatus === 'degraded') {
    return { label: 'degraded', className: 'degraded' };
  }
  if (agent.runtimeStatus === 'offline') {
    return { label: 'not connected', className: 'unavailable' };
  }
  if (['available', 'reachable'].includes(agent.runtimeStatus)) {
    return { label: 'available', className: 'available' };
  }
  return { label: 'unknown', className: 'unknown' };
}

export default function BoardroomRoster({
  agents,
  state,
  selectedAgentIds,
  onToggleAgent,
  onReload,
}) {
  return (
    <aside className="boardroom-panel boardroom-roster">
      <div className="boardroom-panel-heading">
        <div>
          <span className="boardroom-panel-kicker">REGISTERED AGENTS</span>
          <h2>Roster</h2>
        </div>
        <FiUsers size={15} />
      </div>

      {state === 'loading' && <div className="boardroom-empty compact">Loading registry…</div>}

      {state === 'unavailable' && (
        <div className="boardroom-empty compact">
          <p>Agent registry is unavailable.</p>
          <button type="button" onClick={onReload}>
            <FiRefreshCw size={12} />
            Retry
          </button>
        </div>
      )}

      {state === 'ready' && agents.length === 0 && (
        <div className="boardroom-empty compact">No registered agents found.</div>
      )}

      <div className="boardroom-roster-list">
        {agents.map(agent => {
          const agentState = getAgentState(agent);
          const selected = selectedAgentIds.includes(agent.id);
          return (
            <button
              type="button"
              key={agent.id}
              className={`boardroom-agent ${selected ? 'selected' : ''}`}
              onClick={() => onToggleAgent(agent.id)}
              aria-pressed={selected}
            >
              <span className="boardroom-agent-mark">
                {(agent.displayName || agent.id).slice(0, 2).toUpperCase()}
              </span>
              <span className="boardroom-agent-copy">
                <strong>{agent.displayName || agent.id}</strong>
                <small>{agent.role || agent.department || 'Registered agent'}</small>
                <span className={`boardroom-agent-state ${agentState.className}`}>
                  {agentState.label}
                </span>
              </span>
              {agent.requiresApproval && (
                <span className="boardroom-approval-dot" title="Execution requires approval">GATE</span>
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
