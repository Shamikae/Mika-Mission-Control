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

  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState(null);
  const [translation, setTranslation] = useState(null);
  const [narrationInfo, setNarrationInfo] = useState(null);
  const [narrationPreview, setNarrationPreview] = useState(null);
  const [voiceId, setVoiceId] = useState('Samantha');
  const [withNarration, setWithNarration] = useState(true);

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
      if (res.ok && data.ok) { setCompositions(data.compositions); setNarrationPreview(data.narration || null); }
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

  // Additive: builds this job's URS from its Content Package and generates a
  // deterministic composition, then selects it. Manual selection below is
  // untouched — this only removes the need to hand-author one first.
  const generateFromPackage = async () => {
    setGenerating(true); setGenerateError(null); setTranslation(null);
    try {
      const res = await fetch(`/api/production/jobs/${encodeURIComponent(job.id)}/hyperframes-provider-input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ narration: withNarration, voiceId }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setTranslation(data.translation);
        setNarrationInfo(data.narration || null);
        setCompositionId(data.translation.compositionId);
        setValidation(data.validation || null);
        setCostPreview(null);
        await loadCompositions();
        if (onSaved) onSaved(data.job);
      } else {
        setGenerateError(data.error || 'Could not generate a composition from this package.');
        if (data.narration) setNarrationInfo(data.narration);
      }
    } catch {
      setGenerateError('Could not reach the generation endpoint.');
    } finally {
      setGenerating(false);
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
        <label className="pr-field-label font-ui">Generate from package</label>

        {narrationPreview && (
          <div className="pr-exec-meta font-mono">
            <span>Narration: {narrationPreview.available ? 'available' : 'none'}</span>
            {narrationPreview.available && <span>{narrationPreview.characterCount} chars</span>}
            {narrationPreview.available && <span>Timeline: {narrationPreview.timelineDurationSeconds}s</span>}
            <span>Provider: {narrationPreview.estimatedCost?.provider}</span>
            <span>Est. cost: ${narrationPreview.estimatedCost?.amountUsd ?? 0} ({narrationPreview.estimatedCost?.estimateType})</span>
          </div>
        )}

        {narrationPreview?.available && (
          <div className="pr-exec-meta font-mono" style={{ gap: 10, alignItems: 'center' }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={withNarration} onChange={e => setWithNarration(e.target.checked)} />
              Generate narration
            </label>
            <select value={voiceId} onChange={e => setVoiceId(e.target.value)} disabled={!withNarration}>
              {(narrationPreview.voices || []).map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </div>
        )}

        <button
          type="button"
          className="thumb-btn"
          onClick={generateFromPackage}
          disabled={generating}
          style={{ width: '100%' }}
        >
          {generating ? 'Generating…' : 'Generate composition from package'}
        </button>
        <div className="pr-reason-text font-mono">
          Builds a Universal Render Specification from this job&apos;s Content Package and translates it into a
          deterministic composition under the reserved <code>generated-</code> namespace. Hand-authored compositions are never modified.
        </div>

        {generateError && <div className="pr-warning font-mono"><FiAlertCircle size={11} /> {generateError}</div>}

        {translation && (
          <>
            <div className="pr-approved-flash font-mono">
              <FiCheckCircle size={12} /> {translation.reused ? 'Reused existing generated composition' : 'Generated composition'} — {translation.compositionId}
            </div>
            <div className="pr-exec-meta font-mono">
              <span>Completeness: {translation.report?.completeness}%</span>
              <span>Consumed: {translation.report?.consumedFields?.length ?? 0}</span>
              <span>Degraded: {translation.report?.degradedFields?.length ?? 0}</span>
              <span>Ignored: {translation.report?.ignoredFields?.length ?? 0}</span>
            </div>
            <div className="pr-exec-meta font-mono">
              <span>Scenes: {translation.sceneCount}</span>
              <span>Duration: {translation.totalDurationSeconds}s</span>
              <span>URS: v{translation.ursVersion}</span>
            </div>
            {narrationInfo?.available && (
              <div className="pr-exec-meta font-mono">
                <span>Voice: {narrationInfo.voiceId}</span>
                <span>Audio: {narrationInfo.audioDurationSeconds}s</span>
                <span>Fit: {narrationInfo.timingFit}</span>
                <span>Variance: {narrationInfo.varianceSeconds}s</span>
                <span>Cost: ${narrationInfo.actualCost?.amountUsd ?? 0}</span>
                {narrationInfo.reused && <span>(reused)</span>}
              </div>
            )}
            {narrationInfo?.available === false && (
              <div className="pr-reason-text font-mono">Narration: {narrationInfo.reason}</div>
            )}
            {(narrationInfo?.warnings || []).length > 0 && (
              <div className="pr-reason-text font-mono">
                {narrationInfo.warnings.map((w, i) => <div key={i}>• {w}</div>)}
              </div>
            )}
            {(translation.report?.warnings || []).length > 0 && (
              <div className="pr-reason-text font-mono">
                {translation.report.warnings.map((w, i) => (
                  <div key={i}>• {w}</div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

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
