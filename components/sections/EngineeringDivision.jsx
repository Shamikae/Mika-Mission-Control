// components/sections/EngineeringDivision.jsx
// Phase X.7 — Claude Code Workforce Integration
//
// Engineering analysis tasks: architecture reviews, code reviews,
// refactor plans, bug diagnoses.
//
// Governance: all tasks require Activation Gate approval before
// Claude Code can execute. File writes and shell execution are
// permanently disabled — analysis and recommendations only.

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ── Design tokens ─────────────────────────────────────────────────────────────
const GOLD      = '#c9a84c';
const SAPPHIRE  = '#3b82f6';
const EMERALD   = '#10b981';
const CRIMSON   = '#ef4444';
const AMBER     = '#f59e0b';
const TEAL      = '#0dd3c5';
const VIOLET    = '#8b5cf6';
const SURFACE   = 'rgba(15,18,26,0.95)';

const fadeUp = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.3 } } };

// ── Task type config ──────────────────────────────────────────────────────────

const TASK_TYPES = [
  { id: 'code_architecture', label: 'ARCHITECTURE',  icon: '⬡', color: SAPPHIRE,  desc: 'Review or propose architecture decisions' },
  { id: 'code_review',       label: 'CODE REVIEW',   icon: '◉', color: TEAL,      desc: 'Detailed code quality and pattern feedback' },
  { id: 'refactor_plan',     label: 'REFACTOR',      icon: '◈', color: VIOLET,    desc: 'Refactor plan with risks and sequencing' },
  { id: 'bug_diagnosis',     label: 'BUG DIAGNOSIS', icon: '◎', color: CRIMSON,   desc: 'Root cause analysis and fix suggestions' },
];

const TASK_TYPE_MAP = Object.fromEntries(TASK_TYPES.map(t => [t.id, t]));

const EFFORT_COLORS = { Small: EMERALD, Medium: AMBER, Large: CRIMSON, XLarge: VIOLET };
const STATUS_COLORS = { complete: EMERALD, failed: CRIMSON, running: AMBER, pending: GOLD };

// ── Shared helpers ────────────────────────────────────────────────────────────

function timeSince(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function StatusBadge({ status }) {
  const color = STATUS_COLORS[status] || '#8892a4';
  return (
    <span className="font-mono text-[8px] tracking-widest px-1.5 py-0.5 rounded-sm"
      style={{ background: `${color}18`, border: `1px solid ${color}40`, color }}>
      {status?.toUpperCase()}
    </span>
  );
}

// ── Activation status banner ──────────────────────────────────────────────────

function CapabilityBadge({ capabilityMode, canInspectFiles }) {
  if (!capabilityMode) return null;
  const isReadOnly = capabilityMode === 'read-only-inspection';
  const color = isReadOnly ? TEAL : AMBER;
  const label = isReadOnly ? 'READ-ONLY INSPECTION ENABLED' : 'ANALYSIS ONLY — NO FILE INSPECTION';
  const detail = isReadOnly ? 'Read · Glob · Grep · LS only · no writes' : 'no filesystem tools · advice from description only';
  return (
    <div className="flex items-center gap-2 px-3 py-1 rounded-sm"
      style={{ background: `${color}08`, border: `1px solid ${color}25` }}>
      <span className="font-mono text-[8px]" style={{ color }}>{isReadOnly ? '◉' : '◎'}</span>
      <span className="font-mono text-[8px] tracking-widest" style={{ color }}>{label}</span>
      <span className="font-mono text-[7px] ml-auto" style={{ color: `${color}70` }}>{detail}</span>
    </div>
  );
}

function ActivationBanner({ activated, capabilityMode, canInspectFiles }) {
  if (activated === null) return null;
  if (activated) return (
    <div className="flex flex-col gap-1.5 mb-4">
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-sm"
        style={{ background: `${EMERALD}08`, border: `1px solid ${EMERALD}30` }}>
        <span style={{ color: EMERALD }}>●</span>
        <span className="font-mono text-[9px] tracking-widest" style={{ color: EMERALD }}>
          CLAUDE CODE ACTIVATED
        </span>
        <span className="font-mono text-[8px] ml-auto" style={{ color: `${EMERALD}80` }}>
          no file writes · no shell execution
        </span>
      </div>
      <CapabilityBadge capabilityMode={capabilityMode} canInspectFiles={canInspectFiles} />
    </div>
  );
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-sm mb-4"
      style={{ background: `${AMBER}08`, border: `1px solid ${AMBER}30` }}>
      <span style={{ color: AMBER }}>◈</span>
      <span className="font-mono text-[9px] tracking-widest" style={{ color: AMBER }}>
        CLAUDE CODE STAGED — HERMES FALLBACK ACTIVE
      </span>
      <span className="font-mono text-[8px] ml-auto" style={{ color: `${AMBER}80` }}>
        use Activation Gate to promote
      </span>
    </div>
  );
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

function inlineFormat(text, accentColor) {
  // bold **text** or __text__
  const parts = text.split(/(\*\*[^*]+\*\*|__[^_]+__)/g);
  return parts.map((p, i) => {
    if (/^\*\*/.test(p) || /^__/.test(p)) {
      const inner = p.replace(/^\*\*|^\__|__$|\*\*$/g, '');
      return <strong key={i} style={{ color: accentColor || '#f0ede6', fontWeight: 700 }}>{inner}</strong>;
    }
    return p;
  });
}

function MarkdownOutput({ text, accentColor = GOLD }) {
  if (!text) return null;
  const lines = text.split('\n');
  const els = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) { els.push(<div key={i} className="h-2" />); i++; continue; }

    // H1 #
    if (/^# /.test(trimmed)) {
      els.push(<div key={i} className="font-ui text-sm font-bold mt-4 mb-1" style={{ color: '#f0ede6' }}>{trimmed.replace(/^# /, '')}</div>);
      i++; continue;
    }
    // H2 ##
    if (/^## /.test(trimmed)) {
      els.push(
        <div key={i} className="mt-4 mb-1.5">
          <div className="font-ui text-[11px] font-bold tracking-wide" style={{ color: accentColor }}>{trimmed.replace(/^## /, '')}</div>
          <div style={{ borderBottom: `1px solid ${accentColor}25`, marginTop: 3 }} />
        </div>
      );
      i++; continue;
    }
    // H3 ###
    if (/^### /.test(trimmed)) {
      els.push(<div key={i} className="font-ui text-[10px] font-semibold tracking-widest mt-3 mb-1" style={{ color: accentColor }}>{trimmed.replace(/^### /, '').toUpperCase()}</div>);
      i++; continue;
    }
    // H4 ####
    if (/^#### /.test(trimmed)) {
      els.push(<div key={i} className="font-mono text-[9px] tracking-widest mt-2 mb-0.5" style={{ color: `${accentColor}cc` }}>{trimmed.replace(/^#### /, '')}</div>);
      i++; continue;
    }
    // HR ---
    if (/^[-─═*]{3,}$/.test(trimmed)) {
      els.push(<div key={i} className="my-3" style={{ borderTop: `1px solid rgba(255,255,255,0.08)` }} />);
      i++; continue;
    }
    // Numbered list
    if (/^\d+\.\s/.test(trimmed)) {
      const match = trimmed.match(/^(\d+)\.\s+(.*)/);
      els.push(
        <div key={i} className="flex items-start gap-2 my-0.5">
          <span className="font-mono text-[9px] mt-0.5 flex-shrink-0 w-4 text-right" style={{ color: `${accentColor}80` }}>{match[1]}.</span>
          <span className="font-mono text-[10px] leading-relaxed" style={{ color: '#c8c5be' }}>{inlineFormat(match[2], accentColor)}</span>
        </div>
      );
      i++; continue;
    }
    // Bullet - or *
    if (/^[-*•▸]\s/.test(trimmed)) {
      const content = trimmed.replace(/^[-*•▸]\s+/, '');
      els.push(
        <div key={i} className="flex items-start gap-2 my-0.5 pl-2">
          <span className="font-mono text-[9px] mt-0.5 flex-shrink-0" style={{ color: accentColor }}>▸</span>
          <span className="font-mono text-[10px] leading-relaxed" style={{ color: '#c8c5be' }}>{inlineFormat(content, accentColor)}</span>
        </div>
      );
      i++; continue;
    }
    // Blockquote >
    if (/^>\s/.test(trimmed)) {
      els.push(
        <div key={i} className="pl-3 my-1 font-mono text-[10px] leading-relaxed italic"
          style={{ color: '#8892a4', borderLeft: `2px solid ${accentColor}40` }}>
          {trimmed.replace(/^>\s*/, '')}
        </div>
      );
      i++; continue;
    }
    // Code block ```
    if (/^```/.test(trimmed)) {
      const codeLines = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i++;
      }
      els.push(
        <pre key={`code-${i}`} className="font-mono text-[9px] leading-relaxed rounded-sm p-3 my-2 overflow-x-auto"
          style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.07)', color: '#a5f3fc' }}>
          {codeLines.join('\n')}
        </pre>
      );
      i++; continue;
    }
    // Inline code `...`
    if (/`[^`]+`/.test(trimmed)) {
      const parts = trimmed.split(/(`[^`]+`)/g);
      els.push(
        <div key={i} className="font-mono text-[10px] leading-relaxed my-0.5" style={{ color: '#c8c5be' }}>
          {parts.map((p, j) => /^`.*`$/.test(p)
            ? <code key={j} className="px-1 rounded-sm" style={{ background: 'rgba(255,255,255,0.07)', color: '#a5f3fc' }}>{p.slice(1, -1)}</code>
            : p)}
        </div>
      );
      i++; continue;
    }
    // Table row |...|
    if (/^\|/.test(trimmed)) {
      if (/^[\s|:-]+$/.test(trimmed)) { i++; continue; } // skip separator row
      const cells = trimmed.split('|').filter((c, idx, arr) => idx > 0 && idx < arr.length - 1);
      els.push(
        <div key={i} className="flex gap-0 my-0.5">
          {cells.map((cell, j) => (
            <div key={j} className="font-mono text-[9px] leading-relaxed px-2 py-0.5 flex-1 min-w-0"
              style={{ borderBottom: `1px solid rgba(255,255,255,0.06)`, color: '#c8c5be' }}>
              {inlineFormat(cell.trim(), accentColor)}
            </div>
          ))}
        </div>
      );
      i++; continue;
    }
    // Default paragraph
    els.push(
      <div key={i} className="font-mono text-[10px] leading-relaxed my-0.5" style={{ color: '#c8c5be' }}>
        {inlineFormat(trimmed, accentColor)}
      </div>
    );
    i++;
  }
  return <div className="flex flex-col">{els}</div>;
}

// ── Claude Review Panel ───────────────────────────────────────────────────────

function FullOutputModal({ text, onClose }) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.82)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }}
        className="rounded-sm flex flex-col w-full max-w-4xl"
        style={{ background: '#0f0e0c', border: '1px solid rgba(201,168,76,0.25)', maxHeight: '85vh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <span className="font-mono text-[8px] tracking-[0.2em]" style={{ color: GOLD }}>FULL OUTPUT</span>
          <button onClick={onClose} className="font-mono text-[9px] text-[#4b5563] hover:text-[#8892a4]">✕ CLOSE</button>
        </div>
        <div className="overflow-y-auto p-5 flex-1">
          <MarkdownOutput text={text} accentColor={GOLD} />
        </div>
      </motion.div>
    </motion.div>
  );
}

function extractParsed(task) {
  if (task.parsedOutput) return task.parsedOutput;
  const raw = task.output || task.rawOutput || '';
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function extractPreamble(task) {
  const raw = task.output || task.rawOutput || '';
  const match = raw.match(/^([\s\S]*?)\s*\{/);
  const pre = match?.[1]?.trim();
  return pre && pre.length > 10 ? pre : null;
}

function ClaudeReviewPanel({ task, onClose, onRetry }) {
  const [showFull, setShowFull] = useState(false);
  if (!task) return null;

  const typeConfig = TASK_TYPE_MAP[task.taskType] || {};
  const parsed     = extractParsed(task);
  const preamble   = extractPreamble(task);
  const rawOutput  = task.output || task.rawOutput || '';

  const confidence = parsed?.confidence_score;
  const effort     = parsed?.estimated_effort;

  return (
    <motion.div variants={fadeUp} initial="hidden" animate="show"
      className="rounded-sm flex flex-col gap-3"
      style={{ background: SURFACE, border: `1px solid ${typeConfig.color || GOLD}22` }}>

      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3"
        style={{ borderBottom: `1px solid ${typeConfig.color || GOLD}18` }}>
        <div className="flex items-center gap-2">
          <span style={{ color: typeConfig.color || GOLD }}>{typeConfig.icon || '◈'}</span>
          <span className="font-ui text-[10px] font-semibold tracking-widest" style={{ color: typeConfig.color || GOLD }}>
            {typeConfig.label || task.taskType.toUpperCase()}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {effort && (
            <span className="font-mono text-[8px] px-1.5 py-0.5 rounded-sm tracking-widest"
              style={{ background: `${EFFORT_COLORS[effort] || GOLD}15`, border: `1px solid ${EFFORT_COLORS[effort] || GOLD}35`, color: EFFORT_COLORS[effort] || GOLD }}>
              {effort.toUpperCase()}
            </span>
          )}
          {confidence != null && (
            <span className="font-mono text-[8px] px-1.5 py-0.5 rounded-sm"
              style={{ background: `${SAPPHIRE}15`, border: `1px solid ${SAPPHIRE}35`, color: SAPPHIRE }}>
              {confidence}% CONF
            </span>
          )}
          <StatusBadge status={task.status} />
          <button onClick={onClose}
            className="font-mono text-[10px] px-2 py-0.5 rounded-sm ml-1"
            style={{ background: `rgba(255,255,255,0.04)`, border: `1px solid rgba(255,255,255,0.1)`, color: '#8892a4' }}>
            ✕
          </button>
        </div>
      </div>

      {/* Title + meta */}
      <div className="px-4">
        <div className="font-display text-[13px] text-[#f0ede6] mb-1">{task.title}</div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[8px]" style={{ color: '#4b5563' }}>
            {task.executionTarget?.toUpperCase() || '—'}
          </span>
          {task.costUsd != null && (
            <span className="font-mono text-[8px]" style={{ color: '#4b5563' }}>
              ${task.costUsd.toFixed(4)} USD
            </span>
          )}
          {task.durationMs != null && (
            <span className="font-mono text-[8px]" style={{ color: '#4b5563' }}>
              {(task.durationMs / 1000).toFixed(1)}s
            </span>
          )}
          <span className="font-mono text-[8px] ml-auto" style={{ color: '#4b5563' }}>
            {timeSince(task.completedAt || task.updatedAt)}
          </span>
        </div>
      </div>

      <div className="px-4 pb-4 flex flex-col gap-3">

        {/* Failed state */}
        {task.status === 'failed' && (
          <div className="rounded-sm px-3 py-2.5"
            style={{ background: `${CRIMSON}08`, border: `1px solid ${CRIMSON}25` }}>
            <div className="flex items-center justify-between mb-1">
              <div className="font-mono text-[8px] tracking-widest" style={{ color: CRIMSON }}>EXECUTION FAILED</div>
              {onRetry && (
                <button onClick={() => onRetry(task)}
                  className="font-ui text-[8px] font-bold px-2 py-0.5 rounded-sm tracking-wider transition-all"
                  style={{ background: `${AMBER}12`, border: `1px solid ${AMBER}35`, color: AMBER }}>
                  ↻ RETRY
                </button>
              )}
            </div>
            <div className="font-mono text-[9px] leading-relaxed" style={{ color: '#8892a4' }}>
              {task.error || 'Unknown error'}
            </div>
          </div>
        )}

        {/* Preamble (Claude's intro text before JSON) */}
        {preamble && task.status === 'complete' && (
          <div className="rounded-sm px-3 py-2"
            style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <MarkdownOutput text={preamble} accentColor={typeConfig.color || GOLD} />
          </div>
        )}

        {/* Structured output */}
        {parsed && task.status === 'complete' && (
          <>
            {parsed.recommendation && (
              <div className="rounded-sm px-3 py-2.5"
                style={{ background: `${typeConfig.color || GOLD}06`, border: `1px solid ${typeConfig.color || GOLD}20` }}>
                <div className="font-mono text-[8px] tracking-widest mb-1.5" style={{ color: typeConfig.color || GOLD }}>
                  RECOMMENDATION
                </div>
                <MarkdownOutput text={parsed.recommendation} accentColor={typeConfig.color || GOLD} />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              {parsed.risks?.length > 0 && (
                <div className="rounded-sm px-3 py-2.5"
                  style={{ background: `${CRIMSON}06`, border: `1px solid ${CRIMSON}20` }}>
                  <div className="font-mono text-[8px] tracking-widest mb-1.5" style={{ color: CRIMSON }}>RISKS</div>
                  <ul className="flex flex-col gap-1">
                    {parsed.risks.map((r, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="font-mono text-[8px] mt-0.5 flex-shrink-0" style={{ color: CRIMSON }}>▸</span>
                        <span className="font-mono text-[9px] leading-relaxed" style={{ color: '#8892a4' }}>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {parsed.architecture_notes?.length > 0 && (
                <div className="rounded-sm px-3 py-2.5"
                  style={{ background: `${SAPPHIRE}06`, border: `1px solid ${SAPPHIRE}20` }}>
                  <div className="font-mono text-[8px] tracking-widest mb-1.5" style={{ color: SAPPHIRE }}>ARCH NOTES</div>
                  <ul className="flex flex-col gap-1">
                    {parsed.architecture_notes.map((n, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="font-mono text-[8px] mt-0.5 flex-shrink-0" style={{ color: SAPPHIRE }}>▸</span>
                        <span className="font-mono text-[9px] leading-relaxed" style={{ color: '#8892a4' }}>{n}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </>
        )}

        {/* Fallback: no parsed JSON — show full output as markdown */}
        {!parsed && rawOutput && task.status === 'complete' && (
          <div className="rounded-sm px-3 py-2.5"
            style={{ background: `rgba(255,255,255,0.02)`, border: `1px solid rgba(255,255,255,0.08)` }}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="font-mono text-[8px] tracking-widest" style={{ color: '#8892a4' }}>ANALYSIS OUTPUT</div>
              <button onClick={() => setShowFull(true)}
                className="font-mono text-[7px] px-2 py-0.5 rounded-sm tracking-wider transition-all"
                style={{ background: `${GOLD}10`, border: `1px solid ${GOLD}28`, color: GOLD }}>
                ⤢ EXPAND
              </button>
            </div>
            <div className="overflow-hidden" style={{ maxHeight: '400px' }}>
              <MarkdownOutput text={rawOutput} accentColor={typeConfig.color || GOLD} />
            </div>
            {rawOutput.length > 800 && (
              <button onClick={() => setShowFull(true)}
                className="mt-2 font-mono text-[7px] tracking-wider w-full text-center py-1 rounded-sm transition-all"
                style={{ background: `${GOLD}08`, border: `1px solid ${GOLD}20`, color: `${GOLD}90` }}>
                ↓ VIEW FULL OUTPUT ({rawOutput.length.toLocaleString()} chars)
              </button>
            )}
          </div>
        )}

        {/* Expand button always shown when there's output */}
        {task.status === 'complete' && rawOutput && (
          <button onClick={() => setShowFull(true)}
            className="font-mono text-[7px] tracking-wider w-full text-center py-1.5 rounded-sm transition-all"
            style={{ background: `rgba(255,255,255,0.03)`, border: `1px solid rgba(255,255,255,0.07)`, color: '#4b5563' }}>
            ⤢ VIEW FULL OUTPUT
          </button>
        )}
      </div>

      <AnimatePresence>
        {showFull && (
          <FullOutputModal text={rawOutput || task.output || ''} onClose={() => setShowFull(false)} />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Task card ─────────────────────────────────────────────────────────────────

function TaskCard({ task, selected, onClick }) {
  const typeConfig = TASK_TYPE_MAP[task.taskType] || {};
  const color      = typeConfig.color || GOLD;

  return (
    <button onClick={onClick} className="w-full text-left rounded-sm px-3 py-2.5 transition-all"
      style={{
        background: selected ? `${color}10` : `rgba(255,255,255,0.02)`,
        border: `1px solid ${selected ? `${color}40` : 'rgba(255,255,255,0.07)'}`,
      }}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[9px]" style={{ color }}>{typeConfig.icon}</span>
          <span className="font-ui text-[9px] font-semibold truncate" style={{ color: selected ? '#f0ede6' : '#c8c5be' }}>
            {task.title}
          </span>
        </div>
        <StatusBadge status={task.status} />
      </div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[7px] tracking-widest" style={{ color: `${color}80` }}>
          {typeConfig.label}
        </span>
        {task.executionTarget && (
          <span className="font-mono text-[7px]" style={{ color: '#4b5563' }}>
            via {task.executionTarget}
          </span>
        )}
        <span className="font-mono text-[7px] ml-auto" style={{ color: '#4b5563' }}>
          {timeSince(task.createdAt)}
        </span>
      </div>
    </button>
  );
}

// ── Dispatch form ─────────────────────────────────────────────────────────────

function DispatchForm({ activeType, onSubmitted }) {
  const [title, setTitle]               = useState('');
  const [instructions, setInstructions] = useState('');
  const [priority, setPriority]         = useState('Normal');
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState(null);

  const typeConfig = TASK_TYPE_MAP[activeType] || TASK_TYPES[0];
  const color      = typeConfig.color || GOLD;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!instructions.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/engineering/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskType: activeType, title: title.trim() || undefined, instructions, priority }),
      });

      const contentType = r.headers.get('content-type') || '';
      let data = null;

      if (contentType.includes('application/json')) {
        data = await r.json();
      } else {
        const raw = await r.text();
        const preMatch = raw.match(/<pre>([\s\S]*?)<\/pre>/i);
        const extracted = preMatch ? preMatch[1].trim() : '';
        throw new Error(extracted || `Request failed (${r.status})`);
      }

      if (r.ok && (data.ok || data.task)) {
        setTitle('');
        setInstructions('');
        onSubmitted(data.task);
      } else {
        setError(data?.error || `Dispatch failed (${r.status})`);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const inputStyle = {
    background: 'rgba(255,255,255,0.03)',
    border: `1px solid rgba(255,255,255,0.08)`,
    color: '#c8c5be',
    fontSize: '11px',
    fontFamily: 'var(--font-mono, monospace)',
    borderRadius: '2px',
    padding: '8px 10px',
    width: '100%',
    outline: 'none',
  };

  return (
    <div className="rounded-sm p-4"
      style={{ background: SURFACE, border: `1px solid ${color}22` }}>
      <div className="flex items-center gap-2 mb-4" style={{ borderBottom: `1px solid ${color}18`, paddingBottom: '10px' }}>
        <span style={{ color }}>{typeConfig.icon}</span>
        <span className="font-ui text-[10px] font-semibold tracking-widest" style={{ color }}>
          NEW {typeConfig.label}
        </span>
        <span className="font-mono text-[8px] ml-auto" style={{ color: '#4b5563' }}>
          {typeConfig.desc}
        </span>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div>
          <label className="font-mono text-[8px] tracking-widest block mb-1" style={{ color: '#8892a4' }}>
            TITLE <span style={{ color: '#4b5563' }}>(optional)</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={`e.g. Review auth flow in lib/agent-systems.js`}
            style={inputStyle}
          />
        </div>

        <div>
          <label className="font-mono text-[8px] tracking-widest block mb-1" style={{ color: '#8892a4' }}>
            INSTRUCTIONS
          </label>
          <textarea
            value={instructions}
            onChange={e => setInstructions(e.target.value)}
            placeholder={`Describe what you want Claude Code to ${activeType === 'bug_diagnosis' ? 'investigate' : activeType === 'code_review' ? 'review' : 'analyze'}…`}
            rows={5}
            style={inputStyle}
          />
        </div>

        <div>
          <label className="font-mono text-[8px] tracking-widest block mb-1" style={{ color: '#8892a4' }}>
            PRIORITY
          </label>
          <select value={priority} onChange={e => setPriority(e.target.value)} style={inputStyle}>
            <option>Normal</option>
            <option>High</option>
            <option>Low</option>
          </select>
        </div>

        {error && (
          <div className="font-mono text-[8px] px-2 py-1.5 rounded-sm"
            style={{ background: `${CRIMSON}10`, border: `1px solid ${CRIMSON}30`, color: CRIMSON }}>
            {error}
          </div>
        )}

        <button type="submit" disabled={!instructions.trim() || loading}
          className="font-ui text-[9px] tracking-widest font-semibold py-2 px-4 rounded-sm transition-all"
          style={{
            background: (!instructions.trim() || loading) ? 'rgba(255,255,255,0.04)' : `linear-gradient(135deg, ${color}25, ${color}10)`,
            border: `1px solid ${(!instructions.trim() || loading) ? 'rgba(255,255,255,0.08)' : `${color}45`}`,
            color: (!instructions.trim() || loading) ? '#4b5563' : color,
            cursor: (!instructions.trim() || loading) ? 'not-allowed' : 'pointer',
          }}>
          {loading ? '⟳ RUNNING ANALYSIS…' : `▶ DISPATCH ${typeConfig.label}`}
        </button>

        {loading && (
          <div className="font-mono text-[8px] text-center" style={{ color: `${AMBER}80` }}>
            Analysis may take 30–60s — Claude Code is processing
          </div>
        )}
      </form>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function EngineeringDivision() {
  const [activeTab, setActiveTab]       = useState('code_architecture');
  const [tasks, setTasks]               = useState([]);
  const [selectedTask, setSelectedTask] = useState(null);
  const [loading, setLoading]           = useState(true);
  const [activated, setActivated]       = useState(null);
  const [capabilityMode, setCapabilityMode] = useState(null);
  const [canInspectFiles, setCanInspectFiles] = useState(false);

  const fetchTasks = useCallback(async () => {
    try {
      const r    = await fetch('/api/engineering/tasks');
      const data = await r.json();
      if (data.ok) setTasks(data.tasks || []);
    } catch {}
    setLoading(false);
  }, []);

  const checkActivation = useCallback(async () => {
    try {
      const r    = await fetch('/api/activation');
      const data = await r.json();
      const cc   = data.adapters?.find(a => a.adapterId === 'claude-code');
      setActivated(cc?.isActive === true);
      setCapabilityMode(cc?.health?.capabilityMode || null);
      setCanInspectFiles(cc?.health?.canInspectFiles === true);
    } catch { setActivated(false); }
  }, []);

  useEffect(() => {
    fetchTasks();
    checkActivation();
  }, [fetchTasks, checkActivation]);

  const tabTasks = tasks.filter(t => t.taskType === activeTab);

  function handleSubmitted(task) {
    setTasks(prev => {
      const without = prev.filter(t => t.id !== task.id);
      return [task, ...without];
    });
    setSelectedTask(task);
  }

  function handleSelectTask(task) {
    setSelectedTask(prev => prev?.id === task.id ? null : task);
  }

  async function handleRetry(task) {
    try {
      const r = await fetch('/api/engineering/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskType: task.taskType, instructions: task.rawInstructions || task.instructions, priority: task.priority || 'Normal' }),
      });
      const data = await r.json();
      if (r.ok && (data.ok || data.task)) handleSubmitted(data.task);
    } catch {}
  }

  const typeConfig = TASK_TYPE_MAP[activeTab] || TASK_TYPES[0];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col gap-4 p-6 min-h-full"
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-[#f0ede6] tracking-wide">
            Engineering Division
          </h1>
          <p className="font-mono text-[9px] tracking-widest mt-0.5" style={{ color: SAPPHIRE }}>
            CLAUDE CODE · ANALYSIS-ONLY · NO FILE WRITES · APPROVAL REQUIRED
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setLoading(true); fetchTasks(); checkActivation(); }}
            className="font-mono text-[8px] tracking-widest px-3 py-1.5 rounded-sm"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#8892a4' }}>
            ↻ REFRESH
          </button>
        </div>
      </div>

      {/* ── Activation banner ── */}
      <ActivationBanner activated={activated} capabilityMode={capabilityMode} canInspectFiles={canInspectFiles} />

      {/* ── Tab navigation ── */}
      <div className="flex gap-1">
        {TASK_TYPES.map(type => (
          <button key={type.id}
            onClick={() => { setActiveTab(type.id); setSelectedTask(null); }}
            className="font-ui text-[9px] font-semibold tracking-widest px-3 py-1.5 rounded-sm transition-all"
            style={{
              background: activeTab === type.id ? `${type.color}18` : 'rgba(255,255,255,0.03)',
              border: `1px solid ${activeTab === type.id ? `${type.color}45` : 'rgba(255,255,255,0.07)'}`,
              color: activeTab === type.id ? type.color : '#4b5563',
            }}>
            <span className="mr-1.5">{type.icon}</span>{type.label}
            {tasks.filter(t => t.taskType === type.id).length > 0 && (
              <span className="ml-1.5 font-mono text-[7px] opacity-60">
                {tasks.filter(t => t.taskType === type.id).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Main layout: list + panel ── */}
      <div className="grid grid-cols-2 gap-4">

        {/* Left: task list */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="font-ui text-[9px] font-semibold tracking-widest" style={{ color: typeConfig.color }}>
              {typeConfig.icon} {typeConfig.label} QUEUE
            </span>
            <span className="font-mono text-[8px]" style={{ color: '#4b5563' }}>
              {tabTasks.length} task{tabTasks.length !== 1 ? 's' : ''}
            </span>
          </div>

          {loading && (
            <div className="font-mono text-[9px] text-center py-8" style={{ color: '#4b5563' }}>
              loading…
            </div>
          )}

          {!loading && tabTasks.length === 0 && (
            <div className="rounded-sm px-4 py-6 text-center"
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="font-mono text-[9px]" style={{ color: '#4b5563' }}>no tasks yet</div>
              <div className="font-mono text-[8px] mt-1" style={{ color: '#2d3748' }}>
                submit one using the dispatch form →
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <AnimatePresence>
              {tabTasks.map(task => (
                <motion.div key={task.id} variants={fadeUp} initial="hidden" animate="show">
                  <TaskCard
                    task={task}
                    selected={selectedTask?.id === task.id}
                    onClick={() => handleSelectTask(task)}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>

        {/* Right: review panel or dispatch form */}
        <div>
          <AnimatePresence mode="wait">
            {selectedTask ? (
              <motion.div key={selectedTask.id} variants={fadeUp} initial="hidden" animate="show">
                <ClaudeReviewPanel
                  task={selectedTask}
                  onClose={() => setSelectedTask(null)}
                  onRetry={handleRetry}
                />
              </motion.div>
            ) : (
              <motion.div key="dispatch-form" variants={fadeUp} initial="hidden" animate="show">
                <DispatchForm
                  activeType={activeTab}
                  onSubmitted={handleSubmitted}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Governance notice ── */}
      <div className="mt-2 rounded-sm px-4 py-3"
        style={{ background: `rgba(255,255,255,0.01)`, border: `1px solid rgba(255,255,255,0.05)` }}>
        <div className="font-mono text-[7px] tracking-widest mb-1" style={{ color: '#4b5563' }}>
          ENGINEERING GOVERNANCE
        </div>
        <div className="font-mono text-[7px] leading-relaxed" style={{ color: '#2d3748' }}>
          Claude Code runs in analysis-only mode (--tools "" · --no-session-persistence). File writes, shell execution, and autonomous loops are structurally impossible.
          All tasks require Activation Gate approval before Claude Code can execute. Hermes is the fallback when Claude Code is staged.
          Results are recommendations only — no automated changes are applied.
        </div>
      </div>
    </motion.div>
  );
}
