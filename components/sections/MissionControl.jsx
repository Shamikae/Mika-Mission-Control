import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  FiActivity,
  FiAlertCircle,
  FiArrowUpRight,
  FiBookOpen,
  FiCheckSquare,
  FiClock,
  FiCode,
  FiCpu,
  FiDatabase,
  FiDownload,
  FiFilm,
  FiInbox,
  FiLayers,
  FiMessageSquare,
  FiPackage,
  FiRadio,
  FiSend,
  FiTarget,
} from 'react-icons/fi';
import { useStore } from '../../lib/store';
import { AGENT_AVATARS } from '../../lib/agent-avatars';
import ArtifactGallery from '../ui/ArtifactGallery';
import MissionVoiceNav from './MissionVoiceNav';

const fadeUp = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

function SectionLead({ numeral, label }) {
  return (
    <div className="agent-os-section-lead">
      <span>{numeral}</span>
      <i />
      <strong>{label}</strong>
    </div>
  );
}

function StatusCard({ icon: Icon, label, value, detail, state = 'unknown' }) {
  return (
    <motion.div variants={fadeUp} className="mission-status-card">
      <div className="mission-status-head">
        <Icon size={15} />
        <span className={`mika-neutral-dot ${state}`} />
      </div>
      <strong>{label}</strong>
      <div className="mission-status-value">{value}</div>
      <p>{detail}</p>
    </motion.div>
  );
}

function PortalCard({ icon, title, description, meta, onClick }) {
  return (
    <motion.button variants={fadeUp} className="mission-portal-card" onClick={onClick}>
      <div className="mission-portal-head">
        <span className="mission-portal-icon">{icon}</span>
        <FiArrowUpRight size={14} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      <span className="mission-portal-meta">{meta}</span>
    </motion.button>
  );
}

function AgentIcon({ id, fallback }) {
  const avatar = AGENT_AVATARS[id];
  return (
    <span
      className="mission-agent-avatar"
      style={{ background: avatar?.gradient || 'linear-gradient(135deg,#334155,#0f172a)' }}
    >
      {avatar?.initials || fallback}
    </span>
  );
}

function formatTime(value) {
  if (!value) return 'Unknown time';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function MissionControl({ data }) {
  const { setActiveSection } = useStore();
  const [contentMetrics, setContentMetrics] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/orchestration/overview', { cache: 'no-store' })
      .then(res => res.ok ? res.json() : null)
      .then(json => { if (!cancelled && json?.ok) setContentMetrics(json.metrics); })
      .catch(() => { /* Content Division metrics are best-effort — never block Mission Control on this */ });
    return () => { cancelled = true; };
  }, []);

  const {
    gateway,
    openclaw,
    hermes,
    approvals = [],
    outputs = [],
    tasks = [],
    memory = [],
  } = data;

  const gatewayVerified = gateway?.online === true && openclaw?.source !== 'mock';
  const openClawVerified = openclaw?.source !== 'mock' && openclaw?.status === 'LIVE';
  const hermesVerified = hermes?.verified === true && hermes?.reachable === true;
  const hermesStatus = hermes?.status || 'unknown';
  const hermesLabel = {
    verified: 'Verified',
    configured_unverified: 'Configured',
    not_configured: 'Not configured',
    failed: 'Failed',
    unknown: 'Unknown',
  }[hermesStatus] || 'Unknown';
  const hermesDetail = hermesVerified
    ? `${String(hermes?.mode || 'unknown').toUpperCase()} connection verified`
    : hermesStatus === 'configured_unverified'
      ? `${String(hermes?.mode || 'unknown').toUpperCase()} configured; runtime not yet verified`
      : hermesStatus === 'not_configured'
        ? 'No complete Hermes connection mode configured'
        : hermesStatus === 'failed'
          ? 'Last Hermes connection check failed'
          : 'No Hermes runtime evidence';
  const hermesState = hermesVerified
    ? 'verified'
    : hermesStatus === 'configured_unverified'
      ? 'staged'
      : 'unknown';
  const latency = gatewayVerified && gateway?.latencyMs != null ? `${gateway.latencyMs}ms` : 'Unknown';

  const activity = [
    ...outputs.map(item => ({
      id: `output-${item.id}`,
      title: item.title || 'Artifact created',
      detail: item.preview || item.agent || 'Output recorded by Mika',
      status: item.status || 'unknown',
      time: item.ts,
    })),
    ...tasks.map(item => ({
      id: `task-${item.id}`,
      title: item.description || 'Queued work updated',
      detail: item.lane || 'Mika task queue',
      status: item.status || 'unknown',
      time: item.updatedAt || item.createdAt || item.ts,
    })),
  ]
    .sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0))
    .slice(0, 8);

  const pendingTaskCount = tasks.filter(task => !['complete', 'done'].includes(task.status)).length;

  return (
    <motion.div initial="initial" animate="animate" className="agent-os-overview">
      <MissionVoiceNav />
      <section>
        <SectionLead numeral="I." label="Mission Control · status of every agent, every memory, every signal" />
        <div className="mission-status-grid">
          <StatusCard
            icon={FiCode}
            label="Claude"
            value="Staged"
            detail="Adapter registered; direct workspace not activated"
            state="staged"
          />
          <StatusCard
            icon={FiRadio}
            label="OpenClaw"
            value={openClawVerified ? 'Verified' : 'Unknown'}
            detail={openClawVerified ? 'Gateway connection verified' : 'No verified live connection'}
            state={openClawVerified ? 'verified' : 'unknown'}
          />
          <StatusCard
            icon={FiMessageSquare}
            label="Hermes"
            value={hermesLabel}
            detail={hermesDetail}
            state={hermesState}
          />
          <StatusCard
            icon={FiActivity}
            label="Heartbeat"
            value={gatewayVerified ? 'Verified' : 'Unknown'}
            detail={gatewayVerified ? 'Mika gateway is responding' : 'Heartbeat not verified'}
            state={gatewayVerified ? 'verified' : 'unknown'}
          />
          <StatusCard
            icon={FiClock}
            label="Latency"
            value={latency}
            detail={gatewayVerified ? 'Reported gateway response time' : 'No verified latency sample'}
            state={gatewayVerified ? 'verified' : 'unknown'}
          />
          <StatusCard
            icon={FiCpu}
            label="Free Claude Code"
            value="Staged"
            detail="Approved destination; connection pending"
            state="staged"
          />
        </div>
      </section>

      <div className="agent-os-divider"><span /><b>✦</b><span /></div>

      <section>
        <SectionLead numeral="II." label="Agents · click to open control room" />
        <div className="mission-three-grid">
          <PortalCard
            icon={<AgentIcon fallback="CL" />}
            title="Claude"
            description="Claude Code adapter and direct workspace controls."
            meta="Staged"
            onClick={() => setActiveSection('claude-code')}
          />
          <PortalCard
            icon={<AgentIcon id="openclaw" fallback="OC" />}
            title="OpenClaw"
            description="Gateway status, control plane, and Mika agent routing."
            meta={openClawVerified ? 'Verified' : 'Unknown'}
            onClick={() => setActiveSection('openclaw-status')}
          />
          <PortalCard
            icon={<AgentIcon id="hermes" fallback="HE" />}
            title="Hermes"
            description="Status, sessions, communications, and direct chat."
            meta={hermesLabel}
            onClick={() => setActiveSection('hermes-workspace')}
          />
        </div>
      </section>

      <div className="agent-os-divider"><span /><b>✦</b><span /></div>

      <section>
        <SectionLead numeral="III." label="Self · grounded in your Obsidian vault" />
        <div className="mission-three-grid">
          <PortalCard
            icon={<FiTarget size={19} />}
            title="Goals"
            description="Track priorities, milestones, and operating targets."
            meta="Vault-backed"
            onClick={() => setActiveSection('goals')}
          />
          <PortalCard
            icon={<FiBookOpen size={19} />}
            title="Journal"
            description="Daily entries, decisions, context, and debriefs."
            meta="Daily record"
            onClick={() => setActiveSection('journal')}
          />
          <PortalCard
            icon={<FiDatabase size={19} />}
            title="Memory"
            description="Search and review persistent Mika operating context."
            meta={memory.length ? `${memory.length} records` : 'Vault-backed'}
            onClick={() => setActiveSection('memory-vault')}
          />
        </div>
      </section>

      <div className="agent-os-divider"><span /><b>✦</b><span /></div>

      <section>
        <SectionLead numeral="IV." label="Live activity · combined activity stream" />
        <div className="mika-activity-panel">
          {!activity.length ? (
            <div className="mika-empty-state">
              <FiActivity size={18} />
              <span>No recent activity was returned.</span>
            </div>
          ) : activity.map(item => (
            <div className="mika-activity-row" key={item.id}>
              <span className="mika-activity-marker" />
              <div className="min-w-0">
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
              </div>
              <div className="mika-activity-meta">
                <span>{String(item.status).replaceAll('_', ' ')}</span>
                <time>{formatTime(item.time)}</time>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="agent-os-divider"><span /><b>✦</b><span /></div>

      <section>
        <SectionLead numeral="V." label="Priority actions" />
        <div className="mission-three-grid">
          <PortalCard
            icon={<FiCheckSquare size={19} />}
            title="Approvals"
            description="Review human-in-the-loop decisions before execution."
            meta={`${approvals.length} pending`}
            onClick={() => setActiveSection('telegram')}
          />
          <PortalCard
            icon={<FiInbox size={19} />}
            title="Queued work"
            description="Review, route, and submit work through Mika's existing pipeline."
            meta={`${pendingTaskCount} queued`}
            onClick={() => setActiveSection('pipeline')}
          />
          <PortalCard
            icon={<FiCpu size={19} />}
            title="Pending actions"
            description="Open agent controls, activation gates, costs, and system intelligence."
            meta="Diamond Control"
            onClick={() => setActiveSection('diamond-control')}
          />
        </div>
      </section>

      <div className="agent-os-divider"><span /><b>✦</b><span /></div>

      <section>
        <SectionLead numeral="VI." label="Content artifacts · recent workflow outputs" />
        <ArtifactGallery compact limit={4} />
      </section>

      <div className="agent-os-divider"><span /><b>✦</b><span /></div>

      <section>
        <SectionLead numeral="VII." label="Content Division · Content Pack through Production, Review, Publishing, and Export" />
        {contentMetrics ? (
          <div className="mission-status-grid">
            <StatusCard
              icon={FiPackage}
              label="Production Volume"
              value={contentMetrics.production.total}
              detail={`${contentMetrics.production.byExecutionStatus.completed || 0} completed`}
              state={contentMetrics.production.total > 0 ? 'verified' : 'unknown'}
            />
            <StatusCard
              icon={FiCheckSquare}
              label="Render Success"
              value={contentMetrics.production.renderSuccessRate != null ? `${contentMetrics.production.renderSuccessRate}%` : '—'}
              detail={`${contentMetrics.production.byExecutionStatus.failed || 0} failed`}
              state={contentMetrics.production.renderSuccessRate >= 80 ? 'verified' : contentMetrics.production.renderSuccessRate != null ? 'staged' : 'unknown'}
            />
            <StatusCard
              icon={FiFilm}
              label="Review Backlog"
              value={contentMetrics.review.unreviewed}
              detail={`${contentMetrics.review.approved} approved`}
              state={contentMetrics.review.unreviewed > 0 ? 'staged' : 'verified'}
            />
            <StatusCard
              icon={FiSend}
              label="Publish Readiness"
              value={contentMetrics.publishing.readyToPublish}
              detail={`${contentMetrics.publishing.byStatus.published || 0} published`}
              state={contentMetrics.publishing.readyToPublish > 0 ? 'verified' : 'unknown'}
            />
            <StatusCard
              icon={FiDownload}
              label="Export Activity"
              value={contentMetrics.export.generatedCount}
              detail={`${contentMetrics.export.pendingCount} pending`}
              state="verified"
            />
            <StatusCard
              icon={FiAlertCircle}
              label="Package Health"
              value={contentMetrics.packages.total}
              detail={`${contentMetrics.packages.byHealth.blocked + contentMetrics.packages.byHealth.failed} need attention`}
              state={(contentMetrics.packages.byHealth.blocked + contentMetrics.packages.byHealth.failed) > 0 ? 'staged' : 'verified'}
            />
          </div>
        ) : (
          <div className="mika-empty-state">
            <FiActivity size={18} />
            <span>Loading Content Division metrics…</span>
          </div>
        )}
        <div className="mission-three-grid" style={{ marginTop: 16 }}>
          <PortalCard
            icon={<FiLayers size={19} />}
            title="Content Orchestrator"
            description="Unified timeline, relationship graph, and one-click navigation across every content workflow."
            meta="Studio → Content Orchestrator"
            onClick={() => setActiveSection('studio')}
          />
          <PortalCard
            icon={<FiInbox size={19} />}
            title="Rendering & Review Queues"
            description="Jobs waiting to render, and completed outputs waiting for approval."
            meta={contentMetrics ? `${contentMetrics.queues.rendering} rendering · ${contentMetrics.queues.review} to review` : 'Loading…'}
            onClick={() => setActiveSection('studio')}
          />
          <PortalCard
            icon={<FiSend size={19} />}
            title="Publishing & Export Queues"
            description="Publish jobs ready to go out, and published outputs still missing a manual export bundle."
            meta={contentMetrics ? `${contentMetrics.queues.publishing} to publish · ${contentMetrics.queues.export} to export` : 'Loading…'}
            onClick={() => setActiveSection('studio')}
          />
        </div>
      </section>
    </motion.div>
  );
}
