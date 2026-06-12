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
import HermesStatus from '../components/sections/HermesStatus';
import HermesChat from '../components/sections/HermesChat';
import TaskDispatch from '../components/sections/TaskDispatch';
import TelegramApproval from '../components/sections/TelegramApproval';
import {
  DigitalDiamondSection, ManagedByMikaSection, MedAISection,
  CannaOpsSection, HotelHookerSection, AITwinSection, LeadRecoverySection,
} from '../components/sections/BrandSections';
import {
  PromptLibrarySection,
} from '../components/sections/IntelligenceSections';
import ObsidianGraph from '../components/sections/ObsidianGraph';
import ExecutiveFloor from '../components/sections/ExecutiveFloor';
import ProjectRoom from '../components/sections/ProjectRoom';
import WorkforceDivision from '../components/sections/WorkforceDivision';
import ContentDivision from '../components/sections/ContentDivision';
import AgentDispatchCenter from '../components/sections/AgentDispatchCenter';
import ExecutiveIntelligence from '../components/sections/ExecutiveIntelligence';
import RevenueOpportunities from '../components/sections/RevenueOpportunities';
import OfferLibrary  from '../components/sections/OfferLibrary';
import LeadPipeline    from '../components/sections/LeadPipeline';
import ProposalCenter  from '../components/sections/ProposalCenter';
import ClientDelivery   from '../components/sections/ClientDelivery';
import RevenueTracking    from '../components/sections/RevenueTracking';
import AgentControlCenter  from '../components/sections/AgentControlCenter';
import CostIntelligence   from '../components/sections/CostIntelligence';
import ActivationGate     from '../components/sections/ActivationGate';
import EngineeringDivision from '../components/sections/EngineeringDivision';
import DiamondControlWorkspace from '../components/workspaces/DiamondControlWorkspace';
import BoardroomWorkspace from '../components/workspaces/BoardroomWorkspace';
import PlaceholderWorkspace from '../components/workspaces/PlaceholderWorkspace';
import PaperclipWorkspace from '../components/workspaces/PaperclipWorkspace';
import HermesWorkspace from '../components/workspaces/HermesWorkspace';
import GoalsWorkspace from '../components/self/GoalsWorkspace';
import JournalWorkspace from '../components/self/JournalWorkspace';
import MemoryWorkspace from '../components/self/MemoryWorkspace';
import NotebookWorkspace from '../components/self/NotebookWorkspace';
import BuildGuide from '../components/self/BuildGuide';
import LeadsWorkspace from '../components/business/LeadsWorkspace';
import OffersWorkspace from '../components/business/OffersWorkspace';
import ClientsWorkspace from '../components/business/ClientsWorkspace';
import RevenueWorkspace from '../components/business/RevenueWorkspace';
import ProjectsWorkspace from '../components/business/ProjectsWorkspace';
import ContentPipelineBoard from '../components/content/ContentPipelineBoard';
import StudioWorkspace from '../components/content/StudioWorkspace';
import VideoWorkspace from '../components/content/VideoWorkspace';
import ThumbnailStudio from '../components/content/ThumbnailStudio';
import SEOWorkspace from '../components/content/SEOWorkspace';
import ContentKanban from '../components/content/ContentKanban';
import {
  fetchGatewayStatus, fetchActiveAgents, fetchPendingApprovals,
  fetchOpenClawStatus, fetchSubmittedTasks, fetchHermesStatus,
  fetchMissionQueue, fetchTaskOutputs, fetchWeeklyMetrics, fetchRevenueBrands,
  fetchGoals, fetchJournalEntries, fetchMemoryVault, fetchPrompts,
  fetchLeadMetrics, fetchCannaOpsData, fetchMedAIData,
} from '../lib/api';
import { useStore } from '../lib/store';
import config from '../lib/config';
import { resolveWorkspaceRoute } from '../lib/navigation/workspaceRegistry';

const pageTransition = {
  initial: { opacity: 0, x: 8 },
  animate: { opacity: 1, x: 0, transition: { duration: 0.28 } },
  exit:    { opacity: 0, x: -8, transition: { duration: 0.18 } },
};

function StagedWorkspace({ title, description, note }) {
  return (
    <PlaceholderWorkspace
      eyebrow="MIKA AGENTIC OS · STAGED WORKSPACE"
      title={title}
      description={description}
      note={note || 'Available as a staged workspace. No connection or execution state is being claimed.'}
    />
  );
}

export default function Home() {
  const { activeSection, activeAgentId, setPendingApprovals, setGatewayStatus } = useStore();

  const [data, setData] = useState({
    gateway: null, agents: [], approvals: [], queue: [], outputs: [],
    metrics: [], revenueBrands: [], goals: [], journal: [], memory: [], prompts: [],
    selfSources: {},
    leads: null, cannaops: null, medai: null, openclaw: null, tasks: [], hermes: null,
  });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [
        gateway, openclaw, tasks, agents, approvals, queue, outputs, metrics, revenueBrands,
        goalsResult, journalResult, memoryResult, promptsResult, leads, cannaops, medai, hermes,
      ] = await Promise.all([
        fetchGatewayStatus(), fetchOpenClawStatus(), fetchSubmittedTasks(),
        fetchActiveAgents(), fetchPendingApprovals(),
        fetchMissionQueue(), fetchTaskOutputs(), fetchWeeklyMetrics(), fetchRevenueBrands(),
        fetchGoals(), fetchJournalEntries(), fetchMemoryVault(), fetchPrompts(),
        fetchLeadMetrics(), fetchCannaOpsData(), fetchMedAIData(), fetchHermesStatus(),
      ]);
      const next = {
        gateway,
        openclaw,
        tasks,
        agents,
        approvals,
        queue,
        outputs,
        metrics,
        revenueBrands,
        goals: goalsResult.items,
        journal: journalResult.items,
        memory: memoryResult.items,
        prompts: promptsResult.items,
        selfSources: {
          goals: goalsResult,
          journal: journalResult,
          memory: memoryResult,
          prompts: promptsResult,
        },
        leads,
        cannaops,
        medai,
        hermes,
      };
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
      fetchOpenClawStatus().then(s => setData(p => ({ ...p, openclaw: s })));
      fetchHermesStatus().then(s => setData(p => ({ ...p, hermes: s })));
      fetchSubmittedTasks().then(t => setData(p => ({ ...p, tasks: t })));
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
      'diamond-control':        <DiamondControlWorkspace data={data} />,
      'boardroom':              <BoardroomWorkspace />,
      'build-guide':            <BuildGuide />,
      'paperclip':              <PaperclipWorkspace />,
      'ai-workforce':           <PaperclipWorkspace />,
      'claude-code':            <StagedWorkspace title="Claude" description="Claude Code is registered in Mika's adapter layer, but this direct workspace is not activated." />,
      'gemini':                 <StagedWorkspace title="Gemini" description="Gemini is an approved agent destination with no verified Mika workspace connection yet." />,
      'codex':                  <StagedWorkspace title="Codex" description="Codex is registered in Mika's adapter layer, but this direct workspace is not activated." />,
      'antigravity':            <StagedWorkspace title="Antigravity" description="Antigravity is an approved agent destination with no verified Mika workspace connection yet." />,
      'free-claude-code':       <StagedWorkspace title="Free Claude Code" description="Free Claude Code is an approved agent destination with no verified Mika workspace connection yet." />,
      'hermes-workspace':       <HermesWorkspace data={data} />,
      'pipeline':               <ContentPipelineBoard />,
      'studio':                 <StudioWorkspace />,
      'video':                  <VideoWorkspace />,
      'thumbnails':             <ThumbnailStudio />,
      'seo':                    <SEOWorkspace />,
      'kanban':                 <ContentKanban />,
      'leads':                  <LeadsWorkspace />,
      'offers':                 <OffersWorkspace />,
      'clients':                <ClientsWorkspace />,
      'revenue':                <RevenueWorkspace />,
      'projects':               <ProjectsWorkspace data={data} />,
      'executive-floor':        <ExecutiveFloor data={data} />,
      'executive-intelligence': <ExecutiveIntelligence />,
      'revenue-opportunities':  <RevenueOpportunities />,
      'offer-library':          <OfferLibrary />,
      'lead-pipeline':          <LeadPipeline />,
      'proposal-center':        <ProposalCenter />,
      'client-delivery':        <ClientDelivery />,
      'revenue-tracking':       <RevenueTracking />,
      'cost-intelligence':       <CostIntelligence />,
      'agent-control-center':   <AgentControlCenter />,
      'activation-gate':        <ActivationGate />,
      'engineering-division':   <EngineeringDivision />,
      'mission-control':        <MissionControl data={data} />,
      'workforce':       <WorkforceDivision />,
      'content-division':<ContentDivision />,
      'agents-hub':      <AgentsHub agents={config.agents} />,
      'openclaw-status': <OpenClawStatus data={data} />,
      'hermes-status':   <HermesStatus data={data} />,
      'hermes-chat':     <HermesChat />,
      'task-dispatch':   <TaskDispatch />,
      'agent-dispatch':  <AgentDispatchCenter />,
      'telegram':        <TelegramApproval data={data} />,
      'digital-diamond': <ProjectRoom projectId="digital-diamond"><DigitalDiamondSection /></ProjectRoom>,
      'managed-by-mika': <ProjectRoom projectId="managed-by-mika"><ManagedByMikaSection /></ProjectRoom>,
      'medai':           <ProjectRoom projectId="medai"><MedAISection data={data} /></ProjectRoom>,
      'cannaops':        <ProjectRoom projectId="cannaops"><CannaOpsSection data={data} /></ProjectRoom>,
      'hotel-hooker':    <ProjectRoom projectId="hotel-hooker"><HotelHookerSection /></ProjectRoom>,
      'ai-twin':         <ProjectRoom projectId="ai-twin"><AITwinSection /></ProjectRoom>,
      'lead-recovery':   <ProjectRoom projectId="lead-recovery"><LeadRecoverySection data={data} /></ProjectRoom>,
      'prompt-library':  <PromptLibrarySection data={data} />,
      'goals':           <GoalsWorkspace data={data} />,
      'journal':         <JournalWorkspace data={data} />,
      'memory-vault':    <MemoryWorkspace data={data} />,
      'notebook':        <NotebookWorkspace data={data} />,
      'knowledge-graph': <ObsidianGraph />,
    };
    const resolvedRoute = resolveWorkspaceRoute(activeSection);
    const operationalSubviewMap = {
      'mission-control:priority-actions': <TelegramApproval data={data} />,
      'diamond-control:activation': <ActivationGate />,
      'diamond-control:costs': <CostIntelligence />,
      'diamond-control:agent-control': <AgentControlCenter />,
      'diamond-control:dispatch': <AgentDispatchCenter />,
      'diamond-control:system-health': <AgentControlCenter initialTab="adapters" />,
      'diamond-control:engineering': <EngineeringDivision />,
      'pipeline:dispatch': <TaskDispatch />,
    };
    const resolvedKey = `${resolvedRoute.sectionId}:${resolvedRoute.subview || 'overview'}`;
    const resolvedContent = operationalSubviewMap[resolvedKey] || sectionMap[resolvedRoute.sectionId];

    return (
      <AnimatePresence mode="wait">
        <motion.div key={resolvedKey} {...pageTransition}>
          {resolvedContent || (
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
        <title>MIKA AGENTIC OS™</title>
        <meta name="description" content="Mika's agentic business command center" />
      </Head>
      <div className="flex h-screen overflow-hidden bg-cockpit">
        <Sidebar />
        <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
          <div className="agent-os-canvas">
            <TopBar gatewayStatus={data.gateway} openclawStatus={data.openclaw} />
            {renderContent()}
          </div>
        </main>
      </div>
    </>
  );
}
