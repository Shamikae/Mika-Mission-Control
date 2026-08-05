import { useState, useEffect, useCallback } from 'react';
import { FiAlertCircle, FiCheckCircle, FiDollarSign, FiRefreshCw, FiSave } from 'react-icons/fi';

// ── Higgsfield Setup panel ───────────────────────────────────────────────
// Rendered inside JobPanel only when job.selectedProvider === 'higgsfield-mcp'.
// Media type + model + prompt selection, all persisted server-side via
// PATCH .../higgsfield-provider-input. Shows a REAL, non-generating cost
// preview (get_cost) before any submission — Queue/Run/Poll/Cancel/Retry
// remain the existing ExecutionPanel's job; this panel never itself submits
// a generation. No generation is possible until required inputs are saved
// and the job's own existing approval gate is completed.

const MAX_PROMPT_CHARS = 2000;

export default function HiggsfieldSetupPanel({ job, pkg, onSaved }) {
  const [status, setStatus] = useState(null);
  const [models, setModels] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState(null);

  const providerInput = job.providerInput || {};
  const [mediaType, setMediaType] = useState(providerInput.mediaType || 'image');
  const [model, setModel] = useState(providerInput.model || '');
  const [prompt, setPrompt] = useState(providerInput.prompt || '');
  const [aspectRatio, setAspectRatio] = useState(providerInput.aspectRatio || '');
  const [durationSeconds, setDurationSeconds] = useState(providerInput.durationSeconds ?? '');
  const [useUnlim, setUseUnlim] = useState(providerInput.useUnlim ?? null);
  const [testMode, setTestMode] = useState(!!providerInput.testMode);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [validation, setValidation] = useState(null);

  const [costPreview, setCostPreview] = useState(null);
  const [costError, setCostError] = useState(null);
  const [loadingCost, setLoadingCost] = useState(false);

  const loadStatus = useCallback(async () => {
    const res = await fetch('/api/production/providers/higgsfield/status', { cache: 'no-store' }).catch(() => null);
    if (res?.ok) setStatus(await res.json());
  }, []);

  const loadModels = useCallback(async (type) => {
    setLoadingModels(true);
    setModelsError(null);
    try {
      const res = await fetch(`/api/production/providers/higgsfield/models?type=${encodeURIComponent(type)}`, { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && data.ok) setModels(data.models);
      else setModelsError(data.error || 'Could not load Higgsfield model catalog.');
    } catch (e) {
      setModelsError(e.message);
    } finally {
      setLoadingModels(false);
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);
  useEffect(() => { loadModels(mediaType); setModel(''); setCostPreview(null); }, [mediaType]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedModel = models.find(m => m.id === model);
  const scriptFromPackage = (pkg?.script?.fullText || '').trim();

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const body = {
        mediaType, model, prompt, testMode,
        aspectRatio: aspectRatio || null,
        durationSeconds: mediaType === 'video' && durationSeconds !== '' ? Number(durationSeconds) : null,
        useUnlim,
      };
      const res = await fetch(`/api/production/jobs/${encodeURIComponent(job.id)}/higgsfield-provider-input`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setValidation(data.validation);
        onSaved?.(data.job);
      } else {
        setSaveError(data.error || 'Could not save Higgsfield setup.');
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
      const res = await fetch(`/api/production/jobs/${encodeURIComponent(job.id)}/higgsfield-cost-preview`, { method: 'POST' });
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
        <span className="font-ui">Higgsfield Setup</span>
        <button type="button" className="thumb-icon-btn" onClick={() => { loadStatus(); loadModels(mediaType); }} title="Refresh">
          <FiRefreshCw size={11} />
        </button>
      </div>

      {status && (
        <div className="pr-exec-meta font-mono">
          <span>Connection: {status.status}</span>
          <span>Plan: {status.accountSummary?.planName || 'Not reported'}</span>
          <span>Credits: {status.accountSummary?.remainingCredits != null ? status.accountSummary.remainingCredits : 'Not reported'}</span>
        </div>
      )}

      {status?.status !== 'connected' && (
        <div className="pr-warning font-mono">
          <FiAlertCircle size={11} /> Higgsfield must be connected (see the Higgsfield (MCP) Connection panel) before setup can be completed.
        </div>
      )}

      {modelsError && <div className="pr-warning font-mono"><FiAlertCircle size={11} /> {modelsError}</div>}

      <div className="pr-warning font-mono">
        <FiAlertCircle size={11} /> Higgsfield has no cancellation tool — a submitted generation cannot be stopped once started and may consume credits even if marked cancelled locally.
      </div>

      <div className="pr-field">
        <label className="pr-field-label font-ui">Media type</label>
        <div className="pr-row-2">
          <button type="button" className={`pr-btn font-ui${mediaType === 'image' ? ' pr-btn--approve' : ''}`} onClick={() => setMediaType('image')}>Image</button>
          <button type="button" className={`pr-btn font-ui${mediaType === 'video' ? ' pr-btn--approve' : ''}`} onClick={() => setMediaType('video')}>Video</button>
        </div>
      </div>

      <div className="pr-field">
        <label className="pr-field-label font-ui">Model</label>
        <div className="pr-provider-list">
          {loadingModels && <div className="thumb-empty font-mono">Loading models…</div>}
          {!loadingModels && models.length === 0 && <div className="thumb-empty font-mono">No models found.</div>}
          {models.map(m => (
            <button
              type="button" key={m.id}
              className={`pr-provider-item${model === m.id ? ' pr-provider-item--selected' : ''}`}
              onClick={() => { setModel(m.id); setAspectRatio(''); setCostPreview(null); }}
              style={{ textAlign: 'left', width: '100%' }}
            >
              <div className="pr-provider-item-top">
                <span className="font-ui">{m.name}</span>
                {model === m.id && <span className="pr-provider-recommended-tag font-mono">selected</span>}
                {m.supportsUnlim && <span className="pr-provider-badge font-mono">free-trial eligible</span>}
                {m.providerName && <span className="pr-provider-badge font-mono">{m.providerName}</span>}
              </div>
              <div className="pr-provider-reason font-mono">{m.description}</div>
            </button>
          ))}
        </div>
      </div>

      {selectedModel && (
        <div className="pr-field">
          <label className="pr-field-label font-ui">Aspect ratio</label>
          <select className="pr-select font-mono" value={aspectRatio} onChange={e => { setAspectRatio(e.target.value); setCostPreview(null); }}>
            <option value="">Model default</option>
            {selectedModel.aspectRatios.map(ar => <option key={ar} value={ar}>{ar}</option>)}
          </select>
        </div>
      )}

      {mediaType === 'video' && selectedModel?.durationParam && (
        <div className="pr-field">
          <label className="pr-field-label font-ui">
            Duration seconds ({selectedModel.durationParam.min ?? selectedModel.durationParam.options?.[0] ?? 1}–{selectedModel.durationParam.max ?? selectedModel.durationParam.options?.slice(-1)[0] ?? 30}, default {selectedModel.durationParam.default})
          </label>
          <input
            type="number" className="pr-input font-mono" placeholder={String(selectedModel.durationParam.default || '')}
            min={selectedModel.durationParam.min ?? 1} max={selectedModel.durationParam.max ?? 30}
            value={durationSeconds} onChange={e => { setDurationSeconds(e.target.value); setCostPreview(null); }}
          />
        </div>
      )}

      <div className="pr-field">
        <label className="pr-field-label font-ui">Prompt</label>
        <textarea
          className="pr-input font-mono" rows={3} maxLength={MAX_PROMPT_CHARS}
          value={prompt} onChange={e => { setPrompt(e.target.value); setCostPreview(null); }}
          placeholder={scriptFromPackage ? 'Describe the visual — the package script is not auto-sent to Higgsfield.' : 'Describe what to generate…'}
        />
        <div className="pr-field-hint font-mono">{prompt.length} / {MAX_PROMPT_CHARS} characters</div>
      </div>

      {selectedModel?.supportsUnlim && (
        <div className="pr-field">
          <label className="pr-field-label font-ui">Billing</label>
          <select className="pr-select font-mono" value={useUnlim === null ? '' : String(useUnlim)} onChange={e => setUseUnlim(e.target.value === '' ? null : e.target.value === 'true')}>
            <option value="">Let Higgsfield decide</option>
            <option value="true">Use free-trial unlimited allowance</option>
            <option value="false">Use account credits</option>
          </select>
        </div>
      )}

      <div className="pr-field">
        <label className="pr-field-label font-ui">
          <input type="checkbox" checked={testMode} onChange={e => setTestMode(e.target.checked)} /> Mark as test submission
        </label>
        <div className="pr-field-hint font-mono">Local bookkeeping only — Higgsfield has no sandbox/test mode; a real generation still runs and consumes real credits (or the free-trial allowance).</div>
      </div>

      {saveError && <div className="pr-warning font-mono"><FiAlertCircle size={11} /> {saveError}</div>}

      {validation && (
        <div className={validation.valid ? 'pr-approved-flash font-mono' : 'pr-warning font-mono'}>
          {validation.valid ? <FiCheckCircle size={12} /> : <FiAlertCircle size={11} />}
          {validation.valid ? ' Higgsfield setup is valid and ready.' : ` ${validation.errors.join(' ')}`}
        </div>
      )}

      <div className="pr-row-2">
        <button type="button" className="pr-btn pr-btn--approve font-ui" onClick={save} disabled={saving || !model || !prompt.trim()}>
          {saving ? <><FiRefreshCw size={12} className="spin" /> Saving…</> : <><FiSave size={12} /> Save Higgsfield Setup</>}
        </button>
        <button type="button" className="pr-btn font-ui" onClick={previewCost} disabled={loadingCost || !validation?.valid}>
          {loadingCost ? <><FiRefreshCw size={12} className="spin" /> Checking…</> : <><FiDollarSign size={12} /> Preview Cost</>}
        </button>
      </div>

      {costError && <div className="pr-warning font-mono"><FiAlertCircle size={11} /> {costError}</div>}
      {costPreview && (
        <div className={costPreview.provisional ? 'pr-warning font-mono' : 'pr-approved-flash font-mono'}>
          <FiDollarSign size={11} /> {costPreview.note}
        </div>
      )}
    </div>
  );
}
