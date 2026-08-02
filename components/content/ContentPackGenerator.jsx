import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FiAlertCircle, FiCheck, FiCheckCircle, FiCopy, FiDownload,
  FiEye, FiFilter, FiImage, FiPlus, FiRefreshCw,
  FiSearch, FiThumbsDown, FiTrash2, FiX, FiZap,
} from 'react-icons/fi';
// No ContentWorkspace wrapper here — StudioWorkspace (the tab host) already
// provides the outer header, matching every sibling tab (ContentFactoryPackage,
// ContentBriefGenerator, etc.), none of which self-wrap either.

// ── Constants ─────────────────────────────────────────────────────────────────
// Brand/platform/goal are free text with convenient suggestions — Content
// Pack Generator is not hardcoded to a fixed set of brands or platforms.

const BRAND_SUGGESTIONS = [
  'Digital Diamond AI', 'Managed by Mika', 'MedAI', 'CannaOps', 'The Hotel Hooker', 'AI Twin Studio',
];

const PLATFORM_SUGGESTIONS = ['TikTok', 'Instagram Reels', 'YouTube Shorts', 'LinkedIn', 'Pinterest', 'General'];

const GOAL_SUGGESTIONS = [
  'Educate', 'Build trust', 'Promote product', 'Affiliate conversion',
  'Lead generation', 'Engagement', 'Brand awareness',
];

const DURATION_SUGGESTIONS = ['<15s', '15-30s', '30-60s', '60-90s'];

const STATUS_META = {
  draft:        { label: 'Draft',         color: '#60a5fa' },
  needs_review: { label: 'Needs Review',  color: '#a78bfa' },
  approved:     { label: 'Approved',      color: '#4ade80' },
  rejected:     { label: 'Rejected',      color: '#f87171' },
};

const THUMB_STATUS_META = {
  not_requested:   { label: 'Not requested',  color: '#5d6c86' },
  completed:       { label: 'Complete',       color: '#4ade80' },
  failed:          { label: 'Failed',         color: '#f87171' },
  budget_exceeded: { label: 'Budget Exceeded', color: '#f59e0b' },
  unavailable:     { label: 'Unavailable',    color: '#fb923c' },
};

const SYNTH_FAILURE_LABELS = {
  configuration_pending: 'Content synthesis is not configured',
  auth_error:            'OpenRouter authentication failed',
  rate_limited:          'OpenRouter rate limit reached',
  billing_error:         'OpenRouter billing issue',
  provider_error:        'Synthesis provider error',
  network_error:         'Could not reach the synthesis provider',
  parse_error:           'Synthesis returned an unreadable response',
  malformed_output:      'Synthesis output failed validation',
  empty_response:        'Synthesis returned no content',
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
  try {
    return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

function shorten(text, max = 90) {
  if (!text) return '';
  const t = String(text).trim();
  return t.length > max ? `${t.slice(0, max).trim()}…` : t;
}

function buildPlainTextExport(pkg) {
  const lines = [
    `CONTENT PACKAGE — ${pkg.topic}`,
    `Brand: ${pkg.brand}  ·  Platform: ${pkg.platform}  ·  Goal: ${pkg.goal}`,
    '',
    'HOOKS',
    ...pkg.hooks.map((h, i) => `${i + 1}. ${h.text}${h.angle ? ` (${h.angle})` : ''}`),
    '',
    'SCRIPT',
    pkg.script.fullText || '',
    '',
    'SCENE PLAN',
    ...pkg.scenes.map(s => `${s.order}. [${s.durationSeconds ?? '?'}s] ${s.visual}${s.voiceover ? ` — VO: ${s.voiceover}` : ''}${s.onScreenText ? ` — On-screen: ${s.onScreenText}` : ''}`),
    '',
    'CAPTION',
    pkg.caption || '',
    '',
    `CTA: ${pkg.cta || ''}`,
    '',
    `HASHTAGS: ${pkg.hashtags.map(h => `#${h}`).join(' ')}`,
    `KEYWORDS: ${pkg.keywords.join(', ')}`,
    '',
    'THUMBNAIL',
    `Headline: ${pkg.thumbnail.headline || ''}`,
    `Visual brief: ${pkg.thumbnail.visualBrief || ''}`,
  ];
  return lines.join('\n');
}

function downloadArtifact(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'thumbnail';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ── Small shared pieces ──────────────────────────────────────────────────────

function StatusBadge({ status, meta = STATUS_META, size = 'sm' }) {
  const m = meta[status] || { label: status, color: '#5d6c86' };
  return (
    <span
      className={`cpg-status-badge cpg-status-badge--${size} font-mono`}
      style={{ color: m.color, background: `${m.color}1f`, borderColor: `${m.color}40` }}
    >
      {m.label}
    </span>
  );
}

function RegenerateSectionButton({ label }) {
  return (
    <button type="button" className="cpg-regen-btn" disabled title={`Regenerate ${label} — coming soon`}>
      <FiRefreshCw size={11} />
    </button>
  );
}

// Comma/Enter-separated tag chip input, used for hashtags and keywords.
function TagInput({ tags, onChange, placeholder }) {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const value = draft.trim().replace(/^#/, '');
    if (value && !tags.includes(value)) onChange([...tags, value]);
    setDraft('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && !draft && tags.length) {
      onChange(tags.slice(0, -1));
    }
  };

  return (
    <div className="cpg-tag-input">
      {tags.map((t, i) => (
        <span key={`${t}-${i}`} className="cpg-tag-chip font-mono">
          {t}
          <button type="button" onClick={() => onChange(tags.filter((_, idx) => idx !== i))} aria-label={`Remove ${t}`}>
            <FiX size={9} />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commit}
        placeholder={tags.length ? '' : placeholder}
        className="font-mono"
      />
    </div>
  );
}

// ── Package editor sections ──────────────────────────────────────────────────

function HookEditor({ hooks, onChange }) {
  const update = (i, field, value) => {
    const next = hooks.slice();
    next[i] = { ...next[i], [field]: value };
    onChange(next);
  };
  const remove = (i) => onChange(hooks.filter((_, idx) => idx !== i));
  const add = () => { if (hooks.length < 5) onChange([...hooks, { text: '', angle: '' }]); };

  return (
    <div className="cpg-section">
      <div className="cpg-section-head">
        <span className="font-ui">Hooks</span>
        <div className="cpg-section-actions">
          <RegenerateSectionButton label="hooks" />
          <button type="button" className="cpg-icon-btn" onClick={add} disabled={hooks.length >= 5} title="Add hook">
            <FiPlus size={12} />
          </button>
        </div>
      </div>
      {hooks.map((h, i) => (
        <div key={i} className="cpg-hook-row">
          <span className="cpg-hook-index font-mono">{i + 1}</span>
          <div className="cpg-hook-fields">
            <textarea
              className="cpg-textarea cpg-textarea--sm"
              rows={2}
              value={h.text}
              onChange={e => update(i, 'text', e.target.value)}
              placeholder="Hook text…"
            />
            <input
              type="text"
              className="cpg-input font-mono"
              value={h.angle}
              onChange={e => update(i, 'angle', e.target.value)}
              placeholder="Angle (e.g. curiosity gap)"
            />
          </div>
          <button type="button" className="cpg-icon-btn cpg-icon-btn--danger" onClick={() => remove(i)} title="Remove hook">
            <FiTrash2 size={11} />
          </button>
        </div>
      ))}
      {hooks.length === 0 && <div className="cpg-empty-inline font-mono">No hooks yet.</div>}
    </div>
  );
}

function ScriptEditor({ script, onChange }) {
  const update = (field, value) => onChange({ ...script, [field]: value });
  return (
    <div className="cpg-section">
      <div className="cpg-section-head">
        <span className="font-ui">Script</span>
        <RegenerateSectionButton label="script" />
      </div>
      <label className="cpg-field-label font-mono">Full script</label>
      <textarea
        className="cpg-textarea"
        rows={5}
        value={script.fullText}
        onChange={e => update('fullText', e.target.value)}
        placeholder="Complete spoken script…"
      />
      <div className="cpg-row-3">
        <div>
          <label className="cpg-field-label font-mono">Opening</label>
          <textarea className="cpg-textarea cpg-textarea--sm" rows={3} value={script.opening} onChange={e => update('opening', e.target.value)} />
        </div>
        <div>
          <label className="cpg-field-label font-mono">Body</label>
          <textarea className="cpg-textarea cpg-textarea--sm" rows={3} value={script.body} onChange={e => update('body', e.target.value)} />
        </div>
        <div>
          <label className="cpg-field-label font-mono">CTA line</label>
          <textarea className="cpg-textarea cpg-textarea--sm" rows={3} value={script.cta} onChange={e => update('cta', e.target.value)} />
        </div>
      </div>
    </div>
  );
}

function SceneEditor({ scenes, onChange }) {
  const update = (i, field, value) => {
    const next = scenes.slice();
    next[i] = { ...next[i], [field]: value };
    onChange(next);
  };
  const remove = (i) => onChange(scenes.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, order: idx + 1 })));
  const add = () => onChange([...scenes, { order: scenes.length + 1, durationSeconds: 3, visual: '', voiceover: '', onScreenText: '' }]);

  return (
    <div className="cpg-section">
      <div className="cpg-section-head">
        <span className="font-ui">Scene / Shot Plan</span>
        <div className="cpg-section-actions">
          <RegenerateSectionButton label="scene plan" />
          <button type="button" className="cpg-icon-btn" onClick={add} title="Add scene">
            <FiPlus size={12} />
          </button>
        </div>
      </div>
      {scenes.map((s, i) => (
        <div key={i} className="cpg-scene-row">
          <div className="cpg-scene-row-top">
            <span className="cpg-hook-index font-mono">Scene {s.order}</span>
            <input
              type="number"
              className="cpg-input cpg-input--xs font-mono"
              value={s.durationSeconds ?? ''}
              onChange={e => update(i, 'durationSeconds', Number(e.target.value) || null)}
              placeholder="sec"
              min={1}
              max={120}
            />
            <button type="button" className="cpg-icon-btn cpg-icon-btn--danger" onClick={() => remove(i)} title="Remove scene">
              <FiTrash2 size={11} />
            </button>
          </div>
          <textarea className="cpg-textarea cpg-textarea--sm" rows={2} value={s.visual} onChange={e => update(i, 'visual', e.target.value)} placeholder="Visual…" />
          <textarea className="cpg-textarea cpg-textarea--sm" rows={2} value={s.voiceover} onChange={e => update(i, 'voiceover', e.target.value)} placeholder="Voiceover…" />
          <input type="text" className="cpg-input font-mono" value={s.onScreenText} onChange={e => update(i, 'onScreenText', e.target.value)} placeholder="On-screen text…" />
        </div>
      ))}
      {scenes.length === 0 && <div className="cpg-empty-inline font-mono">No scenes yet.</div>}
    </div>
  );
}

function ThumbnailSection({ pkg, onEdit, onGenerate, generating, maxCredits, setMaxCredits }) {
  const thumb = pkg.thumbnail;
  return (
    <div className="cpg-section">
      <div className="cpg-section-head">
        <span className="font-ui">Thumbnail</span>
        <StatusBadge status={thumb.status} meta={THUMB_STATUS_META} />
      </div>

      <label className="cpg-field-label font-mono">Headline</label>
      <input
        type="text"
        className="cpg-input font-mono"
        value={thumb.headline}
        onChange={e => onEdit({ ...thumb, headline: e.target.value })}
        placeholder="Under 6 words…"
        maxLength={150}
      />
      <label className="cpg-field-label font-mono">Visual brief</label>
      <textarea
        className="cpg-textarea cpg-textarea--sm"
        rows={3}
        value={thumb.visualBrief}
        onChange={e => onEdit({ ...thumb, visualBrief: e.target.value })}
        placeholder="Concrete AI-image prompt — composition, subject, style, colors…"
        maxLength={1000}
      />

      {thumb.error && (
        <div className="cpg-thumb-error font-mono">
          <FiAlertCircle size={11} /> {thumb.error}
        </div>
      )}

      {thumb.artifactUrl && (
        <div className="cpg-thumb-preview">
          <img src={thumb.artifactUrl} alt="" loading="lazy" />
        </div>
      )}

      <div className="cpg-thumb-controls">
        <input
          type="number"
          className="cpg-input cpg-input--sm font-mono"
          value={maxCredits}
          onChange={e => setMaxCredits(e.target.value)}
          placeholder="Max credits"
          min={1}
        />
        <button
          type="button"
          className="cpg-btn cpg-btn--secondary font-ui"
          onClick={onGenerate}
          disabled={generating || !thumb.visualBrief?.trim()}
        >
          {generating ? <><FiRefreshCw size={12} className="spin" /> Generating…</> : <><FiImage size={12} /> {thumb.artifactUrl ? 'Regenerate thumbnail' : 'Generate thumbnail'}</>}
        </button>
      </div>
    </div>
  );
}

// ── Package editor (right column) ────────────────────────────────────────────

function PackageEditor({ pkg, setPkg, onSave, onStatusChange, saving, thumbGenerating, onGenerateThumbnail, maxCredits, setMaxCredits, savedFlash }) {
  const patch = (field, value) => setPkg(prev => ({ ...prev, [field]: value }));

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(buildPlainTextExport(pkg)); } catch { /* clipboard may be unavailable */ }
  };
  const handleDownload = () => {
    const blob = new Blob([buildPlainTextExport(pkg)], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    downloadArtifact(url, `${pkg.id}.txt`);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="cpg-editor">
      <div className="cpg-editor-head">
        <div className="cpg-editor-head-main">
          <h3 className="font-ui">{pkg.topic}</h3>
          <div className="cpg-editor-chips font-mono">
            <span>{pkg.brand}</span><span>·</span><span>{pkg.platform}</span><span>·</span><span>{pkg.goal}</span>
          </div>
        </div>
        <StatusBadge status={pkg.status} size="lg" />
      </div>

      <div className="cpg-editor-toolbar">
        <button type="button" className="cpg-btn font-ui" onClick={onSave} disabled={saving}>
          {saving ? <><FiRefreshCw size={12} className="spin" /> Saving…</> : <><FiCheck size={12} /> Save changes</>}
        </button>
        <button type="button" className="cpg-btn cpg-btn--muted font-ui" onClick={() => onStatusChange('needs_review')} disabled={pkg.status === 'needs_review'}>
          <FiEye size={12} /> Mark for review
        </button>
        <button type="button" className="cpg-btn cpg-btn--approve font-ui" onClick={() => onStatusChange('approved')} disabled={pkg.status === 'approved'}>
          <FiCheckCircle size={12} /> Approve
        </button>
        <button type="button" className="cpg-btn cpg-btn--reject font-ui" onClick={() => onStatusChange('rejected')} disabled={pkg.status === 'rejected'}>
          <FiThumbsDown size={12} /> Reject
        </button>
        <button type="button" className="cpg-btn cpg-btn--muted font-ui" onClick={handleCopy}>
          <FiCopy size={12} /> Copy
        </button>
        <button type="button" className="cpg-btn cpg-btn--muted font-ui" onClick={handleDownload}>
          <FiDownload size={12} /> Download
        </button>
        {savedFlash && <span className="cpg-saved-flash font-mono"><FiCheck size={10} /> Saved</span>}
      </div>

      <HookEditor hooks={pkg.hooks} onChange={v => patch('hooks', v)} />
      <ScriptEditor script={pkg.script} onChange={v => patch('script', v)} />
      <SceneEditor scenes={pkg.scenes} onChange={v => patch('scenes', v)} />

      <div className="cpg-section">
        <div className="cpg-section-head">
          <span className="font-ui">Caption</span>
          <RegenerateSectionButton label="caption" />
        </div>
        <textarea className="cpg-textarea" rows={4} value={pkg.caption} onChange={e => patch('caption', e.target.value)} maxLength={2200} />
      </div>

      <div className="cpg-section">
        <div className="cpg-section-head"><span className="font-ui">CTA</span></div>
        <input type="text" className="cpg-input font-mono" value={pkg.cta} onChange={e => patch('cta', e.target.value)} maxLength={300} />
      </div>

      <div className="cpg-row-2">
        <div className="cpg-section">
          <div className="cpg-section-head"><span className="font-ui">Hashtags</span></div>
          <TagInput tags={pkg.hashtags} onChange={v => patch('hashtags', v)} placeholder="Add hashtag + Enter" />
        </div>
        <div className="cpg-section">
          <div className="cpg-section-head"><span className="font-ui">Keywords</span></div>
          <TagInput tags={pkg.keywords} onChange={v => patch('keywords', v)} placeholder="Add keyword + Enter" />
        </div>
      </div>

      <ThumbnailSection
        pkg={pkg}
        onEdit={v => patch('thumbnail', v)}
        onGenerate={onGenerateThumbnail}
        generating={thumbGenerating}
        maxCredits={maxCredits}
        setMaxCredits={setMaxCredits}
      />

      <div className="cpg-editor-meta font-mono">
        <span>model: {pkg.metadata?.model || '—'}</span>
        <span>·</span>
        <span>workflow: {pkg.metadata?.workflowId}</span>
        <span>·</span>
        <span>updated: {formatDate(pkg.metadata?.updatedAt)}</span>
      </div>
    </div>
  );
}

// ── Package library ──────────────────────────────────────────────────────────

function PackageCard({ pkg, onOpen }) {
  return (
    <button type="button" className="cpg-lib-card" onClick={() => onOpen(pkg.id)}>
      <div className="cpg-lib-thumb-wrap">
        {pkg.thumbnail?.artifactUrl ? (
          <img src={pkg.thumbnail.artifactUrl} alt="" loading="lazy" className="cpg-lib-thumb" />
        ) : (
          <div className="cpg-lib-thumb-empty"><FiImage size={18} /></div>
        )}
        <div className="cpg-lib-card-badge"><StatusBadge status={pkg.status} /></div>
      </div>
      <div className="cpg-lib-card-body">
        <span className="cpg-lib-card-title font-ui">{shorten(pkg.topic, 60)}</span>
        <span className="cpg-lib-card-meta font-mono">{pkg.brand} · {pkg.platform}</span>
        <span className="cpg-lib-card-meta font-mono">
          {pkg.metadata?.model || 'no model'}
          {pkg.metadata?.estimatedCost ? ` · ${pkg.metadata.estimatedCost}cr` : ''}
        </span>
        <span className="cpg-lib-card-date font-mono">{formatDate(pkg.metadata?.updatedAt)}</span>
      </div>
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ContentPackGenerator() {
  // Form state
  const [brand, setBrand]               = useState('');
  const [platform, setPlatform]         = useState('TikTok');
  const [goal, setGoal]                 = useState('Engagement');
  const [topic, setTopic]               = useState('');
  const [audience, setAudience]         = useState('');
  const [offer, setOffer]               = useState('');
  const [tone, setTone]                 = useState('');
  const [videoDuration, setVideoDuration]= useState('30-60s');
  const [cta, setCta]                   = useState('');
  const [instructions, setInstructions] = useState('');
  const [generateThumbToggle, setGenerateThumbToggle] = useState(false);
  const [formMaxCredits, setFormMaxCredits] = useState(50);

  // Generation state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null); // { status, message }

  // Current package + editor state
  const [pkg, setPkg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [thumbGenerating, setThumbGenerating] = useState(false);
  const [thumbMaxCredits, setThumbMaxCredits] = useState(50);

  // Library
  const [packages, setPackages] = useState([]);
  const [libLoading, setLibLoading] = useState(false);
  const [libLoaded, setLibLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [filterBrand, setFilterBrand] = useState('all');
  const [filterPlatform, setFilterPlatform] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterDate, setFilterDate] = useState('all');

  const loadLibrary = useCallback(async () => {
    setLibLoading(true);
    try {
      const res = await fetch('/api/content/pack/list', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setPackages(Array.isArray(data.packages) ? data.packages.slice(0, LIBRARY_LIMIT) : []);
    } finally {
      setLibLoading(false);
      setLibLoaded(true);
    }
  }, []);

  useEffect(() => { loadLibrary(); }, [loadLibrary]);

  const filteredPackages = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = Date.now();
    return packages.filter(p => {
      if (filterBrand !== 'all' && p.brand !== filterBrand) return false;
      if (filterPlatform !== 'all' && p.platform !== filterPlatform) return false;
      if (filterStatus !== 'all' && p.status !== filterStatus) return false;
      if (filterDate !== 'all') {
        const t = p.metadata?.updatedAt ? new Date(p.metadata.updatedAt).getTime() : 0;
        const cutoff = filterDate === 'today' ? new Date().setHours(0, 0, 0, 0)
          : now - (filterDate === '7d' ? 7 : 30) * 86400000;
        if (!t || t < cutoff) return false;
      }
      if (q && !`${p.topic} ${p.brand}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [packages, search, filterBrand, filterPlatform, filterStatus, filterDate]);

  const brandOptions = useMemo(() => [...new Set(packages.map(p => p.brand).filter(Boolean))], [packages]);
  const platformOptions = useMemo(() => [...new Set(packages.map(p => p.platform).filter(Boolean))], [packages]);

  // ── Generate ────────────────────────────────────────────────────────────────

  const generate = async () => {
    if (!brand.trim() || !topic.trim() || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    setPkg(null);

    try {
      const res = await fetch('/api/content/pack/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand: brand.trim(), platform, goal, topic: topic.trim(),
          audience: audience.trim(), offer: offer.trim(), tone: tone.trim(),
          videoDuration, cta: cta.trim(), instructions: instructions.trim(),
          generateThumbnail: generateThumbToggle,
          maxImageCredits: generateThumbToggle ? Number(formMaxCredits) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setSubmitError({ status: data.status || 'error', message: data.error || `Server error ${res.status}` });
        return;
      }
      setPkg(data.package);
      setThumbMaxCredits(formMaxCredits);
      await loadLibrary();
    } catch (err) {
      setSubmitError({ status: 'network_error', message: err.message || 'Request failed — please retry.' });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Save / status ─────────────────────────────────────────────────────────

  const saveChanges = async () => {
    if (!pkg) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/content/pack/${encodeURIComponent(pkg.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          edits: {
            hooks: pkg.hooks, script: pkg.script, scenes: pkg.scenes,
            caption: pkg.caption, cta: pkg.cta, hashtags: pkg.hashtags, keywords: pkg.keywords,
            thumbnail: { headline: pkg.thumbnail.headline, visualBrief: pkg.thumbnail.visualBrief },
          },
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setPkg(data.package);
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 2000);
        await loadLibrary();
      }
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (status) => {
    if (!pkg) return;
    const res = await fetch(`/api/content/pack/${encodeURIComponent(pkg.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      setPkg(data.package);
      await loadLibrary();
    }
  };

  const generateThumbnail = async () => {
    if (!pkg) return;
    setThumbGenerating(true);
    try {
      const res = await fetch('/api/content/pack/thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packageId: pkg.id,
          maxImageCredits: Number(thumbMaxCredits),
          headline: pkg.thumbnail.headline,
          visualBrief: pkg.thumbnail.visualBrief,
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setPkg(data.package);
        await loadLibrary();
      }
    } finally {
      setThumbGenerating(false);
    }
  };

  const openPackage = async (id) => {
    const res = await fetch(`/api/content/pack/${encodeURIComponent(id)}`, { cache: 'no-store' });
    const data = await res.json();
    if (res.ok && data.ok) setPkg(data.package);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="cpg-wrapper">
      <div className="cpg-wrapper-head">
        <h3 className="font-ui">Content Pack Generator</h3>
        <p className="font-mono">Turn one idea into a complete, editable, approval-ready content package.</p>
      </div>

      <div className="ts-workspace">

        {/* ══════════════════ LEFT — brief form ══════════════════ */}
        <div className="ts-workspace-left">
          <div className="cpg-form">
            <div className="cpg-field">
              <label className="cpg-field-label font-ui">Brand / lane</label>
              <input
                type="text" list="cpg-brand-suggestions" className="cpg-input font-mono"
                value={brand} onChange={e => setBrand(e.target.value)} placeholder="e.g. Digital Diamond AI"
              />
              <datalist id="cpg-brand-suggestions">
                {BRAND_SUGGESTIONS.map(b => <option key={b} value={b} />)}
              </datalist>
            </div>

            <div className="cpg-row-2">
              <div className="cpg-field">
                <label className="cpg-field-label font-ui">Platform</label>
                <input type="text" list="cpg-platform-suggestions" className="cpg-input font-mono" value={platform} onChange={e => setPlatform(e.target.value)} />
                <datalist id="cpg-platform-suggestions">
                  {PLATFORM_SUGGESTIONS.map(p => <option key={p} value={p} />)}
                </datalist>
              </div>
              <div className="cpg-field">
                <label className="cpg-field-label font-ui">Content goal</label>
                <input type="text" list="cpg-goal-suggestions" className="cpg-input font-mono" value={goal} onChange={e => setGoal(e.target.value)} />
                <datalist id="cpg-goal-suggestions">
                  {GOAL_SUGGESTIONS.map(g => <option key={g} value={g} />)}
                </datalist>
              </div>
            </div>

            <div className="cpg-field">
              <label className="cpg-field-label font-ui">Topic / raw idea</label>
              <textarea
                className="cpg-textarea" rows={3} maxLength={500}
                value={topic} onChange={e => setTopic(e.target.value)}
                placeholder="What's the content about?"
              />
              <div className="cpg-char-count font-mono">{topic.length}/500</div>
            </div>

            <div className="cpg-row-2">
              <div className="cpg-field">
                <label className="cpg-field-label font-ui">Target audience</label>
                <input type="text" className="cpg-input font-mono" value={audience} onChange={e => setAudience(e.target.value)} placeholder="Optional" />
              </div>
              <div className="cpg-field">
                <label className="cpg-field-label font-ui">Product / offer</label>
                <input type="text" className="cpg-input font-mono" value={offer} onChange={e => setOffer(e.target.value)} placeholder="Optional" />
              </div>
            </div>

            <div className="cpg-row-2">
              <div className="cpg-field">
                <label className="cpg-field-label font-ui">Tone</label>
                <input type="text" className="cpg-input font-mono" value={tone} onChange={e => setTone(e.target.value)} placeholder="e.g. bold, playful" />
              </div>
              <div className="cpg-field">
                <label className="cpg-field-label font-ui">Video duration</label>
                <input type="text" list="cpg-duration-suggestions" className="cpg-input font-mono" value={videoDuration} onChange={e => setVideoDuration(e.target.value)} />
                <datalist id="cpg-duration-suggestions">
                  {DURATION_SUGGESTIONS.map(d => <option key={d} value={d} />)}
                </datalist>
              </div>
            </div>

            <div className="cpg-field">
              <label className="cpg-field-label font-ui">Desired CTA</label>
              <input type="text" className="cpg-input font-mono" value={cta} onChange={e => setCta(e.target.value)} placeholder="Optional" maxLength={300} />
            </div>

            <div className="cpg-field">
              <label className="cpg-field-label font-ui">Additional instructions</label>
              <textarea className="cpg-textarea cpg-textarea--sm" rows={3} maxLength={2000} value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="Optional" />
            </div>

            <label className="thumb-exact-toggle font-mono">
              <input type="checkbox" checked={generateThumbToggle} onChange={e => setGenerateThumbToggle(e.target.checked)} />
              Generate thumbnail with this package
            </label>

            {generateThumbToggle && (
              <div className="cpg-field">
                <label className="cpg-field-label font-ui">Max image-credit budget</label>
                <input type="number" className="cpg-input cpg-input--sm font-mono" min={1} value={formMaxCredits} onChange={e => setFormMaxCredits(e.target.value)} />
              </div>
            )}

            {submitError && (
              <div className="thumb-field-error font-mono">
                <FiAlertCircle size={11} />
                {SYNTH_FAILURE_LABELS[submitError.status] || 'Generation failed'}: {submitError.message}
              </div>
            )}

            <button
              type="button"
              className="thumb-generate-btn font-ui"
              disabled={!brand.trim() || !topic.trim() || submitting}
              onClick={generate}
            >
              {submitting ? <><FiRefreshCw size={12} className="spin" /> Generating package…</> : <><FiZap size={12} /> Generate Content Pack</>}
            </button>
          </div>
        </div>

        {/* ══════════════════ RIGHT — package editor ══════════════════ */}
        <div className="ts-workspace-right">
          {!pkg && !submitting && !submitError && (
            <div className="thumb-empty font-mono cpg-empty-panel">
              Fill in the brief on the left and generate a content package, or open one from the library below.
            </div>
          )}
          {submitting && (
            <div className="thumb-empty font-mono cpg-empty-panel">
              <FiRefreshCw size={14} className="spin" /> Synthesizing hooks, script, scenes, caption, and thumbnail brief…
            </div>
          )}
          {pkg && (
            <PackageEditor
              pkg={pkg}
              setPkg={setPkg}
              onSave={saveChanges}
              onStatusChange={changeStatus}
              saving={saving}
              savedFlash={savedFlash}
              thumbGenerating={thumbGenerating}
              onGenerateThumbnail={generateThumbnail}
              maxCredits={thumbMaxCredits}
              setMaxCredits={setThumbMaxCredits}
            />
          )}
        </div>
      </div>

      {/* ══════════════════ Package Library (full width) ══════════════════ */}
      <div className="ts-history-section">
        <div className="thumb-section-head">
          <span className="font-ui">Recent Content Packages</span>
          <button type="button" className="thumb-icon-btn" onClick={loadLibrary} disabled={libLoading} title="Refresh">
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
            <select className="ts-filter-select font-mono" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="all">All statuses</option>
              {Object.keys(STATUS_META).map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
          </div>
        </div>

        {libLoading && !libLoaded ? (
          <div className="thumb-empty font-mono">Loading content packages…</div>
        ) : filteredPackages.length === 0 ? (
          <div className="thumb-empty font-mono">
            {packages.length === 0 ? 'No content packages yet. Generate one above to start your library.' : 'No packages match these filters.'}
          </div>
        ) : (
          <div className="ts-library-grid">
            {filteredPackages.map(p => <PackageCard key={p.id} pkg={p} onOpen={openPackage} />)}
          </div>
        )}
      </div>
    </div>
  );
}
