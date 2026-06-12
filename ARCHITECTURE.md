# MIKA AGENTIC OS™ — Product Architecture Master Plan

> **Tagline:** Built by Pressure. Designed to Shine.
> **Version:** 1.0 | **Date:** 2026-05-30
> **Foundation:** Mika Mission Control → Evolution: MIKA AGENTIC OS™

---

## CRITICAL RULES (preserved in every decision below)

- DO NOT rebuild the application
- DO NOT redesign everything
- DO NOT replace working systems
- DO NOT remove existing functionality
- Preserve and extend what already exists
- Optimize for low Claude Code credit usage

---

## 1. PRODUCT ARCHITECTURE MAP — MIKA TOWER

```
┌─────────────────────────────────────────────────────────────────────┐
│                        MIKA AGENTIC OS™                              │
│                  "Built by Pressure. Designed to Shine."             │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  FUTURE EXPANSION FLOORS (Phase G)                           │    │
│  │  Marketplace · Academy · Community · Partner API             │    │
│  ├─────────────────────────────────────────────────────────────┤    │
│  │  PERSONAL HQ (Phase B)                                       │    │
│  │  Focus Mode · Deep Work · Journal · ADHD Dashboard           │    │
│  ├─────────────────────────────────────────────────────────────┤    │
│  │  KNOWLEDGE VAULT (Phase B)                                   │    │
│  │  Obsidian · Memory · Prompts · Research · Knowledge Graph    │    │
│  ├─────────────────────────────────────────────────────────────┤    │
│  │  REVENUE DIVISION (Phase C)                                  │    │
│  │  Revenue Snapshot · Lead Recovery · Affiliate · Offers       │    │
│  ├─────────────────────────────────────────────────────────────┤    │
│  │  CONTENT DIVISION (Phase E)                                  │    │
│  │  TikTok · LinkedIn · YouTube · Pinterest · Podcast · Blog    │    │
│  ├─────────────────────────────────────────────────────────────┤    │
│  │  AI WORKFORCE DIVISION (Phase D)                             │    │
│  │  Content · Growth · Sales · Operations Departments           │    │
│  ├─────────────────────────────────────────────────────────────┤    │
│  │  PROJECT DIVISION (Phase C)                                  │    │
│  │  Digital Diamond · Managed by Mika · MedAI · CannaOps        │    │
│  │  Hotel Hooker · AI Twin · Lead Recovery · Hermes             │    │
│  ├─────────────────────────────────────────────────────────────┤    │
│  │  EXECUTIVE FLOOR (Phase B)                                   │    │
│  │  CEO Dashboard · Daily Briefing · Goals · AI Activity Feed   │    │
│  ├─────────────────────────────────────────────────────────────┤    │
│  │  COMMAND FLOOR — EXISTING FOUNDATION ✓ (Phase A)             │    │
│  │  Mission Control · Agents Hub · System Status · Approvals    │    │
│  │  Hermes Agent · Agent Chat · Task Dispatch                   │    │
│  ├─────────────────────────────────────────────────────────────┤    │
│  │  GROUND — INFRASTRUCTURE (Already Running)                   │    │
│  │  VPS · Docker · OpenClaw Gateway · OpenRouter · GitHub       │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. SYSTEM ARCHITECTURE DIAGRAM

```
                        ┌──────────────────────┐
                        │   MIKA (MacBook Pro)  │
                        │  localhost:3099        │
                        │  Next.js 14 App        │
                        └──────────┬───────────┘
                                   │ HTTPS / SSH Tunnel
                    ┌──────────────┼──────────────┐
                    │              │               │
         ┌──────────▼──────┐  ┌───▼────┐  ┌──────▼──────────┐
         │ OpenClaw Gateway │  │ Hermes │  │  Local Services  │
         │ Hostinger VPS    │  │  VPS   │  │  Obsidian Vault  │
         │ :8080 / Docker   │  │ :4000  │  │  Local JSON      │
         └──────────┬───────┘  └───┬────┘  └──────┬──────────┘
                    │              │               │
         ┌──────────▼──────────────▼───────────────▼──────────┐
         │                  AGENT NETWORK                       │
         │  OpenClaw · Mika · Diamond · MedBot · CannaBot       │
         │  Hookr · Twin · Recovery · Sentinel                  │
         └──────────┬──────────────────────────────────────────┘
                    │
         ┌──────────▼──────────────────────────────────────────┐
         │              EXTERNAL INTEGRATIONS                    │
         │  OpenRouter · Telegram · GitHub · Google Drive        │
         │  n8n · Make.com · Flowise · WhatsApp                 │
         └─────────────────────────────────────────────────────┘
```

### Data flow
```
User → Next.js UI → lib/api.js → pages/api/* → External Systems
                        ↓
                   lib/store.js (Zustand)
                        ↓
             Components re-render reactively
```

---

## 3. AGENT ARCHITECTURE DIAGRAM

```
                    agents/agent-registry.json
                    (Workforce identity, department, role)
                              │
                    lib/agents/loadAgentRegistry.js
                              │
                    ┌─────────┼──────────────┐
                    │         │              │
           ┌────────▼──┐  ┌───▼────┐  ┌────▼────────┐
           │  ACTIVE    │  │ STAGED │  │ PLACEHOLDER  │
           │  OpenClaw  │  │ Claude │  │  Specialist  │
           │  Hermes    │  │ Code   │  │  Agent Slot  │
           └────────┬───┘  └───┬────┘  └─────────────┘
                    │          │
         config/openclaw.config.js
         (Runtime: systemType, systemId, systemConfig)
                    │
              lib/agent-systems.js
              (HTTP call resolution per systemType)
                    │
           components/sections/AgentWorkspace.jsx
           (5-tab: CONTROL · LOGS · DISPATCH · MEMORY · CONFIG)
```

### Agent execution modes
| Mode | Current agents | How called |
|---|---|---|
| `gateway` | OpenClaw | REST → VPS |
| `ssh-http` | Hermes | SSH tunnel → HTTP |
| `openclaw` | Mika, Diamond, MedBot, CannaBot, Hookr, Twin, Recovery, Sentinel | REST → OpenClaw gateway |
| `local-cli` | Claude Code (future) | CLI subprocess |
| `api` | Codex (future) | OpenAI API |
| `local-docker` | Specialist (future) | Docker socket |

---

## 4. FLOOR-BY-FLOOR ARCHITECTURE

---

### FLOOR 0 — COMMAND FLOOR (Existing — Phase A)

**Purpose:** Live operational control of all agents and systems.

| Area | Existing | Missing |
|---|---|---|
| Mission Control | ✓ MissionControl.jsx | Revenue metrics widget |
| All Agents Hub | ✓ AgentsHub.jsx | Department filter tabs |
| System Status | ✓ OpenClawStatus.jsx | Multi-system health roll-up |
| Task Dispatch | ✓ TaskDispatch.jsx | Batch dispatch, priority levels |
| Hermes Agent | ✓ HermesStatus.jsx | Worker queue visualizer |
| Agent Chat | ✓ HermesChat.jsx | Multi-session tabs |
| Approvals | ✓ TelegramApproval.jsx | WhatsApp approval channel |
| Agent Workspace | ✓ AgentWorkspace.jsx | Performance tab |

**Data model:** Zustand store (lib/store.js) — already covers all state.
**Backing system:** OpenClaw (VPS) + Local JSON
**Priority:** NOW — stabilize, do not rebuild

---

### FLOOR 1 — EXECUTIVE FLOOR (Phase B)

**Purpose:** Daily command center. Answer three questions instantly:
1. What makes money today?
2. What requires my attention?
3. What is AI doing right now?

**Existing support:**
- Mission Control section (partial)
- Notification system in store.js
- Agent status feeds

**Missing:**
- `ExecutiveFloor.jsx` — CEO dashboard component
- Daily Briefing generator (synthesize from agent logs + pending tasks)
- Revenue Snapshot widget (connect to project revenue data)
- Today's Focus panel (3 priorities surfaced from queue)
- Quick Wins feed (low-effort, high-value items from agent outputs)
- Money Opportunities feed (pattern-matched from agent activity)
- AI Activity Feed (unified timeline across all agents)

**Recommended data model:**
```json
{
  "executiveBriefing": {
    "date": "ISO date",
    "todayFocus": ["string"],
    "quickWins": [{ "text": "string", "agentId": "string", "action": "string" }],
    "moneyOpportunities": [{ "text": "string", "value": "string", "urgency": "high|medium|low" }],
    "waitingOn": [{ "task": "string", "blockedBy": "string" }],
    "aiActivityFeed": [{ "agentId": "string", "action": "string", "ts": "ISO" }]
  }
}
```

**Recommended UI components:**
- `<BriefingCard>` — expandable daily briefing panel
- `<FocusStack>` — top 3 priorities with one-click dispatch
- `<RevenueSnapshot>` — per-project revenue sparklines
- `<AIActivityFeed>` — real-time unified agent log stream
- `<MoneyOpportunities>` — alert-style opportunity cards

**Owning agent:** OpenClaw (orchestrator synthesizes briefing)
**Backing system:** OpenClaw API + local JSON cache (`data/executive-briefing.json`)
**Priority:** NEXT

---

### FLOOR 2 — PROJECT DIVISION (Phase C)

**Purpose:** Each project is a self-contained room with its own team, board, and knowledge.

**Existing support:**
- 8 projects defined in config/openclaw.config.js
- Brand sections in BrandSections.jsx
- Business lane context in context/business-lanes.json
- Per-agent memory in lib/memory/

**Missing per project room:**
- Dedicated Kanban board (Hermes drives this)
- Project-level journal (currently global)
- Project revenue tracker
- Project-scoped AI team view (which agents own this project)
- Project automation workflow viewer
- Project knowledge base (Obsidian folder per project)

**Recommended data model:**
```json
{
  "projectId": "string",
  "name": "string",
  "status": "active|paused|archived",
  "revenue": { "monthly": 0, "target": 0, "currency": "USD" },
  "kanban": { "todo": [], "inProgress": [], "done": [] },
  "aiTeam": ["agentId"],
  "journal": [{ "date": "ISO", "entry": "string" }],
  "automations": [{ "id": "string", "name": "string", "trigger": "string", "status": "active|paused" }]
}
```

**Recommended UI components:**
- `<ProjectRoom>` — master container per project
- `<ProjectKanban>` — Hermes-backed board (extend HermesStatus.jsx)
- `<ProjectJournal>` — daily log per project
- `<ProjectRevenue>` — revenue tracking widget
- `<ProjectAITeam>` — agent cards filtered to this project

**Owning agent:** Hermes (Kanban) + project-specific agent (content/ops)
**Backing system:** Hermes + Local JSON (`data/projects/[id].json`)
**Priority:** NEXT

---

### FLOOR 3 — AI WORKFORCE DIVISION (Phase D)

**Purpose:** AI employees appear as real workforce members with roles, departments, and live status.

**Existing support:**
- agents array in openclaw.config.js
- Agent avatars in lib/agent-avatars.js
- AgentsHub.jsx (flat list)
- AgentWorkspace.jsx (per-agent control)

**Missing:**
- Department-organized Workforce Directory
- AI employee profile cards with role/department/performance
- Agent Registry JSON (NOW CREATED: agents/agent-registry.json)
- Registry loader (NOW CREATED: lib/agents/loadAgentRegistry.js)
- API endpoint: `pages/api/agents/registry.js`
- `WorkforceDirectory.jsx` component

**Recommended data model:** See `agents/agent-registry.json` (already created).

**Recommended UI components:**
- `<WorkforceDivision>` — department tabs: CONTENT · GROWTH · SALES · OPERATIONS · ENGINEERING
- `<EmployeeCard>` — avatar, name, role, status badge, current task, allowed task types
- `<DepartmentRow>` — grouped list of agents per department
- `<AgentStatusPulse>` — animated live status indicator

**Department roster:**

| Department | Agents (existing) | Agents (future) |
|---|---|---|
| OPERATIONS | OpenClaw, Hermes, Sentinel | Automation Agent, Doc Agent |
| CONTENT | Hookr (Hotel Hooker), Twin (AI Twin) | Trend Hunter, Script Writer, Publisher |
| SALES | Recovery | Lead Manager, CRM Manager, Offer Manager |
| GROWTH | — | TikTok Agent, LinkedIn Agent, SEO Agent |
| CLIENT OPS | Mika, MedBot, CannaBot | — |
| ENGINEERING | Claude Code*, Codex* | Open Source Specialist |

*Not yet live-connected — display in Workforce Directory as "Staged"

**Owning agent:** OpenClaw (status sync)
**Backing system:** agents/agent-registry.json (local) + OpenClaw status API
**Priority:** NEXT

---

### FLOOR 4 — CONTENT DIVISION (Phase E)

**Purpose:** Content production pipeline from idea to published, organized by studio/channel.

**Existing support:**
- Hookr agent (Hotel Hooker content)
- Twin agent (AI Twin content, scripts, hooks)
- AI Twin Studio brand section
- generate_content, script_video, batch_content capabilities in agents

**Missing:**
- Content pipeline view (Idea → Research → Script → Production → Published)
- Per-studio sections: TikTok, LinkedIn, YouTube, Pinterest, Podcast, Blog
- Content calendar (batched view of scheduled posts)
- Repurposing engine (one piece → all channels)
- Analytics pull per channel

**Recommended data model:**
```json
{
  "contentId": "string",
  "projectId": "string",
  "studio": "tiktok|linkedin|youtube|pinterest|podcast|blog",
  "stage": "idea|research|script|production|editing|scheduled|published",
  "title": "string",
  "body": "string",
  "scheduledAt": "ISO",
  "publishedAt": "ISO",
  "agentId": "string",
  "analytics": { "views": 0, "engagement": 0, "revenue": 0 }
}
```

**Recommended UI components:**
- `<ContentDivision>` — studio selector sidebar + pipeline view
- `<ContentPipeline>` — horizontal Kanban-style stage tracker
- `<ContentCalendar>` — weekly calendar grid
- `<StudioPanel>` — per-channel dashboard (metrics + queue)

**Owning agent:** Twin (personal brand), Hookr (Hotel Hooker), future specialist agents
**Backing system:** Local JSON (`data/content/`) → Future: database
**Priority:** LATER

---

### FLOOR 5 — REVENUE DIVISION (Phase C)

**Purpose:** Know exactly what makes money and where the next dollar comes from.

**Existing support:**
- Lead Recovery agent (multi-channel reactivation)
- Recovery capabilities: whatsapp_sequence, email_sequence, tag_lead, book_call
- Projects have revenue fields (color, icon — but no revenue numbers yet)

**Missing:**
- Revenue tracking per project
- Affiliate manager view
- Lead pipeline (CRM-light)
- Offer manager
- Revenue forecasting widget

**Recommended data model:**
```json
{
  "projectId": "string",
  "month": "YYYY-MM",
  "revenue": 0,
  "target": 0,
  "leads": { "total": 0, "qualified": 0, "converted": 0 },
  "offers": [{ "id": "string", "name": "string", "price": 0, "status": "active|paused" }]
}
```

**Owning agent:** Recovery (lead reactivation), Diamond (consulting pipeline)
**Backing system:** Local JSON (`data/revenue/`) → Future: database
**Priority:** NEXT

---

### FLOOR 6 — KNOWLEDGE VAULT (Existing — Phase B)

**Purpose:** Institutional memory — prompts, research, journal, goals, Obsidian graph.

**Existing support:**
- Obsidian vault integration (config/vault)
- PromptLibrary, Goals, Journal, MemoryVault sections in IntelligenceSections.jsx
- ObsidianGraph.jsx
- lib/memory/loadLaneMemory.js + saveLaneMemory.js
- lib/vault.js
- Rolling memory per business lane in context/business-lanes.json

**Missing:**
- Semantic search across vault
- Auto-tagging of agent outputs into vault
- Memory aging / relevance scoring
- Cross-project knowledge linking

**Owning agent:** Hermes (research routing), OpenClaw (memory writes)
**Backing system:** Obsidian Vault (local) + Local JSON
**Priority:** NEXT (semantic search), LATER (advanced features)

---

### FLOOR 7 — PERSONAL HQ (Phase B)

**Purpose:** ADHD-optimized personal command center. One screen that removes overwhelm.

**Existing support:**
- Theme toggle in store.js
- Journal section
- Goals section

**Missing:**
- Focus Mode (hide everything except Today's Focus + active tasks)
- Deep Work Mode (hide AI feeds, minimize all ambient info)
- Low Energy Mode (surface only Quick Wins, block big decisions)
- High Energy Mode (surface all pipelines, enable batch operations)
- Energy level selector (persistent in localStorage)

**Recommended UI:**
```
[FOCUS MODE] [DEEP WORK] [LOW ENERGY] [HIGH ENERGY]
┌─────────────────────────────────────────────────┐
│  TODAY'S FOCUS (3 items max)                    │
│  ① [task] [dispatch to AI] [done]               │
│  ② [task] [dispatch to AI] [done]               │
│  ③ [task] [dispatch to AI] [done]               │
├─────────────────────────────────────────────────┤
│  QUICK WINS (low effort, high value)            │
│  MONEY OPPORTUNITIES                            │
│  AI ACTIVITY (what's working right now)         │
└─────────────────────────────────────────────────┘
```

**Owning agent:** OpenClaw (surfaces priorities from all queues)
**Backing system:** Zustand store + localStorage
**Priority:** NEXT

---

### FLOOR 8 — FUTURE EXPANSION (Phase G)

| Floor | Name | Purpose |
|---|---|---|
| Marketplace | Agent Marketplace | Install new pre-built agents |
| Academy | Mika Academy | Training content + AI curriculum |
| Community | Operator Network | Connect with other Agentic OS users |
| Partner API | External Access | Let clients access a limited view |

**Backing system:** Future SaaS infrastructure
**Priority:** LATER

---

## 5. DATA ARCHITECTURE

```
LOCAL (exists now)
├── config/openclaw.config.js       ← runtime agent + system config
├── config/openclaw.local.json      ← machine-specific overrides
├── context/business-lanes.json     ← per-brand AI context
├── agents/agent-registry.json      ← workforce identity (NEW)
├── memory/                         ← chat session persistence
└── queue/                          ← approval queue

LOCAL JSON (to create in Phase B/C)
├── data/
│   ├── executive-briefing.json     ← daily briefing cache
│   ├── projects/[id].json          ← per-project room data
│   ├── revenue/[YYYY-MM].json      ← monthly revenue snapshots
│   └── content/[id].json           ← content pipeline items

FUTURE DATABASE (Phase F+)
└── PostgreSQL / Supabase
    ├── projects
    ├── tasks
    ├── content_items
    ├── revenue_entries
    └── agent_activity_log
```

### Data ownership rules
| Data type | Owner | Store |
|---|---|---|
| Agent runtime config | openclaw.config.js | Config file |
| Agent workforce identity | agent-registry.json | JSON file |
| Business lane context | business-lanes.json | JSON file |
| Live agent status | OpenClaw API | In-memory (Zustand) |
| Approval queue | queue/ | Local JSON |
| Chat sessions | memory/ | Local JSON |
| Project state | data/projects/ | Local JSON |
| Revenue data | data/revenue/ | Local JSON |
| Content pipeline | data/content/ | Local JSON |
| Knowledge / prompts | Obsidian Vault | Markdown files |

---

## 6. UI ARCHITECTURE

### Component hierarchy
```
pages/index.js
├── components/layout/TopBar.jsx
│   └── Clock · GatewayStatus · Alerts · ThemeToggle
├── components/layout/Sidebar.jsx
│   ├── NAV_SECTIONS (COMMAND · BRANDS · INTELLIGENCE)
│   └── Agent list with live status dots
└── Section Router (sectionMap)
    ├── COMMAND
    │   ├── MissionControl.jsx         ← extend: add ExecutiveFloor
    │   ├── AgentsHub.jsx              ← extend: add dept filter
    │   ├── OpenClawStatus.jsx
    │   ├── TaskDispatch.jsx
    │   ├── HermesStatus.jsx
    │   ├── HermesChat.jsx
    │   └── TelegramApproval.jsx
    ├── BRANDS (one per project)
    │   └── BrandSections.jsx          ← extend: ProjectRoom per brand
    ├── INTELLIGENCE
    │   └── IntelligenceSections.jsx   ← exists: Prompts/Goals/Journal/Memory/Graph
    └── FUTURE FLOORS
        ├── ExecutiveFloor.jsx         ← Phase B
        ├── WorkforceDivision.jsx      ← Phase D
        └── ContentDivision.jsx        ← Phase E
```

### Design tokens (luxury tech palette evolution)
```css
/* Existing (obsidian/gold) — keep as-is */
--color-gold:     #c9a84c
--color-gold-100: #e5d080

/* Evolve toward Sapphire Blue primary */
--color-sapphire:     #1e3a8a   /* Deep sapphire */
--color-sapphire-400: #3b82f6   /* Bright sapphire */
--color-sapphire-200: #93c5fd   /* Light sapphire */
--color-diamond:      #f0f9ff   /* Diamond white */
--color-navy:         #0f172a   /* Dark navy background */
--color-emerald:      #10b981   /* Success / revenue positive */

/* Typography — keep all existing fonts */
/* Add: Playfair Display for executive-level headings */
```

### Styling convention (DO NOT change existing)
- `panel-gold` — glassmorphism card (keep)
- `font-mono` — JetBrains Mono for data (keep)
- `font-ui` — Syne for labels (keep)
- `font-display` — Cormorant Garamond for headings (keep)
- NEW: `panel-sapphire` — navy background with sapphire border (Phase B)
- NEW: `font-executive` — Playfair Display for Executive Floor only

---

## 7. ADHD OPTIMIZATION STRATEGY

### Core principle
**Surface only what matters now. Hide everything else.**

### Mode system
```
FOCUS MODE      → Today's 3 tasks + active agent status only
DEEP WORK MODE  → Hide all feeds, notifications, agent activity
LOW ENERGY MODE → Quick Wins + Money Opportunities only
HIGH ENERGY MODE → Full dashboard, all pipelines visible
```

### Implementation (Phase B)
```js
// Add to lib/store.js
operatingMode: 'normal',  // 'focus' | 'deep-work' | 'low-energy' | 'high-energy'
setOperatingMode: (mode) => set({ operatingMode: mode }),
```

### ADHD-critical UI rules
1. **Max 3 items in Today's Focus** — never show a list of 10
2. **One-click dispatch** — every focus item has [SEND TO AI] button
3. **Ambient status** — agent activity shows as subtle pulse, not loud alerts
4. **No infinite scroll** — paginated, capped lists everywhere
5. **Mode persists in localStorage** — remember energy level across sessions
6. **Quick Win filter** — agent outputs tagged as quick wins surface in < 5 seconds
7. **Collapse-all** — one button to hide all brand sections, show only Core
8. **Decision count** — aim for < 5 decisions needed per screen

---

## 8. AGENT REGISTRY DESIGN

Files created:
- `agents/agent-registry.json` — workforce identity, department, role, execution mode
- `lib/agents/loadAgentRegistry.js` — loader with merge, filter, and cache utilities

### Schema per agent
```json
{
  "id": "string (matches openclaw.config.js agent id)",
  "displayName": "string",
  "department": "OPERATIONS|ENGINEERING|CONTENT|GROWTH|SALES|CLIENT_OPS",
  "role": "string",
  "avatarType": "string (key into AGENT_AVATARS)",
  "executionMode": "gateway|ssh-http|openclaw|local-cli|api|local-docker",
  "command": "string|null (CLI command for local-cli mode)",
  "workingDir": "string|null",
  "allowedTaskTypes": ["string"],
  "requiresApproval": "boolean",
  "status": "active|inactive|staged|deprecated",
  "description": "string",
  "systemType": "string (mirrors config)",
  "systemId": "string (mirrors config)",
  "systemConfig": "object|null",
  "liveConnected": "boolean",
  "meta": { "version": "string", "owner": "string", "tier": "string", "note": "string" }
}
```

### How to add a new agent
1. Add entry to `agents/agent-registry.json` with all identity fields
2. Add entry to `config/openclaw.config.js` agents array with runtime fields
3. Add avatar to `lib/agent-avatars.js`
4. Done — Workforce Directory reads registry automatically

### How to stage a future agent (not yet connected)
- Set `status: "inactive"` and `liveConnected: false` in registry
- Set `status: "staged"` to show in directory with "Coming Soon" badge
- Zero runtime config needed — no impact on existing system

---

## 9. PHASED ROADMAP

---

### PHASE A — Stabilize Mission Control (NOW)
**Already in progress. This is the existing foundation.**

Objectives:
- All existing sections load and function correctly
- Mock → live data swap is clean and documented
- Agent registry JSON and loader are in place

Features: All existing functionality
Data changes: Add `agents/agent-registry.json` (done)
UI changes: None — stabilize only
Risks: Mock data masking real connection failures
Dependencies: VPS running, OpenClaw healthy
Complexity: Low

---

### PHASE B — Virtual HQ Information Architecture (NEXT)

Objectives:
- Add Executive Floor as new default landing screen
- Implement ADHD mode system (Focus/Deep Work/Low Energy/High Energy)
- Add Personal HQ section
- Migrate sidebar groups: COMMAND → HQ → PROJECTS → INTELLIGENCE

Features:
- `ExecutiveFloor.jsx` (Today's Focus, Quick Wins, AI Activity, Money Opportunities)
- Mode selector (4 modes with localStorage persistence)
- Daily Briefing synthesizer (aggregate from agent logs + queue)
- Revenue Snapshot (static data first, live later)

Data changes:
- Add `operatingMode` to store.js
- Create `data/executive-briefing.json` cache
- Add nav groups to Sidebar: HQ, PROJECTS

UI changes:
- New `ExecutiveFloor.jsx` section
- Mode toggle bar in TopBar.jsx
- Sidebar group rename: COMMAND → HQ
- `panel-sapphire` CSS token addition

Risks: Executive briefing synthesis requires agent data — start with static placeholder
Dependencies: Phase A complete
Complexity: Medium

---

### PHASE C — Project Rooms + Revenue Division (NEXT)

Objectives:
- Each brand gets a proper Project Room
- Revenue tracking per project
- Lead pipeline view for Recovery agent

Features:
- `ProjectRoom.jsx` — extends BrandSections.jsx with Kanban + Journal + AI Team + Revenue
- Per-project Kanban (pull from Hermes)
- `RevenueTracker.jsx` — per-project monthly revenue widget
- Lead pipeline for Recovery agent

Data changes:
- Create `data/projects/[id].json` schema
- Create `data/revenue/[YYYY-MM].json` schema
- Add `pages/api/projects/[id].js` endpoints

UI changes:
- BrandSections.jsx → extend with ProjectRoom tabs
- New Revenue panel in MissionControl.jsx
- Revenue Snapshot on Executive Floor

Risks: Hermes Kanban API must be stable
Dependencies: Phase B complete, Hermes HTTP API running
Complexity: Medium

---

### PHASE D — AI Workforce Directory (NEXT)

Objectives:
- Workforce directory UI reading from agent-registry.json
- Department-organized employee cards
- Live status sync from OpenClaw

Features:
- `WorkforceDivision.jsx` — department tabs + employee cards
- `EmployeeCard.jsx` — avatar, role, status, allowed tasks, execution mode
- `pages/api/agents/registry.js` — serves registry JSON
- Staged agents shown with "Coming Soon" badge

Data changes:
- `pages/api/agents/registry.js` endpoint (new)

UI changes:
- New Workforce Division section in sidebar (group: HQ)
- EmployeeCard style follows panel-gold convention
- Status dot from existing STATUS_DOT_COLOR map

Risks: Low — purely display layer, no new connections
Dependencies: Phase A complete (registry files done)
Complexity: Low

---

### PHASE E — Content Studios (LATER)

Objectives:
- Content pipeline per studio (TikTok, LinkedIn, YouTube, Pinterest, Podcast, Blog)
- Content calendar view
- Pipeline from Idea → Published

Features:
- `ContentDivision.jsx` — studio selector + pipeline
- `ContentCalendar.jsx` — weekly grid
- `ContentPipeline.jsx` — horizontal stage tracker
- Repurposing workflow (dispatch one piece → all studios)

Data changes:
- `data/content/` directory + per-item JSON
- Content pipeline API endpoints

Risks: Studio-specific analytics requires external OAuth (later)
Dependencies: Phase C complete, Twin/Hookr agents stable
Complexity: High

---

### PHASE F — Spatial / 3D Headquarters (LATER)

Objectives:
- Visual "floor map" of Mika Tower
- Click a floor to navigate to that division
- Agent avatars visible on their "floor"

Features:
- Isometric or top-down 2D floor map (CSS/SVG — avoid heavy 3D libs)
- Floor navigation replaces sidebar for high-energy mode
- Agent presence indicators per floor

Risks: Performance on MacBook during normal work mode
Dependencies: Phase E complete, all floors populated with data
Complexity: Very High

Note: Start with a CSS grid floor map, not a full 3D engine. Keep it elegant and fast.

---

### PHASE G — Marketplace + Academy + Community (LATER)

Objectives:
- Install new pre-built agents from a catalog
- Mika Academy course builder
- Community of operators sharing agents and workflows

Features:
- Agent Marketplace (browse, preview, install agent)
- Academy (video + AI-guided learning paths)
- Partner API (limited client-facing view)

Dependencies: All previous phases, SaaS infrastructure, payment processing
Complexity: Very High (multi-tenant, auth, billing)

---

## 10. FUTURE EXPANSION STRATEGY

### Adding a new business/project
1. Add to `projects` in config/openclaw.config.js
2. Add nav item to Sidebar NAV_SECTIONS
3. Add entry to context/business-lanes.json
4. Add brand agent to openclaw.config.js agents array + agent-registry.json
5. Create section component (copy BrandSections.jsx template)
6. Add to sectionMap in pages/index.js

Total effort: ~2 hours per new project

### Adding a new AI agent
1. Add to `agents/agent-registry.json` (identity)
2. Add to `config/openclaw.config.js` (runtime)
3. Add to `lib/agent-avatars.js` (avatar)
4. Test in AgentWorkspace — all 5 tabs work automatically

Total effort: ~30 minutes per new agent

### Adding a new system type
1. Add to `agentSystems` in config/openclaw.config.js
2. Handle auth + endpoints in lib/agent-systems.js
3. All existing agents with that systemType work automatically

Total effort: ~2 hours per system type

### Scaling to multi-operator (future)
- Extract config into per-operator database rows
- Wrap pages/api/* with auth middleware
- Keep UI identical — only data source changes
- agent-registry.json becomes a database table

---

## 11. COMPLEXITY + CREDIT EFFICIENCY RATINGS

| Task | Complexity | Claude Code Sessions |
|---|---|---|
| Add Executive Floor UI | Medium | 1-2 sessions |
| Workforce Directory UI | Low | 1 session |
| ADHD mode system | Low | 1 session |
| Project Room expansion | Medium | 2-3 sessions |
| Revenue tracker | Low | 1 session |
| Content Studios | High | 4-5 sessions |
| Spatial floor map (2D) | High | 3-4 sessions |
| Phase G (marketplace) | Very High | 10+ sessions |

**Recommended session discipline:**
- One feature per Claude Code session
- Always scope to a single file or component pair
- Use the registry + config pattern — never hardcode new agents
- No refactors unless a feature cannot be added without one

---

*This document is the authoritative architecture reference for MIKA AGENTIC OS™.*
*Update it when floors are built, not after.*
