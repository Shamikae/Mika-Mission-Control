# ◈ OpenClaw Mission Control

> Your personal AI business cockpit — a luxury hybrid dashboard for solopreneurs running multiple AI-powered brands.

Built with **Next.js 14**, **Tailwind CSS**, **Framer Motion**, and **Zustand**.

---

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure your environment
```bash
cp .env.example .env.local
# Edit .env.local with your VPS URL, API key, Telegram token, etc.
```

### 3. Edit the central config
Open `config/openclaw.config.js` and update:
- `gateway.vpsUrl` → your Hostinger VPS public IP/domain
- `gateway.apiKey` → your OpenClaw shared secret
- `telegram.botToken` + `chatId`
- `vault.localPath` → path to your Obsidian vault on this Mac
- `projects` → add/remove brands
- `agents` → add/remove agent definitions
- `approvalRules` → customize which actions need human review

### 4. Run locally
```bash
npm run dev
```
Dashboard opens at: **http://localhost:3099**

---

## Connecting to Live OpenClaw

The API layer is in `lib/api.js`. Each function has a commented-out `// LIVE:` block showing the real gateway call. To go live:

1. Set `NEXT_PUBLIC_VPS_GATEWAY_URL` in `.env.local`
2. Uncomment the `// LIVE:` lines in `lib/api.js`
3. Remove the `if (MOCK_MODE) return mock.xxx;` guards

The dashboard will automatically prefer your VPS and fall back to the local Docker instance if the VPS is unreachable.

---

## Architecture

```
openclaw-mission-control/
├── config/openclaw.config.js   ← Central config (VPS URL, agents, approval rules)
├── lib/
│   ├── api.js                  ← API abstraction (mock → live swap)
│   ├── mock-data.js            ← Rich mock data for all sections
│   └── store.js                ← Zustand global state
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
