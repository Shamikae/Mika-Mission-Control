import { FiLock, FiShield } from 'react-icons/fi';

export default function BusinessWorkspace({
  title,
  description,
  children,
  status,
  actions,
  showApprovalNotice = true,
}) {
  return (
    <section className="business-workspace">
      <header className="business-workspace-header">
        <div>
          <div className="business-workspace-eyebrow">BUSINESS · MIKA REVENUE SYSTEM</div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <div className="business-workspace-actions">
          {actions}
          {status && <span className={`business-status status-${status}`}>{status.replaceAll('_', ' ')}</span>}
          <span className="business-governance"><FiShield size={12} /> Mika governed</span>
        </div>
      </header>

      {showApprovalNotice && (
        <div className="business-approval-notice">
          <FiLock size={12} />
          External sending, outreach, payment, invoice, and destructive actions are not performed here.
          Existing queued actions remain subject to Mika approval and dispatch controls.
        </div>
      )}

      {children}
    </section>
  );
}
