import { useEffect, useState } from 'react';
import { FiAlertTriangle, FiLoader } from 'react-icons/fi';

export default function PaperclipFrame({ src, title, reloadKey }) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setErrored(false);
  }, [src, reloadKey]);

  if (!src) {
    return (
      <div className="paperclip-frame-state">
        <FiAlertTriangle size={22} />
        <strong>Paperclip view is unavailable</strong>
        <p>No configured workspace URL was returned for this view.</p>
      </div>
    );
  }

  return (
    <div className="paperclip-frame-shell">
      {!loaded && !errored && (
        <div className="paperclip-frame-loading">
          <FiLoader size={18} className="paperclip-spin" />
          <span>Loading Paperclip</span>
        </div>
      )}
      {errored ? (
        <div className="paperclip-frame-state">
          <FiAlertTriangle size={22} />
          <strong>Paperclip could not be embedded</strong>
          <p>Reload the view or use Open full. The upstream workspace may block iframe embedding.</p>
        </div>
      ) : (
        <iframe
          key={`${src}-${reloadKey}`}
          src={src}
          title={title}
          className="paperclip-frame"
          sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads"
          referrerPolicy="no-referrer"
          allow="clipboard-read; clipboard-write"
          onLoad={() => {
            setLoaded(true);
            setErrored(false);
          }}
          onError={() => {
            setLoaded(false);
            setErrored(true);
          }}
        />
      )}
    </div>
  );
}
