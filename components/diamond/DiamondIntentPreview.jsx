import { FiAlertTriangle, FiCheckCircle, FiCompass, FiLock } from 'react-icons/fi';

const TYPE_LABELS = {
  content: 'Content',
  business: 'Business',
  agent: 'Agent',
  vault: 'Vault',
  project: 'Project',
  system: 'System',
  boardroom: 'Boardroom',
  unknown: 'Unknown',
};

export default function DiamondIntentPreview({ intent }) {
  return (
    <section className="diamond-panel diamond-intent-preview">
      <div className="diamond-panel-heading">
        <div>
          <span>INTERPRETATION</span>
          <h2>Intent preview</h2>
        </div>
        <FiCompass size={15} />
      </div>

      {!intent ? (
        <div className="diamond-empty-state">
          <FiCompass size={23} />
          <p>No command has been interpreted.</p>
          <span>Enter text or use a quick action to create a local intent.</span>
        </div>
      ) : (
        <div className="diamond-intent-body">
          <blockquote>{intent.command}</blockquote>

          <div className="diamond-intent-facts">
            <div>
              <span>TYPE</span>
              <strong className={`type-${intent.type}`}>{TYPE_LABELS[intent.type] || 'Unknown'}</strong>
            </div>
            <div>
              <span>DESTINATION</span>
              <strong>{intent.destination?.label || 'No connected destination'}</strong>
            </div>
            <div>
              <span>STATE</span>
              <strong className={intent.status === 'ready_for_review' ? 'ready' : 'not-connected'}>
                {intent.status === 'ready_for_review' ? (
                  <><FiCheckCircle size={11} /> Ready for review</>
                ) : (
                  <><FiAlertTriangle size={11} /> Not connected yet</>
                )}
              </strong>
            </div>
          </div>

          <div className={`diamond-approval-state ${intent.approvalRequired ? 'required' : ''}`}>
            <FiLock size={13} />
            <div>
              <strong>{intent.approvalRequired ? 'Approval required before execution' : 'No elevated action detected'}</strong>
              <p>
                {intent.approvalRequired
                  ? 'Diamond Control will only route this intent. Existing Mika approval gates remain authoritative.'
                  : 'This is still an intent preview. No work has run and no success is being claimed.'}
              </p>
            </div>
          </div>

          {intent.risks.length > 0 && (
            <div className="diamond-risk-list">
              {intent.risks.map(risk => <span key={risk.id}>{risk.label}</span>)}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
