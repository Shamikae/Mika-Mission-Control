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
import config from '../lib/config';

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
    }, config.ui.liveRefreshMs);
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
      const agentDef = config.agents.find(a => a.id === activeAgentId);
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
      'agents-hub':      <AgentsHub agents={config.agents} />,
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
