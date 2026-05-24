// pages/index.js
import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import { AnimatePresence, motion } from 'framer-motion';
import Sidebar from '../components/layout/Sidebar';
import TopBar  from '../components/layout/TopBar';
import AgentWorkspace from '../components/sections/AgentWorkspace';
import AgentsHub from '../components/sections/AgentsHub';
import MissionControl from '../components/sections/MissionControl';
import OpenClawStatus from '../components/sections/OpenClawStatus';
import TelegramApproval from '../components/sections/TelegramApproval';
import {
  DigitalDiamondSection, ManagedByMikaSection, MedAISection,
  CannaOpsSection, HotelHookerSection, AITwinSection, LeadRecoverySection,
} from '../components/sections/BrandSections';
import {
  PromptLibrarySection, GoalsSection, JournalSection, MemoryVaultSection,
} from '../components/sections/IntelligenceSections';
import {
  fetchGatewayStatus, fetchActiveAgents, fetchPendingApprovals,
  fetchMissionQueue, fetchTaskOutputs, fetchWeeklyMetrics,
  fetchGoals, fetchJournalEntries, fetchMemoryVault, fetchPrompts,
  fetchLeadMetrics, fetchCannaOpsData, fetchMedAIData,
} from '../lib/api';
import { useStore } from '../lib/store';

const AGENT_DEFS = [
  { id: 'mika',     label: 'Mika',     project: 'managed-by-mika', model: 'gpt-4o',                     systemType: 'openclaw', systemId: 'mika',     capabilities: ['checkin','checkout','guest_message','maintenance','report','booking'],               schedule: '*/15 * * * *', memory: true,  description: 'Handles all guest operations autonomously across managed properties.' },
  { id: 'diamond',  label: 'Diamond',  project: 'digital-diamond', model: 'gpt-4o',                     systemType: 'openclaw', systemId: 'diamond',  capabilities: ['draft_proposal','research','outreach','analytics','report'],                         schedule: null,           memory: true,  description: 'AI consulting agent — drafts proposals, runs research, manages outreach.' },
  { id: 'medbot',   label: 'MedBot',   project: 'medai',           model: 'gpt-4o-mini',                systemType: 'openclaw', systemId: 'medbot',   capabilities: ['schedule_appointment','handle_call','insurance_check','waitlist','notify_staff'],     schedule: '0 8 * * 1-5', memory: false, description: 'Manages inbound calls, appointment scheduling, and patient comms.' },
  { id: 'cannabot', label: 'CannaBot', project: 'cannaops',        model: 'gpt-4o-mini',                systemType: 'openclaw', systemId: 'cannabot', capabilities: ['inventory_sync','compliance_check','report','leafly_update'],                        schedule: '0 */6 * * *', memory: false, description: 'Syncs inventory, flags compliance issues, generates regulatory digests.' },
  { id: 'hookr',    label: 'Hookr',    project: 'hotel-hooker',    model: 'claude-3-5-sonnet-20241022', systemType: 'openclaw', systemId: 'hookr',    capabilities: ['generate_content','post_to_social','caption','story','schedule_post'],              schedule: '0 10 * * *',  memory: true,  description: 'Generates and schedules brand content across all Hotel Hooker channels.' },
  { id: 'twin',     label: 'Twin',     project: 'ai-twin',         model: 'claude-3-5-sonnet-20241022', systemType: 'openclaw', systemId: 'twin',     capabilities: ['script_video','generate_hooks','batch_content','voice_clone_prep','publish'],        schedule: '0 9 * * *',   memory: true,  description: 'Personal brand AI — writes scripts, generates hooks, batches content calendars.' },
  { id: 'recovery', label: 'Recovery', project: 'lead-recovery',   model: 'gpt-4o-mini',                systemType: 'openclaw', systemId: 'recovery', capabilities: ['whatsapp_sequence','email_sequence','telegram_ping','tag_lead','book_call'],         schedule: '0 14 * * 1-5',memory: true,  description: 'Runs multi-channel reactivation sequences on cold leads.' },
  { id: 'hermes',   label: 'Hermes',   project: 'hermes',          model: 'gpt-4o',                     systemType: 'custom',   systemId: 'hermes-main', systemConfig: { baseUrl: process.env.NEXT_PUBLIC_HERMES_URL || 'http://localhost:4000', auth: { type: 'bearer', token: '' } }, capabilities: ['send_message','broadcast','route_comms','translate','summarize_thread','draft_reply'], schedule: null, memory: true, description: 'Cross-brand communications agent — routes, drafts, and manages outbound messaging.' },
  { id: 'sentinel', label: 'Sentinel', project: null,              model: 'gpt-4o-mini',                systemType: 'openclaw', systemId: 'sentinel', capabilities: ['health_check','alert','monitor','failover'],                                          schedule: '*/5 * * * *', memory: false, description: 'System watchdog — monitors all agents and fires alerts on failures.' },
];

const pageTransition = {
  initial: { opacity: 0, x: 8 },
  animate: { opacity: 1, x: 0, transition: { duration: 0.28 } },
  exit:    { opacity: 0, x: -8, transition: { duration: 0.18 } },
};

export default function Home() {
  const { activeSection, activeAgentId, setPendingApprovals, setGatewayStatus } = useStore();

  const [data, setData] = useState({
    gateway: null, agents: [], approvals: [], queue: [], outputs: [],
    metrics: [], goals: [], journal: [], memory: [], prompts: [],
    leads: null, cannaops: null, medai: null,
  });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [
        gateway, agents, approvals, queue, outputs, metrics,
        goals, journal, memory, prompts, leads, cannaops, medai,
      ] = await Promise.all([
        fetchGatewayStatus(), fetchActiveAgents(), fetchPendingApprovals(),
        fetchMissionQueue(), fetchTaskOutputs(), fetchWeeklyMetrics(),
        fetchGoals(), fetchJournalEntries(), fetchMemoryVault(), fetchPrompts(),
        fetchLeadMetrics(), fetchCannaOpsData(), fetchMedAIData(),
      ]);
      const next = { gateway, agents, approvals, queue, outputs, metrics, goals, journal, memory, prompts, leads, cannaops, medai };
      setData(next);
      setGatewayStatus(gateway);
      setPendingApprovals(approvals);
    } catch (e) {
      console.error('Data load error:', e);
    } finally {
      setLoading(false);
    }
  }, [setGatewayStatus, setPendingApprovals]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const id = setInterval(() => {
      fetchGatewayStatus().then(s => { setGatewayStatus(s); setData(p => ({ ...p, gateway: s })); });
      fetchPendingApprovals().then(a => { setPendingApprovals(a); setData(p => ({ ...p, approvals: a })); });
    }, 10_000);
    return () => clearInterval(id);
  }, [setGatewayStatus, setPendingApprovals]);

  const renderContent = () => {
    if (loading) return (
      <div className="flex-1 flex items-center justify-center py-32">
        <div className="flex flex-col items-center gap-4">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
            className="w-8 h-8 rounded-full"
            style={{ border: '2px solid var(--border-default)', borderTopColor: 'var(--gold)' }}
          />
          <span className="font-mono text-[10px] tracking-widest" style={{ color: 'var(--text-muted)' }}>
            LOADING MIKA MISSION CONTROL
          </span>
        </div>
      </div>
    );

    if (activeAgentId) {
      const agentDef = AGENT_DEFS.find(a => a.id === activeAgentId);
      if (agentDef) {
        return (
          <AnimatePresence mode="wait">
            <motion.div key={`agent-${activeAgentId}`} {...pageTransition}>
              <AgentWorkspace agentDef={agentDef} />
            </motion.div>
          </AnimatePresence>
        );
      }
    }

    const sectionMap = {
      'mission-control': <MissionControl data={data} />,
      'agents-hub':      <AgentsHub />,
      'openclaw-status': <OpenClawStatus data={data} />,
      'telegram':        <TelegramApproval data={data} />,
      'digital-diamond': <DigitalDiamondSection />,
      'managed-by-mika': <ManagedByMikaSection />,
      'medai':           <MedAISection data={data} />,
      'cannaops':        <CannaOpsSection data={data} />,
      'hotel-hooker':    <HotelHookerSection />,
      'ai-twin':         <AITwinSection />,
      'lead-recovery':   <LeadRecoverySection data={data} />,
      'prompt-library':  <PromptLibrarySection data={data} />,
      'goals':           <GoalsSection data={data} />,
      'journal':         <JournalSection data={data} />,
      'memory-vault':    <MemoryVaultSection data={data} />,
    };

    return (
      <AnimatePresence mode="wait">
        <motion.div key={activeSection} {...pageTransition}>
          {sectionMap[activeSection] || (
            <div className="flex items-center justify-center h-32">
              <p className="font-mono text-sm" style={{ color: 'var(--text-muted)' }}>Section not found</p>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    );
  };

  return (
    <>
      <Head>
        <title>Mika Mission Control</title>
        <meta name="description" content="AI business cockpit" />
      </Head>
      <div className="flex h-screen overflow-hidden bg-cockpit">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopBar gatewayStatus={data.gateway} />
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="max-w-6xl mx-auto px-6 py-6">
            {renderContent()}
          </div>
        </main>
        <footer
          className="h-7 border-t flex items-center px-4 gap-6 flex-shrink-0"
          style={{ background: 'var(--bg-topbar)', borderColor: 'var(--border-default)' }}
        >
          <span className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>MIKA MISSION CONTROL</span>
          <span className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>MODE: MOCK DATA</span>
          <div className="flex items-center gap-1.5">
            <div className="status-dot online" style={{ width: 4, height: 4 }} />
            <span className="font-mono text-[9px]" style={{ color: 'var(--teal)' }}>GATEWAY CONNECTED</span>
          </div>
          <span className="font-mono text-[9px] ml-auto" style={{ color: 'var(--text-muted)' }}>
            v2.0.0 · {new Date().toLocaleDateString()}
          </span>
        </footer>
      </div>
    </div>
    </>
  );
}
