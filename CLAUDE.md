# OpenClaw Mission Control — Claude Code Context

## What this project is
A personal AI business cockpit — a Next.js 14 dashboard running locally on a Mac that connects to an OpenClaw gateway on a Hostinger VPS via Docker. It controls and monitors all AI agents across multiple business brands.

## Stack
- **Framework:** Next.js 14 (pages router) at http://localhost:3099
- **Styling:** Tailwind CSS with a custom luxury dark theme (obsidian/gold palette)
- **Animation:** Framer Motion
- **State:** Zustand (`lib/store.js`)
- **Fonts:** Cormorant Garamond (display), JetBrains Mono (data), Syne (UI labels), DM Sans (body)

## Key architecture decisions
- `config/openclaw.config.js` — single source of truth for ALL settings (VPS URL, agents, projects, approval rules, system types). Edit here first.
- `lib/api.js` — API abstraction layer. Returns mock data when `NEXT_PUBLIC_VPS_GATEWAY_URL` is unset or contains `YOUR_VPS_IP`. Has commented `// LIVE:` blocks ready to uncomment for each function.
- `lib/agent-systems.js` — system-type abstraction. Supports `openclaw`, `n8n`, `make`, `flowise`, `custom`, `local`. Resolves the right HTTP calls per agent's `systemType`.
- `lib/mock-data.js` — all mock data for development/demo.

## Agent workspace pattern
Every agent has a 5-tab workspace: CONTROL (start/stop/restart/pause/resume), LOGS (per-agent stream), DISPATCH (send tasks), MEMORY (key-value context), CONFIG (editable JSON).
- Click any agent in the sidebar → opens `AgentWorkspace` component
- `AgentWorkspace` uses `lib/agent-systems.js` for all calls, not `lib/api.js`

## Adding a new agent
1. Add entry to `agents` array in `config/openclaw.config.js` with `systemType`, `systemId`, `capabilities`, `systemConfig` (if custom URL)
2. Add entry to `AGENT_DEFS` array in `pages/index.js`
3. Add entry to `AGENTS` array in `components/layout/Sidebar.jsx`
4. If the agent needs a dedicated brand section, add to `NAV_SECTIONS` in `Sidebar.jsx`, create `components/sections/YourSection.jsx`, add to `sectionMap` in `pages/index.js`
5. That's it — the workspace spins up automatically

## Adding a new brand section
1. Add project to `projects` array in `config/openclaw.config.js`
2. Add nav item to `NAV_SECTIONS` in `Sidebar.jsx` with `group: 'brands'`
3. Create `components/sections/YourSection.jsx` (copy from `BrandSections.jsx` as template)
4. Add to `sectionMap` in `pages/index.js`

## Connecting to live VPS
1. Set `NEXT_PUBLIC_VPS_GATEWAY_URL` in `.env.local`
2. In `lib/api.js`: uncomment `// LIVE:` lines and remove `if (MOCK_MODE) return mock.xxx;` guards
3. In `lib/agent-systems.js`: set `MOCK_MODE = false` or set the env var

## Connecting a new external system (e.g. n8n, Make, custom agent)
1. Add system config to `agentSystems` in `config/openclaw.config.js`
2. Set agent's `systemType` to match
3. Set `systemId` to the ID/slug used in that system's URLs
4. Add `systemConfig.baseUrl` if it's a `custom` type with its own URL
5. Add `NEXT_PUBLIC_YOUR_SYSTEM_URL` and `YOUR_SYSTEM_API_KEY` to `.env.local`

## Component conventions
- `panel-gold` class = glassmorphism card with gold border
- `font-mono` = JetBrains Mono for all data/numbers/IDs
- `font-ui` = Syne for labels, buttons, nav
- `font-display` = Cormorant Garamond for section headings
- All `StatusBadge`, `MetricCard`, `AgentCard`, `ProgressRing`, `GoldDivider` are in `components/ui/index.jsx`
- Project colors are defined in `PROJECT_COLORS` objects throughout — #c9a84c gold, #0dd3c5 teal, #818cf8 indigo, #4ade80 green, #f472b6 pink, #60a5fa blue, #fb923c orange, #a78bfa violet

## Dev server
```bash
npm run dev     # starts at http://localhost:3099
```

## File structure
```
config/openclaw.config.js     ← edit this to add agents/brands/systems
lib/api.js                    ← mock→live swap layer
lib/agent-systems.js          ← per-systemType HTTP abstraction
lib/mock-data.js              ← all mock data
lib/store.js                  ← Zustand global state
components/layout/Sidebar.jsx ← navigation + agents list
components/layout/TopBar.jsx  ← clock, gateway status, alerts
components/sections/AgentWorkspace.jsx  ← per-agent control panel
components/sections/MissionControl.jsx
components/sections/OpenClawStatus.jsx
components/sections/TelegramApproval.jsx
components/sections/BrandSections.jsx   ← all brand panels
components/sections/IntelligenceSections.jsx ← prompts/goals/journal/memory
components/ui/index.jsx        ← shared UI primitives
pages/index.js                 ← orchestration + routing
styles/globals.css             ← design tokens + utility classes
```
