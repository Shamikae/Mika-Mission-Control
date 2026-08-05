import { useState, useEffect, useCallback } from 'react';
import { FiAlertCircle, FiCheckCircle, FiDollarSign, FiRefreshCw, FiSave } from 'react-icons/fi';

// ── OpenArt Video Setup panel ────────────────────────────────────────────
// Rendered inside JobPanel only when job.selectedProvider === 'openart-video'.
// Model + prompt + duration/aspectRatio/resolution selection, all persisted
// server-side via PATCH .../openart-video-provider-input. Shows a REAL,
// non-generating cost preview (openart_model_cost) before any submission —
// Queue/Run/Poll/Cancel/Retry remain the existing ExecutionPanel's job;
// this panel never itself submits a generation. text2video only in this
// checkpoint — models whose form uses a multi-variant schema
// (image2video/element2video style selection) are shown but disabled, with
// an honest reason, rather than hidden or silently allowed to fail later.

const MAX_PROMPT_CHARS = 2000;

export default function OpenArtVideoSetupPanel({ job, pkg, onSaved }) {
  const [models, setModels] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState(null);

  const providerInput = job.providerInput || {};
  const [model, setModel] = useState(providerInput.model || '');
  const [prompt, setPrompt] = useState(providerInput.prompt || '');
  const [aspectRatio, setAspectRatio] = useState(providerInput.aspectRatio || '');
  const [durationSeconds, setDurationSeconds] = useState(providerInput.durationSeconds ?? '');
  const [resolution, setResolution] = useState(providerInput.resolution || '');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [validation, setValidation] = useState(null);

  const [costPreview, setCostPreview] = useState(null);
  const [costError, setCostError] = useState(null);
  const [loadingCost, setLoadingCost] = useState(false);

  const loadModels = useCallback(async () => {
    setLoadingModels(true);
    setModelsError(null);
    try {
      const res = await fetch('/api/production/providers/openart-video/models', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && data.ok) setModels(data.models);
      else setModelsError(data.error || 'Could not load the OpenArt video model catalog.');
    } catch (e) {
      setModelsError(e.message);
    } finally {
      setLoadingModels(false);
    }
  }, []);

  useEffect(() => { loadModels(); }, [loadModels]);

  const selectedModel = models.find(m => m.id === model);
  const scriptFromPackage = (pkg?.script?.fullText || '').trim();

  const selectModel = (m) => {
    if (!m.supported) return;
    setModel(m.id);
    setAspectRatio(m.defaultAspectRatio || '');
    setDurationSeconds(m.duration?.default ?? '');
    setResolution(m.defaultResolution || '');
    setCostPreview(null);
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const body = {
        model, prompt,
        aspectRatio: aspectRatio || null,
        durationSeconds: durationSeconds !== '' ? Number(durationSeconds) : null,
        resolution: resolution || null,
      };
      const res = await fetch(`/api/production/jobs/${encodeURIComponent(job.id)}/openart-video-provider-input`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setValidation(data.validation);
        onSaved?.(data.job);
      } else {
        setSaveError(data.error || 'Could not save OpenArt Video setup.');
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
      const res = await fetch(`/api/production/jobs/${encodeURIComponent(job.id)}/openart-video-cost-preview`, { method: 'POST' });
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
        <span className="font-ui">OpenArt Video Setup</span>
        <button type="button" className="thumb-icon-btn" onClick={loadModels} title="Refresh">
          <FiRefreshCw size={11} />
        </button>
      </div>

      <div className="pr-warning font-mono">
        <FiAlertCircle size={11} /> OpenArt has no cancellation tool for video — a submitted generation cannot be stopped once started and may consume credits even if marked cancelled locally.
      </div>

      {modelsError && <div className="pr-warning font-mono"><FiAlertCircle size={11} /> {modelsError}</div>}

      <div className="pr-field">
        <label className="pr-field-label font-ui">Model (text-to-video only)</label>
        <div className="pr-provider-list">
          {loadingModels && <div className="thumb-empty font-mono">Loading models…</div>}
          {!loadingModels && models.length === 0 && <div className="thumb-empty font-mono">No models found.</div>}
          {models.map(m => (
            <button
              type="button" key={m.id}
              className={`pr-provider-item${model === m.id ? ' pr-provider-item--selected' : ''}`}
              onClick={() => selectModel(m)}
              disabled={!m.supported}
              style={{ textAlign: 'left', width: '100%', opacity: m.supported ? 1 : 0.5, cursor: m.supported ? 'pointer' : 'not-allowed' }}
            >
              <div className="pr-provider-item-top">
                <span className="font-ui">{m.displayName}</span>
                {model === m.id && <span className="pr-provider-recommended-tag font-mono">selected</span>}
                {!m.supported && <span className="pr-provider-badge font-mono">not supported yet</span>}
              </div>
              <div className="pr-provider-reason font-mono">{m.supported ? m.description : m.unsupportedReason}</div>
            </button>
          ))}
        </div>
      </div>

      {selectedModel && (
        <>
          <div className="pr-field">
            <label className="pr-field-label font-ui">Aspect ratio</label>
            <select className="pr-select font-mono" value={aspectRatio} onChange={e => { setAspectRatio(e.target.value); setCostPreview(null); }}>
              {selectedModel.aspectRatios.map(ar => <option key={ar} value={ar}>{ar}</option>)}
            </select>
          </div>

          <div className="pr-field">
            <label className="pr-field-label font-ui">Resolution</label>
            <select className="pr-select font-mono" value={resolution} onChange={e => { setResolution(e.target.value); setCostPreview(null); }}>
              {selectedModel.resolutions.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          {selectedModel.duration && (
            <div className="pr-field">
              <label className="pr-field-label font-ui">
                Duration seconds ({selectedModel.duration.minimum}–{selectedModel.duration.maximum}, default {selectedModel.duration.default})
              </label>
              <input
                type="number" className="pr-input font-mono" placeholder={String(selectedModel.duration.default || '')}
                min={selectedModel.duration.minimum} max={selectedModel.duration.maximum}
                value={durationSeconds} onChange={e => { setDurationSeconds(e.target.value); setCostPreview(null); }}
              />
            </div>
          )}
        </>
      )}

      <div className="pr-field">
        <label className="pr-field-label font-ui">Prompt</label>
        <textarea
          className="pr-input font-mono" rows={3} maxLength={MAX_PROMPT_CHARS}
          value={prompt} onChange={e => { setPrompt(e.target.value); setCostPreview(null); }}
          placeholder={scriptFromPackage ? 'Describe the visual — the package script is not auto-sent to OpenArt.' : 'Describe what to generate…'}
        />
        <div className="pr-field-hint font-mono">{prompt.length} / {MAX_PROMPT_CHARS} characters</div>
      </div>

      {saveError && <div className="pr-warning font-mono"><FiAlertCircle size={11} /> {saveError}</div>}

      {validation && (
        <div className={validation.valid ? 'pr-approved-flash font-mono' : 'pr-warning font-mono'}>
          {validation.valid ? <FiCheckCircle size={12} /> : <FiAlertCircle size={11} />}
          {validation.valid ? ' OpenArt Video setup is valid and ready.' : ` ${validation.errors.join(' ')}`}
        </div>
      )}

      <div className="pr-row-2">
        <button type="button" className="pr-btn pr-btn--approve font-ui" onClick={save} disabled={saving || !model || !prompt.trim()}>
          {saving ? <><FiRefreshCw size={12} className="spin" /> Saving…</> : <><FiSave size={12} /> Save OpenArt Video Setup</>}
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
