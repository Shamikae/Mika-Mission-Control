import { useCallback, useEffect, useMemo, useState } from 'react';
import { FiShield } from 'react-icons/fi';
import BoardroomComposer from '../boardroom/BoardroomComposer';
import BoardroomControls from '../boardroom/BoardroomControls';
import BoardroomHistory from '../boardroom/BoardroomHistory';
import BoardroomRoster from '../boardroom/BoardroomRoster';
import BoardroomTranscript from '../boardroom/BoardroomTranscript';

const STORAGE_KEY = 'mika-boardroom-sessions-v1';
const SESSION_TYPES = ['Strategy', 'Content', 'Business', 'Technical', 'Review'];
const NON_PARTICIPANT_IDS = new Set([
  'omi',
  'claw3d',
  'graphify',
  'ruflo-swarm',
  'heygen',
  'higgsfield',
  'openrouter',
  'notebooklm',
  'paperclip',
  'specialist-placeholder',
]);

function readSessions() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function createSessionId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `boardroom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function BoardroomWorkspace() {
  const [agents, setAgents] = useState([]);
  const [rosterState, setRosterState] = useState('loading');
  const [sessions, setSessions] = useState([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [sessionType, setSessionType] = useState(SESSION_TYPES[0]);
  const [selectedAgentIds, setSelectedAgentIds] = useState([]);
  const [vaultState, setVaultState] = useState('idle');

  useEffect(() => {
    const stored = readSessions();
    setSessions(stored);
    setActiveSessionId(stored[0]?.id || null);
    setSessionsLoaded(true);
  }, []);

  useEffect(() => {
    if (!sessionsLoaded) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  }, [sessions, sessionsLoaded]);

  const loadRoster = useCallback(async () => {
    setRosterState('loading');
    try {
      const response = await fetch('/api/agents/control-center', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Registry request failed (${response.status})`);
      const payload = await response.json();
      const registeredAgents = Array.isArray(payload.agents)
        ? payload.agents.filter(agent => agent?.id && !NON_PARTICIPANT_IDS.has(agent.id))
        : [];
      setAgents(registeredAgents);
      setSelectedAgentIds(current => current.filter(id => registeredAgents.some(agent => agent.id === id)));
      setRosterState('ready');
    } catch {
      setAgents([]);
      setRosterState('unavailable');
    }
  }, []);

  useEffect(() => {
    loadRoster();
  }, [loadRoster]);

  const activeSession = useMemo(
    () => sessions.find(session => session.id === activeSessionId) || null,
    [activeSessionId, sessions],
  );

  const selectedAgents = useMemo(
    () => agents.filter(agent => selectedAgentIds.includes(agent.id)),
    [agents, selectedAgentIds],
  );

  const approvalRequired = selectedAgents.some(agent => agent.requiresApproval);

  function toggleAgent(agentId) {
    setSelectedAgentIds(current => (
      current.includes(agentId)
        ? current.filter(id => id !== agentId)
        : [...current, agentId]
    ));
  }

  function startNewSession() {
    setActiveSessionId(null);
    setSessionType(SESSION_TYPES[0]);
    setSelectedAgentIds([]);
    setVaultState('idle');
  }

  async function savePromptToVault(prompt, timestamp) {
    setVaultState('saving');
    try {
      const response = await fetch('/api/vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          op: 'appendChat',
          agentLabel: 'Boardroom',
          role: 'user',
          content: prompt,
          timestamp,
          capability: 'planning',
        }),
      });
      if (!response.ok) throw new Error('Vault save failed');
      setVaultState('saved');
    } catch {
      setVaultState('failed');
    }
  }

  async function addPlanningPrompt({ prompt, saveToVault }) {
    const createdAt = new Date().toISOString();
    const participantIds = selectedAgents.map(agent => agent.id);
    const participantNames = selectedAgents.map(agent => agent.displayName);
    const message = {
      id: createSessionId(),
      role: 'user',
      content: prompt,
      createdAt,
      participantIds,
      participantNames,
    };

    let sessionId = activeSession?.id;
    if (activeSession) {
      setSessions(current => current.map(session => (
        session.id === activeSession.id
          ? {
              ...session,
              type: sessionType,
              participantIds,
              participantNames,
              updatedAt: createdAt,
              messages: [...(session.messages || []), message],
            }
          : session
      )));
    } else {
      sessionId = createSessionId();
      const nextSession = {
        id: sessionId,
        title: prompt.trim().slice(0, 64),
        type: sessionType,
        participantIds,
        participantNames,
        createdAt,
        updatedAt: createdAt,
        messages: [message],
      };
      setSessions(current => [nextSession, ...current]);
      setActiveSessionId(sessionId);
    }

    setVaultState('idle');
    if (saveToVault) await savePromptToVault(prompt, createdAt);
    return sessionId;
  }

  return (
    <section className="boardroom-workspace">
      <header className="boardroom-header">
        <div>
          <div className="boardroom-eyebrow">WORKSPACE · GOVERNED COLLABORATION</div>
          <h1>Boardroom</h1>
          <p>Build strategy prompts with registered Mika agents before any governed dispatch.</p>
        </div>
        <div className="boardroom-mode">
          <FiShield size={14} />
          Safe planning mode
        </div>
      </header>

      <BoardroomControls
        sessionType={sessionType}
        sessionTypes={SESSION_TYPES}
        onSessionTypeChange={setSessionType}
        approvalRequired={approvalRequired}
      />

      <div className="boardroom-layout">
        <BoardroomRoster
          agents={agents}
          state={rosterState}
          selectedAgentIds={selectedAgentIds}
          onToggleAgent={toggleAgent}
          onReload={loadRoster}
        />

        <div className="boardroom-conversation">
          <BoardroomTranscript session={activeSession} />
          <BoardroomComposer
            selectedAgents={selectedAgents}
            sessionType={sessionType}
            onSubmit={addPlanningPrompt}
            vaultState={vaultState}
          />
        </div>

        <BoardroomHistory
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={session => {
            setActiveSessionId(session.id);
            setSessionType(session.type || SESSION_TYPES[0]);
            setSelectedAgentIds(session.participantIds || []);
            setVaultState('idle');
          }}
          onNewSession={startNewSession}
        />
      </div>
    </section>
  );
}
