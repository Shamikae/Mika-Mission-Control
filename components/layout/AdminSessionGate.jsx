import { useState, useEffect, useCallback } from 'react';

// ── Admin session gate ──────────────────────────────────────────────────────
// Establishes the `mika_admin_token` cookie that middleware.js already accepts.
//
// Before this existed, every mutation button in the UI failed with a 401 that
// most panels surfaced as nothing at all — the click simply did nothing. This
// renders only when a session is missing, so an authenticated operator never
// sees it.
//
// The token is submitted once and stored by the server as an HttpOnly cookie;
// this component never holds it afterwards and cannot read it back.

export default function AdminSessionGate() {
  const [session, setSession] = useState(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session', { cache: 'no-store' });
      setSession(await res.json());
    } catch {
      setSession({ ok: false, authenticated: false, reason: 'Could not reach the session endpoint.' });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const signIn = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setToken(''); // never retained in component state
        await load();
        return;
      }
      setError(
        res.status === 429 ? 'Too many attempts. Wait a minute and try again.'
          : res.status === 503 ? 'MIKA_ADMIN_TOKEN is not configured on the server.'
          : 'That admin token is not valid.',
      );
    } catch {
      setError('Sign-in request failed.');
    } finally {
      setBusy(false);
    }
  };

  // Nothing to show until we know, and nothing to show once authenticated.
  if (!session || session.authenticated) return null;

  const tokenMissing = session.tokenConfigured === false;

  return (
    <div
      className="panel-gold font-mono"
      style={{
        position: 'fixed', bottom: 16, right: 16, zIndex: 9999,
        maxWidth: 420, padding: '14px 16px', fontSize: 12, lineHeight: 1.5,
      }}
      role="alert"
    >
      <div className="font-ui" style={{ marginBottom: 6, letterSpacing: '0.08em' }}>ADMIN SESSION REQUIRED</div>
      <div style={{ color: 'var(--text-muted)', marginBottom: 10 }}>
        {tokenMissing
          ? 'MIKA_ADMIN_TOKEN is not configured on the server, so mutation APIs are locked. Set it in .env.local and restart.'
          : 'Read-only views work, but every action (connect, approve, generate, publish) will be rejected until this browser has an admin session.'}
      </div>

      {!tokenMissing && (
        <form onSubmit={signIn} style={{ display: 'flex', gap: 6 }}>
          <input
            type="password"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="MIKA_ADMIN_TOKEN"
            autoComplete="off"
            spellCheck={false}
            style={{ flex: 1, minWidth: 0, padding: '6px 8px', fontFamily: 'inherit', fontSize: 12 }}
          />
          <button type="submit" className="thumb-btn" disabled={busy || !token.trim()}>
            {busy ? '…' : 'Sign in'}
          </button>
        </form>
      )}

      {error && <div style={{ color: '#f87171', marginTop: 8 }}>{error}</div>}
    </div>
  );
}
