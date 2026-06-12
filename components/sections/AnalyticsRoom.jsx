// components/sections/AnalyticsRoom.jsx
// Content analytics dashboard. All data is placeholder — marked clearly.
// Wire real data here when platform APIs (TikTok, LinkedIn, YouTube) are connected.

import { motion } from 'framer-motion';

const EMERALD = '#10b981';
const GOLD    = '#c9a84c';
const CRIMSON = '#ef4444';

const stagger = { initial: {}, animate: { transition: { staggerChildren: 0.07 } } };
const fadeUp  = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0, transition: { duration: 0.3 } } };

const STUDIOS = [
  { id: 'tiktok',    label: 'TikTok',    color: '#69c9d0', views: 47200, engagement: 4.2, followers: 6800,  revenue: 1200, trend: 18  },
  { id: 'linkedin',  label: 'LinkedIn',  color: '#0a7abf', views: 12400, engagement: 3.1, followers: 2300,  revenue: 800,  trend: 8   },
  { id: 'youtube',   label: 'YouTube',   color: '#ef4444', views: 8200,  engagement: 5.8, followers: 1100,  revenue: 400,  trend: 4   },
  { id: 'pinterest', label: 'Pinterest', color: '#bd081c', views: 31000, engagement: 2.4, followers: 890,   revenue: 0,    trend: 22  },
  { id: 'blog',      label: 'Blog',      color: '#c9a84c', views: 5800,  engagement: 6.2, followers: null,  revenue: 200,  trend: 15  },
  { id: 'podcast',   label: 'Podcast',   color: '#8b5cf6', views: 0,     engagement: 0,   followers: 0,     revenue: 0,    trend: 0   },
];

const METRICS = [
  { id: 'views',      label: 'Total Views',       value: '104.6k', sub: 'across all platforms', color: EMERALD, trend: 14  },
  { id: 'engagement', label: 'Avg Engagement',    value: '4.3%',   sub: 'weighted average',     color: GOLD,    trend: 2   },
  { id: 'followers',  label: 'Total Followers',   value: '11.1k',  sub: 'all channels',          color: '#3b82f6', trend: 8 },
  { id: 'saves',      label: 'Saves + Bookmarks', value: '6.9k',   sub: 'content saved by users',color: '#818cf8', trend: 22 },
  { id: 'revenue',    label: 'Revenue Attributed', value: '$2.6k', sub: 'content-driven this month', color: EMERALD, trend: 31 },
  { id: 'conversion', label: 'Avg Conversion',    value: '1.8%',   sub: 'content → action',     color: GOLD,    trend: 5   },
];

export default function AnalyticsRoom() {
  const totalRevenue = STUDIOS.reduce((s, st) => s + st.revenue, 0);

  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-5">

      {/* Header */}
      <motion.div variants={fadeUp} className="flex items-start justify-between">
        <div>
          <h3 className="font-ui text-base font-bold mb-0.5" style={{ color: 'var(--text-primary)' }}>
            Analytics Room
          </h3>
          <p className="font-mono text-[9px] tracking-wider" style={{ color: 'var(--text-muted)' }}>
            ALL DATA IS PLACEHOLDER · CONNECT PLATFORM APIS TO GO LIVE
          </p>
        </div>
        <span
          className="font-mono text-[8px] px-2.5 py-1 rounded-sm"
          style={{ color: '#f59e0b', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)' }}
        >
          MOCK DATA
        </span>
      </motion.div>

      {/* Top metric cards */}
      <motion.div variants={fadeUp} className="grid grid-cols-3 gap-3">
        {METRICS.map((m, i) => (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className="panel-gold rounded-sm p-4 relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-16 h-16 rounded-full blur-2xl pointer-events-none"
              style={{ background: `${m.color}10` }} />
            <div className="font-mono text-[7px] tracking-[0.2em] uppercase mb-2" style={{ color: 'var(--text-muted)' }}>
              {m.label}
            </div>
            <div className="font-mono text-2xl font-bold leading-none" style={{ color: m.color }}>
              {m.value}
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>{m.sub}</span>
              <span className="font-mono text-[8px]" style={{ color: m.trend >= 0 ? EMERALD : CRIMSON }}>
                {m.trend >= 0 ? '▲' : '▼'} {Math.abs(m.trend)}%
              </span>
            </div>
          </motion.div>
        ))}
      </motion.div>

      {/* Per-studio breakdown */}
      <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4">
        <div className="font-mono text-[8px] tracking-[0.2em] uppercase mb-4" style={{ color: GOLD }}>
          PER STUDIO BREAKDOWN
        </div>
        <div className="space-y-3">
          {STUDIOS.map((s, i) => {
            const maxViews = Math.max(...STUDIOS.map(st => st.views), 1);
            return (
              <motion.div
                key={s.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.07 }}
                className="grid grid-cols-12 items-center gap-3"
              >
                <div className="col-span-2 flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
                  <span className="font-mono text-[9px] font-semibold" style={{ color: s.color }}>
                    {s.label}
                  </span>
                </div>
                <div className="col-span-4">
                  <div className="h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }}>
                    <motion.div
                      className="h-full rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${(s.views / maxViews) * 100}%` }}
                      transition={{ delay: i * 0.08 + 0.2, duration: 0.7, ease: 'easeOut' }}
                      style={{ background: s.color, opacity: 0.8 }}
                    />
                  </div>
                </div>
                <div className="col-span-2 text-right">
                  <span className="font-mono text-[9px]" style={{ color: 'var(--text-secondary)' }}>
                    {s.views > 0 ? `${(s.views / 1000).toFixed(1)}k` : '—'} views
                  </span>
                </div>
                <div className="col-span-2 text-right">
                  <span className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>
                    {s.engagement > 0 ? `${s.engagement}%` : '—'} eng
                  </span>
                </div>
                <div className="col-span-2 text-right">
                  <span className="font-mono text-[9px]" style={{ color: s.revenue > 0 ? EMERALD : 'var(--text-muted)' }}>
                    {s.revenue > 0 ? `$${s.revenue}` : '—'}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </div>
        <div className="mt-4 pt-3 border-t flex items-center justify-between"
          style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
          <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>
            TOTAL CONTENT-ATTRIBUTED REVENUE
          </span>
          <span className="font-mono text-sm font-bold" style={{ color: EMERALD }}>
            ${totalRevenue.toLocaleString()} / mo
          </span>
        </div>
      </motion.div>

      {/* Placeholder note */}
      <motion.div variants={fadeUp} className="flex items-center gap-3 px-4 py-3 rounded-sm"
        style={{ background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.15)' }}>
        <span style={{ fontSize: 16 }}>◆</span>
        <p className="font-body text-[11px]" style={{ color: 'var(--text-muted)' }}>
          Connect TikTok Business API, LinkedIn Analytics API, YouTube Data API, and Pinterest Analytics
          to replace this mock data with real-time performance tracking.
        </p>
      </motion.div>

    </motion.div>
  );
}
