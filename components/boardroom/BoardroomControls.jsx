import { FiLock } from 'react-icons/fi';

const GATED_ACTIONS = ['Paid', 'External', 'Destructive', 'Long-running'];

export default function BoardroomControls({
  sessionType,
  sessionTypes,
  onSessionTypeChange,
  approvalRequired,
}) {
  return (
    <div className="boardroom-controls">
      <div className="boardroom-session-types" role="tablist" aria-label="Boardroom session type">
        {sessionTypes.map(type => (
          <button
            type="button"
            role="tab"
            aria-selected={sessionType === type}
            className={sessionType === type ? 'active' : ''}
            key={type}
            onClick={() => onSessionTypeChange(type)}
          >
            {type}
          </button>
        ))}
      </div>
      <div className={`boardroom-gate-summary ${approvalRequired ? 'required' : ''}`}>
        <FiLock size={12} />
        <span>{approvalRequired ? 'Selected roster includes approval-gated agents' : 'Execution remains approval-gated'}</span>
        <div>
          {GATED_ACTIONS.map(action => <small key={action}>{action}</small>)}
        </div>
      </div>
    </div>
  );
}
