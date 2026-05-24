// components/sections/AgentWorkspace.jsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { StatusBadge } from '../ui';
import { useStore } from '../../lib/store';
import { AGENT_AVATARS } from '../../lib/agent-avatars';
import {
  agentStart, agentStop, agentRestart, agentPause, agentResume,
  agentDispatch, agentGetLogs, agentGetMemory, agentGetConfig,
  agentSetConfig, testSystemConnection,
} from '../../lib/agent-systems';
import { vaultAppendChat } from '../../lib/vault';
import { format, parseISO } from 'date-fns';
import clsx from 'clsx';

// ── constants ──────────────────────────────────────────────────────

const SYSTEM_TYPE_META = {
  openclaw: { label: 'OpenClaw Gateway', color: '#c9a84c', icon: '◈' },
  n8n:      { label: 'n8n Workflows',    color: '#ea580c', icon: '⬡' },
  make:     { label: 'Make.com',         color: '#6366f1', icon: '◉' },
  flowise:  { label: 'Flowise',          color: '#0ea5e9', icon: '◆' },
  custom:   { label: 'Custom HTTP',      color: '#8b5cf6', icon: '⬟' },
  local:    { label: 'Local Docker',     color: '#4ade80', icon: '▣' },
};

const PROJECT_COLORS = {
  'digital-diamond': '#c9a84c',
  'managed-by-mika': '#0dd3c5',
  'medai':           '#818cf8',
  'cannaops':        '#4ade80',
  'hotel-hooker':    '#f472b6',
  'ai-twin':         '#60a5fa',
  'lead-recovery':   '#fb923c',
  'hermes':          '#a78bfa',
};

const LOG_LEVEL_COLOR = {
  INFO:  '#8892a4',
  WARN:  '#f59e0b',
  ERROR: '#ef4444',
  DEBUG: '#4b5563',
};

const TABS = ['CONTROL', 'CHAT', 'LOGS', 'MEMORY', 'CONFIG'];

// ── Avatar ─────────────────────────────────────────────────────────

function AgentAvatarBubble({ agentId, size = 32 }) {
  const av = AGENT_AVATARS[agentId] || { emoji: '🤖', gradient: 'linear-gradient(135deg,#374151,#1f2937)', color: '#8892a4' };
  return (
    <div
      className="rounded-full flex items-center justify-center flex-shrink-0"
      style={{
        width: size,
        height: size,
        background: av.gradient,
        boxShadow: `0 2px 8px ${av.color}30`,
        fontSize: size * 0.42,
      }}
    >
      {av.emoji}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────

function ControlButton({ label, icon, onClick, variant = 'ghost', disabled }) {
  const base = 'flex items-center gap-2 font-ui text-[10px] font-semibold tracking-widest uppercase px-4 py-2.5 rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed';
  const styles = {
    gold:   'bg-gradient-to-r from-[#c9a84c] to-[#d4b558] text-[#07090f] shadow-lg',
    ghost:  'border text-[#c9a84c] hover:bg-[rgba(201,168,76,0.08)]',
    danger: 'border text-[#ef4444] bg-[rgba(239,68,68,0.06)] hover:bg-[rgba(239,68,68,0.12)]',
    amber:  'border text-[#f59e0b] bg-[rgba(245,158,11,0.06)] hover:bg-[rgba(245,158,11,0.12)]',
    teal:   'border text-[#0dd3c5] bg-[rgba(13,211,197,0.06)] hover:bg-[rgba(13,211,197,0.12)]',
  };
  const borderStyles = {
    ghost:  { borderColor: 'rgba(201,168,76,0.2)' },
    danger: { borderColor: 'rgba(239,68,68,0.3)' },
    amber:  { borderColor: 'rgba(245,158,11,0.3)' },
    teal:   { borderColor: 'rgba(13,211,197,0.3)' },
  };
  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      whileTap={{ scale: 0.97 }}
      className={clsx(base, styles[variant])}
      style={borderStyles[variant]}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </motion.button>
  );
}

function SystemBadge({ systemType, reachable, latencyMs }) {
  const meta = SYSTEM_TYPE_META[systemType] || SYSTEM_TYPE_META.custom;
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
      style={{ background: `${meta.color}0f`, border: `1px solid ${meta.color}25` }}
    >
      <span style={{ color: meta.color }}>{meta.icon}</span>
      <div>
        <div className="font-mono text-[9px] tracking-wider" style={{ color: meta.color }}>{meta.label}</div>
        {reachable !== null && (
          <div className="font-mono text-[8px]" style={{ color: reachable ? '#0dd3c5' : '#ef4444' }}>
            {reachable ? `${latencyMs}ms` : 'UNREACHABLE'}
          </div>
        )}
      </div>
    </div>
  );
}

// ── CONTROL TAB ────────────────────────────────────────────────────

function ControlTab({ agent, status, onAction }) {
  const agentColor = PROJECT_COLORS[agent.project] || '#c9a84c';
  const isRunning  = status === 'running';
  const isPaused   = status === 'paused';
  const isStopped  = status === 'stopped' || status === 'idle' || status === 'error';

  return (
    <div className="space-y-4">
      {/* Status ring */}
      <div className="panel-raised p-5 flex items-center gap-6">
        <div className="relative flex-shrink-0">
          <div
            className="w-24 h-24 rounded-full flex flex-col items-center justify-center"
            style={{
              border: `1.5px solid ${agentColor}40`,
              boxShadow: isRunning ? `0 0 32px ${agentColor}18, inset 0 0 20px ${agentColor}06` : undefined,
            }}
          >
            <motion.div
              animate={isRunning ? { rotate: 360 } : {}}
              transition={{ repeat: Infinity, duration: 8, ease: 'linear' }}
              className="absolute inset-2 rounded-full"
              style={{ border: isRunning ? `1px dashed ${agentColor}30` : 'none' }}
            />
            <span className="font-mono text-xs font-bold" style={{ color: agentColor }}>
              {status?.toUpperCase() || 'UNKNOWN'}
            </span>
            {isRunning && (
              <motion.div
                animate={{ scale: [1, 1.5, 1], opacity: [0.4, 0, 0.4] }}
                transition={{ repeat: Infinity, duration: 2.5 }}
                className="absolute inset-0 rounded-full"
                style={{ border: `1px solid ${agentColor}` }}
              />
            )}
          </div>
        </div>

        <div className="flex-1">
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'SYSTEM',    value: agent.systemType?.toUpperCase() },
              { label: 'SYSTEM ID', value: agent.systemId },
              { label: 'MODEL',     value: agent.model },
              { label: 'SCHEDULE',  value: agent.schedule || 'Manual' },
              { label: 'MEMORY',    value: agent.memory ? 'Enabled' : 'None' },
              { label: 'PROJECT',   value: agent.project || 'Global' },
            ].map(({ label, value }) => (
              <div key={label}>
                <div className="font-mono text-[8px] tracking-widest mb-0.5" style={{ color: 'var(--text-muted)' }}>{label}</div>
                <div className="font-mono text-[10px] truncate" style={{ color: 'var(--text-primary)' }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="panel-raised p-4">
        <div className="font-mono text-[9px] tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>LIFECYCLE CONTROLS</div>
        <div className="flex flex-wrap gap-2">
          <ControlButton label="Start"   icon="▶"  variant="teal"   disabled={isRunning || isPaused} onClick={() => onAction('start')} />
          <ControlButton label="Stop"    icon="■"  variant="danger" disabled={isStopped}             onClick={() => onAction('stop')} />
          <ControlButton label="Restart" icon="↺"  variant="amber"  disabled={false}                 onClick={() => onAction('restart')} />
          <ControlButton label="Pause"   icon="⏸" variant="ghost"  disabled={!isRunning}            onClick={() => onAction('pause')} />
          <ControlButton label="Resume"  icon="▶▶" variant="ghost"  disabled={!isPaused}             onClick={() => onAction('resume')} />
        </div>
      </div>

      {/* Capabilities */}
      <div className="panel-raised p-4">
        <div className="font-mono text-[9px] tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>CAPABILITIES</div>
        <div className="flex flex-wrap gap-2">
          {agent.capabilities?.map(cap => (
            <span
              key={cap}
              className="font-mono text-[9px] px-2.5 py-1 rounded-lg"
              style={{ color: agentColor, background: `${agentColor}0f`, border: `1px solid ${agentColor}28` }}
            >
              {cap}
            </span>
          ))}
        </div>
      </div>

      {/* Description */}
      <div className="panel-raised p-4">
        <div className="font-mono text-[9px] tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>DESCRIPTION</div>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{agent.description}</p>
      </div>
    </div>
  );
}

// ── Mic icon ───────────────────────────────────────────────────────

function MicIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      <line x1="12" y1="19" x2="12" y2="23"/>
      <line x1="8" y1="23" x2="16" y2="23"/>
    </svg>
  );
}

// ── CHAT TAB ───────────────────────────────────────────────────────

function ChatTab({ agent, onDispatch }) {
  const { agentChats, appendChatMessage } = useStore();
  const agentColor  = PROJECT_COLORS[agent.project] || '#c9a84c';
  const avatar      = AGENT_AVATARS[agent.id] || { emoji: '🤖', color: agentColor };
  const messages    = agentChats[agent.id] || [];
  const [input, setInput]         = useState('');
  const [typing, setTyping]       = useState(false);
  const [selCap, setSelCap]       = useState('');
  const [isListening, setIsListening] = useState(false);
  const bottomRef      = useRef(null);
  const inputRef       = useRef(null);
  const recognitionRef = useRef(null);
  const baseTextRef    = useRef('');

  // Auto-resize textarea when input changes (e.g. from speech)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, [input]);

  const toggleMic = useCallback(() => {
    const SR = typeof window !== 'undefined' &&
      (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SR) return;

    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }

    baseTextRef.current = input;
    const r = new SR();
    r.continuous = false;
    r.interimResults = true;
    r.lang = 'en-US';

    r.onstart = () => setIsListening(true);

    r.onresult = (e) => {
      let interim = '';
      let final   = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t;
        else interim += t;
      }
      const speech = final || interim;
      const prefix = baseTextRef.current ? baseTextRef.current + ' ' : '';
      setInput(prefix + speech);
      if (final) inputRef.current?.focus();
    };

    r.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    r.onerror = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = r;
    r.start();
  }, [isListening, input]);

  // Seed greeting on first open
  useEffect(() => {
    if (messages.length === 0) {
      appendChatMessage(agent.id, {
        id: 'welcome',
        role: 'agent',
        content: avatar.greeting || `Hi! I'm ${agent.label}. ${agent.description} What would you like me to do?`,
        ts: new Date().toISOString(),
      });
    }
  }, [agent.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing]);

  const send = async (text, capability) => {
    const content = text.trim();
    if (!content) return;

    const userTs = new Date().toISOString();
    appendChatMessage(agent.id, { id: Date.now(), role: 'user', content, capability, ts: userTs });
    vaultAppendChat(agent.label, 'user', content, userTs, capability || selCap || undefined);
    setInput('');
    setSelCap('');
    setTyping(true);

    try {
      const cap      = capability || selCap || agent.capabilities?.[0] || 'general';
      const result   = await onDispatch({ capability: cap, input: content, priority: 'normal' });
      const agentTs  = new Date().toISOString();
      const agentMsg = `Task dispatched successfully.`;
      setTyping(false);
      appendChatMessage(agent.id, { id: Date.now() + 1, role: 'agent', content: agentMsg, taskResult: result, ts: agentTs });
      vaultAppendChat(agent.label, 'agent', agentMsg, agentTs, undefined);
    } catch {
      const agentTs  = new Date().toISOString();
      const agentMsg = 'Something went wrong dispatching that task. Please try again.';
      setTyping(false);
      appendChatMessage(agent.id, { id: Date.now() + 1, role: 'agent', content: agentMsg, ts: agentTs, error: true });
      vaultAppendChat(agent.label, 'agent', agentMsg, agentTs, undefined);
    }
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  return (
    <div className="flex flex-col" style={{ height: 520 }}>
      {/* Capability pills */}
      {agent.capabilities?.length > 0 && (
        <div
          className="flex gap-2 px-4 py-2.5 overflow-x-auto flex-shrink-0 border-b"
          style={{ borderColor: 'var(--border-default)', scrollbarWidth: 'none' }}
        >
          {agent.capabilities.map(cap => (
            <button
              key={cap}
              onClick={() => { setSelCap(selCap === cap ? '' : cap); inputRef.current?.focus(); }}
              className="font-mono text-[9px] px-3 py-1.5 rounded-full flex-shrink-0 transition-all"
              style={selCap === cap ? {
                background: agentColor,
                color: '#07090f',
                fontWeight: 700,
                boxShadow: `0 2px 8px ${agentColor}40`,
              } : {
                background: 'var(--bg-overlay)',
                color: 'var(--text-muted)',
                border: '1px solid var(--border-default)',
              }}
            >
              {cap}
            </button>
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className={clsx('flex gap-3', msg.role === 'user' ? 'flex-row-reverse' : 'flex-row')}
            >
              {/* Avatar */}
              {msg.role === 'agent' && <AgentAvatarBubble agentId={agent.id} size={32} />}

              <div className={clsx('flex flex-col gap-1', msg.role === 'user' ? 'items-end' : 'items-start')}>
                {/* Bubble */}
                <div
                  className={msg.role === 'agent' ? 'chat-bubble-agent' : 'chat-bubble-user'}
                  style={msg.role === 'agent' && msg.error ? { borderColor: 'rgba(239,68,68,0.3)', color: '#ef4444' } : undefined}
                >
                  {msg.capability && (
                    <span
                      className="inline-block font-mono text-[8px] px-2 py-0.5 rounded mb-2 mr-2"
                      style={{
                        background: msg.role === 'user' ? 'rgba(0,0,0,0.15)' : `${agentColor}18`,
                        color: msg.role === 'user' ? 'rgba(0,0,0,0.5)' : agentColor,
                      }}
                    >
                      /{msg.capability}
                    </span>
                  )}
                  <span>{msg.content}</span>

                  {/* Task result card */}
                  {msg.taskResult && (
                    <div
                      className="mt-3 p-3 rounded-lg"
                      style={{ background: 'rgba(13,211,197,0.08)', border: '1px solid rgba(13,211,197,0.2)' }}
                    >
                      <div className="font-mono text-[8px] tracking-widest mb-2" style={{ color: '#0dd3c5' }}>✓ TASK QUEUED</div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                        {[
                          ['ID',  msg.taskResult.taskId],
                          ['POS', `#${msg.taskResult.queuePos}`],
                          ['ETA', `~${(msg.taskResult.estimatedMs/1000).toFixed(1)}s`],
                          ['STATUS', msg.taskResult.status?.toUpperCase()],
                        ].map(([k, v]) => (
                          <div key={k}>
                            <span className="font-mono text-[7px]" style={{ color: 'var(--text-muted)' }}>{k}: </span>
                            <span className="font-mono text-[9px]" style={{ color: 'var(--text-primary)' }}>{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Timestamp */}
                <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>
                  {format(parseISO(msg.ts), 'HH:mm')}
                </span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Typing indicator */}
        <AnimatePresence>
          {typing && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="flex gap-3 items-end"
            >
              <AgentAvatarBubble agentId={agent.id} size={32} />
              <div
                className="flex items-center gap-1.5 px-4 py-3 rounded-2xl"
                style={{ background: 'var(--chat-agent-bg)', border: '1px solid var(--chat-agent-border)', borderRadius: '4px 16px 16px 16px' }}
              >
                <div className="chat-typing-dot" />
                <div className="chat-typing-dot" />
                <div className="chat-typing-dot" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div
        className="flex-shrink-0 p-3 border-t"
        style={{ borderColor: 'var(--border-default)', background: 'var(--bg-panel)' }}
      >
        {selCap && (
          <div className="flex items-center gap-2 mb-2 px-1">
            <span className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>Action:</span>
            <span
              className="font-mono text-[9px] px-2 py-0.5 rounded-full font-semibold"
              style={{ background: `${agentColor}15`, color: agentColor }}
            >
              /{selCap}
            </span>
            <button
              onClick={() => setSelCap('')}
              className="font-mono text-[9px] ml-auto"
              style={{ color: 'var(--text-muted)' }}
            >
              ✕
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={isListening ? 'Listening...' : `Message ${agent.label}...`}
            rows={1}
            className="flex-1 px-4 py-3 text-sm resize-none focus:outline-none rounded-2xl leading-relaxed"
            style={{
              background: 'var(--bg-input)',
              border: `1px solid ${isListening ? 'rgba(239,68,68,0.5)' : 'var(--border-default)'}`,
              color: 'var(--text-primary)',
              maxHeight: 120,
              transition: 'border-color 0.2s',
            }}
            onFocus={e => { if (!isListening) e.target.style.borderColor = `${agentColor}50`; }}
            onBlur={e => { if (!isListening) e.target.style.borderColor = 'var(--border-default)'; }}
          />

          {/* Mic button */}
          <motion.button
            onClick={toggleMic}
            whileTap={{ scale: 0.93 }}
            title={isListening ? 'Stop recording' : 'Voice input'}
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 relative"
            style={{
              background: isListening ? 'rgba(239,68,68,0.15)' : 'var(--bg-overlay)',
              border: `1px solid ${isListening ? 'rgba(239,68,68,0.5)' : 'var(--border-default)'}`,
              color: isListening ? '#ef4444' : 'var(--text-muted)',
              transition: 'all 0.2s',
            }}
          >
            {isListening && (
              <motion.div
                className="absolute inset-0 rounded-full"
                animate={{ scale: [1, 1.4, 1], opacity: [0.4, 0, 0.4] }}
                transition={{ repeat: Infinity, duration: 1.5 }}
                style={{ background: 'rgba(239,68,68,0.25)' }}
              />
            )}
            <MicIcon size={15} />
          </motion.button>

          {/* Send button */}
          <motion.button
            onClick={() => send(input, selCap || undefined)}
            disabled={!input.trim() || typing}
            whileTap={{ scale: 0.93 }}
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-bold disabled:opacity-30"
            style={{
              background: input.trim() ? `linear-gradient(135deg, ${agentColor}, ${agentColor}cc)` : 'var(--bg-overlay)',
              color: input.trim() ? '#07090f' : 'var(--text-muted)',
              boxShadow: input.trim() ? `0 4px 16px ${agentColor}40` : 'none',
              transition: 'all 0.2s',
            }}
          >
            ↑
          </motion.button>
        </div>
        <p className="font-mono text-[8px] mt-1.5 px-1" style={{ color: 'var(--text-muted)' }}>
          Enter to send · Shift+Enter for newline · 🎙 mic for voice
        </p>
      </div>
    </div>
  );
}

// ── LOGS TAB ───────────────────────────────────────────────────────

function LogsTab({ agent, logs, onRefresh, onClear }) {
  const endRef = useRef(null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[9px] tracking-widest" style={{ color: 'var(--text-muted)' }}>
          LIVE LOG STREAM · {logs.length} ENTRIES
        </div>
        <div className="flex gap-2">
          <button onClick={onRefresh} className="btn-ghost text-[9px] px-2 py-1">↻ REFRESH</button>
          <button onClick={onClear}   className="btn-danger  text-[9px] px-2 py-1">⊗ CLEAR</button>
        </div>
      </div>

      <div className="panel-raised overflow-hidden" style={{ borderRadius: 10 }}>
        <div
          className="overflow-y-auto font-mono text-[10px] leading-relaxed"
          style={{ maxHeight: 420, background: 'rgba(0,0,0,0.2)' }}
        >
          <div className="p-3 space-y-0.5">
            <AnimatePresence initial={false}>
              {logs.map((log, i) => (
                <motion.div
                  key={`${log.ts}-${i}`}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex gap-3 py-0.5 hover:bg-white/[0.02] px-1 rounded"
                >
                  <span className="flex-shrink-0 w-16" style={{ color: 'var(--text-muted)' }}>
                    {format(parseISO(log.ts), 'HH:mm:ss')}
                  </span>
                  <span className="flex-shrink-0 w-10 font-semibold" style={{ color: LOG_LEVEL_COLOR[log.level] || '#8892a4' }}>
                    {log.level}
                  </span>
                  <span style={{ color: 'var(--text-secondary)' }}>{log.msg}</span>
                </motion.div>
              ))}
            </AnimatePresence>
            {logs.length === 0 && (
              <div className="py-8 text-center" style={{ color: 'var(--text-muted)' }}>No log entries yet</div>
            )}
            <div ref={endRef} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── MEMORY TAB ─────────────────────────────────────────────────────

function MemoryTab({ agent, memory }) {
  const agentColor = PROJECT_COLORS[agent.project] || '#c9a84c';

  if (!agent.memory) {
    return (
      <div className="panel-raised p-12 text-center">
        <div className="text-3xl mb-3 opacity-20">⬡</div>
        <p className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>Persistent memory is disabled for this agent.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[9px] tracking-widest" style={{ color: 'var(--text-muted)' }}>{memory.length} MEMORY KEYS</div>
        <button className="btn-ghost text-[9px] px-2 py-1">+ INJECT KEY</button>
      </div>
      {memory.length === 0 ? (
        <div className="panel-raised p-8 text-center">
          <p className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>No memory keys stored yet.</p>
        </div>
      ) : (
        memory.map((m, i) => (
          <motion.div
            key={m.key}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className="panel-raised p-3 card-hover"
          >
            <div className="font-mono text-[9px] mb-1.5" style={{ color: agentColor }}>{m.key}</div>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{m.value}</p>
          </motion.div>
        ))
      )}
    </div>
  );
}

// ── CONFIG TAB ─────────────────────────────────────────────────────

function ConfigTab({ agent, config: cfg, onSave }) {
  const [draft, setDraft] = useState(JSON.stringify(cfg, null, 2));
  const [saved, setSaved]  = useState(false);
  const [err, setErr]      = useState(null);

  const save = async () => {
    try {
      const parsed = JSON.parse(draft);
      setErr(null);
      await onSave(parsed);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <div className="space-y-3">
      <div className="font-mono text-[9px] tracking-widest" style={{ color: 'var(--text-muted)' }}>AGENT CONFIGURATION (JSON)</div>
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        rows={18}
        spellCheck={false}
        className="w-full px-4 py-3 font-mono text-xs resize-y focus:outline-none rounded-xl leading-relaxed"
        style={{
          background: 'var(--bg-input)',
          border: '1px solid var(--border-default)',
          color: 'var(--text-primary)',
        }}
        onFocus={e => { e.target.style.borderColor = 'var(--border-strong)'; }}
        onBlur={e => { e.target.style.borderColor = 'var(--border-default)'; }}
      />
      {err && (
        <div className="font-mono text-[10px] px-1" style={{ color: '#ef4444' }}>⚠ JSON parse error: {err}</div>
      )}
      <button onClick={save} className={saved ? 'btn-gold' : 'btn-ghost'}>
        {saved ? '✓ SAVED' : '⬆ SAVE CONFIG'}
      </button>
    </div>
  );
}

// ── MAIN WORKSPACE ─────────────────────────────────────────────────

export default function AgentWorkspace({ agentDef }) {
  const { appendAgentLog, agentLogs, clearAgentLogs, agentStatusOverrides, setAgentStatus, addNotification } = useStore();

  const [activeTab,     setActiveTab]    = useState('CONTROL');
  const [status,        setStatusLocal]  = useState('running');
  const [connection,    setConnection]   = useState({ reachable: null, latencyMs: null });
  const [memory,        setMemory]       = useState([]);
  const [agentConfig,   setAgentConfig]  = useState(null);
  const [actionPending, setActionPending] = useState(null);

  const agentColor = PROJECT_COLORS[agentDef.project] || '#c9a84c';
  const sysMeta    = SYSTEM_TYPE_META[agentDef.systemType] || SYSTEM_TYPE_META.custom;
  const avatar     = AGENT_AVATARS[agentDef.id] || { emoji: '🤖', color: agentColor, gradient: `linear-gradient(135deg, ${agentColor}, ${agentColor}88)` };
  const logs       = agentLogs[agentDef.id] || [];

  useEffect(() => {
    testSystemConnection(agentDef).then(result => setConnection(result));
    agentGetLogs(agentDef).then(fetchedLogs => {
      fetchedLogs.forEach(log => appendAgentLog(agentDef.id, log));
    });
    const override = agentStatusOverrides[agentDef.id];
    if (override) setStatusLocal(override);
    agentGetMemory(agentDef).then(setMemory);
    agentGetConfig(agentDef).then(setAgentConfig);
  }, [agentDef.id]);

  const handleAction = useCallback(async (action) => {
    setActionPending(action);
    try {
      let newStatus;
      switch (action) {
        case 'start':   await agentStart(agentDef);   newStatus = 'running'; break;
        case 'stop':    await agentStop(agentDef);    newStatus = 'stopped'; break;
        case 'restart': await agentRestart(agentDef); newStatus = 'running'; break;
        case 'pause':   await agentPause(agentDef);   newStatus = 'paused';  break;
        case 'resume':  await agentResume(agentDef);  newStatus = 'running'; break;
      }
      setStatusLocal(newStatus);
      setAgentStatus(agentDef.id, newStatus);
      appendAgentLog(agentDef.id, { ts: new Date().toISOString(), level: 'INFO', msg: `[Dashboard] ${action} → ${newStatus}` });
      addNotification({ type: 'success', message: `${agentDef.label}: ${action} → ${newStatus}` });
    } catch (e) {
      addNotification({ type: 'error', message: `${agentDef.label} ${action} failed: ${e.message}` });
    } finally {
      setActionPending(null);
    }
  }, [agentDef]);

  const handleDispatch = useCallback(async (task) => {
    const result = await agentDispatch(agentDef, task);
    appendAgentLog(agentDef.id, { ts: new Date().toISOString(), level: 'INFO', msg: `[Chat] Task dispatched: ${task.capability} · ID: ${result.taskId}` });
    return result;
  }, [agentDef]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-4"
    >
      {/* ── Agent Header ─────────────────────────────────── */}
      <div className="panel-raised p-5 relative overflow-hidden">
        <div
          className="absolute -right-16 -top-16 w-64 h-64 rounded-full blur-3xl opacity-[0.04]"
          style={{ background: agentColor }}
        />
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            {/* Large avatar */}
            <div className="relative flex-shrink-0">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl shadow-xl"
                style={{ background: avatar.gradient, boxShadow: `0 8px 24px ${agentColor}30` }}
              >
                {avatar.emoji}
              </div>
              <div className={`absolute -bottom-1 -right-1 status-dot ${status}`}
                style={{ width: 12, height: 12, border: '2px solid var(--bg-raised)' }} />
            </div>

            <div>
              <div className="flex items-center gap-3 mb-1">
                <h2 className="font-display text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {agentDef.label}
                </h2>
                <StatusBadge status={status} />
                {actionPending && (
                  <motion.span
                    animate={{ opacity: [1, 0.4, 1] }}
                    transition={{ repeat: Infinity, duration: 1 }}
                    className="font-mono text-[9px]"
                    style={{ color: 'var(--gold)' }}
                  >
                    {actionPending.toUpperCase()}...
                  </motion.span>
                )}
              </div>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{agentDef.description}</p>
            </div>
          </div>

          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            <SystemBadge systemType={agentDef.systemType} reachable={connection.reachable} latencyMs={connection.latencyMs} />
            <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>ID: {agentDef.systemId}</span>
          </div>
        </div>
      </div>

      {/* ── Tabs ─────────────────────────────────────────── */}
      <div className="flex gap-0 border-b" style={{ borderColor: 'var(--border-default)' }}>
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={clsx(
              'font-ui text-[10px] font-semibold tracking-widest px-5 py-2.5 transition-all relative',
              activeTab === tab ? '' : 'hover:opacity-70'
            )}
            style={{ color: activeTab === tab ? agentColor : 'var(--text-muted)' }}
          >
            {tab}
            {activeTab === tab && (
              <motion.div
                layoutId="agentTabUnderline"
                className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t"
                style={{ background: agentColor, boxShadow: `0 0 8px ${agentColor}` }}
              />
            )}
            {tab === 'LOGS' && logs.length > 0 && (
              <span
                className="ml-1.5 font-mono text-[8px] px-1.5 py-0.5 rounded-full"
                style={{ background: `${agentColor}18`, color: agentColor }}
              >
                {logs.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tab Content ──────────────────────────────────── */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
        >
          {activeTab === 'CONTROL' && (
            <ControlTab agent={agentDef} status={status} onAction={handleAction} />
          )}
          {activeTab === 'CHAT' && (
            <div className="panel-raised overflow-hidden" style={{ borderRadius: 12 }}>
              <ChatTab agent={agentDef} onDispatch={handleDispatch} />
            </div>
          )}
          {activeTab === 'LOGS' && (
            <LogsTab
              agent={agentDef}
              logs={logs}
              onRefresh={() => agentGetLogs(agentDef).then(l => { clearAgentLogs(agentDef.id); l.forEach(e => appendAgentLog(agentDef.id, e)); })}
              onClear={() => clearAgentLogs(agentDef.id)}
            />
          )}
          {activeTab === 'MEMORY' && <MemoryTab agent={agentDef} memory={memory} />}
          {activeTab === 'CONFIG' && agentConfig && (
            <ConfigTab
              agent={agentDef}
              config={agentConfig}
              onSave={async (patch) => { await agentSetConfig(agentDef, patch); setAgentConfig(patch); }}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}
