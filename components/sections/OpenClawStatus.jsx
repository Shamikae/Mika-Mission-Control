// components/sections/OpenClawStatus.jsx — Phase 1: live status card only
import { motion } from 'framer-motion';
import { SectionHeader } from '../ui';

const STATUS_COLORS = {
  LIVE:     '#0dd3c5',
  DEGRADED: '#f59e0b',
  OFFLINE:  '#ef4444',
  DISABLED: '#4b5563',
  UNKNOWN:  '#64748b',
};

export default function OpenClawStatus({ data }) {
  const oc = data?.openclaw;
  const status = oc?.source === 'mock' ? 'UNKNOWN' : (oc?.status || 'OFFLINE');
  const color = STATUS_COLORS[status] || STATUS_COLORS.OFFLINE;

  const latency = oc?.latencyMs != null ? `${oc.latencyMs}ms` : '—';
  const lastChecked = oc?.lastChecked
    ? new Date(oc.lastChecked).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—';

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <SectionHeader icon="◈" title="OpenClaw Gateway" subtitle="SSH tunnel · 127.0.0.1:28789" />

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
              <span className="font-mono text-xs font-bold" style={{ color }}>{status}</span>
            </div>
            {status === 'LIVE' && oc?.source !== 'mock' && (
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
              <div className="font-mono text-[9px] tracking-widest text-[#4b5563] mb-1">LATENCY</div>
              <div className="font-mono text-2xl font-semibold" style={{ color: '#c9a84c' }}>{latency}</div>
            </div>
            <div>
              <div className="font-mono text-[9px] tracking-widest text-[#4b5563] mb-1">LAST CHECKED</div>
              <div className="font-mono text-sm" style={{ color: '#8892a4' }}>{lastChecked}</div>
            </div>
          </div>
        </div>

        {oc?.error && (
          <div
            className="mt-5 p-3 rounded-sm"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}
          >
            <span className="font-mono text-[10px] text-[#ef4444]">{oc.error}</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
