// components/sections/TaskDispatch.jsx — Phase 4: Context Registry
import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SectionHeader } from '../ui';
import { submitTask, fetchSubmittedTasks, deleteTask, dispatchTaskToOpenClaw, dispatchTaskToHermes, synthesizeWithOpenClaw, fetchLaneMemory, fetchQueue, approveQueueItem, updateQueueItemStatus, fetchTelegramStatus, previewDispatch, executeViaDispatch } from '../../lib/api';
import businessLanes from '../../context/business-lanes.json';

// ─── Formatted output renderer ───────────────────────────────────────────────
// Parses agent output text into readable sections with styled headers,
// timestamps, bullets, camera directions, and dividers.

function FormattedOutput({ text, accentColor = '#0dd3c5' }) {
  if (!text) return null;

  const lines = text.split('\n');
  const elements = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Empty line → spacer
    if (!trimmed) {
      elements.push(<div key={i} className="h-2" />);
      i++; continue;
    }

    // Horizontal rule
    if (/^[-─═]{3,}$/.test(trimmed)) {
      elements.push(
        <div key={i} className="my-2" style={{ borderTop: `1px solid ${accentColor}20` }} />
      );
      i++; continue;
    }

    // Timestamp block header e.g. [00:00-00:04] HOOK
    if (/^\[[\d:]+[\s\-–]+[\d:]+\]/.test(trimmed)) {
      const match = trimmed.match(/^(\[[\d:]+[\s\-–]+[\d:]+\])\s*(.*)/);
      const ts    = match?.[1] || '';
      const label = match?.[2] || '';
      elements.push(
        <div key={i} className="flex items-baseline gap-2 mt-3 mb-1">
          <span className="font-mono text-[9px] px-1.5 py-0.5 rounded-sm flex-shrink-0"
            style={{ background: `${accentColor}15`, border: `1px solid ${accentColor}30`, color: accentColor }}>
            {ts}
          </span>
          {label && (
            <span className="font-ui text-[10px] font-semibold tracking-widest" style={{ color: '#f0ede6' }}>
              {label}
            </span>
          )}
        </div>
      );
      i++; continue;
    }

    // Camera direction line (starts with 🎬 or 📸)
    if (/^[🎬📸🎥]/.test(trimmed)) {
      elements.push(
        <div key={i} className="font-mono text-[9px] italic pl-2 my-0.5"
          style={{ color: '#6b7280', borderLeft: `2px solid rgba(255,255,255,0.08)` }}>
          {trimmed}
        </div>
      );
      i++; continue;
    }

    // ALL-CAPS section header (e.g. PRODUCTION NOTES, HOOK, BODY — POINT 1)
    if (/^[A-Z][A-Z\s\d—–\-:·|]+$/.test(trimmed) && trimmed.length > 2) {
      elements.push(
        <div key={i} className="font-mono text-[8px] tracking-[0.2em] mt-3 mb-1" style={{ color: accentColor }}>
          {trimmed}
        </div>
      );
      i++; continue;
    }

    // Bullet line (starts with - or •)
    if (/^[-•▸]/.test(trimmed)) {
      elements.push(
        <div key={i} className="flex items-start gap-2 my-0.5">
          <span className="font-mono text-[9px] mt-0.5 flex-shrink-0" style={{ color: accentColor }}>▸</span>
          <span className="font-mono text-[10px] leading-relaxed" style={{ color: '#c8c5be' }}>
            {trimmed.replace(/^[-•▸]\s*/, '')}
          </span>
        </div>
      );
      i++; continue;
    }

    // Spoken dialogue line (in quotes)
    if (/^[""]/.test(trimmed) || /^"/.test(trimmed)) {
      elements.push(
        <div key={i} className="font-mono text-[10px] leading-relaxed pl-2 my-1"
          style={{ color: '#f0ede6', borderLeft: `2px solid ${accentColor}50` }}>
          {trimmed}
        </div>
      );
      i++; continue;
    }

    // Key: Value metadata line
    if (/^[\w\s]+:\s+\S/.test(trimmed) && !trimmed.includes('.')) {
      const colon = trimmed.indexOf(':');
      const key   = trimmed.slice(0, colon).trim();
      const val   = trimmed.slice(colon + 1).trim();
      elements.push(
        <div key={i} className="flex items-baseline gap-2 my-0.5">
          <span className="font-mono text-[8px] tracking-widest flex-shrink-0 w-28" style={{ color: '#4b5563' }}>
            {key.toUpperCase()}
          </span>
          <span className="font-mono text-[10px]" style={{ color: '#c8c5be' }}>{val}</span>
        </div>
      );
      i++; continue;
    }

    // Default: body text
    elements.push(
      <div key={i} className="font-mono text-[10px] leading-relaxed my-0.5" style={{ color: '#c8c5be' }}>
        {trimmed}
      </div>
    );
    i++;
  }

  return <div className="flex flex-col">{elements}</div>;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const LANES = [
  { id: 'digital-diamond', label: 'Digital Diamond AI',    color: '#c9a84c' },
  { id: 'managed-by-mika', label: 'Managed by Mika',       color: '#0dd3c5' },
  { id: 'medai',           label: 'MedAI',                 color: '#818cf8' },
  { id: 'cannaops',        label: 'CannaOps',              color: '#4ade80' },
  { id: 'hotel-hooker',    label: 'The Hotel Hooker',       color: '#f472b6' },
  { id: 'ai-twin',         label: 'AI Twin Content Studio', color: '#60a5fa' },
];

const TASK_TYPES = [
  'Research', 'Content', 'Lead Recovery',
  'Automation', 'Client Delivery', 'System Maintenance',
];

const PRIORITIES = ['Low', 'Normal', 'High'];

const STATUS_META = {
  pending:  { label: 'PENDING',  color: '#8892a4' },
  running:  { label: 'RUNNING',  color: '#c9a84c' },
  complete: { label: 'COMPLETE', color: '#0dd3c5' },
  failed:   { label: 'FAILED',   color: '#ef4444' },
};

const PRIORITY_COLOR = { Low: '#4b5563', Normal: '#c9a84c', High: '#ef4444' };

// ─── Shared styles ────────────────────────────────────────────────────────────

const inputStyle = {
  width: '100%',
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(201,168,76,0.15)',
  borderRadius: 4,
  color: '#f0ede6',
  fontFamily: 'var(--font-ui)',
  fontSize: 11,
  padding: '8px 10px',
  outline: 'none',
  appearance: 'none',
  WebkitAppearance: 'none',
};

const EMPTY_FORM = {
  lane: '', taskType: '', priority: 'Normal', approvalRequired: false, description: '',
};

const stagger = { initial: {}, animate: { transition: { staggerChildren: 0.06 } } };
const fadeUp  = { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0, transition: { duration: 0.35 } } };

// ─── Sub-components ───────────────────────────────────────────────────────────

function LaneChip({ laneId }) {
  const lane = LANES.find(l => l.id === laneId);
  const color = lane?.color || '#8892a4';
  return (
    <span
      className="font-mono text-[8px] tracking-wider px-1.5 py-0.5 rounded-sm flex-shrink-0"
      style={{ color, background: `${color}18`, border: `1px solid ${color}30` }}
    >
      {lane?.label || laneId}
    </span>
  );
}

function StatusPip({ status }) {
  const meta = STATUS_META[status] || STATUS_META.pending;
  return (
    <span className="flex items-center gap-1 flex-shrink-0">
      <motion.span
        className="w-1.5 h-1.5 rounded-full"
        animate={status === 'running' ? { opacity: [1, 0.3, 1] } : {}}
        transition={{ repeat: Infinity, duration: 1.2 }}
        style={{ background: meta.color, boxShadow: status === 'running' ? `0 0 6px ${meta.color}` : undefined }}
      />
      <span className="font-mono text-[8px] tracking-wider" style={{ color: meta.color }}>{meta.label}</span>
    </span>
  );
}

function ResponseLog({ task }) {
  const [resultsExpanded, setResultsExpanded] = useState(true);

  if (task.status === 'pending') return null;

  const isRunning = task.status === 'running';
  const reply     = task.openclawReply ?? task.openclawResponse?.choices?.[0]?.message?.content ?? null;
  const model     = task.openclawResponse?.model;
  const usage     = task.openclawResponse?.usage;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      className="mt-2 pt-2"
      style={{ borderTop: '1px solid rgba(201,168,76,0.08)' }}
    >
      {/* Meta line */}
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-mono text-[8px] tracking-widest text-[#4b5563]">OPENCLAW</span>
          {task.dispatchedAt && (
            <span className="font-mono text-[8px] text-[#4b5563]">
              {new Date(task.dispatchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          {model && <span className="font-mono text-[8px] text-[#4b5563]">{model}</span>}
          {task.openclawStatus && (
            <span className="font-mono text-[8px]" style={{ color: task.openclawStatus === 200 ? '#0dd3c5' : '#ef4444' }}>
              HTTP {task.openclawStatus}
            </span>
          )}
          {usage?.total_tokens > 0 && (
            <span className="font-mono text-[8px] text-[#4b5563]">{usage.total_tokens} tokens</span>
          )}
        </div>
        {(isRunning || task.openclawError || reply) && (
          <button
            type="button"
            onClick={() => setResultsExpanded(v => !v)}
            className="px-2 py-0.5 rounded-sm font-mono text-[8px] font-semibold tracking-wider uppercase transition-all"
            style={{
              background: resultsExpanded ? 'rgba(255,255,255,0.03)' : 'rgba(13,211,197,0.08)',
              border: '1px solid rgba(13,211,197,0.16)',
              color: resultsExpanded ? '#8892a4' : '#0dd3c5',
            }}
          >
            {resultsExpanded ? 'Hide' : 'Show'}
          </button>
        )}
      </div>

      <AnimatePresence>
        {resultsExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            {/* Sending state */}
            {isRunning && (
              <motion.div
                animate={{ opacity: [1, 0.4, 1] }}
                transition={{ repeat: Infinity, duration: 1 }}
                className="font-mono text-[10px] text-[#c9a84c]"
              >
                Sending to OpenClaw...
              </motion.div>
            )}

            {/* Error */}
            {task.openclawError && (
              <div
                className="p-2 rounded-sm font-mono text-[9px] leading-relaxed"
                style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444' }}
              >
                {task.openclawError}
              </div>
            )}

            {/* Assistant reply — formatted output */}
            {reply && (
              <div
                className="p-3 rounded-sm"
                style={{ background: 'rgba(13,211,197,0.04)', border: '1px solid rgba(13,211,197,0.15)' }}
              >
                <FormattedOutput text={reply} accentColor="#0dd3c5" />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Hermes output log ───────────────────────────────────────────────────────

function HermesLog({ task, onSynthesize, synthesizing }) {
  const [resultsExpanded, setResultsExpanded] = useState(true);
  const isStub       = task.hermesStubMode;
  const hasSynthesis = !!task.openclawSynthesis;
  const synthError   = task.openclawSynthesisError;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      className="mt-2 pt-2"
      style={{ borderTop: '1px solid rgba(167,139,250,0.1)' }}
    >
      {/* Meta */}
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-mono text-[8px] tracking-widest" style={{ color: '#a78bfa' }}>HERMES</span>
          {task.dispatchedAt && (
            <span className="font-mono text-[8px] text-[#4b5563]">
              {new Date(task.dispatchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          {task.hermesHandoff?.handoffId && (
            <span className="font-mono text-[8px] text-[#4b5563] truncate max-w-[100px]">{task.hermesHandoff.handoffId}</span>
          )}
          {isStub && (
            <span className="font-mono text-[8px] px-1.5 py-0.5 rounded-sm" style={{ color: '#f59e0b', background: 'rgba(245,158,11,0.1)' }}>
              STUB
            </span>
          )}
        </div>
        {(task.hermesError || task.hermesOutput || hasSynthesis || synthError) && (
          <button
            type="button"
            onClick={() => setResultsExpanded(v => !v)}
            className="px-2 py-0.5 rounded-sm font-mono text-[8px] font-semibold tracking-wider uppercase transition-all"
            style={{
              background: resultsExpanded ? 'rgba(255,255,255,0.03)' : 'rgba(167,139,250,0.08)',
              border: '1px solid rgba(167,139,250,0.18)',
              color: resultsExpanded ? '#8892a4' : '#a78bfa',
            }}
          >
            {resultsExpanded ? 'Hide' : 'Show'}
          </button>
        )}
      </div>

      <AnimatePresence>
        {resultsExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            {/* Error */}
            {task.hermesError && !isStub && (
              <div
                className="p-2 rounded-sm font-mono text-[9px] leading-relaxed mb-2"
                style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444' }}
              >
                {task.hermesError}
              </div>
            )}

            {/* Hermes output — formatted */}
            {task.hermesOutput && (
              <div
                className="p-3 rounded-sm mb-2"
                style={{ background: 'rgba(167,139,250,0.04)', border: '1px solid rgba(167,139,250,0.15)' }}
              >
                <FormattedOutput text={task.hermesOutput} accentColor="#a78bfa" />
              </div>
            )}

            {/* Synthesis section */}
            {task.hermesOutput && !hasSynthesis && (
              <button
                onClick={() => onSynthesize(task.id)}
                disabled={synthesizing}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-sm font-mono text-[9px] tracking-wider transition-all"
                style={{
                  background: synthesizing ? 'rgba(201,168,76,0.04)' : 'rgba(201,168,76,0.08)',
                  border:     `1px solid ${synthesizing ? 'rgba(201,168,76,0.15)' : 'rgba(201,168,76,0.3)'}`,
                  color:      synthesizing ? '#4b5563' : '#c9a84c',
                  cursor:     synthesizing ? 'not-allowed' : 'pointer',
                }}
              >
                {synthesizing ? (
                  <>
                    <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 0.9 }}>◈</motion.span>
                    Synthesizing...
                  </>
                ) : (
                  <>◈ Send to OpenClaw for Synthesis</>
                )}
              </button>
            )}

            {/* Synthesis result */}
            {hasSynthesis && (
              <div className="mt-2">
                <div className="font-mono text-[8px] tracking-widest text-[#4b5563] mb-1">OPENCLAW SYNTHESIS</div>
                <div
                  className="p-2.5 rounded-sm text-[11px] leading-relaxed"
                  style={{ background: 'rgba(13,211,197,0.04)', border: '1px solid rgba(13,211,197,0.15)', color: '#d1faf7' }}
                >
                  {task.openclawSynthesis}
                </div>
              </div>
            )}
            {synthError && !hasSynthesis && (
              <div className="mt-1 font-mono text-[9px]" style={{ color: '#ef4444' }}>Synthesis error: {synthError}</div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Task card ────────────────────────────────────────────────────────────────

const TaskCard = React.forwardRef(function TaskCard({ task, onDispatch, dispatching, onHermesDispatch, hermesDispatching, onSynthesize, synthesizing, onDelete, deleting }, ref) {
  const [expanded, setExpanded] = useState(false);
  const isPending    = task.status === 'pending';
  const isFailed     = task.status === 'failed';
  const canDispatch  = isPending || isFailed;
  const isRunning    = task.status === 'running';
  const isResearch   = task.taskType === 'Research';
  const isSending    = dispatching === task.id;
  const isHermes     = hermesDispatching === task.id;
  const isDeleting   = deleting === task.id;
  const isSynth      = synthesizing === task.id;
  const meta         = STATUS_META[task.status] || STATUS_META.pending;
  const laneColor    = LANES.find(l => l.id === task.lane)?.color || '#4b5563';
  const isHermesTask = task.dispatchTarget === 'hermes';

  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      className="rounded-sm p-3"
      style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid rgba(201,168,76,0.08)` }}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <LaneChip laneId={task.lane} />
          <span className="font-mono text-[9px] text-[#8892a4]">{task.taskType}</span>
          <span
            className="font-mono text-[8px] px-1.5 py-0.5 rounded-sm"
            style={{ color: PRIORITY_COLOR[task.priority] || '#4b5563', background: `${PRIORITY_COLOR[task.priority] || '#4b5563'}18` }}
          >
            {task.priority?.toUpperCase()}
          </span>
          {task.approvalRequired && (
            <span className="font-mono text-[8px] px-1.5 py-0.5 rounded-sm" style={{ color: '#c9a84c', background: 'rgba(201,168,76,0.1)' }}>
              APPROVAL
            </span>
          )}
        </div>
        <StatusPip status={task.status} />
      </div>

      {/* Title + description */}
      {task.title && (
        <p className="font-ui text-[11px] font-semibold mb-0.5 truncate" style={{ color: '#e8e4dc' }}>
          {task.title}
        </p>
      )}
      <p className={`font-body text-[10px] text-[#6b7280] leading-relaxed mb-2 ${expanded ? 'whitespace-pre-wrap' : 'line-clamp-1'}`}>
        {task.description}
      </p>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-2 overflow-hidden"
          >
            <div
              className="grid grid-cols-2 gap-2 p-2 rounded-sm"
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(201,168,76,0.08)' }}
            >
              {[
                ['Created', task.createdAt ? new Date(task.createdAt).toLocaleString() : 'unknown'],
                ['Updated', task.updatedAt ? new Date(task.updatedAt).toLocaleString() : 'unknown'],
                ['Source', task.source || 'manual'],
                ['Workflow', task.workflowId || 'none'],
                ['Stage', task.stageName || task.stageId || 'none'],
                ['Platform', task.platform || 'none'],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <div className="font-mono text-[8px] tracking-widest text-[#4b5563] uppercase">{label}</div>
                  <div className="font-mono text-[9px] text-[#8892a4] truncate">{value}</div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[8px] text-[#4b5563] truncate max-w-[120px]">{task.id}</span>
          <span className="font-mono text-[8px] text-[#4b5563]">
            {new Date(task.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="px-2 py-1 rounded-sm font-mono text-[9px] font-semibold tracking-wider uppercase transition-all"
            style={{
              background: expanded ? 'rgba(201,168,76,0.12)' : 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(201,168,76,0.18)',
              color: expanded ? '#c9a84c' : '#8892a4',
            }}
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>

          <button
            type="button"
            onClick={() => onDelete(task.id)}
            disabled={isRunning || isDeleting}
            className="px-2 py-1 rounded-sm font-mono text-[9px] font-semibold tracking-wider uppercase transition-all"
            style={{
              background: isDeleting ? 'rgba(239,68,68,0.04)' : 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.22)',
              color: isRunning || isDeleting ? '#4b5563' : '#ef4444',
              cursor: isRunning || isDeleting ? 'not-allowed' : 'pointer',
            }}
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </button>

          {/* Dispatch buttons — pending tasks and failed retries */}
          {canDispatch && (
            <>
            {/* OpenClaw dispatch */}
            <button
              onClick={() => onDispatch(task.id)}
              disabled={isSending || isHermes || !!dispatching || !!hermesDispatching}
              className="px-3 py-1 rounded-sm font-mono text-[9px] font-semibold tracking-wider uppercase transition-all"
              style={{
                background: isSending ? 'rgba(13,211,197,0.05)' : 'rgba(13,211,197,0.1)',
                border:     `1px solid ${isSending ? 'rgba(13,211,197,0.15)' : 'rgba(13,211,197,0.35)'}`,
                color:      isSending ? '#4b5563' : '#0dd3c5',
                cursor:     (isSending || isHermes || !!dispatching || !!hermesDispatching) ? 'not-allowed' : 'pointer',
              }}
            >
              {isSending ? 'Sending...' : isFailed ? 'Retry Send' : 'Approve & Send'}
            </button>
            {/* Hermes dispatch — Research only */}
            {isResearch && (
              <button
                onClick={() => onHermesDispatch(task.id)}
                disabled={isSending || isHermes || !!dispatching || !!hermesDispatching}
                className="px-3 py-1 rounded-sm font-mono text-[9px] font-semibold tracking-wider uppercase transition-all"
                style={{
                  background: isHermes ? 'rgba(167,139,250,0.05)' : 'rgba(167,139,250,0.1)',
                  border:     `1px solid ${isHermes ? 'rgba(167,139,250,0.15)' : 'rgba(167,139,250,0.35)'}`,
                  color:      isHermes ? '#4b5563' : '#a78bfa',
                  cursor:     (isSending || isHermes || !!dispatching || !!hermesDispatching) ? 'not-allowed' : 'pointer',
                }}
              >
                {isHermes ? 'Researching...' : '⚡ Hermes'}
              </button>
            )}
            </>
          )}
        </div>
      </div>

      {/* Response / Hermes log */}
      {isHermesTask
        ? <HermesLog task={task} onSynthesize={onSynthesize} synthesizing={isSynth} />
        : <ResponseLog task={task} />
      }
    </motion.div>
  );
});

// ─── Main component ───────────────────────────────────────────────────────────

export default function TaskDispatch() {
  const [form, setForm]             = useState(EMPTY_FORM);
  const [tasks, setTasks]           = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [dispatching, setDispatching] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [flash, setFlash]           = useState(null);
  const [contextExpanded, setContextExpanded] = useState(false);
  const [laneMemory, setLaneMemory]           = useState([]);
  const [memoryExpanded, setMemoryExpanded]   = useState(false);
  const [queueItems, setQueueItems]           = useState([]);
  const [approvingId, setApprovingId]         = useState(null);
  const [queueSendingId, setQueueSendingId]   = useState(null);
  const [telegramStatus, setTelegramStatus]   = useState(null);
  const [hermesDispatching, setHermesDispatching] = useState(null);
  const [synthesizing, setSynthesizing]           = useState(null);
  const [queueHermesSendingId, setQueueHermesSendingId] = useState(null);
  const [dispatchPreviews, setDispatchPreviews]     = useState({});
  const [previewingId, setPreviewingId]             = useState(null);
  const [engineResults, setEngineResults]           = useState({});
  const [engineExecutingId, setEngineExecutingId]   = useState(null);

  const loadTasks = useCallback(async () => {
    try { setTasks(await fetchSubmittedTasks()); } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  useEffect(() => {
    if (form.lane) fetchLaneMemory(form.lane).then(setLaneMemory);
    else setLaneMemory([]);
  }, [form.lane]);

  const refreshQueue = useCallback(() => fetchQueue().then(setQueueItems), []);
  useEffect(() => { refreshQueue(); }, [refreshQueue]);

  useEffect(() => {
    fetchTelegramStatus().then(setTelegramStatus);
  }, []);

  const handleApprove = async (queueId) => {
    setApprovingId(queueId);
    setQueueItems(prev => prev.map(q => q.queueId === queueId ? { ...q, status: 'approved', approved: true } : q));
    try { await approveQueueItem(queueId); } catch { await refreshQueue(); }
    setApprovingId(null);
    fetchTelegramStatus().then(setTelegramStatus);
  };

  const handleQueueDispatch = async (item) => {
    setQueueSendingId(item.queueId);
    setQueueItems(prev => prev.map(q => q.queueId === item.queueId ? { ...q, status: 'dispatched', dispatched: true } : q));
    try {
      const res = await dispatchTaskToOpenClaw(item.taskId);
      const finalStatus = res.success ? 'completed' : 'failed';
      await updateQueueItemStatus(item.queueId, finalStatus);
      setQueueItems(prev => prev.map(q => q.queueId === item.queueId ? { ...q, status: finalStatus, completed: res.success } : q));
      setTasks(prev => prev.map(t => t.id === item.taskId ? (res.task ?? { ...t, status: res.status }) : t));
      if (res.success && form.lane) fetchLaneMemory(form.lane).then(setLaneMemory);
    } catch (err) {
      await updateQueueItemStatus(item.queueId, 'failed');
      setQueueItems(prev => prev.map(q => q.queueId === item.queueId ? { ...q, status: 'failed' } : q));
    }
    setQueueSendingId(null);
    fetchTelegramStatus().then(setTelegramStatus);
  };

  // ── Dispatch Research task to Hermes ──────────────────────────────────────
  const handleHermesDispatch = async (taskId) => {
    setHermesDispatching(taskId);
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, status: 'running', dispatchedAt: new Date().toISOString(), dispatchTarget: 'hermes' } : t
    ));
    try {
      const res = await dispatchTaskToHermes(taskId);
      setTasks(prev => prev.map(t => t.id === taskId ? (res.task ?? { ...t, status: res.status }) : t));
      setFlash({
        type: res.success ? 'success' : 'error',
        msg:  res.success
          ? `Hermes research complete — task ${taskId}`
          : `Hermes error: ${res.hermesError || 'unknown'}`,
      });
    } catch (err) {
      setTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, status: 'failed', hermesError: err.message, dispatchTarget: 'hermes' } : t
      ));
      setFlash({ type: 'error', msg: err.message || 'Hermes dispatch failed.' });
    } finally {
      setHermesDispatching(null);
    }
  };

  // ── Synthesize Hermes output with OpenClaw ─────────────────────────────────
  const handleSynthesize = async (taskId) => {
    setSynthesizing(taskId);
    try {
      const res = await synthesizeWithOpenClaw(taskId);
      setTasks(prev => prev.map(t => t.id === taskId ? (res.task ?? t) : t));
      if (form.lane) fetchLaneMemory(form.lane).then(setLaneMemory);
    } catch (err) {
      setFlash({ type: 'error', msg: err.message || 'Synthesis failed.' });
    } finally {
      setSynthesizing(null);
    }
  };

  // ── Dispatch approved queue item to Hermes ─────────────────────────────────
  const handleQueueHermesDispatch = async (item) => {
    setQueueHermesSendingId(item.queueId);
    setQueueItems(prev => prev.map(q => q.queueId === item.queueId ? { ...q, status: 'dispatched', dispatched: true } : q));
    try {
      const res = await dispatchTaskToHermes(item.taskId);
      const finalStatus = res.success ? 'completed' : 'failed';
      await updateQueueItemStatus(item.queueId, finalStatus);
      setQueueItems(prev => prev.map(q => q.queueId === item.queueId ? { ...q, status: finalStatus, completed: res.success } : q));
      setTasks(prev => prev.map(t => t.id === item.taskId ? (res.task ?? { ...t, status: res.status }) : t));
    } catch (err) {
      await updateQueueItemStatus(item.queueId, 'failed');
      setQueueItems(prev => prev.map(q => q.queueId === item.queueId ? { ...q, status: 'failed' } : q));
    }
    setQueueHermesSendingId(null);
    fetchTelegramStatus().then(setTelegramStatus);
  };

  // ── Preview dispatch route for a queue item ────────────────────────────────
  const handlePreviewDispatch = async (item) => {
    if (previewingId === item.queueId) {
      // Toggle off if already showing
      setPreviewingId(null);
      return;
    }
    setPreviewingId(item.queueId);
    if (dispatchPreviews[item.queueId]) return; // cached

    // Look up taskType from the loaded tasks list
    const matchedTask = tasks.find(t => t.id === item.taskId);
    const taskType    = matchedTask?.taskType || item.taskType || 'Operations';

    try {
      const res = await previewDispatch({
        taskId:   item.taskId,
        taskType,
        laneId:   item.laneId,
        title:    item.title,
        priority: item.priority,
      });
      setDispatchPreviews(prev => ({ ...prev, [item.queueId]: res.decision }));
    } catch (err) {
      setDispatchPreviews(prev => ({
        ...prev,
        [item.queueId]: { error: err.message, taskType },
      }));
    }
  };

  // ── Execute approved task via Dispatch Engine ─────────────────────────────
  const handleEngineExecute = async (item) => {
    setEngineExecutingId(item.queueId);

    // If no preview yet, fetch it first so we can show agent info
    if (!dispatchPreviews[item.queueId]) {
      const matchedTask = tasks.find(t => t.id === item.taskId);
      const taskType    = matchedTask?.taskType || item.taskType || 'Operations';
      try {
        const preview = await previewDispatch({
          taskId:   item.taskId,
          taskType,
          laneId:   item.laneId,
          title:    item.title,
          priority: item.priority,
        });
        setDispatchPreviews(prev => ({ ...prev, [item.queueId]: preview.decision }));

        // Block if agent not executable
        if (!preview.decision?.executableNow) {
          setEngineResults(prev => ({
            ...prev,
            [item.queueId]: {
              ok: false,
              executionStatus: preview.decision?.nextAction === 'STAGED_DISPLAY_ONLY' ? 'staged' : 'manual_required',
              error: preview.decision?.reason || 'Agent not executable',
              decision: preview.decision,
              timestamp: new Date().toISOString(),
            },
          }));
          setEngineExecutingId(null);
          return;
        }
      } catch (err) {
        setEngineResults(prev => ({
          ...prev,
          [item.queueId]: { ok: false, error: err.message, timestamp: new Date().toISOString() },
        }));
        setEngineExecutingId(null);
        return;
      }
    } else {
      // Preview exists — check executableNow
      const preview = dispatchPreviews[item.queueId];
      if (!preview?.executableNow) {
        setEngineResults(prev => ({
          ...prev,
          [item.queueId]: {
            ok: false,
            executionStatus: preview?.nextAction === 'STAGED_DISPLAY_ONLY' ? 'staged' : 'manual_required',
            error: preview?.reason || 'Agent not executable',
            decision: preview,
            timestamp: new Date().toISOString(),
          },
        }));
        setEngineExecutingId(null);
        return;
      }
    }

    // Mark optimistically dispatched
    setQueueItems(prev => prev.map(q => q.queueId === item.queueId
      ? { ...q, status: 'dispatched', dispatched: true }
      : q
    ));

    try {
      const res = await executeViaDispatch(item.taskId);
      const finalStatus = res.ok ? 'completed' : 'failed';
      await updateQueueItemStatus(item.queueId, finalStatus);
      setQueueItems(prev => prev.map(q =>
        q.queueId === item.queueId ? { ...q, status: finalStatus, completed: res.ok } : q
      ));
      // Sync task state
      if (res.task) {
        setTasks(prev => prev.map(t => t.id === item.taskId ? res.task : t));
      }
      setEngineResults(prev => ({ ...prev, [item.queueId]: res }));
    } catch (err) {
      await updateQueueItemStatus(item.queueId, 'failed');
      setQueueItems(prev => prev.map(q =>
        q.queueId === item.queueId ? { ...q, status: 'failed' } : q
      ));
      setEngineResults(prev => ({
        ...prev,
        [item.queueId]: { ok: false, error: err.message, timestamp: new Date().toISOString() },
      }));
    }
    setEngineExecutingId(null);
    fetchTelegramStatus().then(setTelegramStatus);
  };

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  // ── Submit new task ────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.lane || !form.taskType || !form.description.trim()) {
      setFlash({ type: 'error', msg: 'Lane, task type, and description are required.' });
      return;
    }
    setSubmitting(true);
    setFlash(null);
    try {
      const res = await submitTask(form);
      setTasks(prev => [res.task, ...prev]);
      setForm(EMPTY_FORM);
      setFlash({ type: 'success', msg: `Task ${res.taskId} queued — status: PENDING` });
      refreshQueue();
    } catch (err) {
      setFlash({ type: 'error', msg: err.message || 'Submission failed.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteTask = async (taskId) => {
    const task = tasks.find(t => t.id === taskId);
    if (task?.status === 'running') {
      setFlash({ type: 'error', msg: 'Running tasks cannot be deleted.' });
      return;
    }

    const ok = window.confirm(`Delete task ${taskId}? This also removes it from the operational queue.`);
    if (!ok) return;

    setDeletingId(taskId);
    try {
      await deleteTask(taskId);
      setTasks(prev => prev.filter(t => t.id !== taskId));
      setQueueItems(prev => prev.filter(q => q.taskId !== taskId));
      setFlash({ type: 'success', msg: `Task ${taskId} deleted.` });
    } catch (err) {
      setFlash({ type: 'error', msg: err.message || 'Delete failed.' });
    } finally {
      setDeletingId(null);
    }
  };

  // ── Dispatch pending task to OpenClaw ──────────────────────────────────────
  const handleDispatch = async (taskId) => {
    setDispatching(taskId);

    // Optimistically mark as running in local state
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, status: 'running', dispatchedAt: new Date().toISOString() } : t
    ));

    try {
      const res = await dispatchTaskToOpenClaw(taskId);
      // Merge authoritative server state (includes openclawReply, openclawResponse, etc.)
      setTasks(prev => prev.map(t => t.id === taskId ? (res.task ?? { ...t, status: res.status }) : t));
      setFlash({
        type: res.success ? 'success' : 'error',
        msg: res.success
          ? `Task ${taskId} dispatched — status: COMPLETE`
          : `Dispatch returned: ${res.openclawError || 'error'}`,
      });
      if (res.success && form.lane) fetchLaneMemory(form.lane).then(setLaneMemory);
    } catch (err) {
      setTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, status: 'failed', openclawError: err.message } : t
      ));
      setFlash({ type: 'error', msg: err.message || 'Dispatch failed.' });
    } finally {
      setDispatching(null);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-6">
      <SectionHeader icon="◭" title="Task Dispatch" subtitle="Queue and send tasks to OpenClaw" />

      <div className="grid grid-cols-3 gap-4">

        {/* ── Submission form ─────────────────────────────────────────────── */}
        <motion.div variants={fadeUp} className="col-span-1 panel-gold rounded-sm p-5">
          <h3 className="font-ui text-xs font-semibold tracking-wider text-[#f0ede6] uppercase mb-4">New Task</h3>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="font-mono text-[9px] tracking-widest text-[#4b5563] uppercase block mb-1">Business Lane</label>
              <select value={form.lane} onChange={e => set('lane', e.target.value)} style={inputStyle}>
                <option value="">— Select lane —</option>
                {LANES.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </div>

            {/* ── Lane context peek ──────────────────────────────────────── */}
            {form.lane && businessLanes[form.lane] && (() => {
              const ctx = businessLanes[form.lane];
              const model = 'gpt-4o';
              return (
                <div className="rounded-sm overflow-hidden" style={{ border: '1px solid rgba(201,168,76,0.12)' }}>
                  <button
                    type="button"
                    onClick={() => setContextExpanded(v => !v)}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 transition-all"
                    style={{ background: 'rgba(201,168,76,0.04)', color: '#4b5563' }}
                  >
                    <span className="font-mono text-[8px] tracking-widest">LANE CONTEXT</span>
                    <span className="font-mono text-[8px]">{contextExpanded ? '▲' : '▼'}</span>
                  </button>
                  <AnimatePresence>
                    {contextExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18 }}
                        className="px-2.5 py-2 space-y-1"
                        style={{ background: 'rgba(201,168,76,0.02)' }}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[9px] font-semibold" style={{ color: '#c9a84c' }}>{ctx.displayName}</span>
                          <span className="font-mono text-[8px] text-[#4b5563]">{model}</span>
                        </div>
                        <div className="font-mono text-[8px] text-[#4b5563]">session: {ctx.sessionKey}</div>
                        <p className="font-body text-[10px] leading-relaxed" style={{ color: '#6b7280' }}>
                          {ctx.mission.length > 90 ? ctx.mission.slice(0, 90) + '…' : ctx.mission}
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })()}

            {/* ── Recent memory ──────────────────────────────────────────── */}
            {form.lane && (
              <div className="rounded-sm overflow-hidden" style={{ border: '1px solid rgba(13,211,197,0.1)' }}>
                <button
                  type="button"
                  onClick={() => setMemoryExpanded(v => !v)}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 transition-all"
                  style={{ background: 'rgba(13,211,197,0.03)', color: '#4b5563' }}
                >
                  <span className="font-mono text-[8px] tracking-widest">RECENT MEMORY</span>
                  <span className="font-mono text-[8px]" style={{ color: laneMemory.length ? '#0dd3c5' : undefined }}>
                    {laneMemory.length ? `${Math.min(laneMemory.length, 5)} entries` : 'none'} {memoryExpanded ? '▲' : '▼'}
                  </span>
                </button>
                <AnimatePresence>
                  {memoryExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18 }}
                      className="px-2.5 py-2"
                      style={{ background: 'rgba(13,211,197,0.02)' }}
                    >
                      {laneMemory.length === 0 ? (
                        <p className="font-mono text-[9px] text-[#4b5563]">No memory yet for this lane.</p>
                      ) : (
                        <div className="space-y-2">
                          {laneMemory.slice(0, 5).map((m, i) => {
                            const d = new Date(m.timestamp);
                            const stamp = `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                            return (
                              <div key={i} className="pb-2 last:pb-0" style={{ borderBottom: i < Math.min(laneMemory.length, 5) - 1 ? '1px solid rgba(13,211,197,0.06)' : 'none' }}>
                                <div className="flex items-center gap-2 mb-0.5">
                                  <span className="font-mono text-[8px] text-[#4b5563]">{stamp}</span>
                                  <span className="font-mono text-[8px]" style={{ color: '#c9a84c' }}>{m.taskType}</span>
                                </div>
                                <p className="font-mono text-[9px] leading-relaxed" style={{ color: '#6b7280' }}>{m.summary}</p>
                                {m.responseSummary && (
                                  <p className="font-mono text-[8px] mt-0.5" style={{ color: '#4b5563' }}>→ {m.responseSummary}</p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            <div>
              <label className="font-mono text-[9px] tracking-widest text-[#4b5563] uppercase block mb-1">Task Type</label>
              <select value={form.taskType} onChange={e => set('taskType', e.target.value)} style={inputStyle}>
                <option value="">— Select type —</option>
                {TASK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="font-mono text-[9px] tracking-widest text-[#4b5563] uppercase block mb-1">Priority</label>
                <select value={form.priority} onChange={e => set('priority', e.target.value)} style={inputStyle}>
                  {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="font-mono text-[9px] tracking-widest text-[#4b5563] uppercase block mb-1">Approval</label>
                <button
                  type="button"
                  onClick={() => set('approvalRequired', !form.approvalRequired)}
                  className="w-full py-2 rounded-sm text-[10px] font-mono font-semibold tracking-wider transition-all"
                  style={{
                    background: form.approvalRequired ? 'rgba(201,168,76,0.15)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${form.approvalRequired ? 'rgba(201,168,76,0.4)' : 'rgba(201,168,76,0.15)'}`,
                    color: form.approvalRequired ? '#c9a84c' : '#4b5563',
                  }}
                >
                  {form.approvalRequired ? 'REQUIRED' : 'AUTO'}
                </button>
              </div>
            </div>

            <div>
              <label className="font-mono text-[9px] tracking-widest text-[#4b5563] uppercase block mb-1">Description</label>
              <textarea
                value={form.description}
                onChange={e => set('description', e.target.value)}
                placeholder="Describe the task for the agent..."
                rows={4}
                style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
              />
            </div>

            <AnimatePresence>
              {flash && (
                <motion.div
                  key={flash.msg}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="p-2.5 rounded-sm font-mono text-[10px]"
                  style={{
                    background: flash.type === 'success' ? 'rgba(13,211,197,0.08)' : 'rgba(239,68,68,0.08)',
                    border: `1px solid ${flash.type === 'success' ? 'rgba(13,211,197,0.25)' : 'rgba(239,68,68,0.25)'}`,
                    color: flash.type === 'success' ? '#0dd3c5' : '#ef4444',
                  }}
                >
                  {flash.msg}
                </motion.div>
              )}
            </AnimatePresence>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 rounded-sm font-ui text-xs font-semibold tracking-widest uppercase transition-all"
              style={{
                background: submitting ? 'rgba(201,168,76,0.05)' : 'linear-gradient(135deg, rgba(201,168,76,0.2), rgba(201,168,76,0.08))',
                border: '1px solid rgba(201,168,76,0.35)',
                color: submitting ? '#4b5563' : '#c9a84c',
                cursor: submitting ? 'not-allowed' : 'pointer',
              }}
            >
              {submitting ? 'Queuing...' : 'Queue Task'}
            </button>
          </form>
        </motion.div>

        {/* ── Recent tasks list ────────────────────────────────────────────── */}
        <motion.div variants={fadeUp} className="col-span-2 panel-gold rounded-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-ui text-xs font-semibold tracking-wider text-[#f0ede6] uppercase">Recent Tasks</h3>
            <div className="flex items-center gap-3">
              <span className="font-mono text-[9px] text-[#4b5563]">{tasks.length} TOTAL</span>
              {dispatching && (
                <motion.span
                  animate={{ opacity: [1, 0.4, 1] }}
                  transition={{ repeat: Infinity, duration: 1 }}
                  className="font-mono text-[9px] text-[#0dd3c5]"
                >
                  DISPATCHING
                </motion.span>
              )}
            </div>
          </div>

          {tasks.length === 0 ? (
            <div className="flex items-center justify-center h-32">
              <span className="font-mono text-[10px] tracking-wider" style={{ color: 'var(--text-muted)' }}>
                No tasks submitted yet
              </span>
            </div>
          ) : (
            <div className="space-y-2 overflow-y-auto" style={{ maxHeight: 480 }}>
              <AnimatePresence mode="popLayout">
                {tasks.map((task, i) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onDispatch={handleDispatch}
                    dispatching={dispatching}
                    onHermesDispatch={handleHermesDispatch}
                    hermesDispatching={hermesDispatching}
                    onSynthesize={handleSynthesize}
                    synthesizing={synthesizing}
                    onDelete={handleDeleteTask}
                    deleting={deletingId}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </motion.div>
      </div>

      {/* ── Operational Queue panel ──────────────────────────────────────── */}
      <motion.div variants={fadeUp} className="panel-gold rounded-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-ui text-xs font-semibold tracking-wider text-[#f0ede6] uppercase">Operational Queue</h3>
          <div className="flex items-center gap-3">
            {[['queued','#8892a4'],['approved','#c9a84c'],['dispatched','#818cf8'],['completed','#0dd3c5'],['failed','#ef4444']].map(([s, c]) => {
              const n = queueItems.filter(q => q.status === s).length;
              return n > 0 ? (
                <span key={s} className="font-mono text-[8px] px-1.5 py-0.5 rounded-sm" style={{ color: c, background: `${c}18` }}>
                  {n} {s.toUpperCase()}
                </span>
              ) : null;
            })}
            {queueItems.length === 0 && (
              <span className="font-mono text-[9px] text-[#4b5563]">EMPTY</span>
            )}

            {/* Telegram status indicator */}
            {telegramStatus && (
              <div className="flex items-center gap-1.5 pl-3" style={{ borderLeft: '1px solid rgba(201,168,76,0.1)' }}>
                <div
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ background: telegramStatus.enabled ? '#0dd3c5' : '#4b5563' }}
                />
                <span className="font-mono text-[8px] tracking-wider" style={{ color: telegramStatus.enabled ? '#0dd3c5' : '#4b5563' }}>
                  TG {telegramStatus.enabled ? 'ON' : 'OFF'}
                </span>
                {telegramStatus.enabled && telegramStatus.lastSent && (
                  <span className="font-mono text-[8px] text-[#4b5563]">
                    {new Date(telegramStatus.lastSent).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
                {telegramStatus.lastError && (
                  <span className="font-mono text-[8px] truncate max-w-[120px]" style={{ color: '#ef4444' }} title={telegramStatus.lastError}>
                    ERR
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {queueItems.length === 0 ? (
          <div className="flex items-center justify-center h-12">
            <span className="font-mono text-[9px] tracking-wider text-[#4b5563]">No tasks in queue — submit a task to begin</span>
          </div>
        ) : (
          <div className="space-y-1.5 overflow-y-auto" style={{ maxHeight: 320 }}>
            {queueItems.map(item => {
              const laneColor = LANES.find(l => l.id === item.laneId)?.color || '#4b5563';
              const STATUS_C  = { queued:'#8892a4', approved:'#c9a84c', dispatched:'#818cf8', completed:'#0dd3c5', failed:'#ef4444' };
              const sc        = STATUS_C[item.status] || '#4b5563';
              const isApproving        = approvingId           === item.queueId;
              const isSending          = queueSendingId        === item.queueId;
              const isHermesSending    = queueHermesSendingId  === item.queueId;
              const isEngineExecuting  = engineExecutingId     === item.queueId;
              const busy               = !!(approvingId || queueSendingId || queueHermesSendingId || engineExecutingId);
              const canApprove         = item.status === 'queued'   && !busy;
              const canDispatch        = item.status === 'approved' && !busy;
              const isResearchItem     = item.taskType === 'Research' || item.title?.toLowerCase().includes('research');
              const engineResult       = engineResults[item.queueId] || null;

              return (
                <React.Fragment key={item.queueId}>
                <div
                  className="flex items-center gap-2 px-3 py-2 rounded-sm"
                  style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(201,168,76,0.07)' }}
                >
                  {/* Lane bar */}
                  <div className="w-0.5 h-6 rounded-full flex-shrink-0" style={{ background: laneColor, opacity: 0.7 }} />

                  {/* Title */}
                  <p className="font-body text-[11px] text-[#8892a4] flex-1 truncate min-w-0">{item.title}</p>

                  {/* Priority */}
                  <span className="font-mono text-[8px] flex-shrink-0" style={{ color: PRIORITY_COLOR[item.priority] || '#4b5563' }}>
                    {item.priority?.toUpperCase()}
                  </span>

                  {/* Status */}
                  <span className="font-mono text-[8px] tracking-wider flex-shrink-0 w-24 text-right" style={{ color: sc }}>
                    {isEngineExecuting ? 'ROUTING…' : isSending ? 'SENDING…' : isHermesSending ? 'RESEARCHING…' : isApproving ? 'APPROVING…' : item.status.toUpperCase()}
                  </span>

                  {/* Action */}
                  {canApprove && (
                    <button
                      onClick={() => handleApprove(item.queueId)}
                      className="flex-shrink-0 px-2 py-0.5 rounded-sm font-mono text-[8px] tracking-wider transition-all"
                      style={{ background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.3)', color: '#c9a84c', cursor: 'pointer' }}
                    >
                      APPROVE
                    </button>
                  )}

                  {/* Execute via Dispatch Engine — primary path */}
                  {canDispatch && (
                    <button
                      onClick={() => handleEngineExecute(item)}
                      disabled={busy}
                      className="flex-shrink-0 px-2 py-0.5 rounded-sm font-mono text-[8px] tracking-wider font-semibold transition-all"
                      style={{
                        background: 'rgba(201,168,76,0.18)',
                        border: '1px solid rgba(201,168,76,0.55)',
                        color: '#c9a84c',
                        cursor: busy ? 'not-allowed' : 'pointer',
                      }}
                      title="Route through Agent Dispatch Engine"
                    >
                      ◎ DISPATCH
                    </button>
                  )}

                  {/* Legacy direct dispatch */}
                  {canDispatch && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleQueueDispatch(item)}
                        className="px-2 py-0.5 rounded-sm font-mono text-[7px] tracking-wider transition-all"
                        style={{ background: 'rgba(13,211,197,0.06)', border: '1px solid rgba(13,211,197,0.2)', color: '#4b7070', cursor: 'pointer' }}
                        title="Legacy: direct to OpenClaw"
                      >
                        legacy
                      </button>
                      {isResearchItem && (
                        <button
                          onClick={() => handleQueueHermesDispatch(item)}
                          className="px-2 py-0.5 rounded-sm font-mono text-[7px] tracking-wider transition-all"
                          style={{ background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.2)', color: '#6b5b9a', cursor: 'pointer' }}
                          title="Legacy: direct to Hermes"
                        >
                          legacy⚡
                        </button>
                      )}
                    </div>
                  )}

                  {(isApproving || isSending || isHermesSending || isEngineExecuting) && (
                    <motion.div
                      animate={{ opacity: [1, 0.3, 1] }}
                      transition={{ repeat: Infinity, duration: 0.8 }}
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: isEngineExecuting ? '#c9a84c' : isHermesSending ? '#a78bfa' : isSending ? '#0dd3c5' : '#c9a84c' }}
                    />
                  )}
                  {(item.status === 'completed' || item.status === 'failed') && (
                    <span className="font-mono text-[9px] flex-shrink-0" style={{ color: sc }}>
                      {item.status === 'completed' ? '✓' : '✗'}
                    </span>
                  )}

                  {/* Time */}
                  <span className="font-mono text-[8px] text-[#4b5563] flex-shrink-0">
                    {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>

                  {/* Preview Dispatch */}
                  <button
                    onClick={() => handlePreviewDispatch(item)}
                    className="flex-shrink-0 px-2 py-0.5 rounded-sm font-mono text-[8px] tracking-wider transition-all"
                    style={{
                      background: previewingId === item.queueId ? 'rgba(129,140,248,0.15)' : 'rgba(129,140,248,0.06)',
                      border: `1px solid ${previewingId === item.queueId ? 'rgba(129,140,248,0.45)' : 'rgba(129,140,248,0.2)'}`,
                      color: previewingId === item.queueId ? '#818cf8' : '#6b7280',
                      cursor: 'pointer',
                    }}
                    title="Preview which agent would handle this task"
                  >
                    {previewingId === item.queueId && !dispatchPreviews[item.queueId] ? '…' : '⎋ ROUTE'}
                  </button>
                </div>

                {/* Dispatch preview panel */}
                <AnimatePresence>
                  {previewingId === item.queueId && dispatchPreviews[item.queueId] && (
                    <motion.div
                      key={`preview-${item.queueId}`}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.18 }}
                      className="mt-1.5 overflow-hidden"
                    >
                      {(() => {
                        const d = dispatchPreviews[item.queueId];
                        if (d.error) return (
                          <div className="px-3 py-2 rounded-sm font-mono text-[9px]"
                            style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444' }}>
                            Preview error: {d.error}
                          </div>
                        );
                        const execColor  = d.executableNow  ? '#0dd3c5' : '#818cf8';
                        const apprvColor = d.approvalRequired ? '#c9a84c' : '#4b5563';
                        const NEXT_META  = {
                          READY_TO_DISPATCH:  { label: 'READY',    color: '#0dd3c5' },
                          AWAIT_APPROVAL:     { label: 'APPROVAL', color: '#c9a84c' },
                          STAGED_DISPLAY_ONLY:{ label: 'STAGED',   color: '#818cf8' },
                          MANUAL_REVIEW:      { label: 'REVIEW',   color: '#ef4444' },
                        };
                        const nextMeta = NEXT_META[d.nextAction] || { label: d.nextAction, color: '#8892a4' };
                        return (
                          <div className="rounded-sm px-3 py-2.5 space-y-2"
                            style={{ background: 'rgba(129,140,248,0.04)', border: '1px solid rgba(129,140,248,0.15)' }}>
                            {/* Header */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-[8px] tracking-widest" style={{ color: '#818cf8' }}>DISPATCH PREVIEW</span>
                              <span className="font-mono text-[8px] px-1.5 py-0.5 rounded-sm"
                                style={{ color: execColor, background: `${execColor}15` }}>
                                {d.executableNow ? 'EXECUTABLE' : 'NOT EXECUTABLE'}
                              </span>
                              <span className="font-mono text-[8px] px-1.5 py-0.5 rounded-sm"
                                style={{ color: apprvColor, background: `${apprvColor}15` }}>
                                {d.approvalRequired ? 'APPROVAL REQ' : 'AUTO-DISPATCH'}
                              </span>
                              <span className="font-mono text-[8px] px-1.5 py-0.5 rounded-sm font-semibold"
                                style={{ color: nextMeta.color, background: `${nextMeta.color}15`, border: `1px solid ${nextMeta.color}30` }}>
                                {nextMeta.label}
                              </span>
                            </div>
                            {/* Agents */}
                            <div className="flex items-start gap-3">
                              {d.selectedAgent && (
                                <div>
                                  <div className="font-mono text-[7px] text-[#4b5563] mb-0.5">SELECTED</div>
                                  <div className="font-mono text-[9px] font-semibold" style={{ color: '#f0ede6' }}>
                                    {d.selectedAgent.displayName}
                                  </div>
                                  <div className="font-mono text-[8px] text-[#6b7280]">{d.selectedAgent.role}</div>
                                </div>
                              )}
                              {d.fallbackAgent && (
                                <div>
                                  <div className="font-mono text-[7px] text-[#4b5563] mb-0.5">FALLBACK</div>
                                  <div className="font-mono text-[9px]" style={{ color: '#8892a4' }}>
                                    {d.fallbackAgent.displayName}
                                  </div>
                                  <div className="font-mono text-[8px] text-[#4b5563]">{d.fallbackAgent.role}</div>
                                </div>
                              )}
                              {!d.selectedAgent && (
                                <div className="font-mono text-[9px] text-[#4b5563]">No agent assigned — unknown task type</div>
                              )}
                            </div>
                            {/* Reason */}
                            <p className="font-body text-[10px] leading-relaxed" style={{ color: '#6b7280' }}>{d.reason}</p>
                            {/* Warnings */}
                            {d.warnings?.length > 0 && (
                              <div className="space-y-0.5">
                                {d.warnings.map((w, wi) => (
                                  <div key={wi} className="flex items-start gap-1.5">
                                    <span className="text-[#f59e0b] text-[8px] flex-shrink-0">⚠</span>
                                    <span className="font-mono text-[8px] text-[#6b7280]">{w}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="flex items-center gap-1.5 pt-0.5" style={{ borderTop: '1px solid rgba(129,140,248,0.1)' }}>
                              <span className="text-[8px]" style={{ color: '#c9a84c' }}>◈</span>
                              <span className="font-mono text-[8px] text-[#4b5563]">Governance enforced through task routing, approval, and execution-mode controls.</span>
                            </div>
                          </div>
                        );
                      })()}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Engine execution result panel */}
                <AnimatePresence>
                  {engineResult && (
                    <motion.div
                      key={`engine-result-${item.queueId}`}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="mt-1.5 overflow-hidden"
                    >
                      {(() => {
                        const r         = engineResult;
                        const isSuccess = r.ok;
                        const isStaged  = r.executionStatus === 'staged';
                        const isFailed  = !r.ok && !isStaged;
                        const statusColor = isSuccess ? '#0dd3c5' : isStaged ? '#818cf8' : '#ef4444';
                        const statusLabel = isSuccess ? 'EXECUTED' : isStaged ? 'STAGED' : 'FAILED';

                        return (
                          <div className="rounded-sm px-3 py-2.5 space-y-2"
                            style={{ background: `${statusColor}06`, border: `1px solid ${statusColor}25` }}>
                            {/* Header row */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-[8px] tracking-widest" style={{ color: statusColor }}>
                                ENGINE RESULT
                              </span>
                              <span className="font-mono text-[8px] px-1.5 py-0.5 rounded-sm font-semibold"
                                style={{ color: statusColor, background: `${statusColor}18`, border: `1px solid ${statusColor}35` }}>
                                {statusLabel}
                              </span>
                              {r.executionTarget && (
                                <span className="font-mono text-[8px] px-1.5 py-0.5 rounded-sm"
                                  style={{ background: 'rgba(255,255,255,0.04)', color: '#8892a4' }}>
                                  {r.executionTarget}
                                </span>
                              )}
                              {r.executionMode && (
                                <span className="font-mono text-[8px] text-[#4b5563]">{r.executionMode}</span>
                              )}
                              {r.timestamp && (
                                <span className="font-mono text-[8px] text-[#4b5563] ml-auto">
                                  {new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                </span>
                              )}
                            </div>

                            {/* Agent row */}
                            {r.decision?.selectedAgent && (
                              <div className="flex items-center gap-3">
                                <div>
                                  <div className="font-mono text-[7px] text-[#4b5563] mb-0.5">AGENT</div>
                                  <div className="font-mono text-[9px] font-semibold" style={{ color: '#f0ede6' }}>
                                    {r.decision.selectedAgent.displayName}
                                  </div>
                                  <div className="font-mono text-[8px] text-[#6b7280]">
                                    {r.decision.selectedAgent.role}
                                  </div>
                                </div>
                                <div>
                                  <div className="font-mono text-[7px] text-[#4b5563] mb-0.5">MODE</div>
                                  <div className="font-mono text-[8px] text-[#8892a4]">
                                    {r.decision.selectedAgent.executionMode || '—'}
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Output */}
                            {r.output && (
                              <div>
                                <div className="font-mono text-[7px] text-[#4b5563] mb-0.5">OUTPUT</div>
                                <div className="p-2 rounded-sm text-[10px] leading-relaxed"
                                  style={{ background: `${statusColor}06`, border: `1px solid ${statusColor}18`, color: '#d1faf7', maxHeight: 120, overflowY: 'auto' }}>
                                  {r.output}
                                </div>
                              </div>
                            )}

                            {/* Error / staged message */}
                            {r.error && (
                              <div className="p-2 rounded-sm font-mono text-[9px] leading-relaxed"
                                style={{ background: `${statusColor}06`, border: `1px solid ${statusColor}20`, color: statusColor }}>
                                {r.error}
                              </div>
                            )}

                            {/* Warnings */}
                            {r.warnings?.length > 0 && (
                              <div className="space-y-0.5">
                                {r.warnings.map((w, wi) => (
                                  <div key={wi} className="flex items-start gap-1.5">
                                    <span className="text-[#f59e0b] text-[8px] flex-shrink-0">⚠</span>
                                    <span className="font-mono text-[8px] text-[#6b7280]">{w}</span>
                                  </div>
                                ))}
                              </div>
                            )}

                            <div className="flex items-center gap-1.5 pt-0.5"
                              style={{ borderTop: `1px solid ${statusColor}18` }}>
                              <span className="text-[8px]" style={{ color: '#c9a84c' }}>◈</span>
                              <span className="font-mono text-[8px] text-[#4b5563]">
                                Governance enforced through task routing, approval, and execution-mode controls.
                              </span>
                            </div>
                          </div>
                        );
                      })()}
                    </motion.div>
                  )}
                </AnimatePresence>
                </React.Fragment>
              );
            })}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
