import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FiAlertCircle, FiCheckCircle, FiDownload, FiExternalLink, FiHardDrive,
  FiPackage, FiPlay, FiRefreshCw, FiSearch, FiSquare, FiX, FiZap,
} from 'react-icons/fi';

// ── Constants ────────────────────────────────────────────────────────────

const QUALITY_OPTIONS = [
  { id: 'standard', label: 'Standard' },
  { id: 'high', label: 'High' },
];
const LOW_MEM_OPTIONS = [
  { id: 'auto', label: 'Auto (CLI decides)' },
  { id: 'enabled', label: 'Enabled (safer — 1 worker)' },
  { id: 'disabled', label: 'Disabled' },
];
const ORIENTATION_PRESETS = [
  { id: 'existing', label: 'Existing (composition-defined)' },
  { id: 'landscape', label: 'Landscape (16:9)' },
  { id: 'vertical', label: 'Vertical (9:16)' },
];

const RUN_STATUS_META = {
  queued: { label: 'Queued', color: '#60a5fa' },
  running: { label: 'Running', color: '#60a5fa' },
  completed: { label: 'Completed', color: '#4ade80' },
  failed: { label: 'Failed', color: '#f87171' },
  cancelled: { label: 'Cancelled', color: '#5d6c86' },
};

const POLL_INTERVAL_MS = 1500;

// ── Helpers ──────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}
function formatBytes(n) {
  if (n === null || n === undefined) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
function shorten(text, max = 60) {
  if (!text) return '';
  const t = String(text).trim();
  return t.length > max ? `${t.slice(0, max).trim()}…` : t;
}

function RunStatusBadge({ status }) {
  const m = RUN_STATUS_META[status] || { label: status || 'Unknown', color: '#5d6c86' };
  return (
    <span className="pr-status-badge font-mono" style={{ color: m.color, background: `${m.color}1f`, borderColor: `${m.color}40` }}>
      {m.label}
    </span>
  );
}

// Derives the single most relevant composition-status badge from whatever
// runs we've observed for it in this session — "Ready" is the honest
// fallback when nothing has been run yet.
function statusLabelFor({ lintRun, checkRun, renderRun, importResult }) {
  if (renderRun?.status === 'running' || renderRun?.status === 'queued') return { label: 'Rendering', color: '#60a5fa' };
  if (importResult) return { label: 'Import Complete', color: '#4ade80' };
  if (renderRun?.status === 'completed') return { label: 'Render Complete', color: '#4ade80' };
  if (renderRun?.status === 'failed') return { label: 'Failed', color: '#f87171' };
  if (checkRun?.status === 'completed') return { label: 'Check Passed', color: '#4ade80' };
  if (checkRun?.status === 'failed') return { label: 'Failed', color: '#f87171' };
  if (lintRun?.status === 'completed') return { label: 'Lint Passed', color: '#4ade80' };
  if (lintRun?.status === 'failed') return { label: 'Failed', color: '#f87171' };
  return { label: 'Ready', color: '#5d6c86' };
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({ ok: false, error: `Server returned ${res.status}` }));
  return { res, data };
}

// ── Composition library card (left column) ──────────────────────────────

function CompositionCard({ composition, selected, onSelect }) {
  return (
    <button type="button" className={`hf-comp-card${selected ? ' hf-comp-card--selected' : ''}`} onClick={() => onSelect(composition.id)}>
      <div className="hf-comp-card-top">
        <span className="font-ui">{shorten(composition.name, 40)}</span>
        {composition.hasOutputMp4 ? (
          <span className="hf-comp-card-badge hf-comp-card-badge--ok font-mono">Has Render</span>
        ) : (
          <span className="hf-comp-card-badge font-mono">No Render Yet</span>
        )}
      </div>
      <span className="hf-comp-card-meta font-mono">
        {composition.metadata?.width && composition.metadata?.height
          ? `${composition.metadata.width}×${composition.metadata.height}`
          : 'Dimensions unknown'}
        {composition.metadata?.durationSeconds ? ` · ${composition.metadata.durationSeconds}s` : ''}
        {composition.metadata?.fps ? ` · ${composition.metadata.fps}fps` : ''}
      </span>
      <span className="hf-comp-card-meta font-mono">{formatDate(composition.modifiedAt)}</span>
    </button>
  );
}

// ── Main component ───────────────────────────────────────────────────────

export default function HyperFramesStudioWorkspace({ focusRequest, onFocusConsumed, onOpenInProductionRouter } = {}) {
  const [compositions, setCompositions] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState(null);
  const [search, setSearch] = useState('');

  const [selectedId, setSelectedId] = useState(null);
  const [composition, setComposition] = useState(null);
  const [detailError, setDetailError] = useState(null);

  const [lintRun, setLintRun] = useState(null);
  const [checkRun, setCheckRun] = useState(null);
  const [renderRun, setRenderRun] = useState(null);
  const [previewRun, setPreviewRun] = useState(null);
  const [importResult, setImportResult] = useState(null);

  const [linting, setLinting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [stoppingPreview, setStoppingPreview] = useState(false);
  const [importing, setImporting] = useState(false);
  const [oneClicking, setOneClicking] = useState(false);
  const [actionError, setActionError] = useState(null);

  const [quality, setQuality] = useState('standard');
  const [lowMemoryMode, setLowMemoryMode] = useState('enabled');
  const [orientation, setOrientation] = useState('existing');

  const [recentRuns, setRecentRuns] = useState([]);
  const [recentJobs, setRecentJobs] = useState([]);

  const pollTimerRef = useRef(null);
  const focusConsumedRef = useRef(null);

  // ── Composition list ──────────────────────────────────────────────────

  const loadCompositions = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const res = await fetch('/api/hyperframes/compositions', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && data.ok) setCompositions(data.compositions);
      else setListError(data.error || 'Failed to load compositions.');
    } catch (e) {
      setListError(e.message || 'Failed to load compositions.');
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => { loadCompositions(); }, [loadCompositions]);

  const loadRuns = useCallback(async (compositionId) => {
    if (!compositionId) { setRecentRuns([]); return; }
    try {
      const res = await fetch(`/api/hyperframes/runs?compositionId=${encodeURIComponent(compositionId)}`, { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && data.ok) setRecentRuns(data.runs);
    } catch { /* keep prior state on transient failure */ }
  }, []);

  const loadRecentJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/production/jobs', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && data.ok) {
        setRecentJobs((data.jobs || []).filter(j => j.metadata?.isLocalRender === true).slice(0, 20));
      }
    } catch { /* keep prior state on transient failure */ }
  }, []);

  useEffect(() => { loadRecentJobs(); }, [loadRecentJobs]);

  // ── Select a composition ─────────────────────────────────────────────

  const selectComposition = useCallback(async (id) => {
    clearInterval(pollTimerRef.current);
    setSelectedId(id);
    setComposition(null);
    setDetailError(null);
    setLintRun(null); setCheckRun(null); setRenderRun(null); setPreviewRun(null); setImportResult(null);
    setActionError(null);
    try {
      const res = await fetch(`/api/hyperframes/compositions/${encodeURIComponent(id)}`, { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && data.ok) setComposition(data.composition);
      else setDetailError(data.error || 'Composition not found.');
    } catch (e) {
      setDetailError(e.message || 'Failed to load composition.');
    }
    loadRuns(id);
  }, [loadRuns]);

  // Consume an external focus request (e.g. "Open Composition" from a
  // Production Router job) exactly once per request.
  useEffect(() => {
    if (!focusRequest || focusConsumedRef.current === focusRequest.at) return;
    focusConsumedRef.current = focusRequest.at;
    if (focusRequest.compositionId) selectComposition(focusRequest.compositionId);
    onFocusConsumed?.();
  }, [focusRequest, onFocusConsumed, selectComposition]);

  useEffect(() => () => clearInterval(pollTimerRef.current), []);

  const filteredCompositions = compositions.filter(c => {
    const q = search.trim().toLowerCase();
    return !q || c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q);
  });

  // ── Poll a run to completion ──────────────────────────────────────────

  const pollRun = useCallback((runId, onUpdate) => {
    clearInterval(pollTimerRef.current);
    pollTimerRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/hyperframes/runs/${encodeURIComponent(runId)}`, { cache: 'no-store' });
        const data = await res.json();
        if (res.ok && data.ok) {
          onUpdate(data.run);
          if (['completed', 'failed', 'cancelled'].includes(data.run.status)) {
            clearInterval(pollTimerRef.current);
            loadRuns(selectedId);
          }
        }
      } catch { /* keep polling — a transient network hiccup shouldn't stop it */ }
    }, POLL_INTERVAL_MS);
  }, [loadRuns, selectedId]);

  // ── Lint / Check ──────────────────────────────────────────────────────

  const runLint = async () => {
    if (!selectedId || linting) return;
    setLinting(true); setActionError(null);
    try {
      const { res, data } = await postJson(`/api/hyperframes/compositions/${encodeURIComponent(selectedId)}/lint`);
      if (res.ok && data.ok) { setLintRun(data.run); loadRuns(selectedId); }
      else setActionError(data.error || 'Lint failed.');
    } catch (e) { setActionError(e.message || 'Lint request failed.'); }
    finally { setLinting(false); }
  };

  const runCheck = async () => {
    if (!selectedId || checking) return;
    setChecking(true); setActionError(null);
    try {
      const { res, data } = await postJson(`/api/hyperframes/compositions/${encodeURIComponent(selectedId)}/check`);
      if (res.ok && data.ok) { setCheckRun(data.run); loadRuns(selectedId); }
      else setActionError(data.error || 'Check failed.');
    } catch (e) { setActionError(e.message || 'Check request failed.'); }
    finally { setChecking(false); }
  };

  // ── Render (fire, then poll) ──────────────────────────────────────────

  const startRender = async () => {
    if (!selectedId || rendering) return;
    setRendering(true); setActionError(null); setImportResult(null);
    try {
      const { res, data } = await postJson(`/api/hyperframes/compositions/${encodeURIComponent(selectedId)}/render`, { quality, lowMemoryMode });
      if (res.ok && data.ok) {
        setRenderRun(data.run);
        pollRun(data.run.id, async (run) => {
          setRenderRun(run);
          if (run.status === 'completed') {
            // A targeted refresh — deliberately NOT selectComposition(),
            // which would reset renderRun right back to null and hide the
            // just-finished run's progress/log tail from view.
            try {
              const compRes = await fetch(`/api/hyperframes/compositions/${encodeURIComponent(selectedId)}`, { cache: 'no-store' });
              const compData = await compRes.json();
              if (compRes.ok && compData.ok) setComposition(compData.composition);
            } catch { /* keep the prior composition view on a transient failure */ }
            setRendering(false);
          }
          if (['failed', 'cancelled'].includes(run.status)) setRendering(false);
        });
      } else {
        setActionError(data.error || 'Render failed to start.');
        setRendering(false);
      }
    } catch (e) {
      setActionError(e.message || 'Render request failed.');
      setRendering(false);
    }
  };

  const cancelRender = async () => {
    if (!renderRun?.id || cancelling) return;
    setCancelling(true);
    try {
      const { res, data } = await postJson(`/api/hyperframes/runs/${encodeURIComponent(renderRun.id)}/cancel`);
      if (res.ok && data.ok) { setRenderRun(data.run); clearInterval(pollTimerRef.current); setRendering(false); loadRuns(selectedId); }
    } finally { setCancelling(false); }
  };

  // ── Preview ────────────────────────────────────────────────────────────

  const startPreview = async () => {
    if (!selectedId || previewing) return;
    setPreviewing(true); setActionError(null);
    try {
      const { res, data } = await postJson(`/api/hyperframes/compositions/${encodeURIComponent(selectedId)}/preview`);
      if (res.ok && data.ok) setPreviewRun({ ...data.run, previewUrl: data.previewUrl });
      else setActionError(data.error || 'Preview did not start. Lint/Check/Render remain fully functional.');
    } catch (e) {
      setActionError(e.message || 'Preview request failed.');
    } finally {
      setPreviewing(false);
    }
  };

  const stopPreview = async () => {
    if (!selectedId || stoppingPreview) return;
    setStoppingPreview(true);
    try {
      const { res, data } = await postJson(`/api/hyperframes/compositions/${encodeURIComponent(selectedId)}/preview/stop`);
      if (res.ok && data.ok) setPreviewRun(null);
    } finally { setStoppingPreview(false); }
  };

  // ── Import ─────────────────────────────────────────────────────────────

  const importOutput = async () => {
    if (!selectedId || importing) return;
    setImporting(true); setActionError(null);
    try {
      const { res, data } = await postJson(`/api/hyperframes/compositions/${encodeURIComponent(selectedId)}/import`);
      if (res.ok && data.ok) { setImportResult(data.import); loadRecentJobs(); }
      else setActionError(data.error || 'Import failed.');
    } catch (e) { setActionError(e.message || 'Import request failed.'); }
    finally { setImporting(false); }
  };

  // ── One-click Render and Import ───────────────────────────────────────

  // The server kicks off lint -> check -> render -> import as one chain and
  // returns immediately (a single request held open for the whole ~20-40s
  // duration is fragile for a real browser fetch) — this polls the same run
  // record to completion, exactly like the standalone Render button does.
  const renderAndImport = async () => {
    if (!selectedId || oneClicking || rendering) return;
    setOneClicking(true); setActionError(null);
    setLintRun(null); setCheckRun(null); setRenderRun(null); setImportResult(null);
    try {
      const { res, data } = await postJson(`/api/hyperframes/compositions/${encodeURIComponent(selectedId)}/render-and-import`, { quality, lowMemoryMode });
      if (!(res.ok && data.ok)) {
        setActionError(data.error || 'Render and Import failed to start.');
        setOneClicking(false);
        return;
      }
      setRenderRun(data.run);
      pollRun(data.run.id, async (run) => {
        setRenderRun(run);
        if (run.status === 'completed' && run.importedJobId) {
          setLintRun({ status: 'completed' });
          setCheckRun({ status: 'completed' });
          // A targeted composition-detail refresh (picks up the new
          // hasOutputMp4/metadata) — deliberately NOT selectComposition(),
          // which would reset renderRun/importResult right back to null as
          // part of its "switch to a different composition" behavior.
          try {
            const compRes = await fetch(`/api/hyperframes/compositions/${encodeURIComponent(selectedId)}`, { cache: 'no-store' });
            const compData = await compRes.json();
            if (compRes.ok && compData.ok) setComposition(compData.composition);
          } catch { /* keep the prior composition view on a transient failure */ }
          try {
            const jobRes = await fetch(`/api/production/jobs/${encodeURIComponent(run.importedJobId)}`, { cache: 'no-store' });
            const jobData = await jobRes.json();
            if (jobRes.ok && jobData.ok) {
              setImportResult({ productionJobId: run.importedJobId, packageId: jobData.job?.packageId });
            }
          } catch { /* the job still imported successfully server-side even if this lookup hiccups */ }
          loadRecentJobs();
          setOneClicking(false);
        } else if (run.status === 'failed' || run.status === 'cancelled') {
          // run.error already says which stage stopped it ("Stopped at lint/check/render/import: ...").
          setActionError(run.error || 'Render and Import failed.');
          if (run.error?.startsWith('Stopped at lint')) setLintRun({ status: 'failed', error: run.error });
          else if (run.error?.startsWith('Stopped at check')) { setLintRun({ status: 'completed' }); setCheckRun({ status: 'failed', error: run.error }); }
          else { setLintRun({ status: 'completed' }); setCheckRun({ status: 'completed' }); }
          loadRuns(selectedId);
          setOneClicking(false);
        }
      });
    } catch (e) {
      setActionError(e.message || 'Render and Import request failed.');
      setOneClicking(false);
    }
  };

  const status = statusLabelFor({ lintRun, checkRun, renderRun, importResult });
  const isLandscapeComposition = composition?.metadata?.width && composition?.metadata?.height
    ? composition.metadata.width > composition.metadata.height
    : null;
  const showVerticalWarning = orientation === 'vertical' && isLandscapeComposition === true;
  const anyBusy = linting || checking || rendering || oneClicking || importing;

  return (
    <div className="pr-wrapper">
      <div className="pr-wrapper-head">
        <h3 className="font-ui">HyperFrames Studio</h3>
        <p className="font-mono">Run, render, and import local HyperFrames compositions without leaving Mika OS. Local-only — no remote provider, no credentials.</p>
      </div>

      <div className="hf-studio-grid">
        {/* ══════════════ LEFT — composition library ══════════════ */}
        <div className="hf-studio-col">
          <div className="ts-library-search">
            <FiSearch size={13} />
            <input type="text" placeholder="Search compositions…" value={search} onChange={e => setSearch(e.target.value)} className="font-mono" />
          </div>
          {listError && <div className="pr-warning font-mono"><FiAlertCircle size={11} /> {listError}</div>}
          {loadingList && compositions.length === 0 ? (
            <div className="thumb-empty font-mono">Scanning tools/hyperframes/…</div>
          ) : filteredCompositions.length === 0 ? (
            <div className="thumb-empty font-mono">No local HyperFrames compositions found under tools/hyperframes/.</div>
          ) : (
            <div className="hf-comp-list">
              {filteredCompositions.map(c => (
                <CompositionCard key={c.id} composition={c} selected={c.id === selectedId} onSelect={selectComposition} />
              ))}
            </div>
          )}
          <button type="button" className="pr-btn pr-btn--muted font-ui" onClick={loadCompositions} disabled={loadingList}>
            {loadingList ? <><FiRefreshCw size={12} className="spin" /> Refreshing…</> : <><FiRefreshCw size={12} /> Refresh List</>}
          </button>
        </div>

        {/* ══════════════ CENTER — details / lint / check / render ══════════════ */}
        <div className="hf-studio-col">
          {!composition ? (
            <div className="thumb-empty font-mono cpg-empty-panel">
              {detailError || 'Select a composition on the left.'}
            </div>
          ) : (
            <>
              <div className="pr-section">
                <div className="pr-section-head">
                  <span className="font-ui">{composition.name}</span>
                  <span className="pr-status-badge font-mono" style={{ color: status.color, background: `${status.color}1f`, borderColor: `${status.color}40` }}>
                    {status.label}
                  </span>
                </div>
                <div className="pr-exec-meta font-mono">
                  <span>{composition.relativePath}</span>
                  <span>{composition.metadata?.width && composition.metadata?.height ? `${composition.metadata.width}×${composition.metadata.height}` : 'Dimensions unknown'}</span>
                  {composition.metadata?.durationSeconds && <span>{composition.metadata.durationSeconds}s</span>}
                  {composition.metadata?.fps && <span>{composition.metadata.fps}fps</span>}
                  {composition.cliVersionPin && <span>hyperframes@{composition.cliVersionPin}</span>}
                </div>
              </div>

              <div className="pr-section hf-lint-check-row">
                <button type="button" className="pr-btn font-ui" onClick={runLint} disabled={linting || anyBusy}>
                  {linting ? <><FiRefreshCw size={12} className="spin" /> Linting…</> : 'Lint'}
                </button>
                <button type="button" className="pr-btn font-ui" onClick={runCheck} disabled={checking || anyBusy}>
                  {checking ? <><FiRefreshCw size={12} className="spin" /> Checking…</> : 'Check'}
                </button>
                {lintRun && (
                  <div className={`hf-inline-result font-mono${lintRun.status === 'failed' ? ' hf-inline-result--fail' : ''}`}>
                    Lint: {lintRun.status}{lintRun.result?.errorCount != null ? ` (${lintRun.result.errorCount} error(s))` : ''}
                  </div>
                )}
                {checkRun && (
                  <div className={`hf-inline-result font-mono${checkRun.status === 'failed' ? ' hf-inline-result--fail' : ''}`}>
                    Check: {checkRun.status}{checkRun.result?.errorCount != null ? ` (${checkRun.result.errorCount} error(s))` : ''}
                  </div>
                )}
              </div>

              <div className="pr-section">
                <div className="pr-section-head"><span className="font-ui">Render Options</span></div>
                <div className="pr-row-2">
                  <div className="pr-field">
                    <label className="pr-field-label font-ui">Quality</label>
                    <select className="pr-select font-mono" value={quality} onChange={e => setQuality(e.target.value)}>
                      {QUALITY_OPTIONS.map(q => <option key={q.id} value={q.id}>{q.label}</option>)}
                    </select>
                  </div>
                  <div className="pr-field">
                    <label className="pr-field-label font-ui">Low-memory mode</label>
                    <select className="pr-select font-mono" value={lowMemoryMode} onChange={e => setLowMemoryMode(e.target.value)}>
                      {LOW_MEM_OPTIONS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  </div>
                </div>
                <div className="pr-field">
                  <label className="pr-field-label font-ui">Orientation preset (informational)</label>
                  <select className="pr-select font-mono" value={orientation} onChange={e => setOrientation(e.target.value)}>
                    {ORIENTATION_PRESETS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                </div>
                <p className="pr-reason-text font-mono">Low-memory rendering may be slower but is safer on this device.</p>
                {showVerticalWarning && (
                  <div className="pr-warning font-mono">
                    <FiAlertCircle size={11} /> This composition is authored landscape ({composition.metadata.width}×{composition.metadata.height}). HyperFrames output dimensions are defined by the composition itself — rendering will keep the authored orientation, not silently rewrite it to vertical.
                  </div>
                )}

                <div className="hf-render-actions">
                  <button type="button" className="thumb-generate-btn font-ui" onClick={renderAndImport} disabled={anyBusy}>
                    {oneClicking ? <><FiRefreshCw size={12} className="spin" /> Rendering & Importing…</> : <><FiZap size={12} /> Render and Import</>}
                  </button>
                  <button type="button" className="pr-btn font-ui" onClick={startRender} disabled={anyBusy}>
                    {rendering ? <><FiRefreshCw size={12} className="spin" /> Rendering…</> : <><FiPlay size={12} /> Render Only</>}
                  </button>
                  {renderRun && ['queued', 'running'].includes(renderRun.status) && (
                    <button type="button" className="pr-btn pr-btn--reject font-ui" onClick={cancelRender} disabled={cancelling}>
                      <FiX size={12} /> Cancel Render
                    </button>
                  )}
                </div>
              </div>

              {actionError && <div className="pr-warning font-mono"><FiAlertCircle size={11} /> {actionError}</div>}
            </>
          )}
        </div>

        {/* ══════════════ RIGHT — live run status / preview / import ══════════════ */}
        <div className="hf-studio-col">
          {!composition ? (
            <div className="thumb-empty font-mono">Run status and outputs will appear here once a composition is selected.</div>
          ) : (
            <>
              <div className="pr-section">
                <div className="pr-section-head"><span className="font-ui">Preview</span></div>
                {previewRun?.previewUrl ? (
                  <>
                    <a href={previewRun.previewUrl} target="_blank" rel="noopener noreferrer" className="pr-btn pr-btn--secondary font-ui">
                      <FiExternalLink size={12} /> Open Preview
                    </a>
                    <button type="button" className="pr-btn pr-btn--reject font-ui" onClick={stopPreview} disabled={stoppingPreview}>
                      <FiSquare size={11} /> {stoppingPreview ? 'Stopping…' : 'Stop Preview'}
                    </button>
                  </>
                ) : (
                  <button type="button" className="pr-btn font-ui" onClick={startPreview} disabled={previewing}>
                    {previewing ? <><FiRefreshCw size={12} className="spin" /> Starting…</> : <><FiPlay size={12} /> Start Preview</>}
                  </button>
                )}
              </div>

              {renderRun && (
                <div className="pr-section">
                  <div className="pr-section-head">
                    <span className="font-ui">Render Run</span>
                    <RunStatusBadge status={renderRun.status} />
                  </div>
                  <div className="pr-exec-meta font-mono">
                    {renderRun.progress != null && <span>Progress: {renderRun.progress}%</span>}
                    {renderRun.startedAt && <span>Started: {formatDate(renderRun.startedAt)}</span>}
                  </div>
                  {renderRun.error && <div className="pr-warning font-mono"><FiAlertCircle size={11} /> {renderRun.error}</div>}
                  {renderRun.logTail?.length > 0 && (
                    <pre className="hf-log-tail font-mono">{renderRun.logTail.slice(-40).join('\n')}</pre>
                  )}
                </div>
              )}

              <div className="pr-section">
                <div className="pr-section-head"><span className="font-ui">Output / Import</span></div>
                {!composition.hasOutputMp4 && !renderRun ? (
                  <p className="pr-reason-text font-mono">No output.mp4 yet — render this composition first.</p>
                ) : (
                  <>
                    <button type="button" className="pr-btn font-ui" onClick={importOutput} disabled={importing || anyBusy}>
                      {importing ? <><FiRefreshCw size={12} className="spin" /> Importing…</> : <><FiDownload size={12} /> Import Output</>}
                    </button>
                    {importResult && (
                      <div className="hf-import-result font-mono">
                        <FiCheckCircle size={12} /> {importResult.alreadyImported ? 'Already imported — reused existing job.' : 'Imported successfully.'}
                        <button type="button" className="pr-btn pr-btn--secondary font-ui" onClick={() => onOpenInProductionRouter?.(importResult.packageId)}>
                          <FiPackage size={12} /> Open Output in Production Router
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ══════════════ Recent runs ══════════════ */}
      <div className="ts-history-section">
        <div className="thumb-section-head">
          <span className="font-ui">Recent Runs{composition ? ` — ${composition.name}` : ''}</span>
          <button type="button" className="thumb-icon-btn" onClick={() => loadRuns(selectedId)} disabled={!selectedId} title="Refresh">
            <FiRefreshCw size={11} />
          </button>
        </div>
        {!selectedId ? (
          <div className="thumb-empty font-mono">Select a composition to see its run history.</div>
        ) : recentRuns.length === 0 ? (
          <div className="thumb-empty font-mono">No runs yet for this composition.</div>
        ) : (
          <div className="hf-runs-list">
            {recentRuns.map(r => (
              <div key={r.id} className="hf-run-row font-mono">
                <span className="hf-run-command">{r.command}</span>
                <RunStatusBadge status={r.status} />
                <span>{formatDate(r.startedAt || r.updatedAt)}</span>
                {r.error && <span className="hf-run-error">{shorten(r.error, 80)}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ══════════════ Recent imported jobs ══════════════ */}
      <div className="ts-history-section">
        <div className="thumb-section-head">
          <span className="font-ui">Recently Imported Local Renders</span>
          <button type="button" className="thumb-icon-btn" onClick={loadRecentJobs} title="Refresh">
            <FiRefreshCw size={11} />
          </button>
        </div>
        {recentJobs.length === 0 ? (
          <div className="thumb-empty font-mono">No local renders imported yet.</div>
        ) : (
          <div className="hf-runs-list">
            {recentJobs.map(j => (
              <div key={j.id} className="hf-run-row font-mono">
                <FiHardDrive size={11} />
                <span>{shorten(j.execution?.outputs?.[0]?.filename || j.id, 40)}</span>
                <span>{formatDate(j.metadata?.createdAt)}</span>
                <button type="button" className="pr-btn pr-btn--muted font-ui" onClick={() => onOpenInProductionRouter?.(j.packageId)}>
                  <FiExternalLink size={11} /> Open
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
