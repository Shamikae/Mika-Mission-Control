// components/sections/OpenClawStatus.jsx
import { motion } from 'framer-motion';
import { MetricCard, AgentCard, SectionHeader, StatusBadge } from '../ui';

function GaugeBar({ label, value, color = '#c9a84c', warn = 70, crit = 90 }) {
  const c = value >= crit ? '#ef4444' : value >= warn ? '#f59e0b' : color;
  return (
    <div className="mb-3">
      <div className="flex justify-between mb-1">
        <span className="font-mono text-[9px] tracking-wider text-[#4b5563]">{label}</span>
        <span className="font-mono text-xs font-semibold" style={{ color: c }}>{value}%</span>
      </div>
      <div className="progress-bar">
        <motion.div
          className="progress-fill"
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          style={{ background: `linear-gradient(90deg, ${c}80, ${c})` }}
        />
      </div>
    </div>
  );
}

const stagger = { initial: {}, animate: { transition: { staggerChildren: 0.07 } } };
const fadeUp  = { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0, transition: { duration: 0.4 } } };

export default function OpenClawStatus({ data }) {
  const { gateway, agents } = data;

  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-6">
      <SectionHeader icon="◈" title="OpenClaw VPS" subtitle={`Gateway · ${gateway?.vpsUrl}`} />

      {/* Status hero */}
      <motion.div variants={fadeUp} className="panel-gold rounded-sm p-6 relative overflow-hidden">
        <div className="absolute inset-0 scanlines pointer-events-none" />
        <div className="absolute -right-8 -top-8 w-48 h-48 rounded-full blur-3xl opacity-5"
          style={{ background: gateway?.online ? '#0dd3c5' : '#ef4444' }} />

        <div className="flex items-center gap-6">
          {/* Big status indicator */}
          <div className="flex-shrink-0 relative">
            <div className="w-20 h-20 rounded-full flex items-center justify-center"
              style={{
                border: `2px solid ${gateway?.online ? '#0dd3c5' : '#ef4444'}`,
                boxShadow: gateway?.online ? '0 0 32px rgba(13,211,197,0.2)' : '0 0 32px rgba(239,68,68,0.2)',
              }}>
              <span className="font-mono text-xs font-bold" style={{ color: gateway?.online ? '#0dd3c5' : '#ef4444' }}>
                {gateway?.online ? 'LIVE' : 'DOWN'}
              </span>
            </div>
            {gateway?.online && (
              <motion.div
                animate={{ scale: [1, 1.5, 1], opacity: [0.6, 0, 0.6] }}
                transition={{ repeat: Infinity, duration: 2 }}
                className="absolute inset-0 rounded-full"
                style={{ border: '1px solid #0dd3c5' }}
              />
            )}
          </div>

          <div className="flex-1 grid grid-cols-4 gap-4">
            {[
              { label: 'MODE',     value: gateway?.mode,           color: '#0dd3c5' },
              { label: 'LATENCY', value: `${gateway?.latencyMs}ms`, color: '#c9a84c' },
              { label: 'UPTIME',  value: gateway?.uptime,          color: '#c9a84c' },
              { label: 'VERSION', value: `v${gateway?.version}`,   color: '#8892a4' },
            ].map(({ label, value, color }) => (
              <div key={label}>
                <div className="font-mono text-[9px] tracking-widest text-[#4b5563] mb-1">{label}</div>
                <div className="font-mono text-sm font-semibold" style={{ color }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      <div className="grid grid-cols-3 gap-4">
        {/* Resource gauges */}
        <motion.div variants={fadeUp} className="col-span-1 panel-gold rounded-sm p-4">
          <h3 className="font-ui text-xs font-semibold tracking-wider text-[#f0ede6] uppercase mb-4">VPS Resources</h3>
          <GaugeBar label="CPU USAGE"  value={gateway?.cpu}  />
          <GaugeBar label="RAM USAGE"  value={gateway?.ram}  warn={75} crit={90} />
          <GaugeBar label="DISK USAGE" value={gateway?.disk} warn={80} crit={95} />

          <div className="mt-4 grid grid-cols-2 gap-2">
            {[
              { label: 'Sessions', value: gateway?.activeSessions },
              { label: 'Queue',    value: gateway?.queueDepth    },
            ].map(({ label, value }) => (
              <div key={label} className="text-center p-2 rounded-sm" style={{ background: 'rgba(201,168,76,0.04)', border: '1px solid rgba(201,168,76,0.08)' }}>
                <div className="font-mono text-lg font-semibold text-[#c9a84c]">{value}</div>
                <div className="font-mono text-[9px] text-[#4b5563]">{label}</div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Agent roster */}
        <motion.div variants={fadeUp} className="col-span-2 panel-gold rounded-sm p-4">
          <h3 className="font-ui text-xs font-semibold tracking-wider text-[#f0ede6] uppercase mb-4">Agent Roster</h3>
          <div className="overflow-y-auto" style={{ maxHeight: 320 }}>
            {agents?.map(agent => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        </motion.div>
      </div>

      {/* Live log feed */}
      <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4">
        <h3 className="font-ui text-xs font-semibold tracking-wider text-[#f0ede6] uppercase mb-3">Gateway Log Stream</h3>
        <div className="font-mono text-[10px] space-y-1 overflow-y-auto" style={{ maxHeight: 140 }}>
          {[
            { ts: '13:41:22', level: 'INFO',  msg: '[Mika] Task complete: guest-checkin-204 · 3.2s' },
            { ts: '13:40:51', level: 'INFO',  msg: '[Diamond] Draft generated: TechCo AI Audit v1 · 8,412 tokens' },
            { ts: '13:39:10', level: 'WARN',  msg: '[CannaBot] Leafly API rate limit exceeded — retrying in 60s' },
            { ts: '13:38:44', level: 'INFO',  msg: '[Twin] Batch script job started: ai_job_week_ep7' },
            { ts: '13:37:02', level: 'INFO',  msg: '[MedBot] Appointment confirmed: Dr. Chen @ 14:30' },
            { ts: '13:36:59', level: 'INFO',  msg: '[Gateway] Health check passed · latency 42ms' },
            { ts: '13:35:31', level: 'INFO',  msg: '[Hookr] Approval requested: post_to_social · Instagram' },
            { ts: '13:34:12', level: 'INFO',  msg: '[Recovery] WhatsApp broadcast queued: 31 recipients' },
            { ts: '13:33:00', level: 'INFO',  msg: '[Gateway] Agent Sentinel heartbeat OK' },
          ].map((log, i) => (
            <div key={i} className="flex gap-3">
              <span className="text-[#4b5563] flex-shrink-0">{log.ts}</span>
              <span className={`flex-shrink-0 ${log.level === 'WARN' ? 'text-[#f59e0b]' : log.level === 'ERROR' ? 'text-[#ef4444]' : 'text-[#0dd3c5]'}`}>
                {log.level}
              </span>
              <span className="text-[#8892a4]">{log.msg}</span>
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}
