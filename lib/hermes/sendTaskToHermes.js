// ─── HERMES ADAPTER ───────────────────────────────────────────────────────────
//
//  sendTaskToHermes() is the SINGLE point of contact with the Hermes worker.
//  To swap the endpoint or auth scheme, change ONLY this function.
//
//  SWAP POINT: update HERMES_TASK_PATH to match Hermes's actual dispatch endpoint.
//  Default assumes a simple POST /api/task that accepts a handoff object.
//  If Hermes exposes an OpenAI-compatible endpoint, set HERMES_TASK_PATH=/v1/chat/completions
//  and adjust the payload shape accordingly.
//
// ─────────────────────────────────────────────────────────────────────────────

const ENABLED    = process.env.HERMES_ENABLED    === 'true';
const API_URL    = process.env.HERMES_API_URL    || '';
const AGENT_ID   = process.env.HERMES_AGENT_ID   || 'hermes-research';
const TASK_PATH  = process.env.HERMES_TASK_PATH  || '/api/task';
const WORKSPACE  = process.env.HERMES_SHARED_WORKSPACE || '/docker/agentic-os/shared';

export function getHermesConfig() {
  return { enabled: ENABLED, agentId: AGENT_ID, workspace: WORKSPACE, configured: !!API_URL };
}

export async function sendTaskToHermes(handoff) {
  if (!ENABLED) {
    return { ok: false, error: 'Hermes is disabled (HERMES_ENABLED=false)', stubMode: true };
  }
  if (!API_URL) {
    return { ok: false, error: 'HERMES_API_URL is not configured', stubMode: true };
  }

  const url = `${API_URL.replace(/\/+$/, '')}${TASK_PATH}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(url, {
      method:  'POST',
      signal:  controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(handoff),
    });
    clearTimeout(timer);

    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 800) }; }

    return { ok: res.ok, httpStatus: res.status, body, error: null };
  } catch (err) {
    clearTimeout(timer);
    return {
      ok:         false,
      httpStatus: null,
      body:       null,
      error: err.name === 'AbortError' ? 'Hermes timed out after 30s' : err.message,
    };
  }
}
