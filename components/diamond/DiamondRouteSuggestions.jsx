import { FiArrowUpRight, FiMap } from 'react-icons/fi';

export default function DiamondRouteSuggestions({ intent, suggestions, onNavigate }) {
  const canRoute = intent?.status === 'ready_for_review' && suggestions.length > 0;

  return (
    <section className="diamond-panel diamond-route-suggestions">
      <div className="diamond-panel-heading">
        <div>
          <span>ROUTING</span>
          <h2>Suggested workspace</h2>
        </div>
        <FiMap size={15} />
      </div>

      {!intent ? (
        <div className="diamond-empty-state compact">Create an intent to see routing suggestions.</div>
      ) : !canRoute ? (
        <div className="diamond-route-unavailable">
          <strong>Not connected yet</strong>
          <p>This command cannot be routed safely from Diamond Control. Reframe it as planning or open the relevant workspace manually.</p>
        </div>
      ) : (
        <div className="diamond-route-list">
          {suggestions.map((suggestion, index) => (
            <button type="button" key={suggestion.id} onClick={() => onNavigate(suggestion.id)}>
              <span>
                <small>{index === 0 ? 'BEST MATCH' : 'ALTERNATIVE'}</small>
                <strong>{suggestion.label}</strong>
              </span>
              <FiArrowUpRight size={14} />
            </button>
          ))}
        </div>
      )}

      <p className="diamond-route-note">
        Opening a workspace does not execute the command. Dispatch and approvals remain separate.
      </p>
    </section>
  );
}
