import { useEffect, useState } from 'react';
import VideoFactory from '../sections/VideoFactory';
import VideoRouterArchitecture from '../sections/VideoRouterArchitecture';
import ContentWorkspace from '../workspaces/ContentWorkspace';

const VIDEO_CAPABILITY_IDS = [
  'heygen',
  'higgsfield',
  'kling',
  'veo',
  'wan',
  'openart',
  'comfyui',
  'hyperframes',
];

export default function VideoWorkspace() {
  const [capabilities, setCapabilities] = useState([]);
  const [mode, setMode] = useState('factory');

  useEffect(() => {
    fetch('/api/capabilities/registry')
      .then(response => response.ok ? response.json() : null)
      .then(payload => {
        const records = payload?.records || payload?.capabilities || [];
        setCapabilities(records.filter(record => VIDEO_CAPABILITY_IDS.includes(record.id)));
      })
      .catch(() => setCapabilities([]));
  }, []);

  return (
    <ContentWorkspace
      title="Video"
      description="Governed video job staging and provider routing through Mika's existing Video Factory."
    >
      <div className="content-capability-strip">
        <span>CAPABILITIES</span>
        {capabilities.length === 0 ? (
          <small>Capability metadata unavailable</small>
        ) : capabilities.map(capability => (
          <small key={capability.id} title="Capability, not agent">
            {capability.displayName} · {capability.status.replaceAll('_', ' ')}
          </small>
        ))}
      </div>
      <div className="content-focus-tabs" role="tablist">
        <button type="button" className={mode === 'factory' ? 'active' : ''} onClick={() => setMode('factory')}>
          Video Factory
        </button>
        <button type="button" className={mode === 'router' ? 'active' : ''} onClick={() => setMode('router')}>
          Routing Architecture
        </button>
      </div>
      <div className="content-existing-surface">
        {mode === 'factory' ? <VideoFactory /> : <VideoRouterArchitecture />}
      </div>
    </ContentWorkspace>
  );
}
