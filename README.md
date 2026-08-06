# ◈ OpenClaw Mission Control

> Your personal AI business cockpit — a luxury hybrid dashboard for solopreneurs running multiple AI-powered brands.

Built with **Next.js 14**, **Tailwind CSS**, **Framer Motion**, and **Zustand**.

---

## Setup

### One-command local launch

```bash
npm run launch
```

`launch` installs dependencies when needed, runs the setup wizard if `config/openclaw.local.json` does not exist, then starts the dashboard at **http://localhost:3099**.

Use another port when 3099 is already busy:

```bash
PORT=3100 npm run dev
```

### Manual setup

```bash
npm install
npm run setup
npm run dev
```

The setup wizard:
- auto-detects installed local AI tools such as Claude Code, Codex, Cursor, Windsurf, Gemini CLI, Aider, Goose, OpenCode, and Continue
- asks for your vault path
- writes machine-specific settings to `config/openclaw.local.json`

`config/openclaw.local.json` is ignored by Git. Share `config/openclaw.config.js` and `config/openclaw.local.example.json`, not your private local config.

### Configuration

Shared defaults live in `config/openclaw.config.js`:
- `gateway` for OpenClaw/VPS URLs and auth
- `telegram`, `whatsapp`, and `googleDrive` integration settings
- `vault.folders` for vault folder names
- `projects`, `agentSystems`, `agents`, and `approvalRules`
- `ui` refresh/operator settings

Machine-specific overrides live in `config/openclaw.local.json`, created by `npm run setup`.

---

## Connecting to Live OpenClaw

The API layer is in `lib/api.js`. Each function has a commented-out `// LIVE:` block showing the real gateway call. To go live:

1. Set `gateway.vpsUrl` and `gateway.apiKey` in `config/openclaw.config.js` or environment variables.
2. Update `agentSystems` endpoint definitions if your gateway routes differ.
3. Keep `config/openclaw.local.json` for local-only vault paths and detected tools.

The dashboard will automatically prefer your VPS and fall back to the local Docker instance if the VPS is unreachable.

---

## First run — required local configuration

Two capabilities ship **disabled by default**. A fresh clone starts, renders every
screen, and looks healthy — but the Content Division will not actually execute.
These live in `.env.local` (git-ignored), never in `.env.example`:

```bash
CONTENT_WORKFORCE_ENABLED=true    # default false
CONTENT_RESEARCH_ENABLED=true     # default false
```

**Symptoms if you skip this**

| Missing | What you see |
|---|---|
| `CONTENT_WORKFORCE_ENABLED` | App loads normally; running the workforce fails with *"CONTENT_WORKFORCE_ENABLED is not set to true"*. The seven stages never run. |
| `CONTENT_RESEARCH_ENABLED` | Research still runs, but silently falls back to model-synthesis — no live sources, no citations. |
| `MIKA_ADMIN_TOKEN` unset | Every mutation API returns 503 and the UI is effectively read-only. |
| `MIKA_ADMIN_TOKEN` set, no browser session | Mutation buttons return 401. Sign in via the **Admin session required** prompt. |

**Supporting values** (also `.env.local` only — never commit real keys):

- `OPENROUTER_ENABLED=true` + `OPENROUTER_API_KEY` — required by the workforce
- `CONTENT_RESEARCH_PROVIDER` — `exa` or `tavily` (both have real adapters; `brave-search` is staged)
- `EXA_API_KEY` / `TAVILY_API_KEY` — whichever provider you selected
- `MIKA_ADMIN_TOKEN` — any long random string; it gates all mutation APIs

`.env.example` documents every flag with its default. Copy what you need into
`.env.local`; that file is git-ignored and must stay that way.

### First-run verification checklist

1. **App starts** — `npm run dev`, then open http://localhost:3099
2. **Mutation auth works** — if the *Admin session required* prompt appears,
   paste `MIKA_ADMIN_TOKEN`. It is stored as an HttpOnly cookie; page
   JavaScript never sees it. The prompt disappears once a session exists.
3. **Content Workforce enabled** — `curl -s localhost:3099/api/creative-director/workforce | jq .ok`
   (a non-empty response means the route is live; the flag is checked at run time)
4. **Research enabled** — `curl -s localhost:3099/api/research/providers | jq '.providers[] | {id, executable}'`
   — your chosen provider should report `executable: true`
5. **Provider health verified** — `curl -s localhost:3099/api/production/providers | jq '.providers[] | {id, status}'`
6. **One no-spend health check** — `node scripts/validate-render-spec.mjs`
   (pure transform, no network, no credits)

## Architecture

```
openclaw-mission-control/
├── config/openclaw.config.js   ← Shared config (VPS URL, agents, approval rules)
├── config/openclaw.local.example.json
├── lib/
│   ├── api.js                  ← API abstraction (mock → live swap)
│   ├── config-loader.js        ← Server/setup config merge with local overrides
│   ├── mock-data.js            ← Rich mock data for all sections
│   └── store.js                ← Zustand global state
├── scripts/
│   ├── setup.js                ← Wizard for vault path + AI tool detection
│   └── launch.js               ← Install, setup, and run in one command
├── components/
│   ├── layout/
│   │   ├── Sidebar.jsx         ← Navigation with all 14 sections
│   │   └── TopBar.jsx          ← Live clock, gateway status, pending alerts
│   ├── sections/
│   │   ├── MissionControl.jsx  ← Main dashboard overview
│   │   ├── OpenClawStatus.jsx  ← VPS health, agent roster, log stream
│   │   ├── TelegramApproval.jsx← Approve/reject agent actions
│   │   ├── BrandSections.jsx   ← Digital Diamond, Mika, MedAI, CannaOps, etc.
│   │   └── IntelligenceSections.jsx ← Prompts, Goals, Journal, Memory Vault
│   └── ui/index.jsx            ← MetricCard, StatusBadge, AgentCard, etc.
└── pages/index.js              ← Orchestration + live data refresh
```

---

## Planned Integrations

| Integration       | Status     | Notes                                          |
|-------------------|------------|------------------------------------------------|
| OpenClaw Gateway  | Mock → Live | Uncomment `api.js` live blocks                |
| Telegram Bot      | Planned    | Real-time approval push notifications         |
| WhatsApp (Twilio) | Planned    | Broadcast status updates                      |
| Obsidian Vault    | Planned    | Journal, Memory Vault, Prompt Library sync    |
| Google Drive      | Planned    | Per-brand file access                         |

---

## Aesthetics

Luxury dark cockpit — obsidian blacks, gold accents, JetBrains Mono data readouts, Cormorant Garamond display type, Syne UI labels. Glassmorphism panels, subtle grid background, animated status indicators.
