export default function SelfWorkspace({ eyebrow, title, description, actions, children }) {
  return (
    <section className="self-workspace">
      <header className="self-workspace-header">
        <div>
          <div className="self-workspace-eyebrow">{eyebrow || 'SELF · PERSONAL OPERATING SYSTEM'}</div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {actions ? <div className="self-workspace-actions">{actions}</div> : null}
      </header>

      <div className="self-workspace-context">
        <span>Vault governed</span>
        <p>Only existing Mika data and configured Obsidian integrations are shown. Filesystem paths are not exposed.</p>
      </div>

      {children}
    </section>
  );
}
