import { FiShield } from 'react-icons/fi';

export default function ContentWorkspace({
  eyebrow,
  title,
  description,
  status,
  children,
  actions,
}) {
  return (
    <section className="content-workspace">
      <header className="content-workspace-header">
        <div>
          <div className="content-workspace-eyebrow">{eyebrow || 'CONTENT · MIKA CREATIVE SYSTEM'}</div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <div className="content-workspace-header-actions">
          {actions}
          {status && <span className={`content-workspace-status status-${status}`}>{status.replaceAll('_', ' ')}</span>}
          <span className="content-governance-badge"><FiShield size={12} /> Mika governed</span>
        </div>
      </header>
      {children}
    </section>
  );
}
