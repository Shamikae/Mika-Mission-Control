import { useCallback, useEffect, useMemo, useState } from 'react';
import { FiAlertTriangle, FiBriefcase, FiRefreshCw } from 'react-icons/fi';
import PaperclipBuildsGallery from '../paperclip/PaperclipBuildsGallery';
import PaperclipFrame from '../paperclip/PaperclipFrame';
import PaperclipToolbar, { PAPERCLIP_TABS } from '../paperclip/PaperclipToolbar';

function StatePanel({ state, onReload }) {
  const copy = {
    disabled: {
      title: 'Paperclip is disabled',
      detail: 'Set PAPERCLIP_ENABLED=true and provide the required server configuration to enable this workspace.',
    },
    configuration_pending: {
      title: 'Paperclip configuration is pending',
      detail: 'The workspace is visible, but its server-side application URL, API URL, company ID, or company path is incomplete.',
    },
    unreachable: {
      title: 'Paperclip is unreachable',
      detail: 'Configuration is present, but Mika could not reach the configured Paperclip API.',
    },
  };
  const content = copy[state] || copy.configuration_pending;

  return (
    <div className={`paperclip-state-panel state-${state}`}>
      <FiAlertTriangle size={24} />
      <h2>{content.title}</h2>
      <p>{content.detail}</p>
      <button type="button" onClick={onReload}>
        <FiRefreshCw size={14} />
        Check again
      </button>
    </div>
  );
}

export default function PaperclipWorkspace() {
  const [activeTab, setActiveTab] = useState('builds');
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [galleryRefresh, setGalleryRefresh] = useState(0);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/paperclip/overview', { cache: 'no-store' });
      setOverview(await response.json());
    } catch {
      setOverview({ state: 'unreachable', reachable: false, views: {}, workspaceUrl: null });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    const refreshMs = overview?.refreshMs;
    if (!Number.isInteger(refreshMs) || refreshMs < 5000) return undefined;
    const timer = setInterval(loadOverview, refreshMs);
    return () => clearInterval(timer);
  }, [loadOverview, overview?.refreshMs]);

  const activeDefinition = PAPERCLIP_TABS.find(tab => tab.id === activeTab) || PAPERCLIP_TABS[0];
  const activeUrl = useMemo(() => {
    if (activeTab === 'builds') return overview?.workspaceUrl || null;
    return overview?.views?.[activeTab] || null;
  }, [activeTab, overview]);

  function reload() {
    loadOverview();
    if (activeTab === 'builds') setGalleryRefresh(value => value + 1);
    else setReloadKey(value => value + 1);
  }

  const state = overview?.state || (loading ? 'unknown' : 'unreachable');
  const configured = !['disabled', 'configuration_pending'].includes(state);

  return (
    <section className="paperclip-workspace">
      <div className="paperclip-workspace-heading">
        <div className="paperclip-workspace-icon"><FiBriefcase size={18} /></div>
        <div>
          <h2>Paperclip</h2>
          <p>External workforce workspace · Mika-configured integration</p>
        </div>
      </div>

      <PaperclipToolbar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onReload={reload}
        openUrl={activeUrl}
        state={state}
        reloading={loading}
      />

      <div className={`paperclip-workspace-body ${activeTab === 'builds' ? 'gallery' : 'frame'}`}>
        {!configured ? (
          <StatePanel state={state} onReload={reload} />
        ) : activeTab === 'builds' ? (
          <PaperclipBuildsGallery
            refreshSignal={galleryRefresh}
            onStateChange={nextState => {
              if (nextState === 'unreachable') {
                setOverview(current => ({ ...(current || {}), state: 'unreachable', reachable: false }));
              }
            }}
          />
        ) : state === 'unreachable' ? (
          <StatePanel state="unreachable" onReload={reload} />
        ) : (
          <PaperclipFrame
            src={activeUrl}
            title={`Paperclip ${activeDefinition.label}`}
            reloadKey={reloadKey}
          />
        )}
      </div>
    </section>
  );
}
