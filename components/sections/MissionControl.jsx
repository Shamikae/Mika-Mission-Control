// components/sections/MissionControl.jsx
import { motion } from 'framer-motion';
import { MetricCard, AgentCard, StatusBadge, SectionHeader, GoldDivider } from '../ui';
import { format, parseISO } from 'date-fns';

const stagger = {
  initial: {},
  animate: { transition: { staggerChildren: 0.07 } },
};

const fadeUp = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.4 } },
};

const MISSION_STATUS_COLOR = {
  done:    '#0dd3c5',
  running: '#c9a84c',
  pending: '#4b5563',
};

const OPENCLAW_STATUS_META = {
  LIVE: { color: '#0dd3c5', label: 'LIVE' },
  DEGRADED: { color: '#f59e0b', label: 'DEGRADED' },
  OFFLINE: { color: '#ef4444', label: 'OFFLINE' },
};

const PROJECT_COLORS = {
  'digital-diamond': '#c9a84c',
  'managed-by-mika': '#0dd3c5',
  'medai':           '#818cf8',
  'cannaops':        '#4ade80',
  'hotel-hooker':    '#f472b6',
  'ai-twin':         '#60a5fa',
  'lead-recovery':   '#fb923c',
};

export default function MissionControl({ data }) {
  const { gateway, openclaw, agents, approvals, queue, outputs, metrics } = data;

  const doneTasks    = queue?.filter(q => q.status === 'done').length    ?? 0;
  const runningTasks = queue?.filter(q => q.status === 'running').length ?? 0;
  const totalTasks   = queue?.length ?? 0;
  const totalTokens  = agents?.reduce((s, a) => s + a.tokens, 0) ?? 0;
  const weekRevenue  = metrics?.reduce((s, m) => s + m.revenue, 0) ?? 0;
  const openclawMeta = OPENCLAW_STATUS_META[openclaw?.status] || OPENCLAW_STATUS_META.OFFLINE;

  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-6">

      {/* Headline metrics */}
      <motion.div variants={fadeUp} className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label="Active Agents"
          value={agents?.filter(a => a.status === 'running').length ?? 0}
          sub={`of ${agents?.length ?? 0} deployed`}
          color="#0dd3c5"
          icon="⬡"
        />
        <MetricCard
          label="Pending Approvals"
          value={approvals?.length ?? 0}
          sub="require your action"
          color={approvals?.length > 0 ? '#ef4444' : '#0dd3c5'}
          icon="✉"
        />
        <MetricCard
          label="Queue Progress"
          value={`${doneTasks}/${totalTasks}`}
          sub={`${runningTasks} currently running`}
          color="#c9a84c"
          icon="◭"
        />
        <MetricCard
          label="Week Revenue"
          value={`$${(weekRevenue / 1000).toFixed(1)}k`}
          sub="across all brands"
          color="#c9a84c"
          icon="◆"
          trend={12}
        />
      </motion.div>

      {/* OpenClaw live connection */}
      <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div
                className="w-2 h-2 rounded-full"
                style={{ background: openclawMeta.color, boxShadow: `0 0 8px ${openclawMeta.color}` }}
              />
              <h3 className="font-ui text-xs font-semibold tracking-wider text-[#f0ede6] uppercase">
                OpenClaw VPS
              </h3>
            </div>
            <p className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {openclaw?.source === 'mock' ? 'MOCK FALLBACK · ADD OPENCLAW_GATEWAY_URL' : 'SERVER-SIDE STATUS PROXY'}
            </p>
          </div>

          <div className="text-right">
            <div className="font-mono text-lg font-bold" style={{ color: openclawMeta.color }}>
              {openclawMeta.label}
            </div>
            <div className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>
              {openclaw?.latencyMs ?? '—'}ms
            </div>
          </div>
        </div>

        <GoldDivider className="my-3" />

        <div className="grid grid-cols-3 gap-3">
          <div>
            <div className="font-mono text-[8px] tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>LAST CHECKED</div>
            <div className="font-mono text-[10px]" style={{ color: 'var(--text-secondary)' }}>
              {openclaw?.lastChecked ? format(parseISO(openclaw.lastChecked), 'HH:mm:ss') : '—'}
            </div>
          </div>
          <div>
            <div className="font-mono text-[8px] tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>SOURCE</div>
            <div className="font-mono text-[10px]" style={{ color: 'var(--text-secondary)' }}>
              {openclaw?.source || '—'}
            </div>
          </div>
          <div>
            <div className="font-mono text-[8px] tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>ERROR</div>
            <div className="font-mono text-[10px] truncate" style={{ color: openclaw?.error ? '#ef4444' : 'var(--text-secondary)' }}>
              {openclaw?.error || 'None'}
            </div>
          </div>
        </div>
      </motion.div>

      {/* Main grid */}
      <div className="grid grid-cols-3 gap-4">

        {/* Mission Queue */}
        <motion.div variants={fadeUp} className="col-span-1 panel-gold rounded-sm p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-ui text-xs font-semibold tracking-wider text-[#f0ede6] uppercase">Daily Mission Queue</h3>
            <span className="font-mono text-[9px] text-[#4b5563]">{new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
          </div>

          <div className="space-y-1">
            {queue?.map((item, i) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="flex items-center gap-2 py-1.5 group"
              >
                <span className="font-mono text-[9px] text-[#4b5563] w-10 flex-shrink-0">{item.time}</span>
                <div
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{
                    background: MISSION_STATUS_COLOR[item.status] || '#4b5563',
                    boxShadow: item.status === 'running' ? `0 0 6px ${MISSION_STATUS_COLOR.running}` : undefined,
                  }}
                />
                <span className={`font-body text-xs flex-1 ${item.status === 'done' ? 'line-through text-[#4b5563]' : item.status === 'running' ? 'text-[#f0ede6]' : 'text-[#8892a4]'}`}>
                  {item.label}
                </span>
                {item.project && (
                  <div className="w-1 h-4 rounded-full flex-shrink-0"
                    style={{ background: PROJECT_COLORS[item.project] || '#4b5563', opacity: 0.6 }} />
                )}
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Active Agents */}
        <motion.div variants={fadeUp} className="col-span-1 panel-gold rounded-sm p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-ui text-xs font-semibold tracking-wider text-[#f0ede6] uppercase">Active Agents</h3>
            <span className="font-mono text-[9px] text-[#0dd3c5]">
              {agents?.filter(a => a.status === 'running').length} LIVE
            </span>
          </div>
          <div className="space-y-0 overflow-y-auto" style={{ maxHeight: 280 }}>
            {agents?.map(agent => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        </motion.div>

        {/* Latest Outputs */}
        <motion.div variants={fadeUp} className="col-span-1 panel-gold rounded-sm p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-ui text-xs font-semibold tracking-wider text-[#f0ede6] uppercase">Latest Outputs</h3>
            <span className="font-mono text-[9px] text-[#4b5563]">RECENT</span>
          </div>
          <div className="space-y-3 overflow-y-auto" style={{ maxHeight: 280 }}>
            {outputs?.map((out, i) => (
              <motion.div
                key={out.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.1 }}
                className="border-b border-[rgba(201,168,76,0.07)] pb-3 last:border-0 last:pb-0"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-ui text-xs font-medium text-[#f0ede6] truncate flex-1 mr-2">{out.title}</span>
                  <StatusBadge status={out.status} />
                </div>
                <p className="font-body text-[11px] text-[#4b5563] leading-relaxed line-clamp-2">{out.preview}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="font-mono text-[9px] text-[#c9a84c]">{out.agent}</span>
                  <span className="font-mono text-[9px] text-[#4b5563]">
                    {format(parseISO(out.ts), 'HH:mm')}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Weekly sparkline bar chart */}
      <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-ui text-xs font-semibold tracking-wider text-[#f0ede6] uppercase">Week at a Glance</h3>
          <div className="flex gap-4">
            {[{ label: 'Tasks', color: '#c9a84c' }, { label: 'Approvals', color: '#0dd3c5' }].map(l => (
              <div key={l.label} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-sm" style={{ background: l.color }} />
                <span className="font-mono text-[9px] text-[#4b5563]">{l.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-end gap-2 h-16">
          {metrics?.map((m, i) => {
            const maxTasks = Math.max(...(metrics?.map(x => x.tasks) || [1]));
            const maxApp   = Math.max(...(metrics?.map(x => x.approvals) || [1]));
            return (
              <div key={m.day} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex items-end justify-center gap-0.5" style={{ height: 48 }}>
                  <motion.div
                    className="flex-1 rounded-t-sm"
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: 1 }}
                    transition={{ delay: i * 0.06, duration: 0.4, ease: 'easeOut' }}
                    style={{
                      height: `${(m.tasks / maxTasks) * 100}%`,
                      background: 'linear-gradient(180deg, #c9a84c, #8a6e28)',
                      opacity: 0.8,
                      transformOrigin: 'bottom',
                    }}
                  />
                  <motion.div
                    className="flex-1 rounded-t-sm"
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: 1 }}
                    transition={{ delay: i * 0.06 + 0.03, duration: 0.4, ease: 'easeOut' }}
                    style={{
                      height: `${(m.approvals / maxApp) * 100}%`,
                      background: 'linear-gradient(180deg, #0dd3c5, #0aa898)',
                      opacity: 0.7,
                      transformOrigin: 'bottom',
                    }}
                  />
                </div>
                <span className="font-mono text-[9px] text-[#4b5563]">{m.day}</span>
              </div>
            );
          })}
        </div>
      </motion.div>

    </motion.div>
  );
}
