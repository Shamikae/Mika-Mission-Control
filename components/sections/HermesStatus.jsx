import { motion } from 'framer-motion';
import { SectionHeader } from '../ui';

const STATUS_COLORS = {
  verified:              '#0dd3c5',
  configured_unverified: '#f59e0b',
  failed:                '#ef4444',
  not_configured:        '#4b5563',
  unknown:               '#4b5563',
};

const CAPABILITIES = [
  'Web Research',
  'Document Analysis',
  'Data Extraction',
  'Competitive Intelligence',
  'Synthesis & Summarisation',
];

export default function HermesStatus({ data }) {
  const h      = data?.hermes;
  const status = h?.status || 'unknown';
  const color  = STATUS_COLORS[status] || STATUS_COLORS.unknown;
  const statusLabel = status.replaceAll('_', ' ').toUpperCase();

  const lastChecked = h?.lastChecked
    ? new Date(h.lastChecked).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—';
  const mode = String(h?.mode || 'unknown').toUpperCase();

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <SectionHeader icon="⚡" title="Hermes Research Agent" subtitle="Research worker · agent handoff layer" />

      {/* Status card */}
      <div className="panel-gold rounded-sm p-6 relative overflow-hidden">
        <div className="absolute inset-0 scanlines pointer-events-none" />
        <div
          className="absolute -right-8 -top-8 w-48 h-48 rounded-full blur-3xl opacity-5"
          style={{ background: color }}
        />

        <div className="flex items-center gap-8">
          {/* Status ring */}
          <div className="relative flex-shrink-0">
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center"
              style={{ border: `2px solid ${color}`, boxShadow: `0 0 32px ${color}33` }}
            >
              <span className="font-mono text-[10px] font-bold text-center leading-tight px-1" style={{ color }}>
                {statusLabel}
              </span>
            </div>
            {status === 'verified' && (
              <motion.div
                animate={{ scale: [1, 1.5, 1], opacity: [0.6, 0, 0.6] }}
                transition={{ repeat: Infinity, duration: 2 }}
                className="absolute inset-0 rounded-full"
                style={{ border: `1px solid ${color}` }}
              />
            )}
          </div>

          {/* Metrics */}
          <div className="grid grid-cols-2 gap-8 flex-1">
            <div>
              <div className="font-mono text-[9px] tracking-widest text-[#4b5563] mb-1">CANONICAL MODE</div>
              <div className="font-mono text-2xl font-semibold" style={{ color: '#c9a84c' }}>{mode}</div>
            </div>
            <div>
              <div className="font-mono text-[9px] tracking-widest text-[#4b5563] mb-1">LAST CHECKED</div>
              <div className="font-mono text-sm" style={{ color: '#8892a4' }}>{lastChecked}</div>
            </div>
          </div>
        </div>

        {h?.error && (
          <div
            className="mt-5 p-3 rounded-sm"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}
          >
            <span className="font-mono text-[10px] text-[#ef4444]">{h.error}</span>
          </div>
        )}
      </div>

      {/* Agent config panel */}
      <div className="panel-gold rounded-sm p-5 space-y-4">
        <h3 className="font-ui text-xs font-semibold tracking-wider text-[#f0ede6] uppercase">Agent Configuration</h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="font-mono text-[9px] tracking-widest text-[#4b5563] mb-1">CONFIGURED</div>
            <div className="font-mono text-[11px]" style={{ color: '#a78bfa' }}>{h?.configured ? 'YES' : 'NO'}</div>
          </div>
          <div>
            <div className="font-mono text-[9px] tracking-widest text-[#4b5563] mb-1">REACHABLE</div>
            <div className="font-mono text-[11px]" style={{ color: '#8892a4' }}>
              {h?.reachable === true ? 'YES' : h?.reachable === false ? 'NO' : 'UNVERIFIED'}
            </div>
          </div>
        </div>

        {/* Capabilities */}
        <div>
          <div className="font-mono text-[9px] tracking-widest text-[#4b5563] mb-2">CAPABILITIES</div>
          <div className="flex flex-wrap gap-1.5">
            {CAPABILITIES.map(cap => (
              <span
                key={cap}
                className="font-mono text-[8px] px-2 py-0.5 rounded-sm"
                style={{ color: '#a78bfa', background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.2)' }}
              >
                {cap}
              </span>
            ))}
          </div>
        </div>

        {/* Handoff info */}
        <div
          className="p-3 rounded-sm"
          style={{ background: 'rgba(167,139,250,0.04)', border: '1px solid rgba(167,139,250,0.12)' }}
        >
          <div className="font-mono text-[9px] tracking-widest text-[#4b5563] mb-1.5">HANDOFF FLOW</div>
          <div className="flex items-center gap-2 flex-wrap">
            {['Mission Control', '→', 'Queue Approval', '→', 'Hermes Research', '→', 'OpenClaw Synthesis'].map((s, i) => (
              <span
                key={i}
                className="font-mono text-[9px]"
                style={{ color: s === '→' ? '#4b5563' : s.includes('Hermes') ? '#a78bfa' : s.includes('OpenClaw') ? '#c9a84c' : '#8892a4' }}
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
