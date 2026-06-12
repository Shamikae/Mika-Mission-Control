import { useEffect, useState } from 'react';
import { FiImage, FiLock } from 'react-icons/fi';
import ContentWorkspace from '../workspaces/ContentWorkspace';

const IMAGE_CAPABILITIES = new Set(['openart', 'comfyui']);

export default function ThumbnailStudio() {
  const [capabilities, setCapabilities] = useState([]);

  useEffect(() => {
    fetch('/api/capabilities/registry')
      .then(response => response.ok ? response.json() : null)
      .then(payload => {
        const records = payload?.records || payload?.capabilities || [];
        setCapabilities(records.filter(record => IMAGE_CAPABILITIES.has(record.id)));
      })
      .catch(() => setCapabilities([]));
  }, []);

  return (
    <ContentWorkspace
      title="Thumbnails"
      description="Mika-native thumbnail planning shell. Image generation is not connected."
      status="configuration_pending"
    >
      <div className="content-staged-shell">
        <div className="content-staged-visual">
          <FiImage size={28} />
          <strong>Thumbnail Studio</strong>
          <p>Plan visual direction here after a governed image adapter is configured.</p>
        </div>
        <div className="content-staged-fields">
          <label>Format<input disabled value="YouTube / social cover" readOnly /></label>
          <label>Visual brief<textarea disabled placeholder="Available when an approved image workflow is configured." /></label>
          <label>Headline<input disabled placeholder="Thumbnail headline" /></label>
        </div>
        <div className="content-capability-strip">
          <span>CAPABILITIES</span>
          {capabilities.length ? capabilities.map(capability => (
            <small key={capability.id}>{capability.displayName} · {capability.status.replaceAll('_', ' ')}</small>
          )) : <small>OpenArt / ComfyUI metadata unavailable</small>}
        </div>
        <div className="content-approval-notice">
          <FiLock size={13} />
          External or paid image generation requires configuration and approval.
        </div>
      </div>
    </ContentWorkspace>
  );
}
