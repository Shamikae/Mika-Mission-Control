import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FiAlertCircle, FiCheck, FiCheckCircle, FiFileText, FiFilter,
  FiPackage, FiRefreshCw, FiSearch, FiSend, FiThumbsDown, FiX, FiZap,
} from 'react-icons/fi';
import {
  PRIORITY_META, REQUEST_STATE_META, AVATAR_PREFERENCE_LABELS, AGENT_STAGES,
} from '../../lib/creative-director/creativeDirectorRules';
import ContentWorkforcePanel from './ContentWorkforcePanel';

const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const AVATAR_PREFS = ['either', 'avatar', 'faceless'];

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

function StateBadge({ state, size = 'sm' }) {
  const m = REQUEST_STATE_META[state] || { label: state, color: '#5d6c86' };
  return (
    <span className={`pr-status-badge pr-status-badge--${size} font-mono`} style={{ color: m.color, background: `${m.color}1f`, borderColor: `${m.color}40` }}>
      {m.label}
    </span>
  );
}
function PriorityBadge({ priority }) {
  const m = PRIORITY_META[priority] || { label: priority, color: '#5d6c86' };
  return (
    <span className="pr-status-badge font-mono" style={{ color: m.color, background: `${m.color}1f`, borderColor: `${m.color}40` }}>
      {m.label}
    </span>
  );
}

function RequestRow({ request, selected, onSelect }) {
  return (
    <button type="button" className={`pub-source-row${selected ? ' pub-source-row--selected' : ''}`} onClick={() => onSelect(request.id)}>
      <span className="pub-source-row-top">
        <span className="font-ui">{shorten(request.topic, 44)}</span>
        <StateBadge state={request.status} />
      </span>
      <span className="pub-source-row-meta font-mono">{request.brand} · {request.platform}</span>
      <span className="pub-source-row-meta font-mono"><PriorityBadge priority={request.priority} /> {formatDate(request.createdAt)}</span>
    </button>
  );
}

function AgentCard({ stage, agent }) {
  return (
    <div className="cd-agent-card">
      <div className="cd-agent-card-head">
        <span className="font-ui">{stage.label}</span>
        <span className="cd-agent-status font-mono">not started</span>
      </div>
      <p className="pr-reason-text font-mono">{stage.description}</p>
      <p className="cd-agent-note font-mono">{agent?.note || 'Reserved for Phase 4B — no AI generation implemented yet.'}</p>
    </div>
  );
}

const emptyForm = {
  brand: '', platform: '', goal: '', topic: '', targetAudience: '', style: '', cta: '', desiredRuntime: '', avatarPreference: 'either', priority: 'normal',
};

export default function CreativeDirectorWorkspace({ onOpenPackagePipeline, onOpenContentOrchestrator } = {}) {
  const [requests, setRequests] = useState([]);
  const [libLoading, setLibLoading] = useState(false);
  const [libLoaded, setLibLoaded] = useState(false);
  const [filterStatus, setFilterStatus] = useState('all');
  const [librarySearch, setLibrarySearch] = useState('');

  const [form, setForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  const [current, setCurrent] = useState(null); // { request, package }
  const [editDraft, setEditDraft] = useState(emptyForm);
  const [savingFields, setSavingFields] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [generatingBrief, setGeneratingBrief] = useState(false);
  const [creatingPackage, setCreatingPackage] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [completing, setCompleting] = useState(false);

  const loadRequests = useCallback(async () => {
    setLibLoading(true);
    try {
      const res = await fetch('/api/creative-director/requests', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && data.ok) setRequests(data.requests || []);
    } finally {
      setLibLoading(false); setLibLoaded(true);
    }
  }, []);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  const openRequest = useCallback(async (id) => {
    try {
      const res = await fetch(`/api/creative-director/requests/${encodeURIComponent(id)}`, { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && data.ok) {
        setCurrent(data);
        setEditDraft({
          brand: data.request.brand, platform: data.request.platform, goal: data.request.goal, topic: data.request.topic,
          targetAudience: data.request.targetAudience, style: data.request.style, cta: data.request.cta,
          desiredRuntime: data.request.desiredRuntime, avatarPreference: data.request.avatarPreference, priority: data.request.priority,
        });
        setActionError(null);
      }
    } catch { /* keep prior state on transient failure */ }
  }, []);

  // ── Create ────────────────────────────────────────────────────────────

  const createRequest = async () => {
    if (!form.brand || !form.platform || !form.goal || !form.topic || creating) return;
    setCreating(true); setCreateError(null);
    try {
      const res = await fetch('/api/creative-director/requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) { setCreateError(data.errors?.join(' ') || data.error || `Server error ${res.status}`); return; }
      setForm(emptyForm);
      await openRequest(data.request.id);
      await loadRequests();
    } catch (err) {
      setCreateError(err.message || 'Request failed.');
    } finally {
      setCreating(false);
    }
  };

  // ── Edit while draft ──────────────────────────────────────────────────

  const saveFields = async () => {
    if (!current) return;
    setSavingFields(true); setActionError(null);
    try {
      const res = await fetch(`/api/creative-director/requests/${encodeURIComponent(current.request.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editDraft),
      });
      const data = await res.json();
      if (res.ok && data.ok) { setCurrent(data); await loadRequests(); }
      else setActionError(data.errors?.join(' ') || data.error || 'Save failed.');
    } finally {
      setSavingFields(false);
    }
  };

  // ── Lifecycle actions ───────────────────────────────────────────────

  const submitRequest = async () => {
    if (!current) return;
    setSubmitting(true); setActionError(null);
    try {
      const res = await fetch(`/api/creative-director/requests/${encodeURIComponent(current.request.id)}/submit`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.ok) { await openRequest(current.request.id); await loadRequests(); }
      else setActionError(data.errors?.join(' ') || data.error || 'Submit failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const generateBrief = async () => {
    if (!current) return;
    setGeneratingBrief(true); setActionError(null);
    try {
      const res = await fetch(`/api/creative-director/requests/${encodeURIComponent(current.request.id)}/generate-brief`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.ok) { await openRequest(current.request.id); await loadRequests(); }
      else setActionError(data.error || 'Brief generation failed.');
    } finally {
      setGeneratingBrief(false);
    }
  };

  const createPackage = async () => {
    if (!current) return;
    setCreatingPackage(true); setActionError(null);
    try {
      const res = await fetch(`/api/creative-director/requests/${encodeURIComponent(current.request.id)}/create-package`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.ok) { await openRequest(current.request.id); await loadRequests(); }
      else setActionError(data.error || 'Package creation failed.');
    } finally {
      setCreatingPackage(false);
    }
  };

  const rejectRequest = async () => {
    if (!current || !rejectReason.trim()) return;
    setRejecting(true); setActionError(null);
    try {
      const res = await fetch(`/api/creative-director/requests/${encodeURIComponent(current.request.id)}/reject`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: rejectReason }),
      });
      const data = await res.json();
      if (res.ok && data.ok) { await openRequest(current.request.id); await loadRequests(); setRejectReason(''); }
      else setActionError(data.error || 'Reject failed.');
    } finally {
      setRejecting(false);
    }
  };

  const cancelRequest = async () => {
    if (!current) return;
    setCancelling(true); setActionError(null);
    try {
      const res = await fetch(`/api/creative-director/requests/${encodeURIComponent(current.request.id)}/cancel`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.ok) { await openRequest(current.request.id); await loadRequests(); }
      else setActionError(data.error || 'Cancel failed.');
    } finally {
      setCancelling(false);
    }
  };

  const completeRequest = async () => {
    if (!current) return;
    setCompleting(true); setActionError(null);
    try {
      const res = await fetch(`/api/creative-director/requests/${encodeURIComponent(current.request.id)}/complete`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.ok) { await openRequest(current.request.id); await loadRequests(); }
      else setActionError(data.error || 'Complete failed.');
    } finally {
      setCompleting(false);
    }
  };

  // ── Library filtering ──────────────────────────────────────────────────

  const filteredRequests = useMemo(() => {
    const q = librarySearch.trim().toLowerCase();
    return requests.filter(r => {
      if (filterStatus !== 'all' && r.status !== filterStatus) return false;
      if (q && !`${r.topic} ${r.brand}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [requests, filterStatus, librarySearch]);

  const isDraft = current?.request?.status === 'draft';

  return (
    <div className="pr-wrapper">
      <div className="pr-wrapper-head">
        <h3 className="font-ui">Creative Director</h3>
        <p className="font-mono">Turn a content request into a governed Package Pipeline package. No content generation happens here — real creative work is handled by the Package Pipeline and future agents (Phase 4B).</p>
      </div>

      <div className="pub-grid">
        {/* ══════════════════ LEFT — new request form ══════════════════ */}
        <div className="hf-studio-col">
          <div className="pr-section">
            <div className="pr-section-head"><span className="font-ui">New Content Request</span></div>
            <div className="pr-row-2">
              <div className="pr-field">
                <label className="pr-field-label font-ui">Brand</label>
                <input type="text" className="pr-input font-mono" value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} />
              </div>
              <div className="pr-field">
                <label className="pr-field-label font-ui">Platform</label>
                <input type="text" className="pr-input font-mono" value={form.platform} onChange={e => setForm(f => ({ ...f, platform: e.target.value }))} placeholder="TikTok, YouTube…" />
              </div>
            </div>
            <div className="pr-field">
              <label className="pr-field-label font-ui">Goal</label>
              <input type="text" className="pr-input font-mono" value={form.goal} onChange={e => setForm(f => ({ ...f, goal: e.target.value }))} placeholder="Engagement, leads, awareness…" />
            </div>
            <div className="pr-field">
              <label className="pr-field-label font-ui">Topic</label>
              <textarea className="pr-input font-mono" rows={2} value={form.topic} onChange={e => setForm(f => ({ ...f, topic: e.target.value }))} />
            </div>
            <div className="pr-field">
              <label className="pr-field-label font-ui">Target audience</label>
              <input type="text" className="pr-input font-mono" value={form.targetAudience} onChange={e => setForm(f => ({ ...f, targetAudience: e.target.value }))} />
            </div>
            <div className="pr-row-2">
              <div className="pr-field">
                <label className="pr-field-label font-ui">Style</label>
                <input type="text" className="pr-input font-mono" value={form.style} onChange={e => setForm(f => ({ ...f, style: e.target.value }))} />
              </div>
              <div className="pr-field">
                <label className="pr-field-label font-ui">Desired runtime</label>
                <input type="text" className="pr-input font-mono" value={form.desiredRuntime} onChange={e => setForm(f => ({ ...f, desiredRuntime: e.target.value }))} placeholder="30-60s" />
              </div>
            </div>
            <div className="pr-field">
              <label className="pr-field-label font-ui">CTA</label>
              <input type="text" className="pr-input font-mono" value={form.cta} onChange={e => setForm(f => ({ ...f, cta: e.target.value }))} />
            </div>
            <div className="pr-row-2">
              <div className="pr-field">
                <label className="pr-field-label font-ui">Avatar / faceless</label>
                <select className="pr-select font-mono" value={form.avatarPreference} onChange={e => setForm(f => ({ ...f, avatarPreference: e.target.value }))}>
                  {AVATAR_PREFS.map(v => <option key={v} value={v}>{AVATAR_PREFERENCE_LABELS[v]}</option>)}
                </select>
              </div>
              <div className="pr-field">
                <label className="pr-field-label font-ui">Priority</label>
                <select className="pr-select font-mono" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                  {PRIORITIES.map(v => <option key={v} value={v}>{PRIORITY_META[v].label}</option>)}
                </select>
              </div>
            </div>
            {createError && <div className="pr-warning font-mono"><FiAlertCircle size={11} /> {createError}</div>}
            <button type="button" className="thumb-generate-btn font-ui" disabled={!form.brand || !form.platform || !form.goal || !form.topic || creating} onClick={createRequest}>
              {creating ? <><FiRefreshCw size={12} className="spin" /> Creating…</> : <><FiZap size={12} /> Create Request</>}
            </button>
          </div>
        </div>

        {/* ══════════════════ CENTER — request detail ══════════════════ */}
        <div className="hf-studio-col">
          {!current ? (
            <div className="thumb-empty font-mono cpg-empty-panel">Create a request on the left, or open one from the queue below.</div>
          ) : (
            <>
              <div className="pr-section">
                <div className="pr-section-head">
                  <span className="font-ui">{current.request.topic}</span>
                  <StateBadge state={current.request.status} size="lg" />
                </div>
                <div className="pr-exec-meta font-mono">
                  <span>{current.request.brand} · {current.request.platform}</span>
                  <PriorityBadge priority={current.request.priority} />
                </div>
              </div>

              {isDraft ? (
                <div className="pr-section">
                  <div className="pr-section-head"><span className="font-ui">Edit Request</span></div>
                  <div className="pr-row-2">
                    <div className="pr-field">
                      <label className="pr-field-label font-ui">Brand</label>
                      <input type="text" className="pr-input font-mono" value={editDraft.brand} onChange={e => setEditDraft(d => ({ ...d, brand: e.target.value }))} />
                    </div>
                    <div className="pr-field">
                      <label className="pr-field-label font-ui">Platform</label>
                      <input type="text" className="pr-input font-mono" value={editDraft.platform} onChange={e => setEditDraft(d => ({ ...d, platform: e.target.value }))} />
                    </div>
                  </div>
                  <div className="pr-field">
                    <label className="pr-field-label font-ui">Goal</label>
                    <input type="text" className="pr-input font-mono" value={editDraft.goal} onChange={e => setEditDraft(d => ({ ...d, goal: e.target.value }))} />
                  </div>
                  <div className="pr-field">
                    <label className="pr-field-label font-ui">Topic</label>
                    <textarea className="pr-input font-mono" rows={2} value={editDraft.topic} onChange={e => setEditDraft(d => ({ ...d, topic: e.target.value }))} />
                  </div>
                  <button type="button" className="pr-btn font-ui" onClick={saveFields} disabled={savingFields}>
                    {savingFields ? <><FiRefreshCw size={12} className="spin" /> Saving…</> : <><FiCheck size={12} /> Save Fields</>}
                  </button>
                </div>
              ) : (
                <div className="pr-section">
                  <div className="pr-section-head"><span className="font-ui">Request Details</span></div>
                  <p className="pr-reason-text font-mono">Goal: {current.request.goal}</p>
                  <p className="pr-reason-text font-mono">Audience: {current.request.targetAudience || '—'}</p>
                  <p className="pr-reason-text font-mono">Style: {current.request.style || '—'} · Runtime: {current.request.desiredRuntime || '—'}</p>
                  <p className="pr-reason-text font-mono">Presentation: {AVATAR_PREFERENCE_LABELS[current.request.avatarPreference]}</p>
                </div>
              )}

              {current.request.brief && (
                <div className="pr-section">
                  <div className="pr-section-head"><span className="font-ui">Structured Production Brief</span></div>
                  <pre className="cd-brief-text font-mono">{current.request.brief.script.fullText}</pre>
                </div>
              )}

              <div className="pr-section pr-approval-panel">
                <div className="pr-section-head"><span className="font-ui">Lifecycle</span></div>
                {current.request.status === 'draft' && (
                  <button type="button" className="pr-btn pr-btn--approve font-ui" onClick={submitRequest} disabled={submitting}>
                    {submitting ? <><FiRefreshCw size={12} className="spin" /> Submitting…</> : <><FiSend size={12} /> Submit Request</>}
                  </button>
                )}
                {current.request.status === 'submitted' && (
                  <>
                    <button type="button" className="pr-btn pr-btn--approve font-ui" onClick={generateBrief} disabled={generatingBrief}>
                      {generatingBrief ? <><FiRefreshCw size={12} className="spin" /> Generating…</> : <><FiFileText size={12} /> Generate Production Brief</>}
                    </button>
                    <div className="pr-row-2">
                      <input type="text" className="pr-input font-mono" placeholder="Reason for rejection…" value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
                      <button type="button" className="pr-btn pr-btn--reject font-ui" onClick={rejectRequest} disabled={!rejectReason.trim() || rejecting}>
                        <FiThumbsDown size={12} /> Reject
                      </button>
                    </div>
                  </>
                )}
                {current.request.status === 'brief_generated' && (
                  <button type="button" className="pr-btn pr-btn--approve font-ui" onClick={createPackage} disabled={creatingPackage}>
                    {creatingPackage ? <><FiRefreshCw size={12} className="spin" /> Creating Package…</> : <><FiPackage size={12} /> Create Package Pipeline Package</>}
                  </button>
                )}
                {current.request.status === 'package_created' && (
                  <button type="button" className="pr-btn pr-btn--approve font-ui" onClick={completeRequest} disabled={completing}>
                    {completing ? <FiRefreshCw size={12} className="spin" /> : <FiCheckCircle size={12} />} Mark Request Completed
                  </button>
                )}
                {['completed', 'cancelled', 'rejected'].includes(current.request.status) && (
                  <div className="pr-exec-meta font-mono"><span>This request is in a terminal state.</span></div>
                )}
                {!['completed', 'cancelled', 'rejected'].includes(current.request.status) && (
                  <button type="button" className="pr-btn pr-btn--muted font-ui" onClick={cancelRequest} disabled={cancelling}>
                    {cancelling ? <FiRefreshCw size={12} className="spin" /> : <FiX size={12} />} Cancel
                  </button>
                )}
                {actionError && <div className="pr-warning font-mono"><FiAlertCircle size={11} /> {actionError}</div>}
              </div>
            </>
          )}
        </div>

        {/* ══════════════════ RIGHT — agent status + package link + history ══════════════════ */}
        <div className="hf-studio-col">
          {!current ? (
            <div className="thumb-empty font-mono">Agent status and activity history will appear here.</div>
          ) : (
            <>
              {current.package && (
                <div className="pr-section">
                  <div className="pr-section-head"><span className="font-ui">Package Pipeline</span></div>
                  <p className="pr-reason-text font-mono">{current.package.topic}</p>
                  <p className="pr-reason-text font-mono">Stage: {current.package.pipelineStage || 'unknown'}</p>
                  <button type="button" className="pr-btn pr-btn--approve font-ui" onClick={onOpenPackagePipeline}>
                    <FiPackage size={12} /> Open in Package Pipeline
                  </button>
                </div>
              )}

              <ContentWorkforcePanel
                requestId={current.request.id}
                requestStatus={current.request.status}
                onOpenPackagePipeline={onOpenPackagePipeline}
                onOpenContentOrchestrator={onOpenContentOrchestrator}
              />

              <details className="pr-section">
                <summary className="pr-section-head font-ui" style={{ cursor: 'pointer' }}>Legacy Agent Placeholders (pre-Phase 4B reference)</summary>
                <div className="cd-agent-list">
                  {AGENT_STAGES.map(stage => (
                    <AgentCard key={stage.id} stage={stage} agent={current.request.agents?.[stage.id]} />
                  ))}
                </div>
              </details>

              <div className="pr-section">
                <div className="pr-section-head"><span className="font-ui">Activity History</span></div>
                <ol className="cpp-timeline">
                  {[...(current.request.activityHistory || [])].reverse().map((h, i) => (
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

      {/* ══════════════════ Queue of content requests ══════════════════ */}
      <div className="ts-history-section">
        <div className="thumb-section-head">
          <span className="font-ui">Content Request Queue</span>
          <button type="button" className="thumb-icon-btn" onClick={loadRequests} disabled={libLoading} title="Refresh">
            <FiRefreshCw size={11} className={libLoading ? 'spin' : ''} />
          </button>
        </div>
        <div className="ts-library-toolbar">
          <div className="ts-library-search">
            <FiSearch size={13} />
            <input type="text" placeholder="Search by topic or brand…" value={librarySearch} onChange={e => setLibrarySearch(e.target.value)} className="font-mono" />
          </div>
          <div className="ts-library-filters">
            <FiFilter size={11} className="ts-filter-icon" />
            <select className="ts-filter-select font-mono" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="all">All statuses</option>
              {Object.keys(REQUEST_STATE_META).map(s => <option key={s} value={s}>{REQUEST_STATE_META[s].label}</option>)}
            </select>
          </div>
        </div>
        {libLoading && !libLoaded ? (
          <div className="thumb-empty font-mono">Loading requests…</div>
        ) : filteredRequests.length === 0 ? (
          <div className="thumb-empty font-mono">{requests.length === 0 ? 'No content requests yet — create one above.' : 'No requests match these filters.'}</div>
        ) : (
          <div className="ts-library-grid">
            {filteredRequests.map(r => <RequestRow key={r.id} request={r} selected={current?.request?.id === r.id} onSelect={openRequest} />)}
          </div>
        )}
      </div>
    </div>
  );
}
