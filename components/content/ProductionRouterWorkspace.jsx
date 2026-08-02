import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  FiAlertCircle, FiCheck, FiCheckCircle, FiDownload, FiFilter,
  FiRefreshCw, FiSearch, FiThumbsDown, FiX, FiZap,
} from 'react-icons/fi';
import {
  PRODUCTION_MODES, PROVIDER_CATALOG, modeLabel, assetLabel,
} from '../../lib/production/productionRules';

// ── Constants ─────────────────────────────────────────────────────────────────

const JOB_STATE_META = {
  draft:          { label: 'Draft',          color: '#a78bfa' },
  blocked:        { label: 'Blocked',        color: '#f87171' },
  needs_assets:   { label: 'Needs Assets',   color: '#fb923c' },
  needs_approval: { label: 'Needs Approval', color: '#f59e0b' },
  ready:          { label: 'Ready',          color: '#4ade80' },
  queued:         { label: 'Queued',         color: '#60a5fa' },
  executing:      { label: 'Executing',      color: '#60a5fa' },
  completed:      { label: 'Completed',      color: '#4ade80' },
  failed:         { label: 'Failed',         color: '#f87171' },
  cancelled:      { label: 'Cancelled',      color: '#5d6c86' },
};

const PROVIDER_STATUS_META = {
  active:      { label: 'Active',      color: '#4ade80' },
  staged:      { label: 'Staged',      color: '#f59e0b' },
  unavailable: { label: 'Unavailable', color: '#f87171' },
};

const DATE_RANGES = [
  { id: 'all',   label: 'All time' },
  { id: 'today', label: 'Today' },
  { id: '7d',    label: 'Last 7 days' },
  { id: '30d',   label: 'Last 30 days' },
];

const LIBRARY_LIMIT = 50;

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Small shared pieces ──────────────────────────────────────────────────────

function StateBadge({ state, size = 'sm' }) {
  const m = JOB_STATE_META[state] || { label: state, color: '#5d6c86' };
  return (
    <span
      className={`pr-status-badge pr-status-badge--${size} font-mono`}
      style={{ color: m.color, background: `${m.color}1f`, borderColor: `${m.color}40` }}
    >
      {m.label}
    </span>
  );
}

function ReadinessMeter({ readiness }) {
  if (!readiness) return null;
  const color = readiness.ready ? '#4ade80' : readiness.score >= 50 ? '#f59e0b' : '#f87171';
  return (
    <div className="pr-readiness">
      <div className="pr-readiness-head font-ui">
        <span>Readiness</span>
        <span className="font-mono" style={{ color }}>{readiness.score}/100</span>
      </div>
      <div className="pr-readiness-bar">
        <div className="pr-readiness-bar-fill" style={{ width: `${Math.max(0, Math.min(100, readiness.score))}%`, background: color }} />
      </div>
      {readiness.missingRequired.length > 0 && (
        <div className="pr-asset-group">
          <span className="pr-asset-group-label font-ui">Missing required</span>
          <div className="pr-asset-list">
            {readiness.missingRequired.map(k => <span key={k} className="pr-asset-chip pr-asset-chip--missing font-mono">{assetLabel(k)}</span>)}
          </div>
        </div>
      )}
      {readiness.missingOptional.length > 0 && (
        <div className="pr-asset-group">
          <span className="pr-asset-group-label font-ui">Missing optional</span>
          <div className="pr-asset-list">
            {readiness.missingOptional.map(k => <span key={k} className="pr-asset-chip font-mono">{assetLabel(k)}</span>)}
          </div>
        </div>
      )}
      {readiness.available.length > 0 && (
        <div className="pr-asset-group">
          <span className="pr-asset-group-label font-ui">Available</span>
          <div className="pr-asset-list">
            {readiness.available.map(k => <span key={k} className="pr-asset-chip pr-asset-chip--ok font-mono">{assetLabel(k)}</span>)}
          </div>
        </div>
      )}
      {readiness.warnings.map((w, i) => (
        <div key={i} className="pr-warning font-mono"><FiAlertCircle size={11} /> {w}</div>
      ))}
    </div>
  );
}

function ProviderCandidates({ job }) {
  if (!job.providerCandidates?.length) return null;
  return (
    <div className="pr-provider-list">
      {job.providerCandidates.map(c => {
        const meta = PROVIDER_STATUS_META[c.status] || { label: c.status, color: '#5d6c86' };
        const isRecommended = c.id === job.recommendedProvider;
        const isSelected = c.id === job.selectedProvider;
        return (
          <div key={c.id} className={`pr-provider-item${isSelected ? ' pr-provider-item--selected' : ''}`}>
            <div className="pr-provider-item-top">
              <span className="font-ui">{c.displayName}</span>
              {isRecommended && <span className="pr-provider-recommended-tag font-mono">recommended</span>}
              {isSelected && <span className="pr-provider-recommended-tag font-mono">selected</span>}
              <span className="pr-provider-badge font-mono" style={{ color: meta.color, background: `${meta.color}1f`, borderColor: `${meta.color}40` }}>{meta.label}</span>
            </div>
            {!c.executable && job.unavailableReasons?.[c.id] && (
              <div className="pr-provider-reason font-mono">{job.unavailableReasons[c.id]}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function OutputSpecGrid({ spec }) {
  if (!spec) return null;
  const rows = [
    ['Platform', spec.platform], ['Aspect ratio', spec.aspectRatio], ['Target duration', spec.targetDuration],
    ['Resolution', spec.resolution], ['Frame rate', `${spec.frameRate}fps`], ['Caption burn-in', spec.captionBurnIn ? 'Yes' : 'No'],
    ['File format', spec.fileFormat],
  ];
  return (
    <div className="pr-output-spec-grid">
      {rows.map(([label, value]) => (
        <div key={label} className="pr-output-spec-item">
          <span className="pr-output-spec-label font-ui">{label}</span>
          <span className="pr-output-spec-value font-mono">{value}</span>
        </div>
      ))}
      <div className="pr-output-spec-item pr-output-spec-item--full">
        <span className="pr-output-spec-label font-ui">Safe-area notes</span>
        <span className="pr-output-spec-value font-mono">{spec.safeAreaNotes}</span>
      </div>
    </div>
  );
}

function ActivityTimeline({ history }) {
  const timeline = [...(history || [])].reverse();
  if (!timeline.length) return null;
  return (
    <ol className="cpp-timeline">
      {timeline.map((h, i) => (
        <li key={i} className="cpp-timeline-item">
          <span className="pr-event-badge font-mono">{h.type.replaceAll('_', ' ')}</span>
          <span className="cpp-timeline-date font-mono">{formatDate(h.at)}</span>
          {h.note && <span className="cpp-timeline-note font-mono">{shorten(h.note, 140)}</span>}
        </li>
      ))}
    </ol>
  );
}

// ── Job detail panel (right column) ──────────────────────────────────────────

function JobPanel({
  job, pkg, onApprove, onCancel, onRefresh, onPatchMode, onPatchProvider,
  onExport, approving, refreshing, patching, exportingFormat, actionError,
}) {
  const [editMode, setEditMode] = useState(false);
  const [editProvider, setEditProvider] = useState(false);
  const isStale = pkg && job.packageUpdatedAt !== pkg.metadata?.updatedAt;

  return (
    <div className="pr-panel">
      <div className="pr-panel-head">
        <div className="pr-panel-head-main">
          <h3 className="font-ui">{pkg?.topic || job.packageId}</h3>
          <div className="pr-panel-chips font-mono">
            <span>{pkg?.brand || '—'}</span><span>·</span><span>{pkg?.platform || '—'}</span>
          </div>
        </div>
        <StateBadge state={job.status} size="lg" />
      </div>

      {isStale && (
        <div className="pr-warning pr-warning--stale font-mono">
          <FiAlertCircle size={11} /> Package has changed since this plan was built. Refresh to reconcile.
        </div>
      )}
      {actionError && (
        <div className="pr-warning font-mono"><FiAlertCircle size={11} /> {actionError}</div>
      )}

      {job.status === 'blocked' ? (
        <div className="pr-section">
          <div className="pr-section-head"><span className="font-ui">Not Eligible</span></div>
          <ul className="pr-reason-list font-mono">
            {job.eligibility.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      ) : (
        <>
          <div className="pr-section">
            <div className="pr-section-head"><span className="font-ui">Mode</span></div>
            <div className="pr-mode-row font-mono">
              <span>Recommended: <strong>{modeLabel(job.recommendedMode)}</strong></span>
              {editMode ? (
                <select className="pr-select font-mono" defaultValue={job.selectedMode} onChange={e => { onPatchMode(e.target.value); setEditMode(false); }}>
                  {PRODUCTION_MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              ) : (
                <button type="button" className="pr-btn pr-btn--muted font-ui" onClick={() => setEditMode(true)} disabled={patching}>
                  Selected: {modeLabel(job.selectedMode)} · Edit
                </button>
              )}
            </div>
            <p className="pr-reason-text font-mono">{job.modeReason}</p>
          </div>

          <div className="pr-section">
            <div className="pr-section-head"><span className="font-ui">Provider</span></div>
            <div className="pr-mode-row font-mono">
              {editProvider ? (
                <select className="pr-select font-mono" defaultValue={job.selectedProvider} onChange={e => { onPatchProvider(e.target.value); setEditProvider(false); }}>
                  {PROVIDER_CATALOG.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}
                </select>
              ) : (
                <button type="button" className="pr-btn pr-btn--muted font-ui" onClick={() => setEditProvider(true)} disabled={patching}>
                  Selected: {job.providerCandidates?.find(c => c.id === job.selectedProvider)?.displayName || job.selectedProvider} · Edit
                </button>
              )}
            </div>
            <ProviderCandidates job={job} />
          </div>

          <ReadinessMeter readiness={job.readiness} />

          <div className="pr-section">
            <div className="pr-section-head"><span className="font-ui">Output Specification</span></div>
            <OutputSpecGrid spec={job.outputSpec} />
          </div>

          {job.budget && (
            <div className="pr-section">
              <div className="pr-section-head"><span className="font-ui">Budget</span></div>
              <div className="pr-budget-row font-mono">
                <span>Cost tier: <strong>{job.budget.costTier}</strong></span>
                {job.budget.estimatedRange && (
                  <span>Estimate: ${job.budget.estimatedRange.min}–${job.budget.estimatedRange.max} {job.budget.estimatedRange.unit} <em>(provisional)</em></span>
                )}
                {job.budget.maxEstimatedCost != null && <span>Max: ${job.budget.maxEstimatedCost} {job.budget.currency}</span>}
              </div>
              <p className="pr-reason-text font-mono">{job.budget.approvalReason}</p>
            </div>
          )}

          <div className="pr-section pr-approval-panel">
            <div className="pr-section-head"><span className="font-ui">Approval</span></div>
            {job.approval?.approvedAt ? (
              <div className="pr-approved-flash font-mono"><FiCheckCircle size={12} /> Approved {formatDate(job.approval.approvedAt)}</div>
            ) : (
              <div className="pr-approval-actions">
                <button
                  type="button" className="pr-btn pr-btn--approve font-ui"
                  onClick={onApprove} disabled={job.status !== 'needs_approval' || approving}
                >
                  {approving ? <><FiRefreshCw size={12} className="spin" /> Approving…</> : <><FiCheck size={12} /> Approve Plan</>}
                </button>
                <button type="button" className="pr-btn pr-btn--reject font-ui" onClick={onCancel} disabled={job.status === 'cancelled'}>
                  <FiThumbsDown size={12} /> Reject / Cancel
                </button>
              </div>
            )}
            <button type="button" className="pr-btn pr-btn--muted font-ui" onClick={onRefresh} disabled={refreshing}>
              {refreshing ? <><FiRefreshCw size={12} className="spin" /> Refreshing…</> : <><FiRefreshCw size={12} /> Refresh Plan</>}
            </button>
          </div>

          <div className="pr-section">
            <div className="pr-section-head"><span className="font-ui">Manual Export</span></div>
            <p className="pr-reason-text font-mono">Providers are not yet connected — download a production brief for a human to execute manually.</p>
            <div className="pr-export-actions">
              <button type="button" className="pr-btn pr-btn--secondary font-ui" onClick={() => onExport('json')} disabled={exportingFormat === 'json'}>
                {exportingFormat === 'json' ? <FiRefreshCw size={12} className="spin" /> : <FiDownload size={12} />} Download JSON
              </button>
              <button type="button" className="pr-btn pr-btn--secondary font-ui" onClick={() => onExport('markdown')} disabled={exportingFormat === 'markdown'}>
                {exportingFormat === 'markdown' ? <FiRefreshCw size={12} className="spin" /> : <FiDownload size={12} />} Download Markdown
              </button>
            </div>
          </div>
        </>
      )}

      <div className="pr-section">
        <div className="pr-section-head"><span className="font-ui">Activity History</span></div>
        <ActivityTimeline history={job.activityHistory} />
      </div>
    </div>
  );
}

// ── Job library card ──────────────────────────────────────────────────────────

function JobCard({ job, pkg, onOpen }) {
  const isStale = pkg && job.packageUpdatedAt !== pkg.metadata?.updatedAt;
  return (
    <button type="button" className="pr-lib-card" onClick={() => onOpen(job)}>
      <div className="pr-lib-card-top">
        <span className="pr-lib-card-title font-ui">{shorten(pkg?.topic || job.packageId, 60)}</span>
        <StateBadge state={job.status} />
      </div>
      <span className="pr-lib-card-meta font-mono">{pkg?.brand || '—'} · {pkg?.platform || '—'}</span>
      <span className="pr-lib-card-meta font-mono">
        {job.selectedMode ? modeLabel(job.selectedMode) : 'No mode'} · {job.selectedProvider || 'No provider'}
      </span>
      <span className="pr-lib-card-meta font-mono">
        Readiness: {job.readiness?.score ?? '—'}/100
      </span>
      {isStale && <span className="pr-lib-card-stale font-mono"><FiAlertCircle size={10} /> Package changed</span>}
      <span className="pr-lib-card-date font-mono">{formatDate(job.metadata?.createdAt)}</span>
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ProductionRouterWorkspace({ focusRequest, onFocusConsumed } = {}) {
  const [packages, setPackages] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [libLoading, setLibLoading] = useState(false);
  const [libLoaded, setLibLoaded] = useState(false);

  // Form state
  const [selPackageId, setSelPackageId] = useState('');
  const [selMode, setSelMode] = useState('');
  const [selProvider, setSelProvider] = useState('');
  const [maxEstimatedCost, setMaxEstimatedCost] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [approvalRequiredAbove, setApprovalRequiredAbove] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  // Current job panel state
  const [currentJob, setCurrentJob] = useState(null);
  const [approving, setApproving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [patching, setPatching] = useState(false);
  const [exportingFormat, setExportingFormat] = useState(null);
  const [actionError, setActionError] = useState(null);

  // Library filters
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterProvider, setFilterProvider] = useState('all');
  const [filterMode, setFilterMode] = useState('all');
  const [filterBrand, setFilterBrand] = useState('all');
  const [filterPlatform, setFilterPlatform] = useState('all');
  const [filterDate, setFilterDate] = useState('all');

  const focusConsumedRef = useRef(null);

  const loadPackages = useCallback(async () => {
    try {
      const res = await fetch('/api/content/pipeline/list', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setPackages(Array.isArray(data.packages) ? data.packages : []);
    } catch { /* keep prior state on transient failure */ }
  }, []);

  const loadJobs = useCallback(async () => {
    setLibLoading(true);
    try {
      const res = await fetch('/api/production/jobs', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setJobs(Array.isArray(data.jobs) ? data.jobs.slice(0, LIBRARY_LIMIT) : []);
    } finally {
      setLibLoading(false);
      setLibLoaded(true);
    }
  }, []);

  useEffect(() => { loadPackages(); loadJobs(); }, [loadPackages, loadJobs]);

  const packageMap = useMemo(() => Object.fromEntries(packages.map(p => [p.id, p])), [packages]);

  const eligiblePackages = useMemo(
    () => packages.filter(p => p.pipeline?.stage === 'approved' || p.pipeline?.stage === 'production'),
    [packages],
  );

  // ── Consume a focus request from the Package Pipeline ("Create Production
  // Plan" / "Open Production" buttons) exactly once per request.
  useEffect(() => {
    if (!focusRequest || focusConsumedRef.current === focusRequest) return;
    focusConsumedRef.current = focusRequest;

    if (focusRequest.action === 'create') {
      setSelPackageId(focusRequest.packageId);
    } else if (focusRequest.action === 'open') {
      fetch(`/api/production/jobs?packageId=${encodeURIComponent(focusRequest.packageId)}`, { cache: 'no-store' })
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          const found = data?.jobs?.[0];
          if (found) setCurrentJob(found);
          setSelPackageId(focusRequest.packageId);
        })
        .catch(() => {});
    }
    onFocusConsumed?.();
  }, [focusRequest, onFocusConsumed]);

  // ── Create plan ───────────────────────────────────────────────────────────

  const createPlan = async () => {
    if (!selPackageId || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch('/api/production/router/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packageId: selPackageId,
          selectedMode: selMode || undefined,
          selectedProvider: selProvider || undefined,
          maxEstimatedCost: maxEstimatedCost !== '' ? Number(maxEstimatedCost) : undefined,
          currency: currency || undefined,
          approvalRequiredAbove: approvalRequiredAbove || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setCreateError(data.error || `Server error ${res.status}`);
        return;
      }
      setCurrentJob(data.job);
      setActionError(null);
      await loadJobs();
      await loadPackages();
    } catch (err) {
      setCreateError(err.message || 'Request failed — please retry.');
    } finally {
      setCreating(false);
    }
  };

  // ── Job actions ───────────────────────────────────────────────────────────

  const patchJob = useCallback(async (patch) => {
    if (!currentJob) return;
    setPatching(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/production/jobs/${encodeURIComponent(currentJob.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setCurrentJob(data.job);
        await loadJobs();
      } else {
        setActionError(data.error || 'Update failed.');
      }
    } finally {
      setPatching(false);
    }
  }, [currentJob, loadJobs]);

  const approveJob = async () => {
    if (!currentJob) return;
    setApproving(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/production/jobs/${encodeURIComponent(currentJob.id)}/approve`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.ok) { setCurrentJob(data.job); await loadJobs(); }
      else setActionError(data.error || 'Approval failed.');
    } finally {
      setApproving(false);
    }
  };

  const refreshJob = async () => {
    if (!currentJob) return;
    setRefreshing(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/production/jobs/${encodeURIComponent(currentJob.id)}/refresh`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.ok) { setCurrentJob(data.job); await loadJobs(); await loadPackages(); }
      else setActionError(data.error || 'Refresh failed.');
    } finally {
      setRefreshing(false);
    }
  };

  const exportBrief = async (format) => {
    if (!currentJob) return;
    setExportingFormat(format);
    setActionError(null);
    try {
      const res = await fetch(`/api/production/jobs/${encodeURIComponent(currentJob.id)}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        const mime = format === 'markdown' ? 'text/markdown' : 'application/json';
        const ext = format === 'markdown' ? 'md' : 'json';
        downloadBlob(data.content, mime, `${currentJob.id}-brief.${ext}`);
        setCurrentJob(data.job);
        await loadJobs();
      } else {
        setActionError(data.error || 'Export failed.');
      }
    } finally {
      setExportingFormat(null);
    }
  };

  const openJob = (job) => setCurrentJob(job);

  // ── Library filtering ────────────────────────────────────────────────────

  const enrichedJobs = useMemo(() => jobs.map(j => ({ job: j, pkg: packageMap[j.packageId] || null })), [jobs, packageMap]);

  const brandOptions = useMemo(() => [...new Set(enrichedJobs.map(e => e.pkg?.brand).filter(Boolean))], [enrichedJobs]);
  const platformOptions = useMemo(() => [...new Set(enrichedJobs.map(e => e.pkg?.platform).filter(Boolean))], [enrichedJobs]);

  const filteredJobs = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = Date.now();
    return enrichedJobs.filter(({ job, pkg }) => {
      if (filterStatus !== 'all' && job.status !== filterStatus) return false;
      if (filterProvider !== 'all' && job.selectedProvider !== filterProvider) return false;
      if (filterMode !== 'all' && job.selectedMode !== filterMode) return false;
      if (filterBrand !== 'all' && pkg?.brand !== filterBrand) return false;
      if (filterPlatform !== 'all' && pkg?.platform !== filterPlatform) return false;
      if (filterDate !== 'all') {
        const t = job.metadata?.createdAt ? new Date(job.metadata.createdAt).getTime() : 0;
        const cutoff = filterDate === 'today' ? new Date().setHours(0, 0, 0, 0)
          : now - (filterDate === '7d' ? 7 : 30) * 86400000;
        if (!t || t < cutoff) return false;
      }
      if (q && !`${pkg?.topic || ''} ${pkg?.brand || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [enrichedJobs, search, filterStatus, filterProvider, filterMode, filterBrand, filterPlatform, filterDate]);

  const currentJobPackage = currentJob ? packageMap[currentJob.packageId] : null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="pr-wrapper">
      <div className="pr-wrapper-head">
        <h3 className="font-ui">Production Router</h3>
        <p className="font-mono">Turn an approved Content Package into a governed production plan. Planning only — no video is generated.</p>
      </div>

      <div className="ts-workspace">
        {/* ══════════════════ LEFT — plan controls ══════════════════ */}
        <div className="ts-workspace-left">
          <div className="pr-form">
            <div className="pr-field">
              <label className="pr-field-label font-ui">Approved package</label>
              <select className="pr-select font-mono" value={selPackageId} onChange={e => setSelPackageId(e.target.value)}>
                <option value="">Select an approved package…</option>
                {eligiblePackages.map(p => (
                  <option key={p.id} value={p.id}>{shorten(p.topic, 50)} — {p.brand} ({p.pipeline?.stage})</option>
                ))}
              </select>
              {eligiblePackages.length === 0 && (
                <div className="pr-field-hint font-mono">No packages are Approved or in Production yet — approve one in the Package Pipeline first.</div>
              )}
            </div>

            <div className="pr-row-2">
              <div className="pr-field">
                <label className="pr-field-label font-ui">Mode override</label>
                <select className="pr-select font-mono" value={selMode} onChange={e => setSelMode(e.target.value)}>
                  <option value="">Auto (recommended)</option>
                  {PRODUCTION_MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
              <div className="pr-field">
                <label className="pr-field-label font-ui">Provider override</label>
                <select className="pr-select font-mono" value={selProvider} onChange={e => setSelProvider(e.target.value)}>
                  <option value="">Auto (recommended)</option>
                  {PROVIDER_CATALOG.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}
                </select>
              </div>
            </div>

            <div className="pr-row-2">
              <div className="pr-field">
                <label className="pr-field-label font-ui">Max estimated cost</label>
                <input type="number" min={0} className="pr-input font-mono" value={maxEstimatedCost} onChange={e => setMaxEstimatedCost(e.target.value)} placeholder="Optional" />
              </div>
              <div className="pr-field">
                <label className="pr-field-label font-ui">Currency</label>
                <input type="text" className="pr-input font-mono" value={currency} onChange={e => setCurrency(e.target.value)} maxLength={10} />
              </div>
            </div>

            <div className="pr-field">
              <label className="pr-field-label font-ui">Approval required above (tier/note)</label>
              <input type="text" className="pr-input font-mono" value={approvalRequiredAbove} onChange={e => setApprovalRequiredAbove(e.target.value)} placeholder="Optional" maxLength={40} />
            </div>

            {createError && (
              <div className="pr-warning font-mono"><FiAlertCircle size={11} /> {createError}</div>
            )}

            <button type="button" className="thumb-generate-btn font-ui" disabled={!selPackageId || creating} onClick={createPlan}>
              {creating ? <><FiRefreshCw size={12} className="spin" /> Building plan…</> : <><FiZap size={12} /> Create Plan</>}
            </button>
          </div>
        </div>

        {/* ══════════════════ RIGHT — job panel ══════════════════ */}
        <div className="ts-workspace-right">
          {!currentJob ? (
            <div className="thumb-empty font-mono cpg-empty-panel">
              Select an approved package on the left and create a plan, or open one from Recent Production Jobs below.
            </div>
          ) : (
            <JobPanel
              job={currentJob}
              pkg={currentJobPackage}
              onApprove={approveJob}
              onCancel={() => patchJob({ cancel: true })}
              onRefresh={refreshJob}
              onPatchMode={mode => patchJob({ selectedMode: mode })}
              onPatchProvider={provider => patchJob({ selectedProvider: provider })}
              onExport={exportBrief}
              approving={approving}
              refreshing={refreshing}
              patching={patching}
              exportingFormat={exportingFormat}
              actionError={actionError}
            />
          )}
        </div>
      </div>

      {/* ══════════════════ Recent Production Jobs (full width) ══════════════════ */}
      <div className="ts-history-section">
        <div className="thumb-section-head">
          <span className="font-ui">Recent Production Jobs</span>
          <button type="button" className="thumb-icon-btn" onClick={loadJobs} disabled={libLoading} title="Refresh">
            <FiRefreshCw size={11} className={libLoading ? 'spin' : ''} />
          </button>
        </div>

        <div className="ts-library-toolbar">
          <div className="ts-library-search">
            <FiSearch size={13} />
            <input type="text" placeholder="Search by topic or brand…" value={search} onChange={e => setSearch(e.target.value)} className="font-mono" />
          </div>
          <div className="ts-library-filters">
            <FiFilter size={11} className="ts-filter-icon" />
            <select className="ts-filter-select font-mono" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="all">All statuses</option>
              {Object.keys(JOB_STATE_META).map(s => <option key={s} value={s}>{JOB_STATE_META[s].label}</option>)}
            </select>
            <select className="ts-filter-select font-mono" value={filterProvider} onChange={e => setFilterProvider(e.target.value)}>
              <option value="all">All providers</option>
              {PROVIDER_CATALOG.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}
            </select>
            <select className="ts-filter-select font-mono" value={filterMode} onChange={e => setFilterMode(e.target.value)}>
              <option value="all">All modes</option>
              {PRODUCTION_MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <select className="ts-filter-select font-mono" value={filterBrand} onChange={e => setFilterBrand(e.target.value)}>
              <option value="all">All brands</option>
              {brandOptions.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
            <select className="ts-filter-select font-mono" value={filterPlatform} onChange={e => setFilterPlatform(e.target.value)}>
              <option value="all">All platforms</option>
              {platformOptions.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select className="ts-filter-select font-mono" value={filterDate} onChange={e => setFilterDate(e.target.value)}>
              {DATE_RANGES.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </div>
        </div>

        {libLoading && !libLoaded ? (
          <div className="thumb-empty font-mono">Loading production jobs…</div>
        ) : filteredJobs.length === 0 ? (
          <div className="thumb-empty font-mono">
            {jobs.length === 0 ? 'No production jobs yet. Create a plan above to start.' : 'No jobs match these filters.'}
          </div>
        ) : (
          <div className="ts-library-grid">
            {filteredJobs.map(({ job, pkg }) => <JobCard key={job.id} job={job} pkg={pkg} onOpen={openJob} />)}
          </div>
        )}
      </div>
    </div>
  );
}
