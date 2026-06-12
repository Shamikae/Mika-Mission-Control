import { useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import { SectionHeader } from '../ui';

const ForceGraph2D = dynamic(
  () => import('react-force-graph').then(m => m.ForceGraph2D),
  { ssr: false, loading: () => <GraphLoading /> }
);

// ─── Palette ──────────────────────────────────────────────────────────────────

const GROUP_COLORS = {
  root:        '#c9a84c',
  tag:         '#0dd3c5',
  unlinked:    '#374151',
  Journal:     '#818cf8',
  Chats:       '#60a5fa',
  Goals:       '#4ade80',
  Research:    '#f472b6',
  Tasks:       '#fb923c',
  Memory:      '#a78bfa',
  'Memory Vault': '#a78bfa',
};

function groupColor(group) {
  return GROUP_COLORS[group] || '#8892a4';
}

// ─── Loading placeholder ──────────────────────────────────────────────────────

function GraphLoading() {
  return (
    <div className="flex items-center justify-center" style={{ height: 540 }}>
      <motion.div
        animate={{ opacity: [0.3, 1, 0.3] }}
        transition={{ repeat: Infinity, duration: 1.4 }}
        className="font-mono text-[11px]"
        style={{ color: '#c9a84c' }}
      >
        initialising graph...
      </motion.div>
    </div>
  );
}

// ─── Node detail panel ────────────────────────────────────────────────────────

function NodeDetail({ node, onClose }) {
  if (!node) return null;

  const color = node.color || groupColor(node.group) || '#c9a84c';

  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12 }}
      transition={{ duration: 0.18 }}
      className="panel-gold rounded-sm flex-shrink-0"
      style={{ width: 220, alignSelf: 'flex-start', position: 'sticky', top: 0 }}
    >
      <div className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
            <span className="font-ui text-xs font-semibold text-[#f0ede6] leading-tight">{node.name}</span>
          </div>
          <button
            onClick={onClose}
            className="font-mono text-[10px] text-[#4b5563] flex-shrink-0"
            style={{ cursor: 'pointer', background: 'none', border: 'none' }}
          >✕</button>
        </div>

        {/* Type badge */}
        <div className="flex gap-1.5 flex-wrap">
          {node.type && (
            <span
              className="font-mono text-[8px] px-1.5 py-0.5 rounded-sm tracking-wider"
              style={{ background: `${color}15`, border: `1px solid ${color}30`, color }}
            >
              {node.type.toUpperCase()}
            </span>
          )}
          {node.group && !node.type && (
            <span className="font-mono text-[8px] px-1.5 py-0.5 rounded-sm tracking-wider"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#4b5563' }}>
              {node.group}
            </span>
          )}
          {node.systemType && (
            <span className="font-mono text-[8px] px-1.5 py-0.5 rounded-sm tracking-wider"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#4b5563' }}>
              {node.systemType}
            </span>
          )}
        </div>

        {/* Description */}
        {node.description && (
          <p className="font-body text-[10px] leading-relaxed" style={{ color: '#8892a4' }}>
            {node.description}
          </p>
        )}

        {/* Model */}
        {node.model && (
          <div>
            <div className="font-mono text-[8px] tracking-widest text-[#4b5563] mb-1">MODEL</div>
            <div className="font-mono text-[9px]" style={{ color: '#8892a4' }}>{node.model}</div>
          </div>
        )}

        {/* Capabilities */}
        {node.capabilities?.length > 0 && (
          <div>
            <div className="font-mono text-[8px] tracking-widest text-[#4b5563] mb-1.5">CAPABILITIES</div>
            <div className="flex flex-wrap gap-1">
              {node.capabilities.map(c => (
                <span key={c}
                  className="font-mono text-[7px] px-1.5 py-0.5 rounded-sm"
                  style={{ background: `${color}10`, border: `1px solid ${color}25`, color: '#8892a4' }}
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Schedule */}
        {node.schedule && (
          <div>
            <div className="font-mono text-[8px] tracking-widest text-[#4b5563] mb-1">SCHEDULE</div>
            <div className="font-mono text-[9px]" style={{ color: '#8892a4' }}>{node.schedule}</div>
          </div>
        )}

      </div>
    </motion.div>
  );
}

// ─── Graph wrapper — handles sizing + renders ForceGraph2D ────────────────────

function GraphCanvas({ data, onNodeClick, selectedId }) {
  const containerRef = useRef(null);
  const [dims, setDims]   = useState({ w: 800, h: 540 });
  const fgRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        setDims({ w: Math.floor(e.contentRect.width), h: 540 });
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Center on first load — guard against version differences in the ref API
  useEffect(() => {
    if (!fgRef.current || !data.nodes.length) return;
    setTimeout(() => {
      const fg = fgRef.current;
      if (fg && typeof fg.zoomToFit === 'function') fg.zoomToFit(400, 60);
    }, 400);
  }, [data]);

  const nodeColor = useCallback((node) => {
    if (node.id === selectedId) return '#ffffff';
    return node.color || groupColor(node.group) || '#c9a84c';
  }, [selectedId]);

  const nodeCanvasObject = useCallback((node, ctx, globalScale) => {
    const isSelected = node.id === selectedId;
    const color      = node.color || groupColor(node.group) || '#c9a84c';
    const r          = Math.sqrt(Math.max(0, node.val || 3)) * 2.2;

    // Glow
    if (isSelected) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 4, 0, 2 * Math.PI);
      ctx.fillStyle = `${color}30`;
      ctx.fill();
    }

    // Circle
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
    ctx.fillStyle = isSelected ? '#ffffff' : color;
    ctx.shadowColor = color;
    ctx.shadowBlur  = isSelected ? 18 : 6;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Label (only when zoomed in enough)
    if (globalScale >= 0.9) {
      const label    = node.name.length > 20 ? node.name.slice(0, 18) + '…' : node.name;
      const fontSize = Math.max(8, 10 / globalScale);
      ctx.font      = `${fontSize}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = isSelected ? '#ffffff' : 'rgba(240,237,230,0.75)';
      ctx.fillText(label, node.x, node.y + r + 2);
    }
  }, [selectedId]);

  const linkColor = useCallback((link) => {
    return link.color || 'rgba(201,168,76,0.12)';
  }, []);

  if (!data.nodes.length) {
    return (
      <div className="flex items-center justify-center" style={{ height: 540 }}>
        <p className="font-mono text-[10px] text-[#4b5563] text-center">
          No graph data yet.<br />
          <span className="text-[8px]">Add markdown files with [[wiki links]] to populate this view.</span>
        </p>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ width: '100%', height: 540, overflow: 'hidden' }}>
      <ForceGraph2D
        ref={fgRef}
        graphData={data}
        width={dims.w}
        height={dims.h}
        backgroundColor="#07090f"
        nodeAutoColorBy="group"
        nodeColor={nodeColor}
        nodeVal={node => node.val || 3}
        nodeLabel={node => node.name}
        nodeCanvasObject={nodeCanvasObject}
        nodeCanvasObjectMode={() => 'replace'}
        linkColor={linkColor}
        linkWidth={1}
        linkDirectionalParticles={2}
        linkDirectionalParticleWidth={1.2}
        linkDirectionalParticleColor={linkColor}
        onNodeClick={onNodeClick}
        cooldownTicks={120}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
      />
    </div>
  );
}

// ─── Main section ─────────────────────────────────────────────────────────────

const stagger = { initial: {}, animate: { transition: { staggerChildren: 0.06 } } };
const fadeUp  = { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0, transition: { duration: 0.35 } } };

const TABS = ['AGENTS', 'VAULT'];

export default function ObsidianGraph({ defaultTab = 'AGENTS' }) {
  const [activeTab, setActiveTab] = useState(defaultTab);
  const [agentData, setAgentData] = useState({ nodes: [], links: [] });
  const [vaultData, setVaultData] = useState({ nodes: [], links: [] });
  const [vaultMeta, setVaultMeta] = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [selected, setSelected]   = useState(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch('/api/agents/graph').then(r => r.json()).catch(() => ({ nodes: [], links: [] })),
      fetch('/api/vault/graph').then(r => r.json()).catch(() => ({ nodes: [], links: [] })),
    ]).then(([ag, vg]) => {
      setAgentData(ag);
      setVaultData(vg);
      setVaultMeta({ fileCount: vg.fileCount, warn: vg.warn });
      setLoading(false);
    }).catch(err => {
      setError(err.message);
      setLoading(false);
    });
  }, []);

  const currentData = activeTab === 'AGENTS' ? agentData : vaultData;

  const handleNodeClick = useCallback((node) => {
    setSelected(prev => prev?.id === node.id ? null : node);
  }, []);

  const stats = activeTab === 'AGENTS'
    ? `${agentData.nodes.length} nodes · ${agentData.links.length} edges`
    : vaultMeta?.warn
      ? 'Vault unavailable or not configured'
      : `${vaultData.nodes.filter(n => !n.isTag).length} notes · ${vaultData.nodes.filter(n => n.isTag).length} tags · ${vaultData.links.length} links`;

  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-6">
      <SectionHeader icon="◎" title="Knowledge Graph" subtitle="Agent topology and vault connections" />

      {error && (
        <div className="px-4 py-2 rounded-sm font-mono text-[10px]"
          style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444' }}>
          {error}
        </div>
      )}

      <motion.div variants={fadeUp} className="panel-gold rounded-sm overflow-hidden">

        {/* ── Tab bar ── */}
        <div className="flex items-center justify-between px-4 py-2.5"
          style={{ borderBottom: '1px solid rgba(201,168,76,0.1)' }}>
          <div className="flex gap-1">
            {TABS.map(tab => (
              <button
                key={tab}
                onClick={() => { setActiveTab(tab); setSelected(null); }}
                className="px-3 py-1 rounded-sm font-mono text-[9px] tracking-wider transition-all"
                style={activeTab === tab ? {
                  background: 'rgba(201,168,76,0.12)',
                  border:     '1px solid rgba(201,168,76,0.3)',
                  color:      '#c9a84c',
                } : {
                  background: 'transparent',
                  border:     '1px solid transparent',
                  color:      '#4b5563',
                  cursor:     'pointer',
                }}
              >
                {tab}
              </button>
            ))}
          </div>
          <span className="font-mono text-[8px] text-[#4b5563]">{loading ? 'loading...' : stats}</span>
        </div>

        {/* ── Graph + detail panel ── */}
        <div className="flex gap-0" style={{ background: '#07090f' }}>
          {/* Graph canvas */}
          <div className="flex-1 min-w-0">
            {loading ? <GraphLoading /> : (
              <GraphCanvas
                data={currentData}
                onNodeClick={handleNodeClick}
                selectedId={selected?.id}
              />
            )}
          </div>

          {/* Detail panel */}
          <AnimatePresence>
            {selected && (
              <div className="flex-shrink-0 border-l" style={{ borderColor: 'rgba(201,168,76,0.1)' }}>
                <NodeDetail
                  node={selected}
                  onClose={() => setSelected(null)}
                />
              </div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Legend ── */}
        <div className="px-4 py-2 flex items-center gap-4 flex-wrap"
          style={{ borderTop: '1px solid rgba(201,168,76,0.07)' }}>
          {activeTab === 'AGENTS' ? (
            <>
              <LegendDot color="#c9a84c" label="Orchestrator" />
              <LegendDot color="#a78bfa" label="Research" />
              <LegendDot color="#0dd3c5" label="Operations" />
              <LegendDot color="#818cf8" label="Medical" />
              <span className="font-mono text-[8px] text-[#4b5563] ml-auto">click a node for details</span>
            </>
          ) : (
            <>
              <LegendDot color="#c9a84c" label="Root" />
              <LegendDot color="#0dd3c5" label="Tags" />
              <LegendDot color="#818cf8" label="Journal" />
              <LegendDot color="#60a5fa" label="Chats" />
              <span className="font-mono text-[8px] text-[#4b5563] ml-auto">configured Obsidian context</span>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function LegendDot({ color, label }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      <span className="font-mono text-[8px] text-[#4b5563]">{label}</span>
    </div>
  );
}
