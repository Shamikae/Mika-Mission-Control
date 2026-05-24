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
