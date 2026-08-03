import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  FiAlertCircle, FiCalendar, FiCheck, FiCheckCircle, FiDownload, FiEye,
  FiFilter, FiLock, FiPlay, FiRefreshCw, FiSearch, FiSend, FiThumbsDown, FiX, FiZap,
} from 'react-icons/fi';
import { normalizeArtifactList } from '../../lib/artifacts/normalizeArtifact';
import ArtifactViewer from '../artifacts/ArtifactViewer';
import ArtifactPreviewModal from '../artifacts/ArtifactPreviewModal';
import ArtifactMetadata from '../artifacts/ArtifactMetadata';

// ── Constants ─────────────────────────────────────────────────────────────

const PUBLISH_STATE_META = {
  draft:     { label: 'Draft',     color: '#a78bfa' },
  ready:     { label: 'Ready',     color: '#4ade80' },
  scheduled: { label: 'Scheduled', color: '#60a5fa' },
  publishing:{ label: 'Publishing',color: '#60a5fa' },
  published: { label: 'Published', color: '#4ade80' },
  failed:    { label: 'Failed',    color: '#f87171' },
  cancelled: { label: 'Cancelled', color: '#5d6c86' },
};

const LIBRARY_LIMIT = 50;

function formatDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}
function shorten(text, max = 90) {
  if (!text) return '';
  const t = String(text).trim();
  return t.length > max ? `${t.slice(0, max).trim()}…` : t;
}
function downloadBlob(content, mime, filename) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function StateBadge({ state, size = 'sm' }) {
  const m = PUBLISH_STATE_META[state] || { label: state, color: '#5d6c86' };
  return (
    <span className={`pr-status-badge pr-status-badge--${size} font-mono`} style={{ color: m.color, background: `${m.color}1f`, borderColor: `${m.color}40` }}>
      {m.label}
    </span>
  );
}

// ── Left column: approved production jobs to publish from ────────────────

function SourceJobRow({ job, pkg, selected, eligible, onSelect }) {
  return (
    <button
      type="button"
      className={`pub-source-row${selected ? ' pub-source-row--selected' : ''}${!eligible ? ' pub-source-row--disabled' : ''}`}
      onClick={() => eligible && onSelect(job)}
      disabled={!eligible}
      title={eligible ? '' : 'Output review must be "approved" before this can be published.'}
    >
      <span className="pub-source-row-top">
        <span className="font-ui">{shorten(pkg?.topic || job.packageId, 46)}</span>
        {!eligible && <FiLock size={11} className="pub-source-lock" />}
      </span>
      <span className="pub-source-row-meta font-mono">{pkg?.brand || '—'} · {job.selectedProvider || '—'}</span>
      <span className="pub-source-row-meta font-mono">
        {eligible ? <span className="pub-eligible-tag">Approved — ready to publish</span> : <span className="pub-blocked-tag">Review: {job.review?.status || 'unreviewed'}</span>}
      </span>
    </button>
  );
}

// ── Recent publish job card ───────────────────────────────────────────────

function PublishJobCard({ job, onOpen }) {
  return (
    <button type="button" className="pr-lib-card" onClick={() => onOpen(job)}>
      <div className="pr-lib-card-top">
        <span className="pr-lib-card-title font-ui">{job.platform}</span>
        <StateBadge state={job.status} />
      </div>
      <span className="pr-lib-card-meta font-mono">{shorten(job.caption, 60) || 'No caption yet'}</span>
      <span className="pr-lib-card-meta font-mono">{job.hashtags?.length || 0} hashtags{job.scheduledFor ? ` · scheduled ${formatDate(job.scheduledFor)}` : ''}</span>
      <span className="pr-lib-card-date font-mono">{formatDate(job.createdAt)}</span>
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export default function PublishingRouterWorkspace({ focusRequest, onFocusConsumed } = {}) {
  const [productionJobs, setProductionJobs] = useState([]);
  const [packages, setPackages] = useState([]);
  const [platforms, setPlatforms] = useState([]);
  const [publishJobs, setPublishJobs] = useState([]);
  const [libLoading, setLibLoading] = useState(false);
  const [libLoaded, setLibLoaded] = useState(false);

  const [sourceSearch, setSourceSearch] = useState('');
  const [selectedSourceJob, setSelectedSourceJob] = useState(null);
  const [createPlatform, setCreatePlatform] = useState('');
  const [createArtifactId, setCreateArtifactId] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  const [current, setCurrent] = useState(null); // { job, productionJob, artifacts, artifact, platform }
  const [captionDraft, setCaptionDraft] = useState('');
  const [hashtagsDraft, setHashtagsDraft] = useState('');
  const [firstCommentDraft, setFirstCommentDraft] = useState('');
  const [savingFields, setSavingFields] = useState(false);
  const [actionError, setActionError] = useState(null);

  const [validating, setValidating] = useState(false);
  const [markingReady, setMarkingReady] = useState(false);
  const [scheduleInput, setScheduleInput] = useState('');
  const [scheduling, setScheduling] = useState(false);
  const [publishNote, setPublishNote] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [failReason, setFailReason] = useState('');
  const [failing, setFailing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [exportingFormat, setExportingFormat] = useState(null);

  const [modalArtifactId, setModalArtifactId] = useState(null);

  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPlatform, setFilterPlatform] = useState('all');
  const [librarySearch, setLibrarySearch] = useState('');

  const fieldsDirtyRef = useRef(false);
  const focusConsumedRef = useRef(null);

  // ── Loaders ───────────────────────────────────────────────────────────

  const loadProductionJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/production/jobs', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && data.ok) setProductionJobs(data.jobs || []);
    } catch { /* keep prior state on transient failure */ }
  }, []);

  const loadPackages = useCallback(async () => {
    try {
      const res = await fetch('/api/content/pipeline/list', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok) setPackages(Array.isArray(data.packages) ? data.packages : []);
    } catch { /* keep prior state on transient failure */ }
  }, []);

  const loadPlatforms = useCallback(async () => {
    try {
      const res = await fetch('/api/publishing/platforms', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && data.ok) setPlatforms(data.platforms || []);
    } catch { /* keep prior state on transient failure */ }
  }, []);

  const loadPublishJobs = useCallback(async () => {
    setLibLoading(true);
    try {
      const res = await fetch('/api/publishing/jobs', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && data.ok) setPublishJobs((data.jobs || []).slice(0, LIBRARY_LIMIT));
    } finally {
      setLibLoading(false); setLibLoaded(true);
    }
  }, []);

  useEffect(() => { loadProductionJobs(); loadPackages(); loadPlatforms(); loadPublishJobs(); }, [loadProductionJobs, loadPackages, loadPlatforms, loadPublishJobs]);

  const packageMap = useMemo(() => Object.fromEntries(packages.map(p => [p.id, p])), [packages]);

  // Only completed production jobs are publish candidates at all; approved
  // ones are selectable, everything else is shown but locked — the gate is
  // visible, never silently hidden.
  const candidateJobs = useMemo(() => productionJobs.filter(j => j.execution?.status === 'completed'), [productionJobs]);
  const filteredCandidates = useMemo(() => {
    const q = sourceSearch.trim().toLowerCase();
    if (!q) return candidateJobs;
    return candidateJobs.filter(j => {
      const pkg = packageMap[j.packageId];
      return `${pkg?.topic || ''} ${pkg?.brand || ''}`.toLowerCase().includes(q);
    });
  }, [candidateJobs, sourceSearch, packageMap]);

  const selectedSourceArtifacts = useMemo(
    () => selectedSourceJob ? normalizeArtifactList(selectedSourceJob.execution?.outputs, { job: selectedSourceJob }) : [],
    [selectedSourceJob],
  );

  const selectSourceJob = (job) => {
    setSelectedSourceJob(job);
    setCreateError(null);
    setCreatePlatform('');
    const artifacts = normalizeArtifactList(job.execution?.outputs, { job });
    setCreateArtifactId(artifacts[0]?.artifactId || '');
  };

  // ── Create publish job ────────────────────────────────────────────────

  const createPublishJob = async () => {
    if (!selectedSourceJob || !createPlatform || creating) return;
    setCreating(true); setCreateError(null);
    try {
      const res = await fetch('/api/publishing/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productionJobId: selectedSourceJob.id,
          platform: createPlatform,
          artifactId: createArtifactId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) { setCreateError(data.error || `Server error ${res.status}`); return; }
      await openPublishJob(data.job.id);
      await loadPublishJobs();
    } catch (err) {
      setCreateError(err.message || 'Request failed.');
    } finally {
      setCreating(false);
    }
  };

  // ── Open / refresh a publish job ──────────────────────────────────────

  const openPublishJob = useCallback(async (id) => {
    try {
      const res = await fetch(`/api/publishing/jobs/${encodeURIComponent(id)}`, { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && data.ok) {
        setCurrent(data);
        setCaptionDraft(data.job.caption || '');
        setHashtagsDraft((data.job.hashtags || []).join(', '));
        setFirstCommentDraft(data.job.firstComment || '');
        setScheduleInput(data.job.scheduledFor ? data.job.scheduledFor.slice(0, 16) : '');
        setModalArtifactId(null);
        setActionError(null);
        fieldsDirtyRef.current = false;
      }
    } catch { /* keep prior state on transient failure */ }
  }, []);

  const openFromLibrary = (job) => openPublishJob(job.id);

  // Consume an external focus request (e.g. "Open in Publishing Router"
  // from Content Orchestrator) exactly once per request.
  useEffect(() => {
    if (!focusRequest || focusConsumedRef.current === focusRequest.at) return;
    focusConsumedRef.current = focusRequest.at;
    if (focusRequest.publishJobId) openPublishJob(focusRequest.publishJobId);
    onFocusConsumed?.();
  }, [focusRequest, onFocusConsumed, openPublishJob]);

  // ── Field editing (draft/ready only) ──────────────────────────────────

  const saveFields = async () => {
    if (!current) return;
    setSavingFields(true); setActionError(null);
    try {
      const hashtags = hashtagsDraft.split(',').map(h => h.trim()).filter(Boolean);
      const res = await fetch(`/api/publishing/jobs/${encodeURIComponent(current.job.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caption: captionDraft, hashtags, firstComment: firstCommentDraft }),
      });
      const data = await res.json();
      if (res.ok && data.ok) { setCurrent(data); fieldsDirtyRef.current = false; await loadPublishJobs(); }
      else setActionError(data.error || 'Save failed.');
    } catch (err) {
      setActionError(err.message || 'Save failed.');
    } finally {
      setSavingFields(false);
    }
  };

  const changePlatform = async (platformId) => {
    if (!current) return;
    setSavingFields(true); setActionError(null);
    try {
      const res = await fetch(`/api/publishing/jobs/${encodeURIComponent(current.job.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: platformId }),
      });
      const data = await res.json();
      if (res.ok && data.ok) { setCurrent(data); await loadPublishJobs(); }
      else setActionError(data.error || 'Platform change failed.');
    } finally {
      setSavingFields(false);
    }
  };

  // ── Validate / ready / schedule / publish / fail / cancel ────────────

  const runValidate = async () => {
    if (!current) return;
    setValidating(true); setActionError(null);
    try {
      const res = await fetch(`/api/publishing/jobs/${encodeURIComponent(current.job.id)}/validate`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.ok) setCurrent(c => ({ ...c, job: data.job }));
      else setActionError(data.error || 'Validation failed.');
    } finally {
      setValidating(false);
    }
  };

  const markReady = async () => {
    if (!current) return;
    setMarkingReady(true); setActionError(null);
    try {
      const res = await fetch(`/api/publishing/jobs/${encodeURIComponent(current.job.id)}/ready`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.ok) { await openPublishJob(current.job.id); await loadPublishJobs(); }
      else setActionError(data.error || (data.validation ? `Blocked: ${data.validation.warnings.filter(w => w.severity === 'blocking').map(w => w.message).join(' ')}` : 'Could not mark ready.'));
    } finally {
      setMarkingReady(false);
    }
  };

  const submitSchedule = async () => {
    if (!current || !scheduleInput) return;
    setScheduling(true); setActionError(null);
    try {
      const res = await fetch(`/api/publishing/jobs/${encodeURIComponent(current.job.id)}/schedule`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledFor: new Date(scheduleInput).toISOString() }),
      });
      const data = await res.json();
      if (res.ok && data.ok) { await openPublishJob(current.job.id); await loadPublishJobs(); }
      else setActionError(data.error || 'Scheduling failed.');
    } finally {
      setScheduling(false);
    }
  };

  const submitPublish = async () => {
    if (!current) return;
    setPublishing(true); setActionError(null);
    try {
      const res = await fetch(`/api/publishing/jobs/${encodeURIComponent(current.job.id)}/publish`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, note: publishNote || undefined }),
      });
      const data = await res.json();
      if (res.ok && data.ok) { await openPublishJob(current.job.id); await loadPublishJobs(); setPublishNote(''); }
      else setActionError(data.error || 'Publish failed.');
    } finally {
      setPublishing(false);
    }
  };

  const submitFail = async () => {
    if (!current || !failReason.trim()) return;
    setFailing(true); setActionError(null);
    try {
      const res = await fetch(`/api/publishing/jobs/${encodeURIComponent(current.job.id)}/fail`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: failReason }),
      });
      const data = await res.json();
      if (res.ok && data.ok) { await openPublishJob(current.job.id); await loadPublishJobs(); setFailReason(''); }
      else setActionError(data.error || 'Could not mark failed.');
    } finally {
      setFailing(false);
    }
  };

  const submitCancel = async () => {
    if (!current) return;
    setCancelling(true); setActionError(null);
    try {
      const res = await fetch(`/api/publishing/jobs/${encodeURIComponent(current.job.id)}/cancel`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.ok) { await openPublishJob(current.job.id); await loadPublishJobs(); }
      else setActionError(data.error || 'Cancel failed.');
    } finally {
      setCancelling(false);
    }
  };

  // ── Manual export ──────────────────────────────────────────────────────

  const exportBundle = async (format) => {
    if (!current) return;
    setExportingFormat(format);
    try {
      const res = await fetch(`/api/publishing/jobs/${encodeURIComponent(current.job.id)}/export`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        const mime = format === 'markdown' ? 'text/markdown' : 'application/json';
        const ext = format === 'markdown' ? 'md' : 'json';
        downloadBlob(data.content, mime, `${current.job.id}-${current.job.platform}.${ext}`);
        setCurrent(c => ({ ...c, job: data.job }));
        await loadPublishJobs();
      } else {
        setActionError(data.error || 'Export failed.');
      }
    } finally {
      setExportingFormat(null);
    }
  };

  // ── Library filtering ──────────────────────────────────────────────────

  const filteredLibrary = useMemo(() => {
    const q = librarySearch.trim().toLowerCase();
    return publishJobs.filter(j => {
      if (filterStatus !== 'all' && j.status !== filterStatus) return false;
      if (filterPlatform !== 'all' && j.platform !== filterPlatform) return false;
      if (q && !`${j.caption || ''} ${j.platform}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [publishJobs, filterStatus, filterPlatform, librarySearch]);

  const validation = current?.job?.lastValidation || null;
  const modalArtifact = modalArtifactId ? (current?.artifacts || []).find(a => a.artifactId === modalArtifactId) : null;

  return (
    <div className="pr-wrapper">
      <div className="pr-wrapper-head">
        <h3 className="font-ui">Publishing Router</h3>
        <p className="font-mono">Prepare and manually publish approved production outputs across platforms. Manual export only — no automatic upload, no OAuth, no API calls.</p>
      </div>

      <div className="pub-grid">
        {/* ══════════════════ LEFT — approved production jobs ══════════════════ */}
        <div className="hf-studio-col">
          <div className="ts-library-search">
            <FiSearch size={13} />
            <input type="text" placeholder="Search by topic or brand…" value={sourceSearch} onChange={e => setSourceSearch(e.target.value)} className="font-mono" />
          </div>
          {candidateJobs.length === 0 ? (
            <div className="thumb-empty font-mono">No completed production jobs yet — finish one in Production Router first.</div>
          ) : (
            <div className="pub-source-list">
              {filteredCandidates.map(job => (
                <SourceJobRow
                  key={job.id} job={job} pkg={packageMap[job.packageId]}
                  selected={selectedSourceJob?.id === job.id}
                  eligible={job.review?.status === 'approved'}
                  onSelect={selectSourceJob}
                />
              ))}
            </div>
          )}

          {selectedSourceJob && (
            <div className="pr-section">
              <div className="pr-section-head"><span className="font-ui">New Publish Job</span></div>
              <div className="pr-field">
                <label className="pr-field-label font-ui">Platform</label>
                <select className="pr-select font-mono" value={createPlatform} onChange={e => setCreatePlatform(e.target.value)}>
                  <option value="">Select a platform…</option>
                  {platforms.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}
                </select>
              </div>
              {selectedSourceArtifacts.length > 1 && (
                <div className="pr-field">
                  <label className="pr-field-label font-ui">Artifact</label>
                  <select className="pr-select font-mono" value={createArtifactId} onChange={e => setCreateArtifactId(e.target.value)}>
                    {selectedSourceArtifacts.map(a => <option key={a.artifactId} value={a.artifactId}>{a.filename}</option>)}
                  </select>
                </div>
              )}
              {createError && <div className="pr-warning font-mono"><FiAlertCircle size={11} /> {createError}</div>}
              <button type="button" className="thumb-generate-btn font-ui" disabled={!createPlatform || creating} onClick={createPublishJob}>
                {creating ? <><FiRefreshCw size={12} className="spin" /> Creating…</> : <><FiZap size={12} /> Create Publish Job</>}
              </button>
            </div>
          )}
        </div>

        {/* ══════════════════ CENTER — publish configuration ══════════════════ */}
        <div className="hf-studio-col">
          {!current ? (
            <div className="thumb-empty font-mono cpg-empty-panel">
              Select an approved production job on the left, or open one from Recent Publish Jobs below.
            </div>
          ) : (
            <>
              <div className="pr-section">
                <div className="pr-section-head">
                  <span className="font-ui">{current.platform?.displayName || current.job.platform}</span>
                  <StateBadge state={current.job.status} size="lg" />
                </div>
                {['draft', 'ready'].includes(current.job.status) && (
                  <div className="pr-field">
                    <label className="pr-field-label font-ui">Platform</label>
                    <select className="pr-select font-mono" value={current.job.platform} onChange={e => changePlatform(e.target.value)} disabled={savingFields}>
                      {platforms.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}
                    </select>
                  </div>
                )}
              </div>

              {['draft', 'ready'].includes(current.job.status) ? (
                <div className="pr-section">
                  <div className="pr-section-head"><span className="font-ui">Caption & Hashtags</span></div>
                  <div className="pr-field">
                    <label className="pr-field-label font-ui">Caption</label>
                    <textarea className="pr-input font-mono" rows={4} value={captionDraft} onChange={e => setCaptionDraft(e.target.value)} maxLength={5000} placeholder="Write the caption for this platform…" />
                  </div>
                  <div className="pr-field">
                    <label className="pr-field-label font-ui">Hashtags (comma-separated)</label>
                    <input type="text" className="pr-input font-mono" value={hashtagsDraft} onChange={e => setHashtagsDraft(e.target.value)} placeholder="brand, launch, tutorial" />
                  </div>
                  <div className="pr-field">
                    <label className="pr-field-label font-ui">First comment (optional)</label>
                    <input type="text" className="pr-input font-mono" value={firstCommentDraft} onChange={e => setFirstCommentDraft(e.target.value)} placeholder="Posted separately after the main upload…" />
                  </div>
                  <button type="button" className="pr-btn font-ui" onClick={saveFields} disabled={savingFields}>
                    {savingFields ? <><FiRefreshCw size={12} className="spin" /> Saving…</> : <><FiCheck size={12} /> Save Fields</>}
                  </button>
                </div>
              ) : (
                <div className="pr-section">
                  <div className="pr-section-head"><span className="font-ui">Caption & Hashtags</span></div>
                  <p className="pr-reason-text font-mono">{current.job.caption || '_No caption._'}</p>
                  <p className="pr-reason-text font-mono">{(current.job.hashtags || []).map(h => `#${h}`).join(' ') || '—'}</p>
                </div>
              )}

              <div className="pr-section">
                <div className="pr-section-head"><span className="font-ui">Validation</span></div>
                <button type="button" className="pr-btn font-ui" onClick={runValidate} disabled={validating}>
                  {validating ? <><FiRefreshCw size={12} className="spin" /> Validating…</> : <><FiCheck size={12} /> Validate</>}
                </button>
                {validation && (
                  <div className="pub-validation-list">
                    {validation.warnings.length === 0 ? (
                      <div className="pr-approved-flash font-mono"><FiCheckCircle size={12} /> No issues found.</div>
                    ) : validation.warnings.map((w, i) => (
                      <div key={i} className={`pr-warning font-mono${w.severity === 'blocking' ? '' : ' pr-warning--stale'}`}>
                        <FiAlertCircle size={11} /> {w.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="pr-section pr-approval-panel">
                <div className="pr-section-head"><span className="font-ui">Schedule & Publish</span></div>
                {current.job.status === 'draft' && (
                  <button type="button" className="pr-btn pr-btn--approve font-ui" onClick={markReady} disabled={markingReady}>
                    {markingReady ? <><FiRefreshCw size={12} className="spin" /> Checking…</> : <><FiCheck size={12} /> Mark Ready</>}
                  </button>
                )}
                {current.job.status === 'ready' && (
                  <>
                    <div className="pr-row-2">
                      <div className="pr-field">
                        <label className="pr-field-label font-ui">Schedule for</label>
                        <input type="datetime-local" className="pr-input font-mono" value={scheduleInput} onChange={e => setScheduleInput(e.target.value)} />
                      </div>
                      <div className="pr-field pub-schedule-btn-field">
                        <button type="button" className="pr-btn font-ui" onClick={submitSchedule} disabled={!scheduleInput || scheduling}>
                          {scheduling ? <FiRefreshCw size={12} className="spin" /> : <FiCalendar size={12} />} Schedule
                        </button>
                      </div>
                    </div>
                    <input type="text" className="pr-input font-mono" placeholder="Note for this manual publish (optional)…" value={publishNote} onChange={e => setPublishNote(e.target.value)} />
                    <button type="button" className="pr-btn pr-btn--approve font-ui" onClick={submitPublish} disabled={publishing}>
                      {publishing ? <><FiRefreshCw size={12} className="spin" /> Publishing…</> : <><FiSend size={12} /> Publish Now (Manual)</>}
                    </button>
                  </>
                )}
                {current.job.status === 'scheduled' && (
                  <>
                    <div className="pr-exec-meta font-mono"><span>Scheduled for: {formatDate(current.job.scheduledFor)}</span></div>
                    <input type="text" className="pr-input font-mono" placeholder="Note for this manual publish (optional)…" value={publishNote} onChange={e => setPublishNote(e.target.value)} />
                    <button type="button" className="pr-btn pr-btn--approve font-ui" onClick={submitPublish} disabled={publishing}>
                      {publishing ? <><FiRefreshCw size={12} className="spin" /> Publishing…</> : <><FiSend size={12} /> Publish Now (Manual)</>}
                    </button>
                    <div className="pr-row-2">
                      <input type="text" className="pr-input font-mono" placeholder="Reason it failed…" value={failReason} onChange={e => setFailReason(e.target.value)} />
                      <button type="button" className="pr-btn pr-btn--reject font-ui" onClick={submitFail} disabled={!failReason.trim() || failing}>
                        <FiX size={12} /> Mark Failed
                      </button>
                    </div>
                  </>
                )}
                {current.job.status === 'published' && (
                  <div className="pr-approved-flash font-mono"><FiCheckCircle size={12} /> Published {formatDate(current.job.publishedAt)}{current.job.publishResult?.note ? ` — ${current.job.publishResult.note}` : ''}</div>
                )}
                {current.job.status === 'failed' && (
                  <div className="pr-warning font-mono"><FiAlertCircle size={11} /> Failed — {current.job.publishResult?.reason || 'no reason given'}</div>
                )}
                {current.job.status === 'cancelled' && (
                  <div className="pr-exec-meta font-mono"><span>Cancelled.</span></div>
                )}
                {!['published', 'cancelled'].includes(current.job.status) && (
                  <button type="button" className="pr-btn pr-btn--muted font-ui" onClick={submitCancel} disabled={cancelling}>
                    {cancelling ? <FiRefreshCw size={12} className="spin" /> : <FiThumbsDown size={12} />} Cancel
                  </button>
                )}
                {actionError && <div className="pr-warning font-mono"><FiAlertCircle size={11} /> {actionError}</div>}
              </div>
            </>
          )}
        </div>

        {/* ══════════════════ RIGHT — preview / checklist / export / history ══════════════════ */}
        <div className="hf-studio-col">
          {!current ? (
            <div className="thumb-empty font-mono">Publish preview, platform checklist, and manual export will appear here.</div>
          ) : (
            <>
              <div className="pr-section pr-output-preview">
                <div className="pr-section-head"><span className="font-ui">Publish Preview</span></div>
                {current.artifact ? (
                  <>
                    <ArtifactViewer artifact={current.artifact} variant="inline" onRequestFullscreen={() => setModalArtifactId(current.artifact.artifactId)} />
                    <ArtifactMetadata artifact={current.artifact} job={current.productionJob} />
                    <button type="button" className="ts-modal-btn font-ui" onClick={() => setModalArtifactId(current.artifact.artifactId)}>
                      <FiEye size={12} /> Fullscreen Preview
                    </button>
                  </>
                ) : (
                  <div className="pr-output-preview-empty font-mono">No previewable local artifact attached.</div>
                )}
              </div>

              {current.platform && (
                <div className="pr-section">
                  <div className="pr-section-head"><span className="font-ui">{current.platform.displayName} Checklist</span></div>
                  <ul className="pub-checklist">
                    <li>Media: {current.platform.supportedMimeTypes.join(', ')}</li>
                    <li>Duration: {current.platform.durationSeconds.min}s – {current.platform.durationSeconds.max}s</li>
                    <li>Aspect ratio: {current.platform.aspectRatioGuidance}</li>
                    <li>Caption limit: {current.platform.captionMaxChars} chars{current.platform.captionRequired ? ' (required)' : ' (optional)'}</li>
                  </ul>
                </div>
              )}

              <div className="pr-section">
                <div className="pr-section-head"><span className="font-ui">Manual Export</span></div>
                <p className="pr-reason-text font-mono">Everything needed to publish by hand — video, caption, hashtags, metadata, thumbnail, checklist.</p>
                <div className="pr-export-actions">
                  <a href={`/api/publishing/jobs/${encodeURIComponent(current.job.id)}/export-zip`} className="pr-btn pr-btn--secondary font-ui">
                    <FiDownload size={12} /> Download ZIP
                  </a>
                  <button type="button" className="pr-btn pr-btn--secondary font-ui" onClick={() => exportBundle('json')} disabled={exportingFormat === 'json'}>
                    {exportingFormat === 'json' ? <FiRefreshCw size={12} className="spin" /> : <FiDownload size={12} />} Download JSON
                  </button>
                  <button type="button" className="pr-btn pr-btn--secondary font-ui" onClick={() => exportBundle('markdown')} disabled={exportingFormat === 'markdown'}>
                    {exportingFormat === 'markdown' ? <FiRefreshCw size={12} className="spin" /> : <FiDownload size={12} />} Download Markdown
                  </button>
                </div>
              </div>

              <div className="pr-section">
                <div className="pr-section-head"><span className="font-ui">Activity History</span></div>
                <ol className="cpp-timeline">
                  {[...(current.job.activityHistory || [])].reverse().map((h, i) => (
                    <li key={i} className="cpp-timeline-item">
                      <span className="pr-event-badge font-mono">{h.type.replaceAll('_', ' ')}</span>
                      <span className="cpp-timeline-date font-mono">{formatDate(h.at)}</span>
                      {h.note && <span className="cpp-timeline-note font-mono">{shorten(h.note, 140)}</span>}
                    </li>
                  ))}
                </ol>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ══════════════════ Recent Publish Jobs ══════════════════ */}
      <div className="ts-history-section">
        <div className="thumb-section-head">
          <span className="font-ui">Recent Publish Jobs</span>
          <button type="button" className="thumb-icon-btn" onClick={loadPublishJobs} disabled={libLoading} title="Refresh">
            <FiRefreshCw size={11} className={libLoading ? 'spin' : ''} />
          </button>
        </div>
        <div className="ts-library-toolbar">
          <div className="ts-library-search">
            <FiSearch size={13} />
            <input type="text" placeholder="Search by caption or platform…" value={librarySearch} onChange={e => setLibrarySearch(e.target.value)} className="font-mono" />
          </div>
          <div className="ts-library-filters">
            <FiFilter size={11} className="ts-filter-icon" />
            <select className="ts-filter-select font-mono" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="all">All statuses</option>
              {Object.keys(PUBLISH_STATE_META).map(s => <option key={s} value={s}>{PUBLISH_STATE_META[s].label}</option>)}
            </select>
            <select className="ts-filter-select font-mono" value={filterPlatform} onChange={e => setFilterPlatform(e.target.value)}>
              <option value="all">All platforms</option>
              {platforms.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}
            </select>
          </div>
        </div>
        {libLoading && !libLoaded ? (
          <div className="thumb-empty font-mono">Loading publish jobs…</div>
        ) : filteredLibrary.length === 0 ? (
          <div className="thumb-empty font-mono">{publishJobs.length === 0 ? 'No publish jobs yet — create one above.' : 'No jobs match these filters.'}</div>
        ) : (
          <div className="ts-library-grid">
            {filteredLibrary.map(job => <PublishJobCard key={job.id} job={job} onOpen={openFromLibrary} />)}
          </div>
        )}
      </div>

      {modalArtifact && (
        <ArtifactPreviewModal
          artifact={modalArtifact}
          artifacts={current.artifacts}
          job={current.productionJob}
          onClose={() => setModalArtifactId(null)}
          onSelect={a => setModalArtifactId(a.artifactId)}
        />
      )}
    </div>
  );
}
