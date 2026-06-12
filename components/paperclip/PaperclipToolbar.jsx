import {
  FiExternalLink,
  FiRefreshCw,
  FiTool,
} from 'react-icons/fi';

export const PAPERCLIP_TABS = Object.freeze([
  { id: 'builds', label: 'Builds' },
  { id: 'issues', label: 'Issues' },
  { id: 'active', label: 'Active' },
  { id: 'done', label: 'Done' },
  { id: 'org', label: 'Org' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'costs', label: 'Costs' },
]);

export default function PaperclipToolbar({
  activeTab,
  onTabChange,
  onReload,
  openUrl,
  state,
  reloading = false,
}) {
  return (
    <div className="paperclip-toolbar">
      <div className="paperclip-tabs" role="tablist" aria-label="Paperclip workspace views">
        {PAPERCLIP_TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? 'active' : ''}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.id === 'builds' && <FiTool size={12} />}
            {tab.label}
          </button>
        ))}
      </div>

      <div className="paperclip-toolbar-actions">
        <span className={`paperclip-state state-${state || 'unknown'}`}>
          {String(state || 'unknown').replaceAll('_', ' ')}
        </span>
        <button type="button" onClick={onReload} title="Reload Paperclip" disabled={reloading}>
          <FiRefreshCw size={14} className={reloading ? 'paperclip-spin' : ''} />
        </button>
        {openUrl && (
          <a href={openUrl} target="_blank" rel="noopener noreferrer" title="Open full Paperclip workspace">
            <FiExternalLink size={14} />
            <span>Open full</span>
          </a>
        )}
      </div>
    </div>
  );
}
