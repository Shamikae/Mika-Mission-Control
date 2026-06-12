import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  FiAlertTriangle,
  FiArrowUpRight,
  FiExternalLink,
  FiImage,
  FiRefreshCw,
  FiTool,
} from 'react-icons/fi';

function timeAgo(value) {
  if (!value) return '';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  const seconds = Math.max(0, (Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function PaperclipBuildsGallery({ refreshSignal = 0, onStateChange }) {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/paperclip/builds', { cache: 'no-store' });
      const body = await response.json();
      setPayload(body);
      onStateChange?.(body.state || 'unknown');
    } catch {
      const next = { state: 'unreachable', reachable: false, builds: [], error: 'Paperclip builds are unavailable' };
      setPayload(next);
      onStateChange?.('unreachable');
    } finally {
      setLoading(false);
    }
  }, [onStateChange]);

  useEffect(() => {
    load();
  }, [load, refreshSignal]);

  useEffect(() => {
    const refreshMs = payload?.refreshMs;
    if (!Number.isInteger(refreshMs) || refreshMs < 5000) return undefined;
    const timer = setInterval(load, refreshMs);
    return () => clearInterval(timer);
  }, [load, payload?.refreshMs]);

  const state = payload?.state || (loading ? 'unknown' : 'unreachable');
  const builds = Array.isArray(payload?.builds) ? payload.builds : [];

  return (
    <div className="paperclip-gallery">
      <div className="paperclip-gallery-header">
        <div>
          <div className="paperclip-gallery-title">
            <span><FiTool size={17} /></span>
            <h2>Builds Gallery</h2>
          </div>
          <p>
            {loading && !payload
              ? 'Loading Paperclip builds'
              : `${builds.length} build${builds.length === 1 ? '' : 's'} shipped`}
            {payload?.refreshMs ? ' · refreshes automatically' : ''}
          </p>
        </div>
        <button type="button" onClick={load} disabled={loading} title="Refresh builds">
          <FiRefreshCw size={14} className={loading ? 'paperclip-spin' : ''} />
        </button>
      </div>

      {['disabled', 'configuration_pending', 'unreachable'].includes(state) && (
        <div className={`paperclip-notice state-${state}`}>
          <FiAlertTriangle size={18} />
          <div>
            <strong>
              {state === 'disabled'
                ? 'Paperclip is disabled'
                : state === 'configuration_pending'
                  ? 'Paperclip configuration is pending'
                  : 'Paperclip is unreachable'}
            </strong>
            <p>{payload?.error || 'Build data is not available in the current configuration.'}</p>
          </div>
        </div>
      )}

      {!loading && state === 'reachable' && builds.length === 0 && (
        <div className="paperclip-empty">
          <FiTool size={24} />
          <strong>No builds yet</strong>
          <p>Issues with a build URL and image attachment will appear here automatically.</p>
        </div>
      )}

      <div className="paperclip-build-grid">
        {loading && !payload
          ? Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="paperclip-build-card paperclip-skeleton" />
            ))
          : builds.map(build => (
              <motion.article
                key={build.issueId}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="paperclip-build-card"
              >
                <a
                  href={build.liveUrl || build.issueUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="paperclip-build-preview"
                >
                  {build.previewUrl ? (
                    <img src={build.previewUrl} alt="" />
                  ) : (
                    <span className="paperclip-preview-empty"><FiImage size={22} /></span>
                  )}
                  <span className="paperclip-build-status">
                    {build.status === 'done' ? 'Shipped' : build.status || 'Unknown'}
                  </span>
                  <span className="paperclip-build-hover">
                    <FiExternalLink size={14} />
                    Open build
                  </span>
                </a>

                <div className="paperclip-build-body">
                  <h3>{build.title}</h3>
                  <div className="paperclip-build-meta">
                    {build.agent && <span>{build.agentIcon} {build.agent}</span>}
                    {build.project && <span>{build.project}</span>}
                    {build.createdAt && <span>{timeAgo(build.createdAt)}</span>}
                  </div>
                  <div className="paperclip-build-actions">
                    {build.liveUrl && (
                      <a href={build.liveUrl} target="_blank" rel="noopener noreferrer">
                        View live <FiExternalLink size={12} />
                      </a>
                    )}
                    <a href={build.issueUrl} target="_blank" rel="noopener noreferrer">
                      {build.identifier || 'Issue'} <FiArrowUpRight size={12} />
                    </a>
                  </div>
                </div>
              </motion.article>
            ))}
      </div>
    </div>
  );
}
