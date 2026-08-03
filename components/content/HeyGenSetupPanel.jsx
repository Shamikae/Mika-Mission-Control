import { useState, useEffect, useCallback, useRef } from 'react';
import { FiAlertCircle, FiCheckCircle, FiPlay, FiRefreshCw, FiSave, FiSearch } from 'react-icons/fi';

// ── HeyGen Setup panel ───────────────────────────────────────────────────
// Rendered inside JobPanel only when job.selectedProvider === 'heygen-mcp'.
// Avatar/voice selection + a small set of optional generation preferences,
// all persisted server-side via PATCH .../provider-input. Never shows
// tokens/secrets/generation controls beyond Setup itself — Queue/Run/Poll/
// Cancel/Retry remain the existing ExecutionPanel's job. Preview URLs are
// rendered for temporary display only and are never written back anywhere.

const MIKA_SCRIPT_SAFETY_MAX_CHARS = 5000;

export default function HeyGenSetupPanel({ job, pkg, onSaved }) {
  const [status, setStatus] = useState(null);
  const [schema, setSchema] = useState(null);
  const [schemaError, setSchemaError] = useState(null);

  const [avatars, setAvatars] = useState([]);
  const [avatarSearch, setAvatarSearch] = useState('');
  const [loadingAvatars, setLoadingAvatars] = useState(false);

  const [voices, setVoices] = useState([]);
  const [voiceSearch, setVoiceSearch] = useState('');
  const [loadingVoices, setLoadingVoices] = useState(false);

  const providerInput = job.providerInput || {};
  const [avatarId, setAvatarId] = useState(providerInput.avatarId || '');
  const [voiceId, setVoiceId] = useState(providerInput.voiceId || '');
  const [captionEnabled, setCaptionEnabled] = useState(!!providerInput.captionEnabled);
  const [voiceSpeed, setVoiceSpeed] = useState(providerInput.voiceSpeed ?? '');
  const [testMode, setTestMode] = useState(!!providerInput.testMode);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [validation, setValidation] = useState(null);
  const audioRef = useRef(null);

  const loadStatus = useCallback(async () => {
    const res = await fetch('/api/production/providers/heygen/status', { cache: 'no-store' }).catch(() => null);
    if (res?.ok) setStatus(await res.json());
  }, []);

  const loadSchema = useCallback(async () => {
    setSchemaError(null);
    try {
      const res = await fetch('/api/production/providers/heygen/generation-schema', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && data.ok) setSchema(data);
      else setSchemaError(data.error || 'Could not load HeyGen generation schema.');
    } catch (e) {
      setSchemaError(e.message);
    }
  }, []);

  const loadAvatars = useCallback(async (search) => {
    setLoadingAvatars(true);
    try {
      const res = await fetch(`/api/production/providers/heygen/avatars${search ? `?search=${encodeURIComponent(search)}` : ''}`, { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && data.ok) setAvatars(data.avatars);
    } finally {
      setLoadingAvatars(false);
    }
  }, []);

  const loadVoices = useCallback(async (search) => {
    setLoadingVoices(true);
    try {
      const res = await fetch(`/api/production/providers/heygen/voices${search ? `?search=${encodeURIComponent(search)}` : ''}`, { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && data.ok) setVoices(data.voices);
    } finally {
      setLoadingVoices(false);
    }
  }, []);

  useEffect(() => { loadStatus(); loadSchema(); loadAvatars(); loadVoices(); }, [loadStatus, loadSchema, loadAvatars, loadVoices]);

  const scriptLength = (pkg?.script?.fullText || '').trim().length;
  const scriptTooLong = scriptLength > MIKA_SCRIPT_SAFETY_MAX_CHARS;

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const body = { avatarId, voiceId, captionEnabled, testMode };
      body.voiceSpeed = voiceSpeed === '' ? null : Number(voiceSpeed);
      const res = await fetch(`/api/production/jobs/${encodeURIComponent(job.id)}/provider-input`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setValidation(data.validation);
        onSaved?.(data.job);
      } else {
        setSaveError(data.error || 'Could not save HeyGen setup.');
      }
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const playPreview = (url) => {
    if (!audioRef.current || !url) return;
    audioRef.current.src = url;
    audioRef.current.play().catch(() => {});
  };

  return (
    <div className="pr-section pr-heygen-panel">
      <div className="pr-section-head">
        <span className="font-ui">HeyGen Setup</span>
        <button type="button" className="thumb-icon-btn" onClick={() => { loadStatus(); loadSchema(); loadAvatars(avatarSearch); loadVoices(voiceSearch); }} title="Refresh">
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
          <FiAlertCircle size={11} /> HeyGen must be connected (see the HeyGen (MCP) Connection panel) before setup can be completed.
        </div>
      )}

      {schemaError && <div className="pr-warning font-mono"><FiAlertCircle size={11} /> {schemaError}</div>}

      <div className="pr-warning font-mono">
        <FiAlertCircle size={11} /> Credit usage is not available before generation. Submitting may consume HeyGen premium credits.
      </div>
      <div className="pr-warning font-mono">
        <FiAlertCircle size={11} /> Completed provider URLs are temporary and will be saved locally by Mika OS.
      </div>
      {schema && !schema.cancellationSupported && (
        <div className="pr-warning font-mono">
          <FiAlertCircle size={11} /> {schema.cancellationNote}
        </div>
      )}

      <div className="pr-field">
        <label className="pr-field-label font-ui">Avatar</label>
        <div className="ts-library-search">
          <FiSearch size={13} />
          <input
            type="text" className="font-mono" placeholder="Search avatars…" value={avatarSearch}
            onChange={e => { setAvatarSearch(e.target.value); loadAvatars(e.target.value); }}
          />
        </div>
        <div className="pr-provider-list">
          {loadingAvatars && <div className="thumb-empty font-mono">Loading avatars…</div>}
          {!loadingAvatars && avatars.length === 0 && <div className="thumb-empty font-mono">No avatars found.</div>}
          {avatars.map(a => (
            <button
              type="button" key={a.avatarId}
              className={`pr-provider-item${avatarId === a.avatarId ? ' pr-provider-item--selected' : ''}`}
              onClick={() => setAvatarId(a.avatarId)}
              disabled={a.availability !== 'available'}
              style={{ textAlign: 'left', width: '100%' }}
            >
              <div className="pr-provider-item-top">
                {a.previewUrl && <img src={a.previewUrl} alt="" style={{ width: 28, height: 28, borderRadius: 4, objectFit: 'cover' }} />}
                <span className="font-ui">{a.displayName}</span>
                {avatarId === a.avatarId && <span className="pr-provider-recommended-tag font-mono">selected</span>}
                <span className="pr-provider-badge font-mono">{a.type || 'avatar'}{a.gender ? ` · ${a.gender}` : ''}</span>
              </div>
              {a.availability !== 'available' && <div className="pr-provider-reason font-mono">Not currently available ({a.availability}).</div>}
            </button>
          ))}
        </div>
      </div>

      <div className="pr-field">
        <label className="pr-field-label font-ui">Voice</label>
        <div className="ts-library-search">
          <FiSearch size={13} />
          <input
            type="text" className="font-mono" placeholder="Search voices…" value={voiceSearch}
            onChange={e => { setVoiceSearch(e.target.value); loadVoices(e.target.value); }}
          />
        </div>
        <div className="pr-provider-list">
          {loadingVoices && <div className="thumb-empty font-mono">Loading voices…</div>}
          {!loadingVoices && voices.length === 0 && <div className="thumb-empty font-mono">No voices found.</div>}
          {voices.map(v => (
            <div key={v.voiceId} className={`pr-provider-item${voiceId === v.voiceId ? ' pr-provider-item--selected' : ''}`}>
              <div className="pr-provider-item-top">
                <button type="button" className="pr-btn pr-btn--muted font-ui" style={{ flex: 1, textAlign: 'left' }} onClick={() => setVoiceId(v.voiceId)}>
                  {v.displayName}
                  {voiceId === v.voiceId && <span className="pr-provider-recommended-tag font-mono"> selected</span>}
                </button>
                <span className="pr-provider-badge font-mono">{v.language || '—'}{v.gender ? ` · ${v.gender}` : ''}</span>
                {v.previewUrl && (
                  <button type="button" className="thumb-icon-btn" onClick={() => playPreview(v.previewUrl)} title="Preview voice">
                    <FiPlay size={11} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio ref={audioRef} style={{ display: 'none' }} />
      </div>

      {schema?.schema?.supportsCaption && (
        <div className="pr-field">
          <label className="pr-field-label font-ui">
            <input type="checkbox" checked={captionEnabled} onChange={e => setCaptionEnabled(e.target.checked)} /> Burn in captions
          </label>
        </div>
      )}

      {schema?.schema?.supportsVoiceSpeed && (
        <div className="pr-field">
          <label className="pr-field-label font-ui">
            Voice speed ({schema.schema.voiceSpeedRange?.min ?? 0.5}–{schema.schema.voiceSpeedRange?.max ?? 1.5}, default {schema.schema.voiceSpeedRange?.default ?? 1})
          </label>
          <input
            type="number" step="0.1" className="pr-input font-mono" placeholder="Default"
            min={schema.schema.voiceSpeedRange?.min ?? 0.5} max={schema.schema.voiceSpeedRange?.max ?? 1.5}
            value={voiceSpeed} onChange={e => setVoiceSpeed(e.target.value)}
          />
        </div>
      )}

      <div className="pr-field">
        <label className="pr-field-label font-ui">Output</label>
        <div className="pr-exec-meta font-mono">
          <span>Orientation: {job.outputSpec?.aspectRatio || '—'}</span>
          <span>Resolution: {providerInput.resolution || '1080p (default)'}</span>
          <span>Format: mp4</span>
        </div>
      </div>

      <div className="pr-field">
        <label className="pr-field-label font-ui">
          <input type="checkbox" checked={testMode} onChange={e => setTestMode(e.target.checked)} /> Mark as test submission
        </label>
        <div className="pr-field-hint font-mono">Local bookkeeping only — HeyGen has no sandbox/test mode; a real render still runs and may consume real premium credits.</div>
      </div>

      <div className="pr-field">
        <span className="pr-field-label font-ui">Script length</span>
        <div className={`pr-exec-meta font-mono`} style={scriptTooLong ? { color: '#f87171' } : undefined}>
          <span>{scriptLength} / {MIKA_SCRIPT_SAFETY_MAX_CHARS} characters</span>
        </div>
        {scriptTooLong && (
          <div className="pr-warning font-mono"><FiAlertCircle size={11} /> Script exceeds Mika's safety maximum — this job cannot submit until the package script is shortened.</div>
        )}
      </div>

      {saveError && <div className="pr-warning font-mono"><FiAlertCircle size={11} /> {saveError}</div>}

      {validation && (
        <div className={validation.valid ? 'pr-approved-flash font-mono' : 'pr-warning font-mono'}>
          {validation.valid ? <FiCheckCircle size={12} /> : <FiAlertCircle size={11} />}
          {validation.valid ? ' HeyGen setup is valid and ready.' : ` ${validation.errors.join(' ')}`}
        </div>
      )}

      <button type="button" className="pr-btn pr-btn--approve font-ui" onClick={save} disabled={saving || !avatarId || !voiceId}>
        {saving ? <><FiRefreshCw size={12} className="spin" /> Saving…</> : <><FiSave size={12} /> Save HeyGen Setup</>}
      </button>
    </div>
  );
}
