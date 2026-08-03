import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  FiAlertCircle, FiCheckCircle, FiClock, FiDownload,
  FiFilm, FiPackage, FiPlay, FiRefreshCw, FiSearch, FiSend, FiX, FiZap,
} from 'react-icons/fi';
import RelationshipGraph from './RelationshipGraph';

// ── Constants ─────────────────────────────────────────────────────────────

const HEALTH_META = {
  healthy:          { label: 'Healthy',          color: '#4ade80' },
  waiting_approval: { label: 'Waiting Approval', color: '#f59e0b' },
  rendering:        { label: 'Rendering',        color: '#60a5fa' },
  ready_to_publish: { label: 'Ready to Publish', color: '#4ade80' },
  publishing:       { label: 'Publishing',       color: '#60a5fa' },
  published:        { label: 'Published',        color: '#c9a84c' },
  blocked:          { label: 'Blocked',          color: '#f87171' },
  failed:           { label: 'Failed',           color: '#f87171' },
  archived:         { label: 'Archived',         color: '#5d6c86' },
};

const STAGE_STATUS_ICON = {
  done: FiCheckCircle, active: FiPlay, pending: FiClock, blocked: FiAlertCircle, failed: FiX,
};

function formatDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}
function shorten(text, max = 60) {
  if (!text) return '';
  const t = String(text).trim();
  return t.length > max ? `${t.slice(0, max).trim()}…` : t;
}

function HealthBadge({ health }) {
  if (!health) {
    return <span className="pr-status-badge font-mono" style={{ color: '#5d6c86', background: '#5d6c8a1f', borderColor: '#5d6c8a40' }}>…</span>;
  }
  const m = HEALTH_META[health] || { label: health, color: '#5d6c86' };
  return (
    <span className="pr-status-badge font-mono" style={{ color: m.color, background: `${m.color}1f`, borderColor: `${m.color}40` }}>
      {m.label}
    </span>
  );
}

function MetricCard({ icon: Icon, label, value, detail }) {
  return (
    <div className="orch-metric-card">
      <div className="orch-metric-head"><Icon size={13} /><span className="font-ui">{label}</span></div>
      <div className="orch-metric-value font-mono">{value}</div>
      {detail && <div className="orch-metric-detail font-mono">{detail}</div>}
    </div>
  );
}

function QueueWidget({ icon: Icon, label, count }) {
  return (
    <div className="orch-queue-widget">
      <Icon size={13} />
      <span className="font-ui">{label}</span>
      <span className="orch-queue-count font-mono">{count}</span>
    </div>
  );
}

// ── Package library row ──────────────────────────────────────────────────

function PackageRow({ pkg, health, selected, onSelect }) {
  return (
    <button type="button" className={`pub-source-row${selected ? ' pub-source-row--selected' : ''}`} onClick={() => onSelect(pkg.id)}>
      <span className="pub-source-row-top">
        <span className="font-ui">{shorten(pkg.topic || pkg.id, 44)}</span>
        <HealthBadge health={health} />
      </span>
      <span className="pub-source-row-meta font-mono">{pkg.brand || '—'} · {pkg.platform || '—'} · {pkg.pipeline?.stage || 'draft'}</span>
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export default function ContentOrchestratorWorkspace({
  focusRequest, onFocusConsumed, onOpenProductionRouter, onOpenPublishingRouter, onOpenPackagePipeline,
} = {}) {
  const [metrics, setMetrics] = useState(null);
  const [packages, setPackages] = useState([]);
  const [packagesLoading, setPackagesLoading] = useState(false);
  const [selectedPackageId, setSelectedPackageId] = useState(null);
  const [workflow, setWorkflow] = useState(null);
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [workflowError, setWorkflowError] = useState(null);

  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchDebounceRef = useRef(null);

  const [librarySearch, setLibrarySearch] = useState('');

  const focusConsumedRef = useRef(null);

  // ── Loaders ───────────────────────────────────────────────────────────

  const loadMetrics = useCallback(async () => {
    try {
      const res = await fetch('/api/orchestration/overview', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && data.ok) setMetrics(data.metrics);
    } catch { /* keep prior state on transient failure */ }
  }, []);

  const loadPackages = useCallback(async () => {
    setPackagesLoading(true);
    try {
      const res = await fetch('/api/content/pipeline/list', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok) setPackages(Array.isArray(data.packages) ? data.packages : []);
    } finally {
      setPackagesLoading(false);
    }
  }, []);

  useEffect(() => { loadMetrics(); loadPackages(); }, [loadMetrics, loadPackages]);

  // Real health for every package in the list — sourced from the overview
  // endpoint's per-package health map (computed once, server-side, over all
  // packages) rather than guessed or fetched per-row.
  const packageHealthById = metrics?.packages?.healthByPackageId || {};

  const loadWorkflow = useCallback(async (packageId) => {
    setWorkflowLoading(true); setWorkflowError(null);
    try {
      const res = await fetch(`/api/orchestration/workflow/${encodeURIComponent(packageId)}`, { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && data.ok) setWorkflow(data);
      else { setWorkflow(null); setWorkflowError(data.error || 'Could not load workflow.'); }
    } catch (err) {
      setWorkflow(null); setWorkflowError(err.message || 'Could not load workflow.');
    } finally {
      setWorkflowLoading(false);
    }
  }, []);

  const selectPackage = useCallback((packageId) => {
    setSelectedPackageId(packageId);
    loadWorkflow(packageId);
  }, [loadWorkflow]);

  // Consume an external focus request (e.g. "Open in Content Orchestrator"
  // from Production Router / Publishing Router / HyperFrames Studio).
  useEffect(() => {
    if (!focusRequest || focusConsumedRef.current === focusRequest.at) return;
    focusConsumedRef.current = focusRequest.at;
    if (focusRequest.packageId) selectPackage(focusRequest.packageId);
    onFocusConsumed?.();
  }, [focusRequest, onFocusConsumed, selectPackage]);

  // ── Search ────────────────────────────────────────────────────────────

  useEffect(() => {
    clearTimeout(searchDebounceRef.current);
    if (!search.trim()) { setSearchResults([]); setSearchOpen(false); return undefined; }
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/orchestration/search?q=${encodeURIComponent(search.trim())}`, { cache: 'no-store' });
        const data = await res.json();
        if (res.ok && data.ok) { setSearchResults(data.results); setSearchOpen(true); }
      } catch { /* keep prior results on transient failure */ }
    }, 300);
    return () => clearTimeout(searchDebounceRef.current);
  }, [search]);

  const openSearchResult = (result) => {
    setSearchOpen(false);
    if (result.tab === 'content-orchestrator' && result.packageId) selectPackage(result.packageId);
    else if (result.tab === 'production-router') onOpenProductionRouter?.(result.productionJobId, result.packageId);
    else if (result.tab === 'publishing-router') onOpenPublishingRouter?.(result.publishJobId, result.packageId);
    else if (result.tab === 'pack-pipeline') onOpenPackagePipeline?.();
  };

  const runNextAction = (action) => {
    if (action.tab === 'production-router') onOpenProductionRouter?.(action.productionJobId, action.packageId || selectedPackageId);
    else if (action.tab === 'publishing-router') onOpenPublishingRouter?.(action.publishJobId, action.packageId || selectedPackageId);
    else if (action.tab === 'pack-pipeline') onOpenPackagePipeline?.();
  };

  const filteredPackages = useMemo(() => {
    const q = librarySearch.trim().toLowerCase();
    if (!q) return packages;
    return packages.filter(p => `${p.topic || ''} ${p.brand || ''}`.toLowerCase().includes(q));
  }, [packages, librarySearch]);

  const graphData = workflow?.workflow?.graph || { nodes: [], links: [] };

  return (
    <div className="pr-wrapper">
      <div className="pr-wrapper-head">
        <h3 className="font-ui">Content Orchestrator</h3>
        <p className="font-mono">Unified view across Content Pack, Production, Review, Publishing, and Export — governance and mutations stay in each system's own router.</p>
      </div>

      {/* ══════════════════ Mission Control metrics strip ══════════════════ */}
      {metrics && (
        <div className="orch-metrics-strip">
          <MetricCard icon={FiPackage} label="Production Volume" value={metrics.production.total} detail={`${metrics.production.byExecutionStatus.completed || 0} completed`} />
          <MetricCard icon={FiCheckCircle} label="Render Success Rate" value={metrics.production.renderSuccessRate != null ? `${metrics.production.renderSuccessRate}%` : '—'} detail={`${metrics.production.byExecutionStatus.failed || 0} failed`} />
          <MetricCard icon={FiAlertCircle} label="Review Backlog" value={metrics.review.unreviewed} detail={`${metrics.review.approved} approved · ${metrics.review.rejected} rejected`} />
          <MetricCard icon={FiSend} label="Publish Readiness" value={metrics.publishing.readyToPublish} detail={`${metrics.publishing.byStatus.published || 0} published`} />
          <MetricCard icon={FiDownload} label="Export Activity" value={metrics.export.generatedCount} detail={`${metrics.export.pendingCount} pending`} />
        </div>
      )}
      {metrics && (
        <div className="orch-queues-strip">
          <QueueWidget icon={FiFilm} label="Rendering Queue" count={metrics.queues.rendering} />
          <QueueWidget icon={FiAlertCircle} label="Review Queue" count={metrics.queues.review} />
          <QueueWidget icon={FiSend} label="Publishing Queue" count={metrics.queues.publishing} />
          <QueueWidget icon={FiDownload} label="Export Queue" count={metrics.queues.export} />
        </div>
      )}

      {/* ══════════════════ Global search ══════════════════ */}
      <div className="orch-search-wrap">
        <div className="ts-library-search">
          <FiSearch size={13} />
          <input
            type="text" placeholder="Search packages, production jobs, artifacts, providers, publish jobs…"
            value={search} onChange={e => setSearch(e.target.value)}
            onFocus={() => search.trim() && setSearchOpen(true)}
            className="font-mono"
          />
        </div>
        {searchOpen && searchResults.length > 0 && (
          <div className="orch-search-results">
            {searchResults.map((r, i) => (
              <button type="button" key={`${r.type}-${r.id}-${i}`} className="orch-search-result" onClick={() => openSearchResult(r)}>
                <span className="orch-search-result-type font-mono">{r.type.replaceAll('_', ' ')}</span>
                <span className="font-ui">{shorten(r.label, 50)}</span>
                <span className="orch-search-result-detail font-mono">{shorten(r.detail, 40)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="pub-grid">
        {/* ══════════════════ LEFT — package library ══════════════════ */}
        <div className="hf-studio-col">
          <div className="ts-library-search">
            <FiSearch size={13} />
            <input type="text" placeholder="Filter packages…" value={librarySearch} onChange={e => setLibrarySearch(e.target.value)} className="font-mono" />
          </div>
          <button type="button" className="pr-btn pr-btn--muted font-ui" onClick={loadPackages} disabled={packagesLoading}>
            {packagesLoading ? <><FiRefreshCw size={12} className="spin" /> Refreshing…</> : <><FiRefreshCw size={12} /> Refresh</>}
          </button>
          {packages.length === 0 ? (
            <div className="thumb-empty font-mono">No content packages yet.</div>
          ) : (
            <div className="pub-source-list">
              {filteredPackages.map(pkg => (
                <PackageRow
                  key={pkg.id} pkg={pkg}
                  health={packageHealthById[pkg.id] || null}
                  selected={selectedPackageId === pkg.id}
                  onSelect={selectPackage}
                />
              ))}
            </div>
          )}
        </div>

        {/* ══════════════════ CENTER — timeline + next actions ══════════════════ */}
        <div className="hf-studio-col">
          {!selectedPackageId ? (
            <div className="thumb-empty font-mono cpg-empty-panel">Select a content package on the left, or use search above.</div>
          ) : workflowLoading ? (
            <div className="thumb-empty font-mono">Loading workflow…</div>
          ) : workflowError ? (
            <div className="pr-warning font-mono"><FiAlertCircle size={11} /> {workflowError}</div>
          ) : workflow ? (
            <>
              <div className="pr-section">
                <div className="pr-section-head">
                  <span className="font-ui">{workflow.workflow.topic}</span>
                  <HealthBadge health={workflow.workflow.health} />
                </div>
                <div className="pr-exec-meta font-mono"><span>{workflow.workflow.brand} · {workflow.workflow.platform}</span></div>
              </div>

              <div className="pr-section">
                <div className="pr-section-head"><span className="font-ui">Timeline</span></div>
                <ol className="orch-timeline">
                  {workflow.workflow.timeline.stages.map(stage => {
                    const Icon = STAGE_STATUS_ICON[stage.status] || FiClock;
                    const isCurrent = workflow.workflow.timeline.currentStageId === stage.id;
                    return (
                      <li key={stage.id} className={`orch-timeline-item orch-timeline-item--${stage.status}${isCurrent ? ' orch-timeline-item--current' : ''}`}>
                        <Icon size={13} />
                        <div className="orch-timeline-body">
                          <span className="font-ui">{stage.label}</span>
                          <span className="orch-timeline-note font-mono">{stage.note}</span>
                          {stage.at && <span className="orch-timeline-date font-mono">{formatDate(stage.at)}</span>}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>

              <div className="pr-section">
                <div className="pr-section-head"><span className="font-ui">Next Actions</span></div>
                <div className="orch-actions-list">
                  {workflow.workflow.nextActions.map(action => (
                    <button
                      key={action.id} type="button" className="pr-btn pr-btn--approve font-ui"
                      onClick={() => runNextAction(action)} disabled={!action.tab}
                      title={action.description}
                    >
                      <FiZap size={12} /> {action.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : null}
        </div>

        {/* ══════════════════ RIGHT — relationship graph ══════════════════ */}
        <div className="hf-studio-col">
          {!workflow ? (
            <div className="thumb-empty font-mono">The relationship graph for the selected package will appear here.</div>
          ) : (
            <>
              <div className="pr-section">
                <div className="pr-section-head"><span className="font-ui">Relationship Graph</span></div>
                {graphData.nodes.length === 0 ? (
                  <div className="thumb-empty font-mono">No related records yet.</div>
                ) : (
                  <div className="orch-graph-wrap">
                    <RelationshipGraph data={graphData} width={360} height={340} />
                  </div>
                )}
              </div>

              <div className="pr-section">
                <div className="pr-section-head"><span className="font-ui">Production Jobs</span></div>
                {workflow.productionJobs.length === 0 ? (
                  <p className="pr-reason-text font-mono">None yet.</p>
                ) : workflow.productionJobs.map(job => (
                  <button key={job.id} type="button" className="orch-related-row" onClick={() => onOpenProductionRouter?.(job.id, selectedPackageId)}>
                    <span className="font-ui">{job.selectedProvider || 'unknown'}</span>
                    <span className="font-mono">{job.status}{job.queuePosition ? ` · queue #${job.queuePosition}` : ''}</span>
                  </button>
                ))}
              </div>

              <div className="pr-section">
                <div className="pr-section-head"><span className="font-ui">Publish Jobs</span></div>
                {workflow.publishJobs.length === 0 ? (
                  <p className="pr-reason-text font-mono">None yet.</p>
                ) : workflow.publishJobs.map(job => (
                  <button key={job.id} type="button" className="orch-related-row" onClick={() => onOpenPublishingRouter?.(job.id, selectedPackageId)}>
                    <span className="font-ui">{job.platform}</span>
                    <span className="font-mono">{job.status}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
