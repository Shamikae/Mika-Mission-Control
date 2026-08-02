import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  FiAlertCircle, FiCheck, FiCheckSquare, FiFilter, FiImage,
  FiRefreshCw, FiSearch, FiSquare, FiX,
} from 'react-icons/fi';
import { PIPELINE_STAGES, PIPELINE_STAGE_IDS, checkStageTransition } from '../../lib/content/contentPipelineRules';

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_META = {
  draft:        { label: 'Draft',         color: '#60a5fa' },
  needs_review: { label: 'Needs Review',  color: '#a78bfa' },
  approved:     { label: 'Approved',      color: '#4ade80' },
  rejected:     { label: 'Rejected',      color: '#f87171' },
};

const DATE_RANGES = [
  { id: 'all',   label: 'All time' },
  { id: 'today', label: 'Today' },
  { id: '7d',    label: 'Last 7 days' },
  { id: '30d',   label: 'Last 30 days' },
];

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

function stageAccent(stageId) {
  return PIPELINE_STAGES.find(s => s.id === stageId)?.accent || 'var(--text-muted)';
}

function stageLabel(stageId) {
  return PIPELINE_STAGES.find(s => s.id === stageId)?.label || stageId;
}

// ── Small shared pieces ──────────────────────────────────────────────────────

function StageBadge({ stage, size = 'sm' }) {
  const color = stageAccent(stage);
  return (
    <span
      className={`cpp-stage-badge cpp-stage-badge--${size} font-mono`}
      style={{ color, background: `${color}1f`, borderColor: `${color}40` }}
    >
      {stageLabel(stage)}
    </span>
  );
}

function StatusDot({ status }) {
  const meta = STATUS_META[status] || { label: status, color: '#5d6c86' };
  return <span className="cpp-status-dot" style={{ background: meta.color }} title={meta.label} />;
}

// ── Dashboard metrics ─────────────────────────────────────────────────────────

function DashboardMetrics({ metrics }) {
  return (
    <div className="cpp-metrics">
      <div className="cpp-metric">
        <span className="cpp-metric-value font-mono">{metrics.total}</span>
        <span className="cpp-metric-label font-ui">Total packages</span>
      </div>
      <div className="cpp-metric cpp-metric--attn">
        <span className="cpp-metric-value font-mono">{metrics.needsReview}</span>
        <span className="cpp-metric-label font-ui">Needs review</span>
      </div>
      <div className="cpp-metric">
        <span className="cpp-metric-value font-mono">{metrics.inProduction}</span>
        <span className="cpp-metric-label font-ui">In production</span>
      </div>
      <div className="cpp-metric">
        <span className="cpp-metric-value font-mono">{metrics.publishedThisWeek}</span>
        <span className="cpp-metric-label font-ui">Published this week</span>
      </div>
      <div className="cpp-metric">
        <span className="cpp-metric-value font-mono">{metrics.archived}</span>
        <span className="cpp-metric-label font-ui">Archived</span>
      </div>
    </div>
  );
}

// ── Approval queue ────────────────────────────────────────────────────────────

function ApprovalQueue({ items, onApprove, onSendBack, onOpen, busyId }) {
  if (!items.length) return null;
  return (
    <div className="cpp-approval-queue">
      <div className="cpp-approval-head">
        <FiAlertCircle size={13} />
        <span className="font-ui">Approval Queue</span>
        <span className="cpp-approval-count font-mono">{items.length}</span>
      </div>
      <div className="cpp-approval-list">
        {items.map(p => (
          <div key={p.id} className="cpp-approval-item">
            <button type="button" className="cpp-approval-title font-ui" onClick={() => onOpen(p)}>
              {shorten(p.topic, 60)}
            </button>
            <span className="cpp-approval-meta font-mono">{p.brand} · {p.platform}</span>
            <div className="cpp-approval-actions">
              <button type="button" className="cpp-mini-btn cpp-mini-btn--approve" disabled={busyId === p.id} onClick={() => onApprove(p)}>
                <FiCheck size={11} /> Approve
              </button>
              <button type="button" className="cpp-mini-btn" disabled={busyId === p.id} onClick={() => onSendBack(p)}>
                Send back
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Kanban card ───────────────────────────────────────────────────────────────

function PipelineCard({ pkg, onOpen, onMove, dragging, selectMode, selected, onToggleSelect, onDragStart, onDragEnd, onCreateProductionPlan, onOpenProduction }) {
  return (
    <article
      className={`cpp-card${dragging ? ' cpp-card--dragging' : ''}${selected ? ' cpp-card--selected' : ''}`}
      draggable={!selectMode}
      onDragStart={e => onDragStart(e, pkg)}
      onDragEnd={onDragEnd}
      onClick={() => (selectMode ? onToggleSelect(pkg.id) : onOpen(pkg))}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && (selectMode ? onToggleSelect(pkg.id) : onOpen(pkg))}
    >
      {selectMode && (
        <span className="cpp-card-select">
          {selected ? <FiCheckSquare size={14} /> : <FiSquare size={14} />}
        </span>
      )}

      {pkg.thumbnail?.artifactUrl ? (
        <img src={pkg.thumbnail.artifactUrl} alt="" className="cpp-card-thumb" loading="lazy" />
      ) : (
        <div className="cpp-card-thumb cpp-card-thumb--empty"><FiImage size={14} /></div>
      )}

      <div className="cpp-card-body">
        <div className="cpp-card-title">{shorten(pkg.topic, 70)}</div>
        <div className="cpp-card-meta font-mono">
          <StatusDot status={pkg.status} />
          {pkg.brand} · {pkg.platform}
        </div>
        <div className="cpp-card-date font-mono">{formatDate(pkg.pipeline?.enteredStageAt)}</div>
      </div>

      {!selectMode && pkg.pipeline?.stage === 'approved' && onCreateProductionPlan && (
        <button
          type="button"
          className="cpp-mini-btn cpp-card-production-btn font-ui"
          onClick={e => { e.stopPropagation(); onCreateProductionPlan(pkg); }}
        >
          Create Production Plan
        </button>
      )}
      {!selectMode && pkg.pipeline?.stage === 'production' && onOpenProduction && (
        <button
          type="button"
          className="cpp-mini-btn cpp-card-production-btn font-ui"
          onClick={e => { e.stopPropagation(); onOpenProduction(pkg); }}
        >
          Open Production
        </button>
      )}

      {!selectMode && (
        <select
          className="cpp-card-move font-mono"
          value={pkg.pipeline.stage}
          onClick={e => e.stopPropagation()}
          onChange={e => onMove(pkg, e.target.value)}
          aria-label={`Move "${pkg.topic}" to a different stage`}
        >
          {PIPELINE_STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      )}
    </article>
  );
}

// ── Detail drawer ─────────────────────────────────────────────────────────────

function DetailDrawer({ pkg, onClose, onMove, moving }) {
  if (!pkg) return null;
  const timeline = [...(pkg.pipeline?.history || [])].reverse();

  const handleBackdropClick = (e) => { if (e.target === e.currentTarget) onClose(); };

  return (
    <div className="cpp-drawer-overlay" onClick={handleBackdropClick} role="presentation">
      <aside className="cpp-drawer" role="dialog" aria-modal="true" aria-label="Package detail">
        <div className="cpp-drawer-head">
          <StageBadge stage={pkg.pipeline.stage} size="lg" />
          <button type="button" className="cpp-drawer-close" onClick={onClose} aria-label="Close">
            <FiX size={16} />
          </button>
        </div>

        <div className="cpp-drawer-body">
          <h2 className="cpp-drawer-title font-ui">{pkg.topic}</h2>
          <div className="cpp-drawer-chips font-mono">
            <span>{pkg.brand}</span><span>·</span><span>{pkg.platform}</span><span>·</span><span>{pkg.goal}</span>
            <StatusDot status={pkg.status} />
            <span>{STATUS_META[pkg.status]?.label || pkg.status}</span>
          </div>

          {pkg.thumbnail?.artifactUrl && (
            <img src={pkg.thumbnail.artifactUrl} alt="" className="cpp-drawer-thumb" />
          )}

          {pkg.hooks?.length > 0 && (
            <section className="cpp-drawer-section">
              <h4 className="font-ui">Hooks</h4>
              <ul className="cpp-drawer-list">
                {pkg.hooks.map((h, i) => <li key={i}>{h.text}</li>)}
              </ul>
            </section>
          )}

          {pkg.script?.fullText && (
            <section className="cpp-drawer-section">
              <h4 className="font-ui">Script</h4>
              <p className="cpp-drawer-text font-mono">{shorten(pkg.script.fullText, 400)}</p>
            </section>
          )}

          {pkg.caption && (
            <section className="cpp-drawer-section">
              <h4 className="font-ui">Caption</h4>
              <p className="cpp-drawer-text font-mono">{pkg.caption}</p>
            </section>
          )}

          <section className="cpp-drawer-section">
            <h4 className="font-ui">Activity Timeline</h4>
            <ol className="cpp-timeline">
              {timeline.map((h, i) => (
                <li key={i} className="cpp-timeline-item">
                  <StageBadge stage={h.stage} />
                  <span className="cpp-timeline-date font-mono">{formatDate(h.at)}</span>
                  {h.note && <span className="cpp-timeline-note font-mono">{h.note}</span>}
                </li>
              ))}
            </ol>
          </section>
        </div>

        <div className="cpp-drawer-footer">
          <label className="cpp-drawer-footer-label font-ui">Move to</label>
          <select
            className="cpp-input font-mono"
            value={pkg.pipeline.stage}
            disabled={moving}
            onChange={e => onMove(pkg, e.target.value)}
          >
            {PIPELINE_STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
      </aside>
    </div>
  );
}

// ── Bulk action bar ───────────────────────────────────────────────────────────

function BulkActionBar({ count, onMove, onClear, moving }) {
  const [target, setTarget] = useState('draft');
  return (
    <div className="cpp-bulk-bar">
      <span className="font-mono">{count} selected</span>
      <select className="cpp-input cpp-input--sm font-mono" value={target} onChange={e => setTarget(e.target.value)}>
        {PIPELINE_STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <button type="button" className="cpp-btn font-ui" disabled={moving} onClick={() => onMove(target)}>
        {moving ? <><FiRefreshCw size={11} className="spin" /> Moving…</> : 'Move selected'}
      </button>
      <button type="button" className="cpp-btn cpp-btn--muted font-ui" onClick={onClear}>Clear</button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ContentPackagePipeline({ onCreateProductionPlan, onOpenProduction } = {}) {
  const [packages, setPackages] = useState([]);
  const [loading, setLoading]   = useState(false);
  const [loaded, setLoaded]     = useState(false);
  const [toast, setToast]       = useState(null);

  const [search, setSearch]             = useState('');
  const [filterBrand, setFilterBrand]   = useState('all');
  const [filterPlatform, setFilterPlatform] = useState('all');
  const [filterDate, setFilterDate]     = useState('all');

  const [selectMode, setSelectMode]     = useState(false);
  const [selectedIds, setSelectedIds]   = useState(() => new Set());
  const [bulkMoving, setBulkMoving]     = useState(false);

  const [drawerId, setDrawerId] = useState(null);
  const [movingId, setMovingId] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverStage, setDragOverStage] = useState(null);

  const toastTimer = useRef(null);
  const showToast = useCallback((message) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // ── Load ──────────────────────────────────────────────────────────────────

  const loadPackages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/content/pipeline/list', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setPackages(Array.isArray(data.packages) ? data.packages : []);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, []);

  useEffect(() => { loadPackages(); }, [loadPackages]);

  // Escape closes the drawer.
  useEffect(() => {
    if (!drawerId) return undefined;
    const onKeyDown = (e) => { if (e.key === 'Escape') setDrawerId(null); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerId]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const filteredPackages = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = Date.now();
    return packages.filter(p => {
      if (filterBrand !== 'all' && p.brand !== filterBrand) return false;
      if (filterPlatform !== 'all' && p.platform !== filterPlatform) return false;
      if (filterDate !== 'all') {
        const t = p.metadata?.updatedAt ? new Date(p.metadata.updatedAt).getTime() : 0;
        const cutoff = filterDate === 'today' ? new Date().setHours(0, 0, 0, 0)
          : now - (filterDate === '7d' ? 7 : 30) * 86400000;
        if (!t || t < cutoff) return false;
      }
      if (q && !`${p.topic} ${p.brand}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [packages, search, filterBrand, filterPlatform, filterDate]);

  const grouped = useMemo(() => {
    const g = Object.fromEntries(PIPELINE_STAGE_IDS.map(id => [id, []]));
    for (const p of filteredPackages) {
      const stage = PIPELINE_STAGE_IDS.includes(p.pipeline?.stage) ? p.pipeline.stage : 'research';
      g[stage].push(p);
    }
    return g;
  }, [filteredPackages]);

  const metrics = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86400000;
    const perStage = Object.fromEntries(PIPELINE_STAGE_IDS.map(id => [id, 0]));
    let publishedThisWeek = 0;
    for (const p of packages) {
      const stage = PIPELINE_STAGE_IDS.includes(p.pipeline?.stage) ? p.pipeline.stage : 'research';
      perStage[stage] += 1;
      if (stage === 'published') {
        const enteredAt = p.pipeline?.enteredStageAt ? new Date(p.pipeline.enteredStageAt).getTime() : 0;
        if (enteredAt >= weekAgo) publishedThisWeek += 1;
      }
    }
    return {
      total: packages.length,
      needsReview: perStage.review,
      inProduction: perStage.production,
      publishedThisWeek,
      archived: perStage.archived,
    };
  }, [packages]);

  const approvalQueue = useMemo(() => filteredPackages.filter(p => p.pipeline?.stage === 'review'), [filteredPackages]);

  const brandOptions = useMemo(() => [...new Set(packages.map(p => p.brand).filter(Boolean))], [packages]);
  const platformOptions = useMemo(() => [...new Set(packages.map(p => p.platform).filter(Boolean))], [packages]);

  const drawerPkg = useMemo(() => packages.find(p => p.id === drawerId) || null, [packages, drawerId]);

  // ── Move (optimistic, with rollback) ────────────────────────────────────────

  const moveCard = useCallback(async (pkg, toStage) => {
    if (pkg.pipeline.stage === toStage) return;

    const check = checkStageTransition(pkg, toStage);
    if (!check.allowed) {
      showToast(check.reason);
      return;
    }

    const snapshot = packages;
    setMovingId(pkg.id);
    setPackages(prev => prev.map(p => (
      p.id === pkg.id
        ? { ...p, pipeline: { ...p.pipeline, stage: toStage, enteredStageAt: new Date().toISOString() } }
        : p
    )));

    try {
      const res = await fetch('/api/content/pipeline/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pkg.id, toStage }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Move failed.');
      setPackages(prev => prev.map(p => (p.id === pkg.id ? data.package : p)));
    } catch (err) {
      setPackages(snapshot);
      showToast(err.message || 'Move failed — reverted.');
    } finally {
      setMovingId(null);
    }
  }, [packages, showToast]);

  // ── Drag and drop (desktop) ─────────────────────────────────────────────────

  const handleDragStart = useCallback((e, pkg) => {
    e.dataTransfer.setData('text/plain', pkg.id);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingId(pkg.id);
  }, []);
  const handleDragEnd = useCallback(() => { setDraggingId(null); setDragOverStage(null); }, []);

  const handleColumnDragOver = useCallback((e, stageId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverStage(stageId);
  }, []);
  const handleColumnDrop = useCallback((e, stageId) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    const pkg = packages.find(p => p.id === id);
    setDragOverStage(null);
    setDraggingId(null);
    if (pkg) moveCard(pkg, stageId);
  }, [packages, moveCard]);

  // ── Selection + bulk ──────────────────────────────────────────────────────

  const toggleSelect = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => { setSelectedIds(new Set()); setSelectMode(false); }, []);

  const bulkMove = useCallback(async (toStage) => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    const snapshot = packages;
    setBulkMoving(true);
    setPackages(prev => prev.map(p => (
      ids.includes(p.id) ? { ...p, pipeline: { ...p.pipeline, stage: toStage, enteredStageAt: new Date().toISOString() } } : p
    )));
    try {
      const res = await fetch('/api/content/pipeline/bulk-move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, toStage }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error('Bulk move failed.');
      const failed = (data.results || []).filter(r => !r.ok);
      await loadPackages();
      if (failed.length) {
        showToast(`${failed.length} of ${ids.length} package(s) could not move: ${failed[0].error}`);
      } else {
        showToast(`Moved ${ids.length} package(s) to ${stageLabel(toStage)}.`);
      }
      setSelectedIds(new Set());
    } catch (err) {
      setPackages(snapshot);
      showToast(err.message || 'Bulk move failed — reverted.');
    } finally {
      setBulkMoving(false);
    }
  }, [selectedIds, packages, loadPackages, showToast]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="cpp-wrapper">
      <div className="cpp-wrapper-head">
        <h3 className="font-ui">Package Pipeline</h3>
        <p className="font-mono">Research → Draft → Review → Approved → Production → Published → Archived</p>
      </div>

      {toast && (
        <div className="cpp-toast font-mono">
          <FiAlertCircle size={12} /> {toast}
        </div>
      )}

      <DashboardMetrics metrics={metrics} />

      <ApprovalQueue
        items={approvalQueue}
        busyId={movingId}
        onOpen={p => setDrawerId(p.id)}
        onApprove={p => moveCard(p, 'approved')}
        onSendBack={p => moveCard(p, 'draft')}
      />

      <div className="ts-library-toolbar">
        <div className="ts-library-search">
          <FiSearch size={13} />
          <input type="text" placeholder="Search by topic or brand…" value={search} onChange={e => setSearch(e.target.value)} className="font-mono" />
        </div>
        <div className="ts-library-filters">
          <FiFilter size={11} className="ts-filter-icon" />
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
        <button
          type="button"
          className={`cpp-btn font-ui${selectMode ? ' cpp-btn--active' : ''}`}
          onClick={() => { setSelectMode(v => !v); setSelectedIds(new Set()); }}
        >
          {selectMode ? <FiCheckSquare size={12} /> : <FiSquare size={12} />} Select
        </button>
        <button type="button" className="thumb-icon-btn" onClick={loadPackages} disabled={loading} title="Refresh">
          <FiRefreshCw size={13} className={loading ? 'spin' : ''} />
        </button>
      </div>

      {selectMode && selectedIds.size > 0 && (
        <BulkActionBar count={selectedIds.size} moving={bulkMoving} onMove={bulkMove} onClear={clearSelection} />
      )}

      {loading && !loaded ? (
        <div className="thumb-empty font-mono">Loading pipeline…</div>
      ) : packages.length === 0 ? (
        <div className="thumb-empty font-mono">
          No content packages yet. Generate one from Content Pack to start the pipeline.
        </div>
      ) : (
        <div className="cpp-board">
          {PIPELINE_STAGES.map(stage => {
            const stagePackages = grouped[stage.id] || [];
            return (
              <section
                key={stage.id}
                className={`cpp-col${dragOverStage === stage.id ? ' cpp-col--over' : ''}`}
                onDragOver={e => handleColumnDragOver(e, stage.id)}
                onDragLeave={() => setDragOverStage(prev => (prev === stage.id ? null : prev))}
                onDrop={e => handleColumnDrop(e, stage.id)}
              >
                <div className="cpp-col-head" style={{ borderTopColor: stage.accent }}>
                  <strong style={{ color: stage.accent }} className="font-ui">{stage.label}</strong>
                  <span className="cpp-col-count font-mono">{stagePackages.length}</span>
                </div>
                <div className="cpp-col-body">
                  {stagePackages.map(pkg => (
                    <PipelineCard
                      key={pkg.id}
                      pkg={pkg}
                      dragging={draggingId === pkg.id}
                      selectMode={selectMode}
                      selected={selectedIds.has(pkg.id)}
                      onToggleSelect={toggleSelect}
                      onOpen={p => setDrawerId(p.id)}
                      onMove={moveCard}
                      onDragStart={handleDragStart}
                      onDragEnd={handleDragEnd}
                      onCreateProductionPlan={onCreateProductionPlan}
                      onOpenProduction={onOpenProduction}
                    />
                  ))}
                  {stagePackages.length === 0 && <div className="cpp-col-empty font-mono">Empty</div>}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <DetailDrawer pkg={drawerPkg} moving={movingId === drawerId} onClose={() => setDrawerId(null)} onMove={moveCard} />
    </div>
  );
}
