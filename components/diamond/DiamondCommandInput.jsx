import { FiArrowRight, FiCommand } from 'react-icons/fi';

export default function DiamondCommandInput({
  value,
  onChange,
  onSubmit,
  quickActions,
  onQuickAction,
}) {
  function submit(event) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <div className="diamond-command-input-panel">
      <form onSubmit={submit}>
        <div className="diamond-command-input">
          <FiCommand size={17} />
          <textarea
            value={value}
            onChange={event => onChange(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                onSubmit();
              }
            }}
            placeholder="What should Mika help route or prepare?"
            rows={3}
            maxLength={8000}
          />
          <button type="submit" disabled={!value.trim()}>
            Review intent
            <FiArrowRight size={13} />
          </button>
        </div>
      </form>

      <div className="diamond-quick-actions" aria-label="Quick command examples">
        {quickActions.map(action => (
          <button type="button" key={action} onClick={() => onQuickAction(action)}>
            {action}
          </button>
        ))}
      </div>
    </div>
  );
}
