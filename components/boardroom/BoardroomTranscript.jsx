import { FiMessageSquare } from 'react-icons/fi';

function formatTime(timestamp) {
  try {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function BoardroomTranscript({ session }) {
  const messages = session?.messages || [];

  return (
    <div className="boardroom-panel boardroom-transcript">
      <div className="boardroom-panel-heading">
        <div>
          <span className="boardroom-panel-kicker">{session?.type || 'PLANNING SESSION'}</span>
          <h2>{session?.title || 'New Boardroom session'}</h2>
        </div>
        <FiMessageSquare size={15} />
      </div>

      <div className="boardroom-planning-notice">
        Prompts are captured for planning only. No agents are dispatched and no responses are generated here.
      </div>

      {messages.length === 0 ? (
        <div className="boardroom-empty">
          <FiMessageSquare size={22} />
          <p>Choose registered agents and add the first planning prompt.</p>
          <span>The transcript remains empty until you create a session.</span>
        </div>
      ) : (
        <div className="boardroom-message-list">
          {messages.map(message => (
            <article className="boardroom-message" key={message.id}>
              <div className="boardroom-message-meta">
                <strong>You</strong>
                <span>{formatTime(message.createdAt)}</span>
              </div>
              <p>{message.content}</p>
              <div className="boardroom-message-targets">
                {message.participantNames?.length
                  ? `Planning with: ${message.participantNames.join(', ')}`
                  : 'No agents selected'}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
