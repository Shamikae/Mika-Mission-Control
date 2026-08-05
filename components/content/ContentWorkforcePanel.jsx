import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FiZap, FiRefreshCw, FiCheck, FiX, FiThumbsDown, FiPackage, FiAlertCircle,
  FiChevronRight, FiEdit2, FiClock, FiDollarSign, FiPlay, FiSearch, FiExternalLink,
} from 'react-icons/fi';
import {
  WORKFORCE_STAGE_IDS, WORKFORCE_STAGE_META, RUN_STATUS_META, STAGE_STATUS_META,
} from '../../lib/creative-director/workforce/workforceRules';
import { RESEARCH_RUN_STATUS_META } from '../../lib/research/researchRules.js';

function fmtMoney(cost) {
  if (!cost || !Number.isFinite(cost.amountUsd)) return null;
  return `~$${cost.amountUsd.toFixed(4)}${cost.provisional ? ' (provisional)' : ''}`;
}
function fmtDuration(result) {
  if (!result?.startedAt || !result?.completedAt) return null;
  const ms = new Date(result.completedAt) - new Date(result.startedAt);
  return Number.isFinite(ms) && ms >= 0 ? `${(ms / 1000).toFixed(1)}s` : null;
}

function RunStatusBadge({ status }) {
  const m = RUN_STATUS_META[status] || { label: status, color: '#5d6c86' };
  return <span className="pr-status-badge pr-status-badge--lg font-mono" style={{ color: m.color, background: `${m.color}1f`, borderColor: `${m.color}40` }}>{m.label}</span>;
}
function StageStatusBadge({ status }) {
  const m = STAGE_STATUS_META[status] || { label: status, color: '#5d6c86' };
  return <span className="pr-status-badge font-mono" style={{ color: m.color, background: `${m.color}1f`, borderColor: `${m.color}40` }}>{m.label}</span>;
}

function cumulativeCost(run) {
  if (!run) return 0;
  return WORKFORCE_STAGE_IDS.reduce((sum, id) => sum + (run.stages?.[id]?.result?.estimatedCost?.amountUsd || 0), 0);
}

// ── Stage output previews (compact — full detail is in the expandable section below) ──

function StagePreview({ stageId, output }) {
  if (!output) return null;
  if (stageId === 'research') return <p className="pr-reason-text font-mono">{output.summary}</p>;
  if (stageId === 'script') return <p className="pr-reason-text font-mono">"{output.selectedHook}"</p>;
  if (stageId === 'storyboard') return <p className="pr-reason-text font-mono">{(output.scenes || []).length} scenes · {output.totalDurationSeconds}s</p>;
  if (stageId === 'prompts') return <p className="pr-reason-text font-mono">Mode: {output.productionMode}</p>;
  if (stageId === 'thumbnail') return <p className="pr-reason-text font-mono">{output.headline}</p>;
  if (stageId === 'caption') return <p className="pr-reason-text font-mono">{(output.primaryCaption || '').slice(0, 80)}</p>;
  if (stageId === 'review') return <p className="pr-reason-text font-mono">Verdict: {output.verdict} · Score: {output.overallScore}/10</p>;
  return null;
}

// ── Editable field forms (whitelisted per stage — mirrors the server's sanitizeStageOverride) ──

function StageEditForm({ stageId, output, onSave, saving }) {
  const [draft, setDraft] = useState(() => {
    if (stageId === 'script') return { selectedHook: output.selectedHook || '', fullText: output.fullText || '', cta: output.cta || '' };
    if (stageId === 'thumbnail') return { headline: output.headline || '', visualBrief: output.visualBrief || '' };
    if (stageId === 'caption') return { primaryCaption: output.primaryCaption || '', hashtags: (output.hashtags || []).join(', ') };
    if (stageId === 'storyboard') return { scenes: (output.scenes || []).map(s => ({ index: s.index, narration: s.narration, visual: s.visual })) };
    return {};
  });

  if (stageId === 'script') {
    return (
      <div className="cd-agent-note font-mono" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input className="pr-input font-mono" value={draft.selectedHook} onChange={e => setDraft(d => ({ ...d, selectedHook: e.target.value }))} placeholder="Selected hook" />
        <textarea className="pr-input font-mono" rows={4} value={draft.fullText} onChange={e => setDraft(d => ({ ...d, fullText: e.target.value }))} placeholder="Full script text" />
        <input className="pr-input font-mono" value={draft.cta} onChange={e => setDraft(d => ({ ...d, cta: e.target.value }))} placeholder="CTA" />
        <button type="button" className="pr-btn font-ui" disabled={saving} onClick={() => onSave(draft)}><FiCheck size={12} /> Save Edit</button>
      </div>
    );
  }
  if (stageId === 'thumbnail') {
    return (
      <div className="cd-agent-note font-mono" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input className="pr-input font-mono" value={draft.headline} onChange={e => setDraft(d => ({ ...d, headline: e.target.value }))} placeholder="Headline" />
        <textarea className="pr-input font-mono" rows={2} value={draft.visualBrief} onChange={e => setDraft(d => ({ ...d, visualBrief: e.target.value }))} placeholder="Visual brief" />
        <button type="button" className="pr-btn font-ui" disabled={saving} onClick={() => onSave(draft)}><FiCheck size={12} /> Save Edit</button>
      </div>
    );
  }
  if (stageId === 'caption') {
    return (
      <div className="cd-agent-note font-mono" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <textarea className="pr-input font-mono" rows={3} value={draft.primaryCaption} onChange={e => setDraft(d => ({ ...d, primaryCaption: e.target.value }))} placeholder="Primary caption" />
        <input className="pr-input font-mono" value={draft.hashtags} onChange={e => setDraft(d => ({ ...d, hashtags: e.target.value }))} placeholder="hashtags, comma, separated" />
        <button type="button" className="pr-btn font-ui" disabled={saving} onClick={() => onSave({ primaryCaption: draft.primaryCaption, hashtags: draft.hashtags.split(',').map(h => h.trim()).filter(Boolean) })}><FiCheck size={12} /> Save Edit</button>
      </div>
    );
  }
  if (stageId === 'storyboard') {
    return (
      <div className="cd-agent-note font-mono" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {draft.scenes.map((s, i) => (
          <div key={s.index} className="pr-row-2">
            <input className="pr-input font-mono" value={s.narration} onChange={e => setDraft(d => ({ ...d, scenes: d.scenes.map((x, xi) => xi === i ? { ...x, narration: e.target.value } : x) }))} placeholder={`Scene ${s.index} narration`} />
            <input className="pr-input font-mono" value={s.visual} onChange={e => setDraft(d => ({ ...d, scenes: d.scenes.map((x, xi) => xi === i ? { ...x, visual: e.target.value } : x) }))} placeholder={`Scene ${s.index} visual`} />
          </div>
        ))}
        <button type="button" className="pr-btn font-ui" disabled={saving} onClick={() => onSave(draft)}><FiCheck size={12} /> Save Edit</button>
      </div>
    );
  }
  return null;
}

// ── Full stage output detail (expandable) ──────────────────────────────

function StageDetail({ stageId, output }) {
  if (!output) return <p className="thumb-empty font-mono">No output yet.</p>;
  if (stageId === 'research') {
    return (
      <div className="cd-brief-text font-mono">
        <p><b>Research mode:</b> {output.researchMode}</p>
        {output.researchMode === 'live-search' && output.sourceSummary && (
          <p><b>Provider:</b> {output.sourceSummary.provider} · <b>Queries:</b> {output.sourceSummary.queryCount} · <b>Sources:</b> {output.sourceSummary.sourceCount}</p>
        )}
        <p><b>Summary:</b> {output.summary}</p>
        <p><b>Recommended angle:</b> {output.recommendedAngle}</p>
        <p><b>Content angles:</b></p>
        <ul>{output.contentAngles.map((a, i) => <li key={i}>{a.title} — {a.angle} (hook: {a.hookPotential}, risk: {a.riskLevel}, score: {a.relevanceScore})</li>)}</ul>
        <p><b>Claims needing sources:</b></p>
        <ul>{output.claims.filter(c => c.sourceNeeded).map((c, i) => <li key={i}>{c.text}</li>)}</ul>
        {output.unresolvedClaims?.length > 0 && (
          <>
            <p><b>Unresolved claims:</b></p>
            <ul>{output.unresolvedClaims.map((c, i) => <li key={i}>{c}</li>)}</ul>
          </>
        )}
      </div>
    );
  }
  if (stageId === 'script') {
    return (
      <div className="cd-brief-text font-mono">
        <p><b>Hooks:</b></p>
        <ul>{output.hooks.map((h, i) => <li key={i}>{h.text} ({h.angle}, score {h.score})</li>)}</ul>
        <p><b>Full text:</b></p>
        <pre>{output.fullText}</pre>
        <p><b>Runtime estimate:</b> {output.estimatedRuntimeSeconds}s · <b>Tone:</b> {output.tone}</p>
      </div>
    );
  }
  if (stageId === 'storyboard') {
    return (
      <div className="cd-brief-text font-mono">
        <p><b>Pacing:</b> {output.pacing} · <b>Style:</b> {output.visualStyle}</p>
        <ol className="cpp-timeline">
          {output.scenes.map(s => (
            <li key={s.index} className="cpp-timeline-item">
              <span className="pr-event-badge font-mono">Scene {s.index} · {s.startSeconds}-{s.endSeconds}s</span>
              <span className="cpp-timeline-note font-mono">{s.narration} — {s.visual}</span>
            </li>
          ))}
        </ol>
      </div>
    );
  }
  if (stageId === 'prompts') {
    return (
      <div className="cd-brief-text font-mono">
        <p><b>Production mode:</b> {output.productionMode}</p>
        <p><b>HeyGen applicable:</b> {String(output.heygen.applicable)} — {output.heygen.avatarDirection}</p>
        <p><b>HyperFrames applicable:</b> {String(output.hyperframes.applicable)} — {output.hyperframes.compositionBrief}</p>
        <p><b>Image generation applicable:</b> {String(output.imageGeneration.applicable)}</p>
        <ul>{output.imageGeneration.prompts.map((p, i) => <li key={i}>[scene {p.sceneIndex}] {p.prompt}</li>)}</ul>
        <p><b>Thumbnail seed:</b> {output.thumbnail.headline} — {output.thumbnail.imagePrompt}</p>
      </div>
    );
  }
  if (stageId === 'thumbnail') {
    return (
      <div className="cd-brief-text font-mono">
        <p><b>Headline:</b> {output.headline}</p>
        <p><b>Alternates:</b> {output.alternateHeadlines.join(' / ')}</p>
        <p><b>Visual brief:</b> {output.visualBrief}</p>
        <p><b>Image prompt:</b> {output.imagePrompt}</p>
        <p><b>Score:</b> {output.score}/10</p>
      </div>
    );
  }
  if (stageId === 'caption') {
    return (
      <div className="cd-brief-text font-mono">
        <p><b>Primary caption:</b> {output.primaryCaption}</p>
        <p><b>Hashtags:</b> {output.hashtags.map(h => `#${h}`).join(' ')}</p>
        <p><b>First comment:</b> {output.firstComment}</p>
        <p><b>Platform variants:</b></p>
        <ul>{Object.entries(output.platformVariants).map(([k, v]) => <li key={k}>{k}: {v}</li>)}</ul>
      </div>
    );
  }
  if (stageId === 'review') {
    return (
      <div className="cd-brief-text font-mono">
        <p><b>Verdict:</b> {output.verdict} · <b>Overall score:</b> {output.overallScore}/10</p>
        <p><b>Category scores:</b> {Object.entries(output.categoryScores).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>
        {output.blockingIssues.length > 0 && <><p><b>Blocking issues:</b></p><ul>{output.blockingIssues.map((b, i) => <li key={i}>{b}</li>)}</ul></>}
        {output.warnings.length > 0 && <><p><b>Warnings:</b></p><ul>{output.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></>}
        <p><b>Approved for package creation:</b> {String(output.approvedForPackageCreation)}</p>
      </div>
    );
  }
  return null;
}

// ── Live Research panel: provider health, queries, sources, evidence ──────

function ResearchRunStatusBadge({ status }) {
  const m = RESEARCH_RUN_STATUS_META[status] || { label: status, color: '#5d6c86' };
  return <span className="pr-status-badge font-mono" style={{ color: m.color, background: `${m.color}1f`, borderColor: `${m.color}40` }}>{m.label}</span>;
}

function SourceCard({ source }) {
  return (
    <div className="cd-agent-card">
      <div className="cd-agent-card-head">
        <span className="font-ui">{source.title}</span>
        <span className="cd-agent-status font-mono">{source.classification}</span>
      </div>
      <p className="pr-exec-meta font-mono">
        <span>{source.domain}</span>
        <span>{source.publishedAt ? new Date(source.publishedAt).toLocaleDateString() : 'undated'}</span>
        <span>score {source.qualityScore ?? '—'}</span>
      </p>
      <p className="pr-reason-text font-mono">{(source.snippet || source.content || '').slice(0, 220)}</p>
      <a href={source.url} target="_blank" rel="noopener noreferrer" className="pr-btn font-ui" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
        <FiExternalLink size={12} /> Open Source
      </a>
    </div>
  );
}

function ProviderStatusStrip({ providers }) {
  if (!providers?.length) return null;
  const relevant = providers.filter(p => p.id !== 'model-synthesis');
  return (
    <p className="pr-exec-meta font-mono" style={{ flexWrap: 'wrap' }}>
      {relevant.map(p => (
        <span key={p.id} title={p.health}>{p.displayName}: {p.status}{p.id === (relevant.find(x => x.executable)?.id) ? ' (selected)' : ''}</span>
      ))}
    </p>
  );
}

function ResearchPanel({ researchRun, output, providers, stageWarnings }) {
  if (!researchRun && !output?.evidence?.length) return null;
  const elapsed = researchRun ? fmtDuration({ startedAt: researchRun.createdAt, completedAt: researchRun.completedAt }) : null;
  const fallbackWarnings = (stageWarnings || []).filter(w => /fell back|fallback/i.test(w));
  return (
    <div style={{ marginTop: 8 }}>
      <ProviderStatusStrip providers={providers} />
      {researchRun && (
        <p className="pr-exec-meta font-mono">
          <ResearchRunStatusBadge status={researchRun.status} />
          <span>{researchRun.provider || 'no provider'}</span>
          <span>{researchRun.usage?.queries || 0} queries</span>
          <span>{researchRun.sources?.length || 0} sources</span>
          <span>{researchRun.usage?.fetches || 0} fetched</span>
          {elapsed && <span><FiClock size={11} /> {elapsed}</span>}
          {fmtMoney(researchRun.estimatedCost) && <span>{fmtMoney(researchRun.estimatedCost)}</span>}
        </p>
      )}
      {fallbackWarnings.map((w, i) => (
        <div key={`fallback-${i}`} className="pr-warning font-mono"><FiAlertCircle size={11} /> {w}</div>
      ))}
      {researchRun?.warnings?.length > 0 && researchRun.warnings.map((w, i) => (
        <div key={i} className="pr-warning font-mono"><FiAlertCircle size={11} /> {w}</div>
      ))}
      {researchRun?.error && <div className="pr-warning font-mono"><FiAlertCircle size={11} /> {researchRun.error}</div>}

      {researchRun?.queries?.length > 0 && (
        <details>
          <summary className="cd-agent-status font-mono" style={{ cursor: 'pointer' }}>Queries ({researchRun.queries.length})</summary>
          <ul className="cd-brief-text font-mono">
            {researchRun.queries.map(q => <li key={q.id}>{q.query} — <i>{q.purpose}</i></li>)}
          </ul>
        </details>
      )}

      {researchRun?.sources?.length > 0 && (
        <details>
          <summary className="cd-agent-status font-mono" style={{ cursor: 'pointer' }}>Sources ({researchRun.sources.length})</summary>
          <div className="cd-agent-list">
            {researchRun.sources.map(s => <SourceCard key={s.id} source={s} />)}
          </div>
        </details>
      )}

      {output?.evidence?.length > 0 && (
        <details>
          <summary className="cd-agent-status font-mono" style={{ cursor: 'pointer' }}>Evidence ({output.evidence.length})</summary>
          <ul className="cd-brief-text font-mono">
            {output.evidence.map(e => <li key={e.id}>[{e.verificationStatus}/{e.confidence}] {e.claim} {e.notes ? `— ${e.notes}` : ''}</li>)}
          </ul>
        </details>
      )}

      {output?.evidence?.some(e => e.verificationStatus === 'conflicting') && (
        <details>
          <summary className="cd-agent-status font-mono" style={{ cursor: 'pointer' }}>Conflicting Findings</summary>
          <ul className="cd-brief-text font-mono">
            {output.evidence.filter(e => e.verificationStatus === 'conflicting').map(e => <li key={e.id}>{e.claim} — {e.notes}</li>)}
          </ul>
        </details>
      )}

      {output?.unresolvedClaims?.length > 0 && (
        <details>
          <summary className="cd-agent-status font-mono" style={{ cursor: 'pointer' }}>Unsupported Claims</summary>
          <ul className="cd-brief-text font-mono">
            {output.unresolvedClaims.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

const EDITABLE_STAGES = new Set(['script', 'storyboard', 'thumbnail', 'caption']);

export default function ContentWorkforcePanel({ requestId, requestStatus, onOpenPackagePipeline, onOpenContentOrchestrator }) {
  const [run, setRun] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [editingStage, setEditingStage] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [researchRunId, setResearchRunId] = useState(null);
  const [researchRun, setResearchRun] = useState(null);
  const [providers, setProviders] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/research/providers', { cache: 'no-store' })
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (!cancelled && data?.ok) setProviders(data.providers); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const loadRun = useCallback(async () => {
    if (!requestId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/creative-director/workforce?requestId=${encodeURIComponent(requestId)}`, { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && data.ok) setRun(data.runs?.[0] || null);
    } finally {
      setLoading(false); setLoaded(true);
    }
  }, [requestId]);

  useEffect(() => { setRun(null); setLoaded(false); setResearchRunId(null); setResearchRun(null); loadRun(); }, [requestId, loadRun]);

  // Fetch researchRunId via the detail route (the list route doesn't include it),
  // then the full research-run record (sources/evidence/queries) whenever it changes.
  useEffect(() => {
    if (!run?.id) return;
    let cancelled = false;
    fetch(`/api/creative-director/workforce/${run.id}`, { cache: 'no-store' })
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (!cancelled && data?.ok) setResearchRunId(data.researchRunId || null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [run?.id, run?.stages?.research?.status]);

  useEffect(() => {
    if (!researchRunId) { setResearchRun(null); return; }
    let cancelled = false;
    fetch(`/api/research/runs/${researchRunId}`, { cache: 'no-store' })
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (!cancelled && data?.ok) setResearchRun(data.run); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [researchRunId]);

  const doAction = async (fn) => {
    setBusy(true); setError(null);
    try {
      const res = await fn();
      const data = await res.json();
      if (res.ok && data.ok) { setRun(data.run); return data; }
      setError(data.error || `Server error ${res.status}`);
      return null;
    } catch (err) {
      setError(err.message || 'Request failed.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const runWorkforce = () => doAction(() => fetch('/api/creative-director/workforce/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId }) }));
  const runNext = () => doAction(() => fetch('/api/creative-director/workforce/run-next', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId: run.id }) }));
  const runNextWithResearchMode = (researchMode) => doAction(() => fetch('/api/creative-director/workforce/run-next', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(run ? { runId: run.id, researchMode } : { requestId, researchMode }) }));
  const rerunStage = (stageId, researchMode) => doAction(() => fetch(`/api/creative-director/workforce/${run.id}/rerun-stage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(researchMode ? { stageId, researchMode } : { stageId }) }));
  const retryResearch = () => doAction(() => fetch(`/api/research/runs/${researchRunId}/retry`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).then(() => loadRun());
  const saveEdit = (stageId, override) => doAction(() => fetch(`/api/creative-director/workforce/${run.id}/rerun-stage`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stageId, override }) })).then(d => { if (d) setEditingStage(null); });
  const approve = () => doAction(() => fetch(`/api/creative-director/workforce/${run.id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
  const reject = () => doAction(() => fetch(`/api/creative-director/workforce/${run.id}/reject`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: rejectReason }) })).then(d => { if (d) setRejectReason(''); });
  const cancel = () => doAction(() => fetch(`/api/creative-director/workforce/${run.id}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
  const createPackage = () => doAction(() => fetch(`/api/creative-director/workforce/${run.id}/create-package`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));

  const totalCost = useMemo(() => cumulativeCost(run), [run]);
  const capUsd = run?.budget?.capUsd;

  return (
    <div className="pr-section">
      <div className="pr-section-head">
        <span className="font-ui">Content Workforce</span>
        {run && <RunStatusBadge status={run.status} />}
      </div>
      <p className="pr-reason-text font-mono">Seven governed AI stages turn this request into a complete, human-approved Content Package. Nothing enters Package Pipeline until Creative Review approves it AND you explicitly approve the run.</p>

      {!loaded && loading && <div className="thumb-empty font-mono">Loading workforce run…</div>}

      {loaded && !run && (
        <div className="pr-row-2">
          <button type="button" className="thumb-generate-btn font-ui" disabled={busy} onClick={runWorkforce}>
            {busy ? <><FiRefreshCw size={12} className="spin" /> Running…</> : <><FiZap size={12} /> Run Creative Workforce</>}
          </button>
          <button type="button" className="pr-btn pr-btn--approve font-ui" disabled={busy} onClick={() => runNextWithResearchMode('live-search')}>
            <FiSearch size={12} /> Run Live Research
          </button>
          <button type="button" className="pr-btn font-ui" disabled={busy} onClick={() => runNextWithResearchMode('model-synthesis')}>
            <FiZap size={12} /> Use Model Synthesis
          </button>
        </div>
      )}

      {run && (
        <>
          <div className="pr-exec-meta font-mono" style={{ marginTop: 8 }}>
            <span><FiDollarSign size={11} /> Cumulative estimated cost: ~${totalCost.toFixed(4)}{capUsd != null ? ` / cap $${capUsd}` : ''} (provisional)</span>
          </div>

          {error && <div className="pr-warning font-mono"><FiAlertCircle size={11} /> {error}</div>}

          {!['waiting_review', 'approved', 'rejected', 'cancelled', 'package_created'].includes(run.status) && (
            <div className="pr-row-2" style={{ marginTop: 8 }}>
              <button type="button" className="pr-btn pr-btn--approve font-ui" disabled={busy} onClick={runWorkforce}>
                {busy ? <FiRefreshCw size={12} className="spin" /> : <FiPlay size={12} />} {run.status === 'failed' ? 'Resume Workforce' : 'Run Creative Workforce'}
              </button>
              <button type="button" className="pr-btn font-ui" disabled={busy} onClick={runNext}>
                {busy ? <FiRefreshCw size={12} className="spin" /> : <FiChevronRight size={12} />} Run Next Stage
              </button>
            </div>
          )}

          {run.status === 'waiting_review' && (
            <div className="pr-approval-panel" style={{ marginTop: 10 }}>
              <div className="pr-section-head"><span className="font-ui">Human Review</span></div>
              <button type="button" className="pr-btn pr-btn--approve font-ui" disabled={busy} onClick={approve}>
                <FiCheck size={12} /> Approve Workforce Output
              </button>
              <div className="pr-row-2">
                <input type="text" className="pr-input font-mono" placeholder="Reason for rejection…" value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
                <button type="button" className="pr-btn pr-btn--reject font-ui" disabled={busy || !rejectReason.trim()} onClick={reject}>
                  <FiThumbsDown size={12} /> Reject
                </button>
              </div>
            </div>
          )}

          {run.status === 'approved' && !run.packageId && (
            <button type="button" className="pr-btn pr-btn--approve font-ui" style={{ marginTop: 10 }} disabled={busy} onClick={createPackage}>
              {busy ? <FiRefreshCw size={12} className="spin" /> : <FiPackage size={12} />} Create Package
            </button>
          )}

          {run.packageId && (
            <div className="pr-exec-meta font-mono" style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span>Package: {run.packageId}</span>
              <button type="button" className="pr-btn font-ui" onClick={onOpenPackagePipeline}><FiPackage size={12} /> Open in Package Pipeline</button>
              {onOpenContentOrchestrator && <button type="button" className="pr-btn font-ui" onClick={onOpenContentOrchestrator}><FiChevronRight size={12} /> Open in Content Orchestrator</button>}
            </div>
          )}

          {!['package_created'].includes(run.status) && (
            <button type="button" className="pr-btn pr-btn--muted font-ui" style={{ marginTop: 8 }} disabled={busy} onClick={cancel}>
              <FiX size={12} /> Cancel Run
            </button>
          )}

          <div className="cd-agent-list" style={{ marginTop: 12 }}>
            {WORKFORCE_STAGE_IDS.map(stageId => {
              const slot = run.stages[stageId];
              const result = slot?.result;
              const meta = WORKFORCE_STAGE_META[stageId];
              const cost = fmtMoney(result?.estimatedCost);
              const duration = fmtDuration(result);
              return (
                <div key={stageId} className="cd-agent-card">
                  <div className="cd-agent-card-head">
                    <span className="font-ui">{meta.label}</span>
                    <StageStatusBadge status={slot?.status || 'not_started'} />
                  </div>
                  <p className="pr-reason-text font-mono">{meta.description}</p>
                  {result?.ok && <StagePreview stageId={stageId} output={result.output} />}
                  {result && !result.ok && <div className="pr-warning font-mono"><FiAlertCircle size={11} /> {result.error}</div>}
                  <div className="pr-exec-meta font-mono">
                    {duration && <span><FiClock size={11} /> {duration}</span>}
                    {cost && <span>{cost}</span>}
                    {result?.warnings?.length > 0 && <span>{result.warnings.length} warning(s)</span>}
                  </div>
                  {stageId === 'research' && (slot?.status === 'not_started' || slot?.status === 'invalidated') && run.status !== 'package_created' && (
                    <div className="pr-row-2">
                      <button type="button" className="pr-btn pr-btn--approve font-ui" disabled={busy} onClick={() => runNextWithResearchMode('live-search')}><FiSearch size={12} /> Run Live Research</button>
                      <button type="button" className="pr-btn font-ui" disabled={busy} onClick={() => runNextWithResearchMode('model-synthesis')}><FiZap size={12} /> Use Model Synthesis</button>
                    </div>
                  )}
                  {stageId === 'research' && slot?.status === 'failed' && run.status !== 'package_created' && (
                    <div className="pr-row-2">
                      {researchRun?.status === 'failed' && (
                        <button type="button" className="pr-btn font-ui" disabled={busy} onClick={retryResearch}><FiRefreshCw size={12} /> Retry Research</button>
                      )}
                      <button type="button" className="pr-btn font-ui" disabled={busy} onClick={() => rerunStage(stageId)}><FiRefreshCw size={12} /> Rerun Stage</button>
                    </div>
                  )}
                  {stageId === 'research' && slot?.status === 'completed' && run.status !== 'package_created' && (
                    <div className="pr-row-2">
                      <button type="button" className="pr-btn font-ui" disabled={busy} onClick={() => rerunStage(stageId, 'live-search')}><FiSearch size={12} /> Rerun with Live Search</button>
                      <button type="button" className="pr-btn font-ui" disabled={busy} onClick={() => rerunStage(stageId, 'model-synthesis')}><FiZap size={12} /> Rerun with Model Synthesis</button>
                    </div>
                  )}
                  {stageId === 'research' && (result?.ok || researchRun) && (
                    <ResearchPanel researchRun={researchRun} output={result?.output} providers={providers} stageWarnings={result?.warnings} />
                  )}

                  {stageId !== 'research' && (slot?.status === 'failed' || slot?.status === 'invalidated') && run.status !== 'package_created' && (
                    <button type="button" className="pr-btn font-ui" disabled={busy} onClick={() => rerunStage(stageId)}><FiRefreshCw size={12} /> Rerun Stage</button>
                  )}
                  {slot?.status === 'completed' && EDITABLE_STAGES.has(stageId) && run.status !== 'package_created' && (
                    editingStage === stageId ? (
                      <StageEditForm stageId={stageId} output={result.output} saving={busy} onSave={(override) => saveEdit(stageId, override)} />
                    ) : (
                      <div className="pr-row-2">
                        <button type="button" className="pr-btn font-ui" onClick={() => setEditingStage(stageId)}><FiEdit2 size={12} /> Edit</button>
                        <button type="button" className="pr-btn font-ui" disabled={busy} onClick={() => rerunStage(stageId)}><FiRefreshCw size={12} /> Rerun</button>
                      </div>
                    )
                  )}
                  {result?.ok && (
                    <details>
                      <summary className="cd-agent-status font-mono" style={{ cursor: 'pointer' }}>View full output</summary>
                      <StageDetail stageId={stageId} output={result.output} />
                    </details>
                  )}
                </div>
              );
            })}
          </div>

          <details style={{ marginTop: 10 }}>
            <summary className="cd-agent-status font-mono" style={{ cursor: 'pointer' }}>Workforce activity timeline</summary>
            <ol className="cpp-timeline">
              {[...(run.activityHistory || [])].reverse().map((h, i) => (
                <li key={i} className="cpp-timeline-item">
                  <span className="pr-event-badge font-mono">{h.type.replaceAll('_', ' ')}</span>
                  <span className="cpp-timeline-date font-mono">{new Date(h.at).toLocaleString()}</span>
                  {h.note && <span className="cpp-timeline-note font-mono">{String(h.note).slice(0, 140)}</span>}
                </li>
              ))}
            </ol>
          </details>
        </>
      )}
    </div>
  );
}
