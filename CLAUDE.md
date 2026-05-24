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
- `config/openclaw.config.js` — shared source of truth for settings (VPS URL, agents, projects, approval rules, system types). Edit here first.
- `config/openclaw.local.json` — ignored local overrides created by `npm run setup` for vault path and detected AI tools.
- `lib/api.js` — API abstraction layer. Returns mock data when the configured gateway URL is unset or contains `YOUR_VPS_IP`.
- `lib/agent-systems.js` — system-type abstraction. Supports `openclaw`, `n8n`, `make`, `flowise`, `custom`, `local`. Resolves the right HTTP calls per agent's `systemType`.
- `lib/mock-data.js` — all mock data for development/demo.

## Agent workspace pattern
Every agent has a 5-tab workspace: CONTROL (start/stop/restart/pause/resume), LOGS (per-agent stream), DISPATCH (send tasks), MEMORY (key-value context), CONFIG (editable JSON).
- Click any agent in the sidebar → opens `AgentWorkspace` component
- `AgentWorkspace` uses `lib/agent-systems.js` for all calls, not `lib/api.js`

## Adding a new agent
1. Add entry to `agents` array in `config/openclaw.config.js` with `systemType`, `systemId`, `capabilities`, `systemConfig` (if custom URL)
2. If the agent needs a dedicated brand section, add to `NAV_SECTIONS` in `Sidebar.jsx`, create `components/sections/YourSection.jsx`, add to `sectionMap` in `pages/index.js`
3. That's it — the sidebar, hub, and workspace read the configured agents automatically

## Adding a new brand section
1. Add project to `projects` array in `config/openclaw.config.js`
2. Add nav item to `NAV_SECTIONS` in `Sidebar.jsx` with `group: 'brands'`
3. Create `components/sections/YourSection.jsx` (copy from `BrandSections.jsx` as template)
4. Add to `sectionMap` in `pages/index.js`

## Connecting to live VPS
1. Set `gateway.vpsUrl` and `gateway.apiKey` in `config/openclaw.config.js` or environment variables
2. Update `agentSystems` endpoint definitions if your gateway routes differ
3. Keep `config/openclaw.local.json` for machine-specific vault path and detected tools

## Connecting a new external system (e.g. n8n, Make, custom agent)
1. Add system config to `agentSystems` in `config/openclaw.config.js`
2. Set agent's `systemType` to match
3. Set `systemId` to the ID/slug used in that system's URLs
4. Add `systemConfig.baseUrl` if it's a `custom` type with its own URL
5. Add shared defaults in config and keep private local-only overrides in `config/openclaw.local.json`

## Component conventions
- `panel-gold` class = glassmorphism card with gold border
- `font-mono` = JetBrains Mono for all data/numbers/IDs
- `font-ui` = Syne for labels, buttons, nav
- `font-display` = Cormorant Garamond for section headings
- All `StatusBadge`, `MetricCard`, `AgentCard`, `ProgressRing`, `GoldDivider` are in `components/ui/index.jsx`
- Project colors come from `config.projects`.

## Dev server
```bash
npm run dev     # starts at http://localhost:3099
npm run setup   # local vault path + AI tool detection wizard
npm run launch  # install, setup if needed, then run dev
```

## File structure
```
config/openclaw.config.js     ← edit this to add agents/brands/systems
config/openclaw.local.example.json
lib/api.js                    ← mock→live swap layer
lib/agent-systems.js          ← per-systemType HTTP abstraction
lib/config-loader.js          ← server/setup config merge with local overrides
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
scripts/setup.js               ← wizard for vault path and AI tool detection
scripts/launch.js              ← one-command installer/setup/dev runner
styles/globals.css             ← design tokens + utility classes
```
