// DispatchStream — compact live dispatch output panel.
//
// Usage:
//   <DispatchStream taskId="task-xxx" />
//   <DispatchStream task={taskObject} />
//
// Rules:
//   - Stream NEVER starts automatically — user must click "Watch execution".
//   - AbortController cancels the client fetch; the server finishes normally.
//   - Completion is only claimed once the server emits a 'complete' event.
//   - Does not expose raw error payloads — shows the sanitised message only.

import { useState, useRef, useCallback } from 'react';
import { FiPlay, FiX, FiRefreshCw, FiCheck, FiAlertCircle, FiClock, FiZap } from 'react-icons/fi';

const STREAM_URL = '/api/dispatch/stream';

// ── Event metadata ────────────────────────────────────────────────────────────

const EVENT_META = {
  accepted:          { label: 'Accepted',           icon: FiClock,       color: 'var(--text-muted)' },
  checking_approval: { label: 'Checking approval',  icon: FiClock,       color: 'var(--text-muted)' },
  approval_required: { label: 'Approval required',  icon: FiAlertCircle, color: '#f59e0b' },
  resolving_agent:   { label: 'Resolving agent',    icon: FiClock,       color: 'var(--text-muted)' },
  selected_agent:    { label: 'Agent selected',     icon: FiZap,         color: '#60a5fa' },
  executing:         { label: 'Executing',           icon: FiZap,         color: '#a78bfa' },
  complete:          { label: 'Complete',            icon: FiCheck,       color: '#4ade80' },
  error:             { label: 'Error',               icon: FiAlertCircle, color: '#f87171' },
};

const STATUS_CONFIG = {
  idle:              { label: 'Idle',               color: 'var(--text-muted)',  pulse: false },
  connecting:        { label: 'Connecting…',        color: '#60a5fa',            pulse: true  },
  running:           { label: 'Running',            color: '#a78bfa',            pulse: true  },
  complete:          { label: 'Complete',           color: '#4ade80',            pulse: false },
  failed:            { label: 'Failed',             color: '#f87171',            pulse: false },
  approval_required: { label: 'Approval required',  color: '#f59e0b',            pulse: false },
};

// ── Event row ─────────────────────────────────────────────────────────────────

function EventRow({ ev }) {
  const meta = EVENT_META[ev.event] || { label: ev.event, icon: FiClock, color: 'var(--text-muted)' };
  const Icon = meta.icon;

  // Build a short human-readable detail string from the data payload
  let detail = '';
  if (ev.event === 'selected_agent' && ev.data?.displayName) {
    detail = `${ev.data.displayName}${ev.data.executionMode ? ` · ${ev.data.executionMode}` : ''}`;
  } else if (ev.event === 'executing' && ev.data?.agentId) {
    detail = ev.data.agentId;
  } else if (ev.event === 'approval_required') {
    detail = 'Human approval needed via Telegram';
  } else if (ev.event === 'error') {
    detail = ev.data?.message || 'Execution did not succeed';
  } else if (ev.event === 'complete') {
    detail = ev.data?.executionTarget
      ? `via ${ev.data.executionTarget} · ${ev.data.executionMode || ''}`
      : '';
  } else if (ev.event === 'accepted' && ev.data?.taskType) {
    detail = ev.data.taskType;
  }

  const timeStr = ev.ts
    ? new Date(ev.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '';

  return (
    <div className="ds-event-row">
      <Icon size={11} style={{ color: meta.color, flexShrink: 0 }} />
      <span className="ds-event-label font-ui" style={{ color: meta.color }}>
        {meta.label}
      </span>
      {detail && (
        <span className="ds-event-detail font-mono">{detail}</span>
      )}
      {timeStr && (
        <time className="ds-event-time font-mono">{timeStr}</time>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DispatchStream({ taskId: taskIdProp, task }) {
  const taskId = taskIdProp || task?.id;

  const [status,     setStatus]     = useState('idle');
  const [events,     setEvents]     = useState([]);
  const [output,     setOutput]     = useState(null);
  const [errorMsg,   setErrorMsg]   = useState(null);
  const abortRef = useRef(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus('idle');
    setEvents([]);
    setOutput(null);
    setErrorMsg(null);
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus('idle');
  }, []);

  const start = useCallback(async () => {
    if (!taskId || abortRef.current) return;

    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('connecting');
    setEvents([]);
    setOutput(null);
    setErrorMsg(null);

    try {
      const res = await fetch(STREAM_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ taskId }),
        signal:  controller.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorMsg(body.error || `Server returned ${res.status}`);
        setStatus('failed');
        abortRef.current = null;
        return;
      }

      setStatus('running');

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';

      const processLine = (line) => {
        if (!line.trim()) return;
        let ev;
        try { ev = JSON.parse(line); } catch { return; }

        setEvents(prev => [...prev, ev]);

        switch (ev.event) {
          case 'approval_required':
            setStatus('approval_required');
            break;
          case 'complete':
            setStatus('complete');
            setOutput(ev.data?.output || null);
            break;
          case 'error':
            setStatus('failed');
            setErrorMsg(ev.data?.message || 'Execution did not succeed.');
            break;
          default:
            break;
        }
      };

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? ''; // keep incomplete trailing fragment

        for (const line of lines) processLine(line);
      }

      // Flush any remaining buffer after stream ends
      if (buffer.trim()) processLine(buffer);

    } catch (err) {
      if (err.name === 'AbortError') {
        // User cancelled — already handled in cancel()
      } else {
        setErrorMsg(err.message || 'Stream connection failed.');
        setStatus('failed');
      }
    } finally {
      abortRef.current = null;
    }
  }, [taskId]);

  if (!taskId) return null;

  const cfg    = STATUS_CONFIG[status] || STATUS_CONFIG.idle;
  const isIdle = status === 'idle';
  const isDone = ['complete', 'failed', 'approval_required'].includes(status);
  const isBusy = ['connecting', 'running'].includes(status);

  return (
    <div className="dispatch-stream">
      {/* ── Header row ─────────────────────────────────────────────────── */}
      <div className="ds-header">
        <div className="ds-badge" style={{ '--ds-color': cfg.color }}>
          {cfg.pulse && <span className="ds-badge-pulse" />}
          <span className="ds-badge-dot" />
          <span className="ds-badge-label font-mono">{cfg.label}</span>
        </div>

        <div className="ds-controls">
          {isIdle && (
            <button
              type="button"
              className="ds-btn ds-btn--start"
              onClick={start}
              title="Watch execution live"
            >
              <FiPlay size={10} /> Watch
            </button>
          )}
          {isBusy && (
            <button
              type="button"
              className="ds-btn ds-btn--cancel"
              onClick={cancel}
              title="Cancel stream (task continues server-side)"
            >
              <FiX size={10} /> Cancel
            </button>
          )}
          {isDone && (
            <button
              type="button"
              className="ds-btn"
              onClick={reset}
              title="Reset panel"
            >
              <FiRefreshCw size={10} /> Reset
            </button>
          )}
        </div>
      </div>

      {/* ── Event log ──────────────────────────────────────────────────── */}
      {events.length > 0 && (
        <div className="ds-event-log">
          {events.map((ev, i) => (
            <EventRow key={i} ev={ev} />
          ))}
        </div>
      )}

      {/* ── Output block ───────────────────────────────────────────────── */}
      {output && (
        <div className="ds-output">
          <div className="ds-output-label font-mono">Output</div>
          <pre className="ds-output-pre">{output}</pre>
        </div>
      )}

      {/* ── Error block ────────────────────────────────────────────────── */}
      {errorMsg && status !== 'complete' && (
        <div className="ds-error font-mono">
          <FiAlertCircle size={11} />
          <span>{errorMsg}</span>
        </div>
      )}
    </div>
  );
}
