import { useState, useEffect, useCallback } from 'react';
import { FiAlertCircle, FiCheckCircle, FiDollarSign, FiRefreshCw, FiSave } from 'react-icons/fi';

// ── HyperFrames Setup panel ──────────────────────────────────────────────
// Rendered inside JobPanel only when job.selectedProvider === 'hyperframes'.
// Composition selection + optional render quality, persisted server-side
// via PATCH .../hyperframes-provider-input. Shows the confirmed (always
// real, never provisional) $0 local-compute cost — Queue/Run/Poll/Cancel/
// Retry remain the existing ExecutionPanel's job; this panel never itself
// starts a render. Unlike HeyGen/Higgsfield/OpenArt Video, HyperFrames
// genuinely supports cancellation (a real SIGTERM to the local render
// process) — the existing generic Cancel button already works correctly
// for it with no special-casing needed here.
//
// Deliberately NOT a duplicate of HyperFrames Studio: no lint/check/
// preview controls. This panel only selects an already-authored,
// already-lint/check-passing composition and hands it to the governed
// Production Router approval/enqueue/execution flow. Studio remains the
// advanced composition-development surface.

const QUALITY_VALUES = ['standard', 'high'];

export default function HyperFramesSetupPanel({ job, onSaved }) {
  const [status, setStatus] = useState(null);
  const [compositions, setCompositions] = useState([]);
  const [loadingCompositions, setLoadingCompositions] = useState(false);
  const [compositionsError, setCompositionsError] = useState(null);

  const providerInput = job.providerInput || {};
  const [compositionId, setCompositionId] = useState(providerInput.compositionId || '');
  const [quality, setQuality] = useState(providerInput.quality || 'standard');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [validation, setValidation] = useState(null);

  const [costPreview, setCostPreview] = useState(null);
  const [costError, setCostError] = useState(null);
  const [loadingCost, setLoadingCost] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/production/providers', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && data.ok) setStatus(data.providers?.find(p => p.id === 'hyperframes') || null);
    } catch { /* status stays null — panel renders the loading state */ }
  }, []);

  const loadCompositions = useCallback(async () => {
    setLoadingCompositions(true);
    setCompositionsError(null);
    try {
      const res = await fetch(`/api/production/jobs/${encodeURIComponent(job.id)}/hyperframes-provider-input`, { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && data.ok) setCompositions(data.compositions);
      else setCompositionsError(data.error || 'Could not load HyperFrames compositions.');
    } catch (e) {
      setCompositionsError(e.message);
    } finally {
      setLoadingCompositions(false);
    }
  }, [job.id]);

  useEffect(() => { loadStatus(); }, [loadStatus]);
  useEffect(() => { loadCompositions(); }, [loadCompositions]);

  const selectedComposition = compositions.find(c => c.id === compositionId);

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/production/jobs/${encodeURIComponent(job.id)}/hyperframes-provider-input`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ compositionId, quality }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setValidation(data.validation);
        onSaved?.(data.job);
      } else {
        setSaveError(data.error || 'Could not save HyperFrames setup.');
      }
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const previewCost = async () => {
    setLoadingCost(true);
    setCostError(null);
    setCostPreview(null);
    try {
      const res = await fetch(`/api/production/jobs/${encodeURIComponent(job.id)}/hyperframes-cost-preview`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.ok) setCostPreview(data.estimate);
      else setCostError(data.error || 'Could not preview cost.');
    } catch (e) {
      setCostError(e.message);
    } finally {
      setLoadingCost(false);
    }
  };

  return (
    <div className="pr-section pr-heygen-panel">
      <div className="pr-section-head">
        <span className="font-ui">HyperFrames Setup</span>
        <button type="button" className="thumb-icon-btn" onClick={() => { loadStatus(); loadCompositions(); }} title="Refresh">
          <FiRefreshCw size={11} />
        </button>
      </div>

      {status && (
        <div className="pr-exec-meta font-mono">
          <span>Status: {status.status}</span>
          <span>CLI: {status.executable ? 'Runnable' : 'Not runnable'}</span>
          <span>Compositions found: {compositions.length}</span>
        </div>
      )}

      {status && !status.executable && (
        <div className="pr-warning font-mono">
          <FiAlertCircle size={11} /> {status.error || 'HyperFrames is not currently usable — see status above.'}
        </div>
      )}

      <div className="pr-approved-flash font-mono">
        <FiCheckCircle size={12} /> Real cancellation is supported — Cancel (in the execution panel) sends an actual stop signal to the local render process, not a best-effort local-only marker.
      </div>

      {compositionsError && <div className="pr-warning font-mono"><FiAlertCircle size={11} /> {compositionsError}</div>}

      <div className="pr-field">
        <label className="pr-field-label font-ui">Composition</label>
        <div className="pr-provider-list">
          {loadingCompositions && <div className="thumb-empty font-mono">Loading compositions…</div>}
          {!loadingCompositions && compositions.length === 0 && <div className="thumb-empty font-mono">No compositions found under tools/hyperframes/.</div>}
          {compositions.map(c => (
            <button
              type="button" key={c.id}
              className={`pr-provider-item${compositionId === c.id ? ' pr-provider-item--selected' : ''}`}
              onClick={() => { setCompositionId(c.id); setCostPreview(null); }}
              style={{ textAlign: 'left', width: '100%' }}
            >
              <div className="pr-provider-item-top">
                <span className="font-ui">{c.name}</span>
                {compositionId === c.id && <span className="pr-provider-recommended-tag font-mono">selected</span>}
                {c.hasOutputMp4 && <span className="pr-provider-badge font-mono">previously rendered</span>}
              </div>
              <div className="pr-provider-reason font-mono">
                {c.metadata?.width && c.metadata?.height ? `${c.metadata.width}×${c.metadata.height}` : 'Dimensions unknown until rendered'}
                {c.metadata?.durationSeconds ? ` · ${c.metadata.durationSeconds}s` : ''}
                {c.metadata?.fps ? ` · ${c.metadata.fps}fps` : ''}
                {' · '}{c.relativePath}
              </div>
            </button>
          ))}
        </div>
      </div>

      {selectedComposition && (
        <div className="pr-exec-meta font-mono">
          <span>Output type: video/mp4</span>
          <span>Resolution: {selectedComposition.metadata?.width && selectedComposition.metadata?.height ? `${selectedComposition.metadata.width}×${selectedComposition.metadata.height}` : 'Unknown until rendered'}</span>
          <span>Duration: {selectedComposition.metadata?.durationSeconds ? `${selectedComposition.metadata.durationSeconds}s` : 'Unknown until rendered'}</span>
        </div>
      )}

      <div className="pr-field">
        <label className="pr-field-label font-ui">Quality</label>
        <select className="pr-select font-mono" value={quality} onChange={e => { setQuality(e.target.value); setCostPreview(null); }}>
          {QUALITY_VALUES.map(q => <option key={q} value={q}>{q}</option>)}
        </select>
      </div>

      <div className="pr-reason-text font-mono">
        This render uses local CPU/GPU time on this machine — no provider credits are charged.
      </div>

      {saveError && <div className="pr-warning font-mono"><FiAlertCircle size={11} /> {saveError}</div>}

      {validation && (
        <div className={validation.valid ? 'pr-approved-flash font-mono' : 'pr-warning font-mono'}>
          {validation.valid ? <FiCheckCircle size={12} /> : <FiAlertCircle size={11} />}
          {validation.valid ? ' HyperFrames setup is valid and ready.' : ` ${validation.errors.join(' ')}`}
        </div>
      )}

      <div className="pr-row-2">
        <button type="button" className="pr-btn pr-btn--approve font-ui" onClick={save} disabled={saving || !compositionId}>
          {saving ? <><FiRefreshCw size={12} className="spin" /> Saving…</> : <><FiSave size={12} /> Save HyperFrames Setup</>}
        </button>
        <button type="button" className="pr-btn font-ui" onClick={previewCost} disabled={loadingCost || !validation?.valid}>
          {loadingCost ? <><FiRefreshCw size={12} className="spin" /> Checking…</> : <><FiDollarSign size={12} /> Preview Cost</>}
        </button>
      </div>

      {costError && <div className="pr-warning font-mono"><FiAlertCircle size={11} /> {costError}</div>}
      {costPreview && (
        <div className="pr-approved-flash font-mono">
          <FiDollarSign size={11} /> {costPreview.note}
        </div>
      )}
    </div>
  );
}
