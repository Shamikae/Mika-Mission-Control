const WORKSPACE_GROUPS = [
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      { id: 'mission-control', label: 'Mission Control', description: 'Status of every agent, every memory, every signal' },
      { id: 'paperclip', label: 'Paperclip', description: 'External workforce workspace', state: 'staged' },
      { id: 'boardroom', label: 'Boardroom', description: 'Governed multi-agent planning room', state: 'verified' },
      { id: 'diamond-control', label: 'Diamond Control', description: 'Safe command intake and workspace routing' },
    ],
  },
  {
    id: 'agents',
    label: 'Agents',
    items: [
      { id: 'claude-code', label: 'Claude', description: 'Claude Code workspace', state: 'staged', agent: true },
      { id: 'openclaw-status', label: 'OpenClaw', description: 'OpenClaw gateway workspace', agent: true },
      { id: 'hermes-workspace', label: 'Hermes', description: 'Hermes status and communications workspace', agent: true },
      { id: 'gemini', label: 'Gemini', description: 'Gemini workspace', state: 'staged', agent: true },
      { id: 'codex', label: 'Codex', description: 'Codex workspace', state: 'staged', agent: true },
      { id: 'antigravity', label: 'Antigravity', description: 'Antigravity workspace', state: 'staged', agent: true },
      { id: 'free-claude-code', label: 'Free Claude Code', description: 'Free Claude Code workspace', state: 'staged', agent: true },
    ],
  },
  {
    id: 'self',
    label: 'Self',
    items: [
      { id: 'goals', label: 'Goals', description: 'Business milestones and progress' },
      { id: 'journal', label: 'Journal', description: 'Daily logs and debriefs' },
      { id: 'memory-vault', label: 'Memory', description: 'Persistent operational context' },
      { id: 'notebook', label: 'Notebook', description: 'Mika knowledge notebook' },
      { id: 'build-guide', label: 'Build Guide', description: 'MIKA AGENTIC OS setup and onboarding' },
    ],
  },
  {
    id: 'content',
    label: 'Content',
    items: [
      { id: 'pipeline', label: 'Pipeline', description: 'Content intake, routing, and queued work' },
      { id: 'studio', label: 'Studio', description: 'Mika content studios and creative workflows' },
      { id: 'video', label: 'Video', description: 'Video factory and routing workspace' },
      { id: 'thumbnails', label: 'Thumbnails', description: 'Thumbnail creation workspace', state: 'staged' },
      { id: 'seo', label: 'SEO', description: 'SEO content workspace', state: 'staged' },
      { id: 'kanban', label: 'Kanban', description: 'Content production board' },
    ],
  },
  {
    id: 'business',
    label: 'Business',
    items: [
      { id: 'leads', label: 'Leads', description: 'Lead pipeline and follow-up work' },
      { id: 'offers', label: 'Offers', description: 'Offer library and validation' },
      { id: 'clients', label: 'Clients', description: 'Client onboarding and delivery' },
      { id: 'revenue', label: 'Revenue', description: 'Revenue, opportunities, and proposals' },
      { id: 'projects', label: 'Projects', description: 'Mika project and brand rooms' },
    ],
  },
];

export const CANONICAL_ROUTE_MAP = Object.freeze({
  workspace: Object.freeze(['mission-control', 'paperclip', 'boardroom', 'diamond-control']),
  agents: Object.freeze([
    'claude-code',
    'openclaw-status',
    'hermes-workspace',
    'gemini',
    'codex',
    'antigravity',
    'free-claude-code',
  ]),
  self: Object.freeze(['goals', 'journal', 'memory-vault', 'notebook', 'build-guide']),
  content: Object.freeze(['pipeline', 'studio', 'video', 'thumbnails', 'seo', 'kanban']),
  business: Object.freeze(['leads', 'offers', 'clients', 'revenue', 'projects']),
});

const CANONICAL_ROUTE_IDS = new Set(Object.values(CANONICAL_ROUTE_MAP).flat());

// Alias direction is intentionally one-way:
// deprecated/internal route ID -> approved canonical sidebar route ID.
// Canonical IDs must never appear as keys, and alias targets must never be aliases.
export const legacyAliasMap = Object.freeze({
  'ai-workforce': 'paperclip',
  'content-factory': 'studio',
  'content-command': 'pipeline',
  'creative-studio': 'studio',
  'revenue-division': 'revenue',
  'project-rooms': 'projects',
  'diamond-vault': 'memory-vault',
  'system-vitals': 'diamond-control',
  settings: 'diamond-control',
  'agent-control-center': 'diamond-control',
  'executive-floor': 'diamond-control',
  'executive-intelligence': 'diamond-control',
  'cost-intelligence': 'diamond-control',
  'activation-gate': 'diamond-control',
  'engineering-division': 'diamond-control',
  'agents-hub': 'diamond-control',
  workforce: 'diamond-control',
  telegram: 'mission-control',
  'hermes-status': 'hermes-workspace',
  'hermes-chat': 'hermes-workspace',
  'task-dispatch': 'pipeline',
  'agent-dispatch': 'pipeline',
  'content-division': 'studio',
  'offer-library': 'offers',
  'lead-pipeline': 'leads',
  'client-delivery': 'clients',
  'revenue-opportunities': 'revenue',
  'proposal-center': 'revenue',
  'revenue-tracking': 'revenue',
  'digital-diamond': 'projects',
  'managed-by-mika': 'projects',
  medai: 'projects',
  cannaops: 'projects',
  'hotel-hooker': 'projects',
  'ai-twin': 'projects',
  'lead-recovery': 'projects',
  'knowledge-graph': 'memory-vault',
  'prompt-library': 'notebook',
});

function validateRouteRegistry() {
  const navigationIds = WORKSPACE_GROUPS.flatMap(group => group.items.map(item => item.id));
  const canonicalIds = [...CANONICAL_ROUTE_IDS];

  if (navigationIds.length !== canonicalIds.length || navigationIds.some(id => !CANONICAL_ROUTE_IDS.has(id))) {
    throw new Error('Workspace navigation and canonical route map are out of sync');
  }

  for (const [legacyId, canonicalId] of Object.entries(legacyAliasMap)) {
    if (CANONICAL_ROUTE_IDS.has(legacyId)) {
      throw new Error(`Canonical route "${legacyId}" cannot be a legacy alias`);
    }
    if (!CANONICAL_ROUTE_IDS.has(canonicalId)) {
      throw new Error(`Legacy route "${legacyId}" targets unknown canonical route "${canonicalId}"`);
    }
    if (Object.prototype.hasOwnProperty.call(legacyAliasMap, canonicalId)) {
      throw new Error(`Legacy route "${legacyId}" requires more than one alias hop`);
    }
  }
}

validateRouteRegistry();

export function buildWorkspaceNavigation() {
  return WORKSPACE_GROUPS;
}

export function resolveSectionId(sectionId) {
  return legacyAliasMap[sectionId] || sectionId;
}

export function getWorkspaceMeta(sectionId, agents = []) {
  const canonicalId = resolveSectionId(sectionId);
  for (const group of WORKSPACE_GROUPS) {
    const item = group.items.find(entry => entry.id === canonicalId);
    if (item) return { ...item, group: group.label };
  }

  const agent = agents.find(entry => entry.id === sectionId);
  if (agent) {
    return {
      id: agent.id,
      label: agent.label,
      description: agent.description || 'Agent workspace',
      group: 'Agents',
    };
  }

  return null;
}

export { WORKSPACE_GROUPS };
