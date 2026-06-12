import { useEffect, useMemo, useState } from 'react';
import { FiCommand, FiShield } from 'react-icons/fi';
import { useStore } from '../../lib/store';
import DiamondCommandInput from '../diamond/DiamondCommandInput';
import DiamondIntentPreview from '../diamond/DiamondIntentPreview';
import DiamondRecentCommands from '../diamond/DiamondRecentCommands';
import DiamondRouteSuggestions from '../diamond/DiamondRouteSuggestions';
import DiamondVoiceInput from '../diamond/DiamondVoiceInput';

const STORAGE_KEY = 'mika-diamond-control-intents-v1';

const TYPE_RULES = [
  {
    type: 'boardroom',
    keywords: ['boardroom', 'mastermind', 'group decision', 'strategy session', 'collaborate'],
    destination: { id: 'boardroom', label: 'Boardroom' },
  },
  {
    type: 'content',
    keywords: ['content', 'post', 'caption', 'script', 'video', 'thumbnail', 'seo', 'blog', 'podcast', 'publish'],
    destination: { id: 'studio', label: 'Studio' },
  },
  {
    type: 'business',
    keywords: ['revenue', 'lead', 'offer', 'client', 'sales', 'proposal', 'campaign', 'invoice'],
    destination: { id: 'revenue', label: 'Revenue' },
  },
  {
    type: 'agent',
    keywords: ['agent', 'openclaw', 'hermes', 'claude', 'codex', 'gemini', 'workforce'],
    destination: { id: 'agent-control-center', label: 'Agent Control Center' },
  },
  {
    type: 'vault',
    keywords: ['vault', 'memory', 'remember', 'journal', 'note', 'notebook', 'obsidian', 'knowledge'],
    destination: { id: 'memory-vault', label: 'Memory' },
  },
  {
    type: 'project',
    keywords: ['project', 'brand room', 'project room', 'artifact', 'milestone'],
    destination: { id: 'projects', label: 'Projects' },
  },
  {
    type: 'system',
    keywords: ['system', 'status', 'health', 'cost', 'approval', 'activation', 'gateway', 'vitals', 'mission control'],
    destination: { id: 'mission-control', label: 'Mission Control' },
  },
];

const UNSUPPORTED_PATTERNS = [
  /\b(run|execute)\s+(a\s+)?(shell|terminal|command|script)\b/i,
  /\b(install|uninstall)\s+(a\s+)?(package|dependency|app|software)\b/i,
  /\b(open|launch|start)\s+(an?\s+)?(app|application|program|process)\b/i,
  /\b(delete|erase|wipe|remove)\s+(a\s+)?(file|folder|directory|database)\b/i,
];

const RISK_RULES = [
  { id: 'external', label: 'External action', pattern: /\b(send|publish|post|email|message|upload|external|third-party)\b/i },
  { id: 'paid', label: 'Paid action', pattern: /\b(pay|purchase|buy|subscribe|paid|spend|invoice|charge)\b/i },
  { id: 'destructive', label: 'Destructive action', pattern: /\b(delete|remove|erase|wipe|cancel|terminate|overwrite)\b/i },
  { id: 'long-running', label: 'Long-running action', pattern: /\b(batch|crawl|render|train|long-running|all projects|every file|full audit)\b/i },
];

const QUICK_ACTIONS = [
  'Create a content idea',
  'Review agents',
  'Open Boardroom',
  'Add a journal entry',
  'Check revenue',
  'Search memory',
];

function makeId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `intent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function classifyCommand(command) {
  const normalized = command.trim().toLowerCase();
  const rule = TYPE_RULES.find(entry => entry.keywords.some(keyword => normalized.includes(keyword)));
  const unsupported = UNSUPPORTED_PATTERNS.some(pattern => pattern.test(command));
  const risks = RISK_RULES.filter(entry => entry.pattern.test(command)).map(({ id, label }) => ({ id, label }));
  let destination = rule?.destination || null;

  if (rule?.type === 'vault' && normalized.includes('journal')) {
    destination = { id: 'journal', label: 'Journal' };
  } else if (rule?.type === 'vault' && normalized.includes('notebook')) {
    destination = { id: 'notebook', label: 'Notebook' };
  } else if (rule?.type === 'business' && normalized.includes('lead')) {
    destination = { id: 'leads', label: 'Leads' };
  } else if (rule?.type === 'business' && normalized.includes('offer')) {
    destination = { id: 'offers', label: 'Offers' };
  } else if (rule?.type === 'business' && normalized.includes('client')) {
    destination = { id: 'clients', label: 'Clients' };
  } else if (rule?.type === 'content' && normalized.includes('video')) {
    destination = { id: 'video', label: 'Video' };
  } else if (rule?.type === 'content' && normalized.includes('pipeline')) {
    destination = { id: 'pipeline', label: 'Pipeline' };
  }

  return {
    id: makeId(),
    command: command.trim(),
    type: rule?.type || 'unknown',
    destination,
    status: unsupported || !rule ? 'not_connected' : 'ready_for_review',
    risks,
    approvalRequired: risks.length > 0,
    createdAt: new Date().toISOString(),
  };
}

function loadRecentIntents() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function DiamondControlWorkspace() {
  const setActiveSection = useStore(state => state.setActiveSection);
  const [draft, setDraft] = useState('');
  const [intent, setIntent] = useState(null);
  const [recentIntents, setRecentIntents] = useState([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  useEffect(() => {
    const stored = loadRecentIntents();
    setRecentIntents(stored);
    setIntent(stored[0] || null);
    setHistoryLoaded(true);
  }, []);

  useEffect(() => {
    if (!historyLoaded) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(recentIntents));
  }, [historyLoaded, recentIntents]);

  const routeSuggestions = useMemo(() => {
    if (!intent) return [];
    const suggestions = [];
    if (intent.destination) suggestions.push(intent.destination);

    if (intent.type === 'content') suggestions.push({ id: 'pipeline', label: 'Pipeline' });
    if (intent.type === 'business') suggestions.push({ id: 'leads', label: 'Leads' });
    if (intent.type === 'vault') suggestions.push({ id: 'notebook', label: 'Notebook' });
    if (intent.type === 'project') suggestions.push({ id: 'boardroom', label: 'Boardroom' });
    if (intent.type === 'agent') suggestions.push({ id: 'mission-control', label: 'Mission Control' });

    return suggestions.filter((entry, index, all) => (
      all.findIndex(candidate => candidate.id === entry.id) === index
    ));
  }, [intent]);

  function createIntent(command = draft) {
    const normalized = command.trim();
    if (!normalized) return;
    const nextIntent = classifyCommand(normalized);
    setIntent(nextIntent);
    setRecentIntents(current => [nextIntent, ...current.filter(item => item.id !== nextIntent.id)].slice(0, 30));
    setDraft('');
  }

  function selectQuickAction(command) {
    setDraft(command);
    createIntent(command);
  }

  return (
    <section className="diamond-control-workspace">
      <header className="diamond-control-header">
        <div className="diamond-control-heading">
          <span className="diamond-control-mark"><FiCommand size={18} /></span>
          <div>
            <div className="diamond-control-eyebrow">WORKSPACE · SAFE COMMAND INTAKE</div>
            <h1>Diamond Control</h1>
            <p>Describe an objective, review Mika's local interpretation, then choose where it should go.</p>
          </div>
        </div>
        <div className="diamond-control-mode">
          <FiShield size={13} />
          Intent review only
        </div>
      </header>

      <div className="diamond-command-deck">
        <DiamondCommandInput
          value={draft}
          onChange={setDraft}
          onSubmit={() => createIntent()}
          quickActions={QUICK_ACTIONS}
          onQuickAction={selectQuickAction}
        />
        <DiamondVoiceInput
          onTranscript={transcript => {
            setDraft(transcript);
            createIntent(transcript);
          }}
        />
      </div>

      <div className="diamond-control-grid">
        <div className="diamond-control-main">
          <DiamondIntentPreview intent={intent} />
          <DiamondRouteSuggestions
            intent={intent}
            suggestions={routeSuggestions}
            onNavigate={setActiveSection}
          />
        </div>
        <DiamondRecentCommands
          commands={recentIntents}
          activeId={intent?.id}
          onSelect={setIntent}
          onClear={() => {
            setRecentIntents([]);
            setIntent(null);
          }}
        />
      </div>
    </section>
  );
}

export { classifyCommand };
