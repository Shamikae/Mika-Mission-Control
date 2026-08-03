import { useEffect, useRef } from 'react';
import { FiX } from 'react-icons/fi';
import ArtifactViewer from './ArtifactViewer';
import ArtifactMetadata from './ArtifactMetadata';
import ArtifactActions from './ArtifactActions';
import ArtifactCard from './ArtifactCard';
import ArtifactReviewControls from './ArtifactReviewControls';

const FOCUSABLE_SELECTOR = 'button, a[href], [tabindex]:not([tabindex="-1"]), input, select, textarea';

// ── Large accessible preview modal ──────────────────────────────────────
// Reuses the existing ts-modal-* CSS (ThumbnailStudio's proven two-pane /
// mobile-bottom-sheet pattern) for the shell, and adds the accessibility
// behavior that pattern didn't yet have: focus moves into the modal on
// open, Tab is trapped inside it, focus returns to the triggering control
// on close, and body scroll is locked while open.

export default function ArtifactPreviewModal({
  artifact, artifacts, job, onClose, onSelect, onOpenPackage, onOpenComposition, onRegenerate,
  review, onApproveReview, onRejectReview, reviewSubmitting,
}) {
  const modalRef = useRef(null);
  const closeBtnRef = useRef(null);
  const triggerElementRef = useRef(null);

  useEffect(() => {
    if (!artifact) return undefined;

    triggerElementRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move focus into the modal.
    closeBtnRef.current?.focus();

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose?.();
        return;
      }
      if (e.key !== 'Tab' || !modalRef.current) return;
      const focusable = Array.from(modalRef.current.querySelectorAll(FOCUSABLE_SELECTOR)).filter(el => !el.disabled);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      // Return focus to whatever triggered the modal.
      if (triggerElementRef.current && typeof triggerElementRef.current.focus === 'function') {
        triggerElementRef.current.focus();
      }
    };
  }, [artifact, onClose]);

  if (!artifact) return null;

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose?.();
  };

  const others = (artifacts || []).filter(a => a.artifactId !== artifact.artifactId);

  return (
    <div className="ts-modal-backdrop" onMouseDown={handleBackdropClick} role="presentation">
      <div className="ts-modal ov-preview-modal" role="dialog" aria-modal="true" aria-label={`Preview: ${artifact.filename}`} ref={modalRef}>
        <button type="button" className="ts-modal-close" onClick={onClose} aria-label="Close preview" ref={closeBtnRef}>
          <FiX size={18} />
        </button>

        <div className="ts-modal-image-wrap ov-modal-viewer-pane">
          <ArtifactViewer artifact={artifact} variant="modal" />
        </div>

        <div className="ts-modal-info">
          {job?.execution?.mock && (
            <div className="pr-mock-banner font-mono">TEST SIMULATION — NOT A REAL VIDEO</div>
          )}

          <ArtifactMetadata artifact={artifact} job={job} />

          {others.length > 0 && (
            <div className="ov-modal-other-outputs">
              <span className="ov-meta-label font-ui">Other outputs</span>
              <div className="ov-artifact-card-row">
                {others.map(a => (
                  <ArtifactCard key={a.artifactId} artifact={a} compact onSelect={onSelect} />
                ))}
              </div>
            </div>
          )}

          <ArtifactActions artifact={artifact} onOpenPackage={onOpenPackage} onOpenComposition={onOpenComposition} onRegenerate={onRegenerate} />

          <ArtifactReviewControls
            review={review}
            onApprove={onApproveReview}
            onReject={onRejectReview}
            submitting={reviewSubmitting}
          />
        </div>
      </div>
    </div>
  );
}
