import { useState } from 'react';
import { FiAlertTriangle, FiCheckCircle, FiClock, FiExternalLink, FiRefreshCw, FiZap } from 'react-icons/fi';
import { useStore } from '../../lib/store';
import ArtifactGallery from '../ui/ArtifactGallery';
import FusionReviewPanel from './FusionReviewPanel';

const LANES = [
  { id: 'digital-diamond', label: 'Digital Diamond AI' },
  { id: 'managed-by-mika', label: 'Managed by Mika'    },
  { id: 'medai',           label: 'MedAI'               },
  { id: 'cannaops',        label: 'CannaOps'            },
  { id: 'hotel-hooker',    label: 'The Hotel Hooker'    },
  { id: 'ai-twin',         label: 'AI Twin Studio'      },
];

const PLATFORMS     = ['TikTok', 'Instagram', 'YouTube Shorts', 'LinkedIn', 'Blog'];
const CONTENT_TYPES = ['educational', 'trend', 'tutorial', 'UGC', 'offer', 'story', 'listicle'];
const GOALS         = ['awareness', 'engagement', 'lead', 'sale', 'authority'];

const GOAL_LABELS = {
  awareness:  'Brand Awareness',
  engagement: 'Engagement',
  lead:       'Lead Generation',
  sale:       'Sale / CTA',
  authority:  'Authority',
};

const NEXT_ACTION_META = {
  READY_TO_DISPATCH:  { icon: <FiCheckCircle size={11} />,   cls: 'cfp-action--run',      label: 'ready to dispatch' },
  AWAIT_APPROVAL:     { icon: <FiAlertTriangle size={11} />, cls: 'cfp-action--approval', label: 'needs approval'    },
  STAGED_DISPLAY_ONLY:{ icon: <FiClock size={11} />,         cls: 'cfp-action--staged',   label: 'staged'            },
  MANUAL_REVIEW:      { icon: <FiAlertTriangle size={11} />, cls: 'cfp-action--staged',   label: 'manual review'     },
};

function ActionBadge({ nextAction }) {
  const meta = NEXT_ACTION_META[nextAction] || NEXT_ACTION_META.MANUAL_REVIEW;
  return (
    <span className={`cfp-action-badge ${meta.cls} font-mono`}>
      {meta.icon}
      {meta.label}
    </span>
  );
}

function PillGroup({ options, value, onChange, labels = {} }) {
  return (
    <div className="cfp-pills">
      {options.map(opt => (
        <button
          key={opt}
          type="button"
          className={`cfp-pill font-ui${value === opt ? ' cfp-pill--active' : ''}`}
          onClick={() => onChange(opt)}
        >
          {labels[opt] || opt}
        </button>
      ))}
    </div>
  );
}

function ResultView({ result, onReset }) {
  const { setActiveSection } = useStore();
  const { packageId, tasks, dispatchPreviews, approvalSummary } = result;
  const [showFusion, setShowFusion] = useState(false);

  const fusionContext = `Content Factory Package: ${packageId}\nPlatform: ${tasks[0]?.platform || ''}\nGoal: ${tasks[0]?.contentGoal || ''}\nLane: ${tasks[0]?.lane || ''}`;
  const fusionContent = tasks.map((t, i) =>
    `${String(i + 1).padStart(2, '0')}. ${t.stepLabel} (${t.taskType})\n${t.description.split('\n').slice(0, 4).join('\n')}`
  ).join('\n\n');

  return (
    <div className="cfp-wrapper">
      <div className="cfp-result panel-gold">
        <div className="cfp-result-head">
          <div>
            <h3 className="cfp-result-title font-display">Package Created</h3>
            <code className="cfp-pkg-id font-mono">{packageId}</code>
          </div>
          <button type="button" className="cfp-reset-btn font-ui" onClick={onReset}>
            <FiRefreshCw size={12} />
            New package
          </button>
        </div>

        <div className="cfp-summary-bar">
          <span className="cfp-summary-stat cfp-summary-stat--run font-mono">
            <FiCheckCircle size={11} />
            {approvalSummary.executableNow} executable
          </span>
          <span className="cfp-summary-stat cfp-summary-stat--approval font-mono">
            <FiAlertTriangle size={11} />
            {approvalSummary.requiresApproval} need approval
          </span>
          <span className="cfp-summary-stat cfp-summary-stat--staged font-mono">
            <FiClock size={11} />
            {approvalSummary.staged} staged
          </span>
        </div>

        <div className="cfp-step-list">
          {tasks.map((task, i) => {
            const preview = dispatchPreviews?.[task.id] || {};
            return (
              <div key={task.id} className="cfp-step-row">
                <span className="cfp-step-num font-mono">{String(i + 1).padStart(2, '0')}</span>
                <div className="cfp-step-info">
                  <strong className="cfp-step-label">{task.stepLabel}</strong>
                  <span className="cfp-step-type font-mono">{task.taskType}</span>
                </div>
                <span className="cfp-step-agent font-mono">
                  {preview.selectedAgent?.id || '—'}
                </span>
                <ActionBadge nextAction={preview.nextAction} />
              </div>
            );
          })}
        </div>

        <div className="cfp-result-actions">
          <button
            type="button"
            className="cfp-pipeline-btn font-ui"
            onClick={() => setActiveSection('pipeline')}
          >
            <FiExternalLink size={12} />
            View in Pipeline
          </button>
          <button
            type="button"
            className="cfp-fusion-toggle font-ui"
            onClick={() => setShowFusion(prev => !prev)}
          >
            <FiZap size={12} />
            {showFusion ? 'Hide Fusion Review' : 'Fusion Review'}
          </button>
        </div>

        {showFusion && (
          <div className="cfp-fusion-section">
            <FusionReviewPanel
              initialReviewType="content-factory"
              initialContext={fusionContext}
              initialContent={fusionContent}
            />
          </div>
        )}
      </div>

      <div className="cfp-gallery-section">
        <p className="cfp-gallery-label font-ui">Content Factory Outputs</p>
        <ArtifactGallery limit={6} />
      </div>
    </div>
  );
}

export default function ContentFactoryPackage() {
  const [lane,        setLane]        = useState('digital-diamond');
  const [platform,    setPlatform]    = useState('');
  const [contentType, setContentType] = useState('');
  const [topic,       setTopic]       = useState('');
  const [audience,    setAudience]    = useState('');
  const [goal,        setGoal]        = useState('');
  const [tone,        setTone]        = useState('');
  const [notes,       setNotes]       = useState('');

  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [result,  setResult]  = useState(null);

  const canSubmit = lane && platform && contentType && topic.trim() && audience.trim() && goal && tone.trim() && !loading;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/content/factory/create-package', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          lane,
          platform,
          contentType,
          topic:    topic.trim(),
          audience: audience.trim(),
          goal,
          tone:     tone.trim(),
          notes:    notes.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `Error ${res.status}`);
        return;
      }
      setResult(data);
    } catch (err) {
      setError(err.message || 'Network error — please retry.');
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setResult(null);
    setError(null);
    setTopic('');
    setAudience('');
    setTone('');
    setNotes('');
  }

  if (result) {
    return <ResultView result={result} onReset={handleReset} />;
  }

  return (
    <div className="cfp-wrapper">
      <form className="cfp-form panel-gold" onSubmit={handleSubmit}>
        <h3 className="cfp-form-title font-display">Content Factory Package</h3>
        <p className="cfp-form-sub font-ui">One topic. Nine governed outputs. Ready for dispatch.</p>

        <div className="cfp-field">
          <label className="cfp-label font-ui">Brand lane</label>
          <select
            className="cfp-select font-mono"
            value={lane}
            onChange={e => setLane(e.target.value)}
          >
            {LANES.map(l => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
        </div>

        <div className="cfp-field">
          <label className="cfp-label font-ui">
            Topic / Content idea <span className="cfp-required">*</span>
          </label>
          <textarea
            className="cfp-textarea font-body"
            rows={3}
            maxLength={500}
            placeholder="E.g. How to build a personal brand as a healthcare professional in 2026…"
            value={topic}
            onChange={e => setTopic(e.target.value)}
          />
          <span className="cfp-char-count font-mono">{topic.length}/500</span>
        </div>

        <div className="cfp-field">
          <label className="cfp-label font-ui">Platform <span className="cfp-required">*</span></label>
          <PillGroup options={PLATFORMS} value={platform} onChange={setPlatform} />
        </div>

        <div className="cfp-field">
          <label className="cfp-label font-ui">Content type <span className="cfp-required">*</span></label>
          <PillGroup options={CONTENT_TYPES} value={contentType} onChange={setContentType} />
        </div>

        <div className="cfp-field">
          <label className="cfp-label font-ui">
            Target audience <span className="cfp-required">*</span>
          </label>
          <input
            type="text"
            className="cfp-input font-body"
            placeholder="E.g. Female founders aged 28–45 building service businesses"
            maxLength={200}
            value={audience}
            onChange={e => setAudience(e.target.value)}
          />
        </div>

        <div className="cfp-field">
          <label className="cfp-label font-ui">Goal <span className="cfp-required">*</span></label>
          <PillGroup options={GOALS} value={goal} onChange={setGoal} labels={GOAL_LABELS} />
        </div>

        <div className="cfp-field">
          <label className="cfp-label font-ui">
            Tone of voice <span className="cfp-required">*</span>
          </label>
          <input
            type="text"
            className="cfp-input font-body"
            placeholder="E.g. bold and conversational, or calm and educational"
            maxLength={100}
            value={tone}
            onChange={e => setTone(e.target.value)}
          />
        </div>

        <div className="cfp-field">
          <label className="cfp-label font-ui">
            Notes <span className="cfp-optional">(optional)</span>
          </label>
          <textarea
            className="cfp-textarea cfp-textarea--sm font-body"
            rows={2}
            maxLength={300}
            placeholder="Any additional context, constraints, or creative direction…"
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>

        {error && (
          <div className="cfp-error">
            <FiAlertTriangle size={13} />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="cfp-submit-btn font-ui"
        >
          {loading
            ? <><FiRefreshCw size={13} className="spin" /> Building package…</>
            : 'Generate 9-output package →'}
        </button>

        <p className="cfp-dispatch-note font-mono">
          All outputs are routed through existing dispatch governance. No providers are called directly.
        </p>
      </form>

      <div className="cfp-gallery-section">
        <p className="cfp-gallery-label font-ui">Recent factory packages</p>
        <ArtifactGallery limit={4} />
      </div>
    </div>
  );
}
