import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SectionHeader } from '../ui';
import {
  sendHermesChat, sendOpenClawChat, submitTask,
  fetchHermesStatus, fetchHermesChatSessions, clearHermesChatSession,
} from '../../lib/api';

const LANES = [
  { id: 'digital-diamond', label: 'Digital Diamond AI', color: '#c9a84c' },
  { id: 'managed-by-mika', label: 'Managed by Mika',   color: '#0dd3c5' },
  { id: 'medai',           label: 'MedAI',             color: '#818cf8' },
  { id: 'cannaops',        label: 'CannaOps',          color: '#4ade80' },
  { id: 'hotel-hooker',    label: 'The Hotel Hooker',  color: '#f472b6' },
  { id: 'ai-twin',         label: 'AI Twin Studio',    color: '#60a5fa' },
];

const selectStyle = {
  background:   'rgba(255,255,255,0.03)',
  border:       '1px solid rgba(201,168,76,0.2)',
  borderRadius: 3,
  color:        '#8892a4',
  fontSize:     10,
  fontFamily:   'var(--font-mono)',
  padding:      '3px 6px',
  outline:      'none',
};

// ─── Chat panel ───────────────────────────────────────────────────────────────

function ChatPanel({
  name, icon, color, mode,
  messages, sending,
  onSend, onQueueResult,
  connectionStatus,
  // Hermes-only session props
  selectedLane, lanes, onLaneChange,
  onNewSession, sessionInfo,
}) {
  const [input, setInput]               = useState('');
  const [pendingQueue, setPendingQueue] = useState(null);
  const [queueLane, setQueueLane]       = useState('digital-diamond');
  const [queueing, setQueueing]         = useState(false);
  const [queueSuccess, setQueueSuccess] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending, pendingQueue]);

  // Sync queue lane with selected lane when available
  useEffect(() => {
    if (selectedLane) setQueueLane(selectedLane);
  }, [selectedLane]);

  const doSend = useCallback(() => {
    const msg = input.trim();
    if (!msg || sending) return;
    setInput('');
    onSend(msg);
  }, [input, sending, onSend]);

  const handleKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') doSend();
  };

  const doQueue = async () => {
    if (!pendingQueue || queueing) return;
    setQueueing(true);
    const ok = await onQueueResult(pendingQueue, queueLane);
    setQueueing(false);
    if (ok) {
      setQueueSuccess(true);
      setTimeout(() => { setQueueSuccess(false); setPendingQueue(null); }, 1800);
    }
  };

  const borderColor = `${color}20`;
  const bgColor     = `${color}06`;
  const connectionVerified = connectionStatus?.status === 'verified';
  const connectionFailed = connectionStatus?.status === 'failed';
  const connectionColor = connectionVerified ? '#0dd3c5' : connectionFailed ? '#ef4444' : '#f59e0b';
  const connectionLabel = String(connectionStatus?.status || 'unknown').replaceAll('_', ' ').toUpperCase();

  return (
    <div className="panel-gold rounded-sm flex flex-col" style={{ height: 580 }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0" style={{ borderBottom: '1px solid rgba(201,168,76,0.1)' }}>

        {/* Title row */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm" style={{ color }}>{icon}</span>
            <span className="font-ui text-xs font-semibold tracking-wider text-[#f0ede6]">{name}</span>
            {mode && (
              <span
                className="font-mono text-[8px] px-1.5 py-0.5 rounded-sm"
                style={{ color: '#4b5563', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                {mode.toUpperCase()}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {sending && (
              <motion.span
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ repeat: Infinity, duration: 0.9 }}
                className="font-mono text-[8px]"
                style={{ color }}
              >
                thinking...
              </motion.span>
            )}
            <motion.div
              animate={sending ? { opacity: [1, 0.3, 1] } : {}}
              transition={{ repeat: Infinity, duration: 0.9 }}
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: sending ? color : '#4b5563' }}
            />
          </div>
        </div>

        {/* Connection status bar */}
        {connectionStatus && (
          <div className="flex items-center gap-3 px-4 pb-1.5">
            <div className="flex items-center gap-1">
              <div
                className="w-1.5 h-1.5 rounded-full"
                style={{
                  background: connectionColor,
                  boxShadow: connectionVerified ? '0 0 4px #0dd3c5' : undefined,
                }}
              />
              <span
                className="font-mono text-[8px] tracking-wider"
                style={{ color: connectionColor }}
              >
                {connectionLabel}
              </span>
            </div>
            {connectionStatus.lastChecked && (
              <span className="font-mono text-[8px] text-[#4b5563]">
                checked {new Date(connectionStatus.lastChecked).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <span className="font-mono text-[8px] text-[#4b5563] ml-auto">{connectionStatus.mode || 'cli'}</span>
            {connectionStatus.error && !connectionVerified && (
              <span className="font-mono text-[8px] truncate max-w-[140px]" style={{ color: '#ef4444' }} title={connectionStatus.error}>
                {connectionStatus.error}
              </span>
            )}
          </div>
        )}

        {/* Session toolbar — Hermes only */}
        {lanes && (
          <div
            className="flex items-center gap-2 px-4 pb-2.5"
            style={{ borderTop: connectionStatus ? '1px solid rgba(255,255,255,0.04)' : undefined, paddingTop: connectionStatus ? 6 : undefined }}
          >
            {/* Lane selector */}
            <select
              value={selectedLane}
              onChange={e => onLaneChange(e.target.value)}
              style={{ ...selectStyle, flex: 1 }}
            >
              {lanes.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>

            {/* Session info */}
            {sessionInfo?.hasSession && (
              <span className="font-mono text-[8px] text-[#4b5563] flex-shrink-0">
                {sessionInfo.messageCount} msg{sessionInfo.messageCount !== 1 ? 's' : ''}
              </span>
            )}
            {sessionInfo?.title && (
              <span
                className="font-mono text-[8px] truncate max-w-[100px]"
                style={{ color: '#4b5563' }}
                title={sessionInfo.title}
              >
                "{sessionInfo.title}"
              </span>
            )}

            {/* New session button */}
            <button
              onClick={onNewSession}
              className="flex-shrink-0 px-2 py-0.5 rounded-sm font-mono text-[8px] tracking-wider transition-all"
              style={{
                background: 'rgba(255,255,255,0.02)',
                border:     '1px solid rgba(255,255,255,0.08)',
                color:      '#4b5563',
                cursor:     'pointer',
              }}
              title="Start a new Hermes session"
            >
              + New
            </button>
          </div>
        )}
      </div>

      {/* ── Messages ───────────────────────────────────────────────────────── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {messages.length === 0 && !sending && (
          <div className="flex items-center justify-center h-full">
            <p className="font-mono text-[10px] text-[#4b5563] text-center">
              Start a conversation...<br />
              <span className="text-[8px]">⌘↵ to send</span>
            </p>
          </div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.role === 'user' ? (
                <div
                  className="max-w-[80%] px-3 py-2 rounded-sm font-body text-[11px] leading-relaxed"
                  style={{
                    background: 'rgba(201,168,76,0.08)',
                    border:     '1px solid rgba(201,168,76,0.2)',
                    color:      '#f0ede6',
                  }}
                >
                  {msg.content}
                </div>
              ) : (
                <div className="max-w-[88%] space-y-1">
                  <div
                    className="px-3 py-2 rounded-sm font-body text-[11px] leading-relaxed whitespace-pre-wrap"
                    style={{
                      background: msg.error ? 'rgba(239,68,68,0.06)' : bgColor,
                      border:     `1px solid ${msg.error ? 'rgba(239,68,68,0.2)' : borderColor}`,
                      color:      msg.error ? '#ef4444' : '#e2e8f0',
                    }}
                  >
                    {msg.content}
                  </div>
                  {!msg.error && (
                    <button
                      onClick={() => setPendingQueue(msg.content)}
                      className="font-mono text-[8px] px-2 py-0.5 rounded-sm transition-colors"
                      style={{ color: '#4b5563', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer' }}
                    >
                      → Queue
                    </button>
                  )}
                  {msg.ts && (
                    <span className="font-mono text-[8px] text-[#4b5563] pl-1">
                      {new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  )}
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {sending && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
            <div className="px-3 py-2 rounded-sm" style={{ background: bgColor, border: `1px solid ${borderColor}` }}>
              <motion.div className="flex gap-1">
                {[0, 1, 2].map(i => (
                  <motion.div
                    key={i}
                    className="w-1 h-1 rounded-full"
                    style={{ background: color }}
                    animate={{ opacity: [0.2, 1, 0.2] }}
                    transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.2 }}
                  />
                ))}
              </motion.div>
            </div>
          </motion.div>
        )}
      </div>

      {/* ── Queue inline form ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {pendingQueue && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex-shrink-0 overflow-hidden"
            style={{ borderTop: '1px solid rgba(201,168,76,0.1)', background: 'rgba(201,168,76,0.02)' }}
          >
            <div className="flex items-center gap-2 px-4 py-2">
              <span className="font-mono text-[8px] text-[#4b5563] flex-shrink-0">Queue as Research →</span>
              <select value={queueLane} onChange={e => setQueueLane(e.target.value)} style={{ ...selectStyle, flex: 1 }}>
                {LANES.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
              <button
                onClick={doQueue}
                disabled={queueing || queueSuccess}
                className="flex-shrink-0 px-2.5 py-1 rounded-sm font-mono text-[9px] font-semibold tracking-wider transition-all"
                style={{
                  background: 'rgba(13,211,197,0.1)',
                  border:     '1px solid rgba(13,211,197,0.3)',
                  color:      '#0dd3c5',
                  cursor:     (queueing || queueSuccess) ? 'default' : 'pointer',
                }}
              >
                {queueSuccess ? '✓ Queued' : queueing ? '...' : 'Create Task'}
              </button>
              <button
                onClick={() => setPendingQueue(null)}
                className="font-mono text-[9px] text-[#4b5563] flex-shrink-0"
                style={{ cursor: 'pointer', background: 'none', border: 'none' }}
              >
                ✕
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Input ──────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-4 py-3" style={{ borderTop: '1px solid rgba(201,168,76,0.1)' }}>
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${name}...`}
            rows={2}
            disabled={sending}
            style={{
              flex:         1,
              background:   'rgba(255,255,255,0.02)',
              border:       '1px solid rgba(201,168,76,0.15)',
              borderRadius: 3,
              color:        '#f0ede6',
              fontSize:     11,
              fontFamily:   'var(--font-body)',
              padding:      '6px 10px',
              resize:       'none',
              outline:      'none',
              opacity:      sending ? 0.5 : 1,
            }}
          />
          <button
            onClick={doSend}
            disabled={!input.trim() || sending}
            className="px-3 rounded-sm font-mono text-[10px] font-semibold tracking-wider transition-all flex-shrink-0"
            style={{
              background: (!input.trim() || sending) ? 'rgba(201,168,76,0.04)' : `${color}15`,
              border:     `1px solid ${(!input.trim() || sending) ? 'rgba(201,168,76,0.1)' : `${color}35`}`,
              color:      (!input.trim() || sending) ? '#4b5563' : color,
              cursor:     (!input.trim() || sending) ? 'not-allowed' : 'pointer',
            }}
          >
            SEND
          </button>
        </div>
        <div className="mt-1.5 font-mono text-[8px] text-[#4b5563]">⌘↵ send · max 4000 chars</div>
      </div>
    </div>
  );
}

// ─── Main section ─────────────────────────────────────────────────────────────

const stagger = { initial: {}, animate: { transition: { staggerChildren: 0.06 } } };
const fadeUp  = { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0, transition: { duration: 0.35 } } };

export default function HermesChat() {
  const [hermesMessages, setHermesMessages]   = useState([]);
  const [ocMessages, setOcMessages]           = useState([]);
  const [hermesSending, setHermesSending]     = useState(false);
  const [ocSending, setOcSending]             = useState(false);
  const [queueFlash, setQueueFlash]           = useState(null);
  const [hermesHttpStatus, setHermesHttpStatus] = useState(null);

  // Session state
  const [hermesLane, setHermesLane]         = useState('digital-diamond');
  const [hermesSessions, setHermesSessions] = useState({});

  // ── Load persisted sessions on mount ──────────────────────────────────────
  useEffect(() => {
    fetchHermesChatSessions().then(sessions => {
      setHermesSessions(sessions);
      // Restore messages for the default lane
      const lane = sessions['digital-diamond'];
      if (lane?.messages?.length) setHermesMessages(lane.messages);
    });
  }, []);

  // ── Poll the canonical Hermes connection summary every 30s ─────────────────
  useEffect(() => {
    fetchHermesStatus().then(setHermesHttpStatus);
    const id = setInterval(() => fetchHermesStatus().then(setHermesHttpStatus), 30_000);
    return () => clearInterval(id);
  }, []);

  // ── Lane change — restore messages from persisted session ─────────────────
  const handleHermesLaneChange = useCallback((newLane) => {
    setHermesLane(newLane);
    const session = hermesSessions[newLane];
    setHermesMessages(session?.messages || []);
  }, [hermesSessions]);

  // ── New session ────────────────────────────────────────────────────────────
  const handleNewHermesSession = useCallback(async () => {
    await clearHermesChatSession(hermesLane);
    setHermesMessages([]);
    setHermesSessions(prev => {
      const next = { ...prev };
      delete next[hermesLane];
      return next;
    });
  }, [hermesLane]);

  const addMessage = (setter, role, content, extra = {}) => {
    setter(prev => [...prev, { role, content, ts: Date.now(), ...extra }]);
  };

  // ── Send to Hermes ─────────────────────────────────────────────────────────
  const handleSendToHermes = useCallback(async (text) => {
    addMessage(setHermesMessages, 'user', text);
    setHermesSending(true);
    try {
      const res = await sendHermesChat(text, hermesLane);
      addMessage(setHermesMessages, 'assistant', res.reply || res.error || 'No response', { error: !res.ok });
      // Sync session state from server response
      if (res.session) {
        setHermesSessions(prev => ({ ...prev, [hermesLane]: res.session }));
      }
    } catch (err) {
      addMessage(setHermesMessages, 'assistant', err.message, { error: true });
    } finally {
      setHermesSending(false);
      fetchHermesStatus().then(setHermesHttpStatus);
    }
  }, [hermesLane]);

  // ── Send to OpenClaw (untouched) ───────────────────────────────────────────
  const handleSendToOpenClaw = useCallback(async (text) => {
    addMessage(setOcMessages, 'user', text);
    setOcSending(true);
    try {
      const res = await sendOpenClawChat(text);
      addMessage(setOcMessages, 'assistant', res.reply || res.error || 'No response', { error: !res.ok });
    } catch (err) {
      addMessage(setOcMessages, 'assistant', err.message, { error: true });
    } finally {
      setOcSending(false);
    }
  }, []);

  // ── Queue result as task ───────────────────────────────────────────────────
  const handleQueueResult = useCallback(async (content, lane) => {
    try {
      await submitTask({
        lane,
        taskType:         'Research',
        priority:         'Normal',
        approvalRequired: true,
        description:      content.slice(0, 2000),
      });
      setQueueFlash('Task queued successfully');
      setTimeout(() => setQueueFlash(null), 3000);
      return true;
    } catch (err) {
      setQueueFlash(`Queue failed: ${err.message}`);
      setTimeout(() => setQueueFlash(null), 4000);
      return false;
    }
  }, []);

  // ── Session info for the toolbar ───────────────────────────────────────────
  const currentSession = hermesSessions[hermesLane];
  const sessionInfo = {
    hasSession:   !!currentSession,
    title:        currentSession?.title || null,
    messageCount: currentSession?.messages?.length || 0,
  };

  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-6">
      <SectionHeader icon="⚡" title="Agent Chat" subtitle="Direct conversation with Hermes and OpenClaw" />

      {/* Global queue flash */}
      <AnimatePresence>
        {queueFlash && (
          <motion.div
            key={queueFlash}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="px-4 py-2.5 rounded-sm font-mono text-[10px]"
            style={{
              background: queueFlash.startsWith('Task') ? 'rgba(13,211,197,0.08)' : 'rgba(239,68,68,0.08)',
              border:     `1px solid ${queueFlash.startsWith('Task') ? 'rgba(13,211,197,0.25)' : 'rgba(239,68,68,0.25)'}`,
              color:      queueFlash.startsWith('Task') ? '#0dd3c5' : '#ef4444',
            }}
          >
            {queueFlash}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Two chat panels */}
      <motion.div variants={fadeUp} className="grid grid-cols-2 gap-4">

        {/* Hermes — session-aware */}
        <ChatPanel
          name="Hermes"
          icon="⚡"
          color="#a78bfa"
          mode="research"
          messages={hermesMessages}
          sending={hermesSending}
          onSend={handleSendToHermes}
          onQueueResult={handleQueueResult}
          connectionStatus={hermesHttpStatus}
          selectedLane={hermesLane}
          lanes={LANES}
          onLaneChange={handleHermesLaneChange}
          onNewSession={handleNewHermesSession}
          sessionInfo={sessionInfo}
        />

        {/* OpenClaw — untouched */}
        <ChatPanel
          name="OpenClaw"
          icon="◈"
          color="#c9a84c"
          mode="orchestrator"
          messages={ocMessages}
          sending={ocSending}
          onSend={handleSendToOpenClaw}
          onQueueResult={handleQueueResult}
        />
      </motion.div>

      {/* Footer note */}
      <motion.div
        variants={fadeUp}
        className="flex items-center gap-6 px-4 py-2.5 rounded-sm"
        style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(201,168,76,0.07)' }}
      >
        <span className="font-mono text-[9px] text-[#4b5563]">
          Hermes Chat → direct research · sessions persist per lane · --continue for follow-ups
        </span>
        <span className="font-mono text-[9px] text-[#4b5563]">
          OpenClaw Chat → direct orchestrator queries
        </span>
        <span className="font-mono text-[9px] text-[#4b5563] ml-auto">
          → Queue saves any reply as a Research task
        </span>
      </motion.div>
    </motion.div>
  );
}
