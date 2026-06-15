import { useState } from 'react';
import {
  FiAlertTriangle,
  FiCheckCircle,
  FiEye,
  FiInfo,
  FiRefreshCw,
  FiZap,
} from 'react-icons/fi';

const REVIEW_TYPES = [
  { id: 'content-factory', label: 'Content Package' },
  { id: 'script',          label: 'Script Critique'  },
  { id: 'boardroom',       label: 'Strategy Review'  },
  { id: 'offer-strategy',  label: 'Offer Strategy'   },
  { id: 'pipeline-stage',  label: 'Pipeline Stage'   },
];

function ListSection({ heading, items, icon }) {
  if (!items?.length) return null;
  return (
    <div className="fusion-list-section">
      <h4 className="fusion-list-heading font-ui">
        {icon} {heading}
      </h4>
      <ul className="fusion-list">
        {items.map((item, i) => (
          <li key={i} className="fusion-list-item">{item}</li>
        ))}
      </ul>
    </div>
  );
}

function FusionResult({ result, onReset }) {
  return (
    <div className="fusion-result">
      <div className="fusion-result-bar">
        <span className="fusion-result-model font-mono">
          <FiZap size={11} />
          {result.model}
          {result.tokensUsed ? ` · ${result.tokensUsed.toLocaleString()} tokens` : ''}
        </span>
        <button type="button" className="fusion-reset-btn font-ui" onClick={onReset}>
          <FiRefreshCw size={11} /> New review
        </button>
      </div>

      <div className="fusion-consensus-box">
        <h4 className="fusion-consensus-label font-ui">
          <FiCheckCircle size={12} /> Consensus
        </h4>
        <p className="fusion-consensus-text">{result.consensus}</p>
      </div>

      <div className="fusion-lists-grid">
        <ListSection heading="Contradictions" items={result.contradictions} icon="⚡" />
        <ListSection heading="Blind spots"    items={result.blindSpots}     icon="🔍" />
        <ListSection heading="Unique insights" items={result.uniqueInsights} icon="💡" />
      </div>

      <div className="fusion-recommendation-box">
        <h4 className="fusion-recommendation-label font-ui">
          <FiEye size={12} /> Recommendation
        </h4>
        <p className="fusion-recommendation-text">{result.recommendation}</p>
      </div>
    </div>
  );
}

/**
 * FusionReviewPanel
 *
 * Embeddable panel for requesting an OpenRouter Fusion multi-model synthesis review.
 *
 * @param {object} props
 * @param {string}  [props.initialReviewType='content-factory'] — pre-select review type
 * @param {string}  [props.initialContext='']  — pre-fill context textarea
 * @param {string}  [props.initialContent='']  — pre-fill content textarea
 */
export default function FusionReviewPanel({
  initialReviewType = 'content-factory',
  initialContext    = '',
  initialContent    = '',
}) {
  const [reviewType,   setReviewType]   = useState(initialReviewType);
  const [context,      setContext]      = useState(initialContext);
  const [content,      setContent]      = useState(initialContent);
  const [costAcked,    setCostAcked]    = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [result,       setResult]       = useState(null);
  const [error,        setError]        = useState(null);
  const [configPending, setConfigPending] = useState(false);

  const canSubmit = reviewType && context.trim() && content.trim() && costAcked && !loading;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;

    setLoading(true);
    setError(null);
    setConfigPending(false);

    try {
      const res = await fetch('/api/openrouter/fusion/review', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          reviewType,
          context: context.trim(),
          content: content.trim(),
        }),
      });

      const data = await res.json();

      if (data.status === 'configuration_pending') {
        setConfigPending(true);
        return;
      }

      if (!data.ok) {
        setError(data.message || data.error || `Error: ${res.status}`);
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
    setConfigPending(false);
  }

  if (result) {
    return <FusionResult result={result} onReset={handleReset} />;
  }

  return (
    <form className="fusion-panel" onSubmit={handleSubmit}>
      <div className="fusion-header">
        <span className="fusion-title font-ui">
          <FiZap size={13} /> Fusion Review
        </span>
        <span className="fusion-subtitle font-mono">
          Multi-model synthesis · openrouter/fusion
        </span>
      </div>

      {/* Review type selector */}
      <div className="fusion-field">
        <label className="fusion-label font-ui">Review type</label>
        <div className="fusion-type-pills">
          {REVIEW_TYPES.map(rt => (
            <button
              key={rt.id}
              type="button"
              className={`fusion-type-btn font-ui${reviewType === rt.id ? ' fusion-type-btn--active' : ''}`}
              onClick={() => setReviewType(rt.id)}
            >
              {rt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Context */}
      <div className="fusion-field">
        <label className="fusion-label font-ui">
          Context <span className="fusion-required">*</span>
          <span className="fusion-field-hint">What are you reviewing and why?</span>
        </label>
        <textarea
          className="fusion-textarea font-body"
          rows={2}
          maxLength={2000}
          placeholder="E.g. Content Factory Package for Digital Diamond AI — TikTok educational series on AI tools"
          value={context}
          onChange={e => setContext(e.target.value)}
        />
        <span className="fusion-char-count font-mono">{context.length}/2000</span>
      </div>

      {/* Content */}
      <div className="fusion-field">
        <label className="fusion-label font-ui">
          Content to review <span className="fusion-required">*</span>
          <span className="fusion-field-hint">Paste the script, package summary, strategy, or offer details</span>
        </label>
        <textarea
          className="fusion-textarea fusion-textarea--tall font-body"
          rows={6}
          maxLength={8000}
          placeholder="Paste the content, package output, script, strategy document, or offer details here…"
          value={content}
          onChange={e => setContent(e.target.value)}
        />
        <span className="fusion-char-count font-mono">{content.length}/8000</span>
      </div>

      {/* Cost gate */}
      <label className="fusion-cost-gate">
        <input
          type="checkbox"
          checked={costAcked}
          onChange={e => setCostAcked(e.target.checked)}
        />
        <FiInfo size={12} />
        <span>
          I understand this calls OpenRouter Fusion (paid API) and may incur token cost.
          API key must be configured in <code>.env.local</code>.
        </span>
      </label>

      {/* Errors */}
      {error && (
        <div className="fusion-error">
          <FiAlertTriangle size={13} />
          <span>{error}</span>
        </div>
      )}

      {/* Config pending */}
      {configPending && (
        <div className="fusion-config-pending">
          <FiInfo size={13} />
          <div>
            <strong>OpenRouter Fusion is not configured.</strong>
            <p>
              Add <code>OPENROUTER_ENABLED=true</code>, <code>OPENROUTER_API_KEY</code>,
              and <code>OPENROUTER_FUSION_ENABLED=true</code> to your <code>.env.local</code> file,
              then restart the dev server.
            </p>
          </div>
        </div>
      )}

      <button type="submit" disabled={!canSubmit} className="fusion-submit-btn font-ui">
        {loading
          ? <><FiRefreshCw size={13} className="spin" /> Synthesising…</>
          : <><FiZap size={13} /> Run Fusion Review</>}
      </button>
    </form>
  );
}
