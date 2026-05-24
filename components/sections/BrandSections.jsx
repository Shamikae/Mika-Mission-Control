// components/sections/BrandSections.jsx
import { motion } from 'framer-motion';
import { MetricCard, SectionHeader, StatusBadge, ProgressRing } from '../ui';

const stagger = { initial: {}, animate: { transition: { staggerChildren: 0.08 } } };
const fadeUp  = { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0, transition: { duration: 0.4 } } };

function BrandHeader({ icon, title, tagline, color, status = 'online' }) {
  return (
    <div className="flex items-center gap-4 mb-6">
      <div className="w-12 h-12 rounded-sm flex items-center justify-center text-2xl flex-shrink-0"
        style={{ background: `${color}12`, border: `1px solid ${color}30`, boxShadow: `0 0 20px ${color}10` }}>
        {icon}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-3">
          <h2 className="font-display text-xl font-semibold text-[#f0ede6]">{title}</h2>
          <StatusBadge status={status} />
        </div>
        <p className="font-mono text-[10px] text-[#4b5563] mt-0.5 tracking-wider">{tagline}</p>
      </div>
    </div>
  );
}

// ── Digital Diamond AI ─────────────────────────────────────────────
export function DigitalDiamondSection() {
  const pipeline = [
    { stage: 'LEADS',     count: 87, color: '#4b5563'  },
    { stage: 'CONTACTED', count: 42, color: '#c9a84c'  },
    { stage: 'DISCOVERY', count: 11, color: '#f59e0b'  },
    { stage: 'PROPOSAL',  count:  4, color: '#0dd3c5'  },
    { stage: 'CLOSED',    count:  2, color: '#4ade80'  },
  ];

  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-6">
      <BrandHeader icon="💎" title="Digital Diamond AI" tagline="AI CONSULTING · AUTOMATION · AGENCY" color="#c9a84c" />

      <motion.div variants={fadeUp} className="grid grid-cols-4 gap-3">
        <MetricCard label="MRR"           value="$6.2k"   sub="↑ 18% vs last month" color="#c9a84c" />
        <MetricCard label="Active Clients" value="2"      sub="+ 3 in pipeline"     color="#c9a84c" />
        <MetricCard label="Proposals Out"  value="4"      sub="$48k total value"    color="#f59e0b" />
        <MetricCard label="Avg Deal Size"  value="$9.4k"  sub="audits + impl"       color="#0dd3c5" />
      </motion.div>

      <div className="grid grid-cols-2 gap-4">
        <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4">
          <h3 className="font-ui text-xs font-semibold tracking-wider text-[#f0ede6] uppercase mb-4">Sales Pipeline</h3>
          <div className="space-y-2">
            {pipeline.map((stage, i) => (
              <div key={stage.stage} className="flex items-center gap-3">
                <span className="font-mono text-[9px] tracking-wider w-20 text-[#4b5563]">{stage.stage}</span>
                <div className="flex-1 h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <motion.div
                    className="h-full rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${(stage.count / 87) * 100}%` }}
                    transition={{ delay: i * 0.1, duration: 0.6 }}
                    style={{ background: stage.color }}
                  />
                </div>
                <span className="font-mono text-xs font-semibold w-6 text-right" style={{ color: stage.color }}>{stage.count}</span>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4">
          <h3 className="font-ui text-xs font-semibold tracking-wider text-[#f0ede6] uppercase mb-3">Active Proposals</h3>
          {[
            { client: 'TechCo Inc.',    value: '$12,500', stage: 'AI Audit + Roadmap', status: 'ready_for_review' },
            { client: 'Verde Medspas',  value: '$6,800',  stage: 'Automation Audit',   status: 'pending'          },
            { client: 'Apex Realty',    value: '$9,200',  stage: 'Full AI Stack',       status: 'pending'          },
            { client: 'NutraStar LLC',  value: '$4,500',  stage: 'AI Receptionist',     status: 'pending'          },
          ].map((p, i) => (
            <div key={i} className="flex items-center justify-between py-2.5 border-b border-[rgba(201,168,76,0.07)] last:border-0">
              <div>
                <div className="font-ui text-xs font-medium text-[#f0ede6]">{p.client}</div>
                <div className="font-mono text-[9px] text-[#4b5563]">{p.stage}</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-xs font-semibold text-[#c9a84c]">{p.value}</div>
                <StatusBadge status={p.status} />
              </div>
            </div>
          ))}
        </motion.div>
      </div>
    </motion.div>
  );
}

// ── Managed by Mika ───────────────────────────────────────────────
export function ManagedByMikaSection() {
  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-6">
      <BrandHeader icon="🤖" title="Managed by Mika" tagline="AI PROPERTY · HOSPITALITY MANAGEMENT" color="#0dd3c5" />

      <motion.div variants={fadeUp} className="grid grid-cols-4 gap-3">
        <MetricCard label="Properties"      value="3"     sub="actively managed"    color="#0dd3c5" />
        <MetricCard label="Active Guests"   value="7"     sub="checked in now"      color="#0dd3c5" />
        <MetricCard label="Tasks Today"     value="24"    sub="handled autonomously" color="#c9a84c" />
        <MetricCard label="Guest Rating"    value="4.9★"  sub="avg this month"      color="#f59e0b" />
      </motion.div>

      <div className="grid grid-cols-2 gap-4">
        <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4">
          <h3 className="font-ui text-xs font-semibold tracking-wider text-[#f0ede6] uppercase mb-3">Guest Queue</h3>
          {[
            { room: '204', guest: 'Sasha M.',  action: 'Early check-in approved',    status: 'complete' },
            { room: '311', guest: 'David K.',  action: 'Late checkout +2h granted',  status: 'complete' },
            { room: '408', guest: 'Priya S.',  action: 'Airport transfer booked',    status: 'running'  },
            { room: '510', guest: 'Carlos R.', action: 'Restaurant rec sent',        status: 'complete' },
            { room: '602', guest: 'Emma T.',   action: 'Spa booking pending',        status: 'pending'  },
          ].map((g, i) => (
            <div key={i} className="flex items-center gap-3 py-2 border-b border-[rgba(13,211,197,0.06)] last:border-0">
              <div className="w-10 h-10 rounded-sm flex items-center justify-center font-mono text-xs font-semibold flex-shrink-0"
                style={{ background: 'rgba(13,211,197,0.08)', color: '#0dd3c5', border: '1px solid rgba(13,211,197,0.2)' }}>
                {g.room}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-ui text-xs font-medium text-[#f0ede6]">{g.guest}</div>
                <div className="font-mono text-[9px] text-[#4b5563] truncate">{g.action}</div>
              </div>
              <StatusBadge status={g.status} />
            </div>
          ))}
        </motion.div>

        <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4">
          <h3 className="font-ui text-xs font-semibold tracking-wider text-[#f0ede6] uppercase mb-3">Mika Activity Log</h3>
          <div className="space-y-2 font-mono text-[10px]">
            {[
              { ts: '13:41', msg: 'Welcome WhatsApp sent → Priya (Rm 408)' },
              { ts: '13:39', msg: 'Late checkout approved → David (Rm 311)' },
              { ts: '13:37', msg: 'Airport transfer booked → Priya via Lyft API' },
              { ts: '13:34', msg: 'Maintenance ticket #44 closed — Rm 204 AC fixed' },
              { ts: '13:30', msg: 'Guest survey sent → Sasha (checkout 13:00)' },
              { ts: '13:15', msg: 'Revenue report emailed → owner@property.com' },
            ].map((log, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-[#0dd3c5] flex-shrink-0">{log.ts}</span>
                <span className="text-[#8892a4]">{log.msg}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

// ── MedAI Receptionist ─────────────────────────────────────────────
export function MedAISection({ data }) {
  const med = data?.medai;
  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-6">
      <BrandHeader icon="⚕️" title="MedAI Receptionist" tagline="AI MEDICAL FRONT-DESK · SCHEDULING AGENT" color="#818cf8" />

      <motion.div variants={fadeUp} className="grid grid-cols-4 gap-3">
        <MetricCard label="Appointments"   value={med?.todayAppointments ?? 14} sub="locked for today"    color="#818cf8" />
        <MetricCard label="Calls Handled"  value={med?.callsHandled ?? 9}       sub="0 missed"            color="#818cf8" />
        <MetricCard label="Waitlist Fills" value={med?.waitlistFilled ?? 2}     sub="from cancellations"  color="#0dd3c5" />
        <MetricCard label="Satisfaction"   value={`${med?.patientSatisfaction ?? 4.8}★`} sub="patient avg" color="#c9a84c" />
      </motion.div>

      <div className="grid grid-cols-2 gap-4">
        <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4">
          <h3 className="font-ui text-xs font-semibold tracking-wider text-[#f0ede6] uppercase mb-3">Today's Schedule (Dr. Chen)</h3>
          {[
            { time: '09:00', patient: 'Robert A.',  type: 'Annual Physical',   handled: true  },
            { time: '09:30', patient: 'Maria T.',   type: 'Follow-up',         handled: true  },
            { time: '10:00', patient: 'James L.',   type: 'New Patient Consult',handled: true },
            { time: '10:30', patient: '— OPEN —',   type: '[Waitlist slot]',   handled: false },
            { time: '11:00', patient: 'Diane K.',   type: 'Lab Review',        handled: true  },
            { time: '14:00', patient: 'Alex B.',    type: 'Telehealth',        handled: false },
          ].map((appt, i) => (
            <div key={i} className={`flex items-center gap-3 py-2 border-b border-[rgba(129,140,248,0.06)] last:border-0 ${!appt.handled ? 'opacity-50' : ''}`}>
              <span className="font-mono text-[9px] text-[#818cf8] w-12 flex-shrink-0">{appt.time}</span>
              <div className="flex-1">
                <div className="font-ui text-xs font-medium text-[#f0ede6]">{appt.patient}</div>
                <div className="font-mono text-[9px] text-[#4b5563]">{appt.type}</div>
              </div>
              {appt.handled && <span className="text-[#0dd3c5] text-sm">✓</span>}
            </div>
          ))}
        </motion.div>

        <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4">
          <h3 className="font-ui text-xs font-semibold tracking-wider text-[#f0ede6] uppercase mb-3">AI Call Handling</h3>
          <div className="space-y-2">
            {[
              { caller: '+1 (305) 244-XXXX', intent: 'Schedule new patient', outcome: 'Booked 10:00am', status: 'complete' },
              { caller: '+1 (754) 881-XXXX', intent: 'Cancel & reschedule',  outcome: 'Rescheduled → Friday', status: 'complete' },
              { caller: '+1 (561) 332-XXXX', intent: 'Insurance question',   outcome: 'Escalated to staff', status: 'paused' },
              { caller: '+1 (786) 447-XXXX', intent: 'Rx refill request',    outcome: 'Dr. notified by email', status: 'complete' },
            ].map((call, i) => (
              <div key={i} className="p-2 rounded-sm" style={{ background: 'rgba(129,140,248,0.04)', border: '1px solid rgba(129,140,248,0.1)' }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-[10px] text-[#818cf8]">{call.caller}</span>
                  <StatusBadge status={call.status} />
                </div>
                <div className="font-body text-[11px] text-[#8892a4]">{call.intent}</div>
                <div className="font-mono text-[9px] text-[#4b5563] mt-0.5">→ {call.outcome}</div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

// ── CannaOps ──────────────────────────────────────────────────────
export function CannaOpsSection({ data }) {
  const canna = data?.cannaops;
  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-6">
      <BrandHeader icon="🌿" title="CannaOps" tagline="CANNABIS DISPENSARY AUTOMATION · COMPLIANCE" color="#4ade80" />

      <motion.div variants={fadeUp} className="grid grid-cols-4 gap-3">
        <MetricCard label="Locations"    value={canna?.dispensaries ?? 3}        sub="active dispensaries"  color="#4ade80" />
        <MetricCard label="Daily Rev."   value={`$${(canna?.dailyRevenue ?? 4820).toLocaleString()}`} sub="combined est."  color="#c9a84c" />
        <MetricCard label="Compliance"   value={canna?.complianceStatus === 'green' ? 'CLEAR' : 'ACTION'} sub="regulatory status" color={canna?.complianceStatus === 'green' ? '#4ade80' : '#ef4444'} />
        <MetricCard label="Pending Regs" value={canna?.pendingRegs ?? 2}         sub="state updates queued" color="#f59e0b" />
      </motion.div>

      <div className="grid grid-cols-2 gap-4">
        <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-ui text-xs font-semibold tracking-wider text-[#f0ede6] uppercase">Inventory Sync</h3>
            <StatusBadge status={canna?.inventorySync ?? 'stale'} />
          </div>
          <div className="space-y-3">
            {(canna?.topProducts ?? []).map((p, i) => (
              <div key={i} className="flex items-center justify-between">
                <div>
                  <div className="font-ui text-xs text-[#f0ede6]">{p.name}</div>
                  <div className="font-mono text-[9px] text-[#4b5563]">SKU: {p.sku}</div>
                </div>
                <div className="text-right">
                  <div className={`font-mono text-sm font-semibold ${p.stock < 20 ? 'text-[#ef4444]' : 'text-[#4ade80]'}`}>{p.stock}</div>
                  <div className="font-mono text-[9px] text-[#4b5563]">{p.velocity} sell</div>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4">
          <h3 className="font-ui text-xs font-semibold tracking-wider text-[#f0ede6] uppercase mb-3">Location Health</h3>
          {(canna?.activeLocations ?? []).map((loc, i) => (
            <div key={i} className="flex items-center justify-between py-2 border-b border-[rgba(74,222,128,0.06)] last:border-0">
              <span className="font-ui text-xs text-[#f0ede6]">{loc}</span>
              <div className="flex items-center gap-2">
                <div className="status-dot online" />
                <span className="font-mono text-[10px] text-[#0dd3c5]">LIVE</span>
              </div>
            </div>
          ))}
          <div className="mt-3 p-2 rounded-sm text-center" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)' }}>
            <span className="font-mono text-[10px] text-[#ef4444]">⚠ LEAFLY SYNC STALE — last 5h ago</span>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

// ── Hotel Hooker ──────────────────────────────────────────────────
export function HotelHookerSection() {
  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-6">
      <BrandHeader icon="🎭" title="The Hotel Hooker" tagline="BOUTIQUE HOSPITALITY CONTENT SUPPORT" color="#f472b6" />

      <motion.div variants={fadeUp} className="grid grid-cols-4 gap-3">
        <MetricCard label="Content Pieces" value="48"   sub="published this month"  color="#f472b6" />
        <MetricCard label="Bookings"        value="12"  sub="attributed to content" color="#c9a84c" />
        <MetricCard label="Reach"           value="89k" sub="total monthly reach"   color="#f472b6" />
        <MetricCard label="IG Followers"    value="6.2k" sub="↑ 340 this month"    color="#f59e0b" />
      </motion.div>

      <div className="grid grid-cols-2 gap-4">
        <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4">
          <h3 className="font-ui text-xs font-semibold tracking-wider text-[#f0ede6] uppercase mb-3">Content Pipeline</h3>
          {[
            { piece: 'Weekend Availability — IG Stories (4)',  platform: 'Instagram', status: 'pending_approval', due: 'Today 3pm'   },
            { piece: '"Suite Life" Video Series — Ep 3',       platform: 'TikTok',   status: 'scripting',        due: 'Tomorrow'    },
            { piece: 'Brand Manifesto Reel Edit',              platform: 'Instagram', status: 'generating',       due: 'Wed'         },
            { piece: '"No Judgment Policy" Blog Post',         platform: 'Website',  status: 'complete',         due: 'Published'   },
          ].map((c, i) => (
            <div key={i} className="py-2.5 border-b border-[rgba(244,114,182,0.07)] last:border-0">
              <div className="flex items-center justify-between mb-1">
                <span className="font-ui text-xs text-[#f0ede6]">{c.piece}</span>
                <StatusBadge status={c.status} />
              </div>
              <div className="flex gap-3">
                <span className="font-mono text-[9px] text-[#f472b6]">{c.platform}</span>
                <span className="font-mono text-[9px] text-[#4b5563]">Due: {c.due}</span>
              </div>
            </div>
          ))}
        </motion.div>

        <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4">
          <h3 className="font-ui text-xs font-semibold tracking-wider text-[#f0ede6] uppercase mb-3">Brand Voice Snapshot</h3>
          <div className="space-y-2">
            {[
              { label: 'TONE',     value: 'Cheeky · Luxury · Unapologetic' },
              { label: 'AUDIENCE', value: 'Adults 28–45 · Liberated · Affluent' },
              { label: 'NEVER',    value: 'Explicit · Graphic · Judgmental' },
              { label: 'ALWAYS',   value: 'Witty · Aspirational · Clever' },
            ].map(({ label, value }) => (
              <div key={label} className="flex gap-3 py-1.5 border-b border-[rgba(244,114,182,0.06)] last:border-0">
                <span className="font-mono text-[9px] text-[#f472b6] w-18 flex-shrink-0 tracking-wider">{label}</span>
                <span className="font-body text-xs text-[#8892a4]">{value}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 p-3 rounded-sm" style={{ background: 'rgba(244,114,182,0.05)', border: '1px solid rgba(244,114,182,0.12)' }}>
            <div className="font-mono text-[9px] text-[#f472b6] mb-1">HOOKR AGENT STATUS</div>
            <div className="font-body text-xs text-[#f0ede6]">Awaiting approval on Instagram Stories batch. 1 approval required before publish.</div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

// ── AI Twin Studio ────────────────────────────────────────────────
export function AITwinSection() {
  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-6">
      <BrandHeader icon="🪞" title="AI Twin Studio" tagline="PERSONAL AI CONTENT CREATION · BRAND CLONING" color="#60a5fa" />

      <motion.div variants={fadeUp} className="grid grid-cols-4 gap-3">
        <MetricCard label="TikTok Followers" value="7.8k"   sub="↑ 420 this week"     color="#60a5fa" />
        <MetricCard label="Videos Published"  value="31"    sub="this month"           color="#60a5fa" />
        <MetricCard label="Scripts in Queue"  value="6"     sub="ready to shoot"       color="#c9a84c" />
        <MetricCard label="Avg Hook Score"    value="8.4"   sub="out of 10 / AI eval"  color="#f59e0b" />
      </motion.div>

      <div className="grid grid-cols-2 gap-4">
        <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4">
          <h3 className="font-ui text-xs font-semibold tracking-wider text-[#f0ede6] uppercase mb-3">Script Queue</h3>
          {[
            { ep: 'Ep 4', title: 'AI Does My Job — Day 1 Recap',        hookScore: 9.1, status: 'pending_approval' },
            { ep: 'Ep 5', title: 'AI Does My Job — The Scary Part',      hookScore: 8.7, status: 'pending_approval' },
            { ep: 'Ep 6', title: 'AI Does My Job — Results Are In',      hookScore: 8.3, status: 'pending_approval' },
            { ep: 'Ep 7', title: 'AI Does My Job — I Almost Fired It',   hookScore: 7.9, status: 'scripting'        },
          ].map((s, i) => (
            <div key={i} className="flex items-center gap-3 py-2.5 border-b border-[rgba(96,165,250,0.07)] last:border-0">
              <span className="font-mono text-xs text-[#60a5fa] w-8 flex-shrink-0">{s.ep}</span>
              <div className="flex-1 min-w-0">
                <div className="font-ui text-xs text-[#f0ede6] truncate">{s.title}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <StatusBadge status={s.status} />
                  <span className="font-mono text-[9px]" style={{ color: s.hookScore >= 9 ? '#4ade80' : s.hookScore >= 8 ? '#c9a84c' : '#f59e0b' }}>
                    Hook: {s.hookScore}/10
                  </span>
                </div>
              </div>
            </div>
          ))}
        </motion.div>

        <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4">
          <h3 className="font-ui text-xs font-semibold tracking-wider text-[#f0ede6] uppercase mb-3">Platform Growth</h3>
          <div className="space-y-3">
            {[
              { platform: 'TikTok',    followers: 7800, goal: 10000, color: '#60a5fa'  },
              { platform: 'Instagram', followers: 4200, goal: 10000, color: '#f472b6'  },
              { platform: 'YouTube',   followers: 892,  goal: 5000,  color: '#ef4444'  },
            ].map((p, i) => (
              <div key={p.platform}>
                <div className="flex justify-between mb-1">
                  <span className="font-mono text-[10px] tracking-wider" style={{ color: p.color }}>{p.platform}</span>
                  <span className="font-mono text-[10px] text-[#8892a4]">{p.followers.toLocaleString()} / {p.goal.toLocaleString()}</span>
                </div>
                <div className="progress-bar">
                  <motion.div
                    className="progress-fill"
                    initial={{ width: 0 }}
                    animate={{ width: `${(p.followers / p.goal) * 100}%` }}
                    transition={{ delay: i * 0.15, duration: 0.8 }}
                    style={{ background: p.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

// ── Lead Recovery ─────────────────────────────────────────────────
export function LeadRecoverySection({ data }) {
  const leads = data?.leads;
  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-6">
      <BrandHeader icon="🎯" title="Lead Recovery Workflows" tagline="MULTI-CHANNEL COLD LEAD REACTIVATION" color="#fb923c" />

      <motion.div variants={fadeUp} className="grid grid-cols-4 gap-3">
        <MetricCard label="Cold Pool"      value={leads?.totalCold ?? 156}       sub="eligible leads"      color="#fb923c" />
        <MetricCard label="Reply Rate"     value={`${((leads?.replied ?? 31) / (leads?.contacted ?? 89) * 100).toFixed(0)}%`} sub={`${leads?.replied ?? 31} of ${leads?.contacted ?? 89}`} color="#c9a84c" />
        <MetricCard label="Calls Booked"   value={leads?.booked ?? 12}           sub="from recovery"       color="#0dd3c5" />
        <MetricCard label="Rev. Recovered" value={`$${(leads?.revenueRecover ?? 8400).toLocaleString()}`} sub="from reactivation" color="#c9a84c" />
      </motion.div>

      <div className="grid grid-cols-2 gap-4">
        <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4">
          <h3 className="font-ui text-xs font-semibold tracking-wider text-[#f0ede6] uppercase mb-3">Channel Performance</h3>
          {(leads?.channels ?? []).map((ch, i) => (
            <div key={ch.name} className="py-3 border-b border-[rgba(251,146,60,0.07)] last:border-0">
              <div className="flex justify-between mb-1.5">
                <span className="font-ui text-xs text-[#f0ede6]">{ch.name}</span>
                <span className="font-mono text-xs font-semibold text-[#fb923c]">{ch.rate}% reply</span>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <div className="progress-bar">
                    <motion.div
                      className="progress-fill"
                      initial={{ width: 0 }}
                      animate={{ width: `${(ch.sent / (leads?.totalCold ?? 156)) * 100}%` }}
                      transition={{ delay: i * 0.1, duration: 0.7 }}
                      style={{ background: 'rgba(251,146,60,0.4)' }}
                    />
                  </div>
                  <div className="font-mono text-[9px] text-[#4b5563] mt-1">Sent: {ch.sent}</div>
                </div>
                <div className="flex-1">
                  <div className="progress-bar">
                    <motion.div
                      className="progress-fill"
                      initial={{ width: 0 }}
                      animate={{ width: `${(ch.replied / ch.sent) * 100}%` }}
                      transition={{ delay: i * 0.1 + 0.1, duration: 0.7 }}
                      style={{ background: '#fb923c' }}
                    />
                  </div>
                  <div className="font-mono text-[9px] text-[#4b5563] mt-1">Replied: {ch.replied}</div>
                </div>
              </div>
            </div>
          ))}
        </motion.div>

        <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4">
          <h3 className="font-ui text-xs font-semibold tracking-wider text-[#f0ede6] uppercase mb-3">Recovery Funnel</h3>
          <div className="space-y-2">
            {[
              { label: 'Cold Pool',  n: 156, w: '100%', color: '#4b5563' },
              { label: 'Contacted', n: 89,  w: '57%',  color: '#fb923c' },
              { label: 'Replied',   n: 31,  w: '35%',  color: '#f59e0b' },
              { label: 'Booked',    n: 12,  w: '14%',  color: '#0dd3c5' },
              { label: 'Converted', n: 4,   w: '5%',   color: '#4ade80' },
            ].map((s, i) => (
              <div key={s.label} className="flex items-center gap-3">
                <span className="font-mono text-[9px] w-18 text-[#4b5563] flex-shrink-0">{s.label}</span>
                <div className="flex-1 h-6 flex items-center" style={{ paddingLeft: `${i * 8}%` }}>
                  <motion.div
                    className="h-full rounded-sm flex items-center px-2"
                    initial={{ width: 0 }}
                    animate={{ width: s.w }}
                    transition={{ delay: i * 0.1, duration: 0.6 }}
                    style={{ background: s.color, opacity: 0.7, minWidth: 32 }}
                  >
                    <span className="font-mono text-[9px] font-semibold text-[#07090f]">{s.n}</span>
                  </motion.div>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
