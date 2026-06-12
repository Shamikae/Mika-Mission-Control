// components/sections/VideoRouterPromptPack.jsx
// Phase E.5 — Video Router Prompt Pack
//
// Transforms a video-prompt.md artifact into provider-specific generation prompts.
// NO video is generated. NO external APIs are called. NO credits are spent.
// Output: copyable, downloadable provider prompts ready for when providers activate.

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const GOLD    = '#c9a84c';
const EMERALD = '#10b981';
const TEAL    = '#0dd3c5';
const PURPLE  = '#818cf8';
const SAPPHIRE = '#3b82f6';
const CRIMSON = '#ef4444';

const COST_COLORS = {
  free:    '#10b981',
  low:     '#0dd3c5',
  medium:  '#c9a84c',
  premium: '#f59e0b',
};

const BUDGET_OPTIONS = [
  { id: 'low-cost', label: 'Low Cost', icon: '🔓', desc: 'Free & open-source first' },
  { id: 'balanced', label: 'Balanced', icon: '⚖',  desc: 'Best price-to-quality' },
  { id: 'premium',  label: 'Premium',  icon: '💎', desc: 'Highest quality' },
];

const FORMAT_OPTIONS = [
  { id: 'short-form', label: 'Short-Form',  icon: '📱' },
  { id: 'avatar',     label: 'AI Avatar',   icon: '🧑‍💻' },
  { id: 'cinematic',  label: 'Cinematic',   icon: '🎥' },
  { id: 'ugc-ad',     label: 'UGC Ad',      icon: '🪝' },
  { id: 'b-roll',     label: 'B-Roll',      icon: '🎬' },
  { id: 'ai-twin',    label: 'AI Twin',     icon: '🪞' },
];

const PROVIDER_COLORS = {
  higgsfield: '#f59e0b',
  heygen:     '#3b82f6',
  openart:    '#e1306c',
  veo:        '#10b981',
  kling:      '#ef4444',
  wan:        '#4ade80',
  comfyui:    '#818cf8',
};

const stagger = { initial: {}, animate: { transition: { staggerChildren: 0.04 } } };
const fadeUp  = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0, transition: { duration: 0.22 } } };

// ── Copy util ─────────────────────────────────────────────────────────────────

function copyText(text) {
  try { navigator.clipboard.writeText(text); } catch {}
}

function downloadFile(content, filename, type = 'text/markdown') {
  const blob = new Blob([content], { type });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Provider prompt card ──────────────────────────────────────────────────────

function ProviderCard({ provider, isRecommended, isActive, onClick }) {
  const [copied, setCopied] = useState(false);
  const color = PROVIDER_COLORS[provider.providerId] || GOLD;

  function handleCopy(e) {
    e.stopPropagation();
    copyText(provider.prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <motion.div
      variants={fadeUp}
      layout
      className="rounded-sm overflow-hidden cursor-pointer transition-all"
      style={{
        background:  isActive ? `${color}08` : 'rgba(255,255,255,0.02)',
        border:      `1px solid ${isActive ? `${color}40` : 'rgba(255,255,255,0.06)'}`,
      }}
      onClick={onClick}
    >
      {/* Card header */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span style={{ fontSize: 16 }}>{provider.emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-ui text-[11px] font-bold" style={{ color: isActive ? color : '#f0ede6' }}>
              {provider.displayName}
            </span>
            {isRecommended && (
              <span className="font-mono text-[6px] px-1.5 py-0.5 rounded-sm font-semibold"
                style={{ color: EMERALD, background: `${EMERALD}15`, border: `1px solid ${EMERALD}30` }}>
                ⭐ RECOMMENDED
              </span>
            )}
            <span className="font-mono text-[6px] px-1 py-0.5 rounded-sm"
              style={{ color: '#818cf8', background: 'rgba(129,140,248,0.1)' }}>
              STAGED
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="font-mono text-[7px]"
              style={{ color: COST_COLORS[provider.costTier] || GOLD }}>
              {provider.costTier?.toUpperCase()}
            </span>
            <span className="font-mono text-[7px] text-[#4b5563] truncate">{provider.bestFor}</span>
          </div>
        </div>
        <button
          onClick={handleCopy}
          className="flex-shrink-0 px-2 py-0.5 rounded-sm font-mono text-[7px] tracking-wider transition-all"
          style={{
            background: copied ? `${EMERALD}15` : `${color}10`,
            border:     `1px solid ${copied ? `${EMERALD}30` : `${color}25`}`,
            color:      copied ? EMERALD : color,
            cursor:     'pointer',
          }}
        >
          {copied ? '✓' : '⎋'}
        </button>
      </div>

      {/* Prompt preview / full */}
      <AnimatePresence>
        {isActive && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3" style={{ borderTop: `1px solid ${color}18` }}>
              <pre
                className="font-mono text-[8px] leading-relaxed whitespace-pre-wrap mt-2 p-2 rounded-sm overflow-y-auto"
                style={{
                  color:      '#8892a4',
                  background: 'rgba(0,0,0,0.3)',
                  border:     `1px solid rgba(255,255,255,0.05)`,
                  maxHeight:  200,
                  margin:     0,
                }}
              >
                {provider.prompt}
              </pre>
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1 px-2 py-1 rounded-sm font-mono text-[8px] tracking-wider transition-all"
                  style={{ background: `${color}12`, border: `1px solid ${color}28`, color, cursor: 'pointer' }}
                >
                  {copied ? '✓ COPIED' : '⎋ COPY PROMPT'}
                </button>
                <span className="font-mono text-[7px] text-[#4b5563]">{provider.costNote}</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Collapsed prompt hint */}
      {!isActive && (
        <div className="px-3 pb-2">
          <p className="font-mono text-[7px] text-[#4b5563] truncate">
            {provider.prompt?.slice(0, 80)}…
          </p>
        </div>
      )}
    </motion.div>
  );
}

// ── Routing recommendation banner ─────────────────────────────────────────────

function RoutingBanner({ rec }) {
  if (!rec?.primary) return null;
  const color = PROVIDER_COLORS[rec.primary.providerId] || GOLD;

  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-sm"
      style={{ background: `${color}08`, border: `1px solid ${color}25` }}>
      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[8px] tracking-wider text-[#4b5563]">RECOMMENDED FOR THIS CONTENT</span>
          <span className="font-ui text-[11px] font-bold" style={{ color }}>{rec.primary.displayName}</span>
          {rec.secondary && (
            <span className="font-mono text-[8px] text-[#6b7280]">→ {rec.secondary.displayName}</span>
          )}
          {rec.tertiary && (
            <span className="font-mono text-[8px] text-[#4b5563]">→ {rec.tertiary.displayName}</span>
          )}
        </div>
        {rec.primary.reason && (
          <p className="font-mono text-[8px] text-[#6b7280] mt-0.5">{rec.primary.reason}</p>
        )}
      </div>
      {rec.note && (
        <span className="font-mono text-[7px] flex-shrink-0 text-[#4b5563]">{rec.note}</span>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function VideoRouterPromptPack({ laneId, workflowId, onClose }) {
  const [budgetMode,     setBudgetMode]     = useState('balanced');
  const [contentFormat,  setContentFormat]  = useState('short-form');
  const [pack,           setPack]           = useState(null);
  const [generating,     setGenerating]     = useState(false);
  const [error,          setError]          = useState('');
  const [activeProvider, setActiveProvider] = useState(null);
  const [downloadFlash,  setDownloadFlash]  = useState(false);

  // Load existing pack on mount
  useEffect(() => {
    if (!laneId || !workflowId) return;
    fetch(`/api/video-router/get-pack?laneId=${encodeURIComponent(laneId)}&workflowId=${encodeURIComponent(workflowId)}`)
      .then(r => r.json())
      .then(d => {
        if (d.exists && d.pack) {
          setPack(d.pack);
          setBudgetMode(d.pack.budgetMode || 'balanced');
          setContentFormat(d.pack.contentFormat || 'short-form');
          // Auto-open recommended provider
          const rec = d.pack.routingRecommendation?.primary?.providerId;
          if (rec) setActiveProvider(rec);
        }
      })
      .catch(() => {});
  }, [laneId, workflowId]);

  async function handleGenerate() {
    if (!laneId || !workflowId || generating) return;
    setGenerating(true);
    setError('');
    setPack(null);
    setActiveProvider(null);
    try {
      const res  = await fetch('/api/video-router/generate-pack', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ laneId, workflowId, budgetMode, contentFormat }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation failed');
      setPack(data);
      const rec = data.routingRecommendation?.primary?.providerId;
      if (rec) setActiveProvider(rec);
    } catch (err) {
      setError(err.message || 'Prompt pack generation failed');
    } finally {
      setGenerating(false);
    }
  }

  function handleDownload() {
    if (!pack) return;
    const md = buildDownloadMd(pack);
    downloadFile(md, 'video-router-pack.md');
    setDownloadFlash(true);
    setTimeout(() => setDownloadFlash(false), 1500);
  }

  function handleDownloadJson() {
    if (!pack) return;
    downloadFile(JSON.stringify(pack, null, 2), 'video-router-pack.json', 'application/json');
  }

  const providers = pack ? Object.values(pack.providerPrompts || {}) : [];
  const sortedProviders = [...providers].sort((a, b) => (b.recommendationScore || 0) - (a.recommendationScore || 0));

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span style={{ fontSize: 18 }}>🎬</span>
            <h3 className="font-ui text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
              Video Router Prompt Pack
            </h3>
          </div>
          <p className="font-mono text-[8px] tracking-wider" style={{ color: 'var(--text-muted)' }}>
            PROMPT PACK ONLY · NO VIDEO GENERATED · NO CREDITS SPENT
          </p>
        </div>
        {onClose && (
          <button onClick={onClose}
            className="font-mono text-[9px] text-[#4b5563] hover:text-[#8892a4] transition-colors px-2 py-1"
            style={{ cursor: 'pointer' }}>
            ✕ CLOSE
          </button>
        )}
      </div>

      {/* Governance notice */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-sm"
        style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
        <span style={{ color: CRIMSON, fontSize: 11 }}>⚠</span>
        <span className="font-mono text-[8px] text-[#8892a4]">
          No video generated. Prompt pack only. All video generation requires human approval before any provider is called.
        </span>
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-4 flex-wrap">
        {/* Budget mode */}
        <div>
          <div className="font-mono text-[7px] tracking-[0.15em] uppercase mb-1.5" style={{ color: 'var(--text-muted)' }}>
            BUDGET MODE
          </div>
          <div className="flex items-center gap-1">
            {BUDGET_OPTIONS.map(b => (
              <button
                key={b.id}
                onClick={() => setBudgetMode(b.id)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-sm font-ui text-[8px] font-semibold tracking-wider transition-all"
                style={{
                  background: budgetMode === b.id ? `${GOLD}18` : 'rgba(255,255,255,0.02)',
                  border:     `1px solid ${budgetMode === b.id ? `${GOLD}40` : 'rgba(255,255,255,0.07)'}`,
                  color:      budgetMode === b.id ? GOLD : '#6b7280',
                }}
              >
                {b.icon} {b.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content format */}
        <div>
          <div className="font-mono text-[7px] tracking-[0.15em] uppercase mb-1.5" style={{ color: 'var(--text-muted)' }}>
            CONTENT FORMAT
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {FORMAT_OPTIONS.map(f => (
              <button
                key={f.id}
                onClick={() => setContentFormat(f.id)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-sm font-ui text-[8px] font-semibold tracking-wider transition-all"
                style={{
                  background: contentFormat === f.id ? `${SAPPHIRE}18` : 'rgba(255,255,255,0.02)',
                  border:     `1px solid ${contentFormat === f.id ? `${SAPPHIRE}40` : 'rgba(255,255,255,0.07)'}`,
                  color:      contentFormat === f.id ? SAPPHIRE : '#6b7280',
                }}
              >
                {f.icon} {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Generate button */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="flex items-center gap-2 font-ui text-[10px] font-bold px-5 py-2.5 rounded-sm tracking-wider transition-all"
          style={{
            background: generating ? 'rgba(201,168,76,0.06)' : 'rgba(201,168,76,0.15)',
            border:     `1px solid ${generating ? 'rgba(201,168,76,0.2)' : 'rgba(201,168,76,0.45)'}`,
            color:      generating ? '#4b5563' : GOLD,
            cursor:     generating ? 'not-allowed' : 'pointer',
          }}
        >
          {generating ? (
            <>
              <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 0.8 }}>◈</motion.span>
              Generating Pack…
            </>
          ) : (
            `🎬 ${pack ? 'Regenerate' : 'Generate'} Prompt Pack`
          )}
        </button>

        {pack && (
          <>
            <button onClick={handleDownload}
              className="flex items-center gap-1 px-3 py-2 rounded-sm font-mono text-[8px] tracking-wider transition-all"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: downloadFlash ? EMERALD : '#8892a4', cursor: 'pointer' }}>
              {downloadFlash ? '✓ DOWNLOADED' : '↓ PACK.MD'}
            </button>
            <button onClick={handleDownloadJson}
              className="flex items-center gap-1 px-3 py-2 rounded-sm font-mono text-[8px] tracking-wider transition-all"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#8892a4', cursor: 'pointer' }}>
              ↓ PACK.JSON
            </button>
          </>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="px-3 py-2 rounded-sm font-mono text-[9px]"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: CRIMSON }}>
          {error}
        </div>
      )}

      {/* Pack output */}
      <AnimatePresence>
        {pack && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-3"
          >
            {/* Routing recommendation */}
            <RoutingBanner rec={pack.routingRecommendation} />

            {/* Pack metadata */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-mono text-[7px] text-[#4b5563]">
                Generated: {pack.generatedAt ? new Date(pack.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
              </span>
              <span className="font-mono text-[7px] text-[#4b5563]">
                {providers.length} providers
              </span>
              <span className="font-mono text-[7px] text-[#4b5563]">
                Source: video-prompt.md
              </span>
            </div>

            {/* Provider cards */}
            <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-2">
              {sortedProviders.map(provider => (
                <ProviderCard
                  key={provider.providerId}
                  provider={provider}
                  isRecommended={provider.isRecommended}
                  isActive={activeProvider === provider.providerId}
                  onClick={() => setActiveProvider(
                    activeProvider === provider.providerId ? null : provider.providerId
                  )}
                />
              ))}
            </motion.div>

            {/* Bottom governance notice */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-sm"
              style={{ background: 'rgba(201,168,76,0.04)', border: '1px solid rgba(201,168,76,0.12)' }}>
              <span style={{ color: GOLD, fontSize: 9 }}>◈</span>
              <span className="font-mono text-[7px] text-[#6b7280]">
                {pack.governanceNote}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Download helper ───────────────────────────────────────────────────────────

function buildDownloadMd(pack) {
  const rec = pack.routingRecommendation;
  const lines = [
    `# 🎬 Video Router Prompt Pack`,
    `> Generated by MIKA AGENTIC OS™ — No video generated. Prompt pack only.`,
    `> Workflow: ${pack.workflowId}`,
    `> Generated: ${pack.generatedAt}`,
    ``,
    `## ⭐ Routing Recommendation`,
    `**Format**: ${pack.contentFormat} | **Budget**: ${pack.budgetMode}`,
    `**Primary**: ${rec?.primary?.displayName || '—'} — ${rec?.primary?.reason || ''}`,
    `**Secondary**: ${rec?.secondary?.displayName || '—'}`,
    ``,
    `> ⚠️ No video generated. All providers are staged. Human approval required before activation.`,
    ``,
  ];

  for (const [id, p] of Object.entries(pack.providerPrompts || {})) {
    lines.push(`## ${p.emoji} ${p.displayName}${p.isRecommended ? ' ⭐' : ''}`);
    lines.push(`**Cost**: ${p.costTier} | ${p.costNote}`);
    lines.push(`**Best for**: ${p.bestFor}`);
    lines.push(`**Status**: ${p.status} (not connected)`);
    lines.push(``);
    lines.push('```');
    lines.push(p.prompt);
    lines.push('```');
    lines.push(``);
  }

  return lines.join('\n');
}
