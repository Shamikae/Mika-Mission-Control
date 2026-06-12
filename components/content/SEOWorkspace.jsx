import { useEffect, useState } from 'react';
import { FiSearch } from 'react-icons/fi';
import { useStore } from '../../lib/store';
import ContentWorkspace from '../workspaces/ContentWorkspace';

export default function SEOWorkspace() {
  const setActiveSection = useStore(state => state.setActiveSection);
  const [openRouter, setOpenRouter] = useState(null);

  useEffect(() => {
    fetch('/api/capabilities/registry')
      .then(response => response.ok ? response.json() : null)
      .then(payload => setOpenRouter(payload?.records?.find(record => record.id === 'openrouter') || null))
      .catch(() => setOpenRouter(null));
  }, []);

  return (
    <ContentWorkspace
      title="SEO"
      description="SEO planning and optimization workspace."
      status="configuration_pending"
    >
      <div className="content-staged-shell centered">
        <FiSearch size={28} />
        <strong>SEO workspace is not connected yet</strong>
        <p>
          Mika has SEO-related content task definitions, but no dedicated governed SEO analysis API or verified live data source.
        </p>
        <div className="content-capability-strip">
          <span>CAPABILITY</span>
          <small>{openRouter ? `${openRouter.displayName} · ${openRouter.status.replaceAll('_', ' ')}` : 'OpenRouter metadata unavailable'}</small>
        </div>
        <button type="button" onClick={() => setActiveSection('studio')}>
          Open Studio
        </button>
      </div>
    </ContentWorkspace>
  );
}
