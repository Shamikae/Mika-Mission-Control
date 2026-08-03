import { useState } from 'react';
import { FiCheck, FiCheckCircle, FiRefreshCw, FiThumbsDown, FiXCircle } from 'react-icons/fi';

const MAX_NOTE_CHARS = 500;

// ── Output review controls — approve/reject a completed job's output.
// Server-managed (POST /api/production/jobs/[id]/review) — this component
// only ever calls the provided callbacks; it never mutates job state itself.
// Approving here never publishes anything — Publishing Router is a future,
// separate milestone.

export default function ArtifactReviewControls({ review, onApprove, onReject, submitting }) {
  const [note, setNote] = useState('');
  const [showRejectNote, setShowRejectNote] = useState(false);

  const status = review?.status || 'unreviewed';

  if (status === 'approved') {
    return (
      <div className="ov-review-block">
        <div className="pr-approved-flash font-mono"><FiCheckCircle size={12} /> Output approved{review.reviewedAt ? ` · ${new Date(review.reviewedAt).toLocaleString()}` : ''}</div>
        {review.note && <p className="pr-reason-text font-mono">{review.note}</p>}
      </div>
    );
  }
  if (status === 'rejected') {
    return (
      <div className="ov-review-block">
        <div className="pr-warning font-mono"><FiXCircle size={11} /> Output rejected{review.reviewedAt ? ` · ${new Date(review.reviewedAt).toLocaleString()}` : ''}</div>
        {review.note && <p className="pr-reason-text font-mono">{review.note}</p>}
      </div>
    );
  }

  return (
    <div className="ov-review-block">
      <span className="ov-meta-label font-ui">Output review</span>
      <div className="ov-review-actions">
        <button type="button" className="pr-btn pr-btn--approve font-ui" onClick={() => onApprove?.()} disabled={submitting}>
          {submitting ? <FiRefreshCw size={12} className="spin" /> : <FiCheck size={12} />} Approve Output
        </button>
        <button type="button" className="pr-btn pr-btn--reject font-ui" onClick={() => setShowRejectNote(v => !v)} disabled={submitting}>
          <FiThumbsDown size={12} /> Reject Output
        </button>
      </div>
      {showRejectNote && (
        <div className="ov-review-note-row">
          <textarea
            className="pr-input font-mono" rows={2} maxLength={MAX_NOTE_CHARS}
            placeholder="Reason for rejection (optional)…"
            value={note} onChange={e => setNote(e.target.value)}
          />
          <button
            type="button" className="pr-btn pr-btn--reject font-ui"
            onClick={() => onReject?.(note)} disabled={submitting}
          >
            {submitting ? <FiRefreshCw size={12} className="spin" /> : <FiThumbsDown size={12} />} Confirm Reject
          </button>
        </div>
      )}
    </div>
  );
}
