/**
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  OPENCLAW MISSION CONTROL — CENTRAL CONFIGURATION               │
 * │  Edit this file to connect your live VPS, Telegram, vault, etc. │
 * └─────────────────────────────────────────────────────────────────┘
 */

const config = {
  // ── Gateway ───────────────────────────────────────────────────────
  gateway: {
    vpsUrl:              process.env.NEXT_PUBLIC_VPS_GATEWAY_URL  || 'https://YOUR_VPS_IP:8080',
    localUrl:            process.env.NEXT_PUBLIC_LOCAL_GATEWAY_URL || 'http://localhost:8080',
    apiKey:              process.env.OPENCLAW_API_KEY || 'YOUR_API_KEY_HERE',
    healthCheckInterval: 15_000,
    vpsTimeoutMs:        5_000,
  },

  // ── Telegram ──────────────────────────────────────────────────────
  telegram: {
    botToken:        process.env.TELEGRAM_BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN',
    chatId:          process.env.TELEGRAM_CHAT_ID   || 'YOUR_CHAT_ID',
    approvalChannel: process.env.TELEGRAM_APPROVAL_CHANNEL || '@YourApprovalChannel',
    webhookSecret:   process.env.TELEGRAM_WEBHOOK_SECRET || '',
    polling:         true,
  },

  // ── WhatsApp ──────────────────────────────────────────────────────
  whatsapp: {
    accountSid:      process.env.WHATSAPP_ACCOUNT_SID || '',
    authToken:       process.env.WHATSAPP_AUTH_TOKEN  || '',
    phoneNumberId:   process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    recipientNumber: process.env.WHATSAPP_RECIPIENT || '+1XXXXXXXXXX',
  },

  // ── Obsidian Vault ────────────────────────────────────────────────
  vault: {
    localPath: process.env.VAULT_PATH || '',
    folders: {
      chats: 'Chats', journal: 'Journal', goals: 'Goals', memory: 'Memory Vault',
      prompts: 'Prompt Library', tasks: 'Tasks', research: 'Research',
    },
  },

  // ── Local AI Tools Detected by Setup ─────────────────────────────
  localAiTools: [],

  // ── Google Drive ──────────────────────────────────────────────────
  googleDrive: {
    clientId:     process.env.GOOGLE_CLIENT_ID     || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN || '',
    folderIds: {
      digitalDiamond: '', managedByMika: '', medAi: '',
      cannaOps: '', hotelHooker: '', aiTwin: '',
    },
  },

  // ── Projects / Brands ─────────────────────────────────────────────
  projects: [
    { id: 'digital-diamond', label: 'Digital Diamond AI',   color: '#c9a84c', icon: '💎', description: 'AI consulting & premium automation services' },
    { id: 'managed-by-mika', label: 'Managed by Mika',      color: '#0dd3c5', icon: '🤖', description: 'AI-powered property & hospitality management' },
    { id: 'medai',           label: 'MedAI Receptionist',   color: '#818cf8', icon: '⚕️', description: 'AI medical front-desk & scheduling agent' },
    { id: 'cannaops',        label: 'CannaOps',             color: '#4ade80', icon: '🌿', description: 'Cannabis dispensary automation & compliance' },
    { id: 'hotel-hooker',    label: 'The Hotel Hooker',     color: '#f472b6', icon: '🎭', description: 'Boutique hospitality content & support' },
    { id: 'ai-twin',         label: 'AI Twin Studio',       color: '#60a5fa', icon: '🪞', description: 'Personal AI content creation & brand cloning' },
    { id: 'lead-recovery',   label: 'Lead Recovery',        color: '#fb923c', icon: '🎯', description: 'Multi-channel lead reactivation workflows' },
    { id: 'hermes',          label: 'Hermes',               color: '#a78bfa', icon: '⚡', description: 'Cross-brand messaging & comms automation' },
  ],

  // ── Agent Systems ─────────────────────────────────────────────────
  /**
   * systemType controls HOW the dashboard talks to the agent's host.
   *
   *  openclaw  → OpenClaw REST gateway  (your VPS)
   *  n8n       → n8n workflow API       (self-hosted or cloud)
   *  make      → Make.com webhook/API
   *  flowise   → Flowise chatflow API
   *  custom    → Any HTTP endpoint you define (baseUrl + auth)
   *  local     → Local Docker/process via localhost
   *
   * controlEndpoints maps action names to relative URL paths.
   * The api.js layer resolves baseUrl + path and fires the request.
   */
  agentSystems: {
    openclaw: {
      label:   'OpenClaw Gateway',
      baseUrl: process.env.NEXT_PUBLIC_VPS_GATEWAY_URL || 'https://YOUR_VPS_IP:8080',
      auth: { type: 'bearer', token: process.env.OPENCLAW_API_KEY || '' },
      controlEndpoints: {
        status:  'GET  /api/agents/:id',
        start:   'POST /api/agents/:id/start',
        stop:    'POST /api/agents/:id/stop',
        restart: 'POST /api/agents/:id/restart',
        pause:   'POST /api/agents/:id/pause',
        resume:  'POST /api/agents/:id/resume',
        dispatch:'POST /api/agents/:id/task',
        logs:    'GET  /api/agents/:id/logs',
        memory:  'GET  /api/agents/:id/memory',
        config:  'GET  /api/agents/:id/config',
        setConfig:'PUT /api/agents/:id/config',
      },
    },
    n8n: {
      label:   'n8n Workflows',
      baseUrl: process.env.NEXT_PUBLIC_N8N_URL || 'http://localhost:5678',
      auth: { type: 'api-key', header: 'X-N8N-API-KEY', token: process.env.N8N_API_KEY || '' },
      controlEndpoints: {
        status:   'GET  /api/v1/workflows/:id',
        start:    'POST /api/v1/workflows/:id/activate',
        stop:     'POST /api/v1/workflows/:id/deactivate',
        dispatch: 'POST /webhook/:id',
        logs:     'GET  /api/v1/executions?workflowId=:id&limit=25',
      },
    },
    make: {
      label:   'Make.com',
      baseUrl: 'https://hook.eu1.make.com',
      auth: { type: 'none' },
      controlEndpoints: {
        dispatch: 'POST /:id',
      },
    },
    flowise: {
      label:   'Flowise',
      baseUrl: process.env.NEXT_PUBLIC_FLOWISE_URL || 'http://localhost:3001',
      auth: { type: 'bearer', token: process.env.FLOWISE_API_KEY || '' },
      controlEndpoints: {
        dispatch: 'POST /api/v1/prediction/:id',
        logs:     'GET  /api/v1/chatmessage/:id',
      },
    },
    custom: {
      label:   'Custom HTTP',
      baseUrl: '',   // set per-agent via agent.systemConfig.baseUrl
      auth: { type: 'bearer', token: '' },
      controlEndpoints: {
        status:   'GET  /status',
        start:    'POST /start',
        stop:     'POST /stop',
        restart:  'POST /restart',
        dispatch: 'POST /task',
        logs:     'GET  /logs',
      },
    },
    local: {
      label:   'Local Docker',
      baseUrl: 'http://localhost',
      auth: { type: 'none' },
      controlEndpoints: {
        status:   'GET  /health',
        start:    'POST /start',
        stop:     'POST /stop',
        restart:  'POST /restart',
        dispatch: 'POST /run',
        logs:     'GET  /logs',
      },
    },
  },

  // ── Agents ────────────────────────────────────────────────────────
  /**
   * Each agent declares:
   *   systemType  — which agentSystem entry to use
   *   systemId    — the ID/slug used in that system's URLs (:id placeholder)
   *   systemConfig— per-agent overrides (e.g. custom baseUrl for 'custom' type)
   *   capabilities— what actions this agent can receive (shown in workspace UI)
   *   schedule    — cron string or null
   *   memory      — does this agent support persistent memory reads?
   */
  agents: [
    {
      id:         'mika',
      label:      'Mika',
      project:    'managed-by-mika',
      model:      'gpt-4o',
      systemType: 'openclaw',
      systemId:   'mika',
      capabilities: ['checkin', 'checkout', 'guest_message', 'maintenance', 'report', 'booking'],
      schedule:   '*/15 * * * *',
      memory:     true,
      description: 'Handles all guest operations autonomously across managed properties.',
    },
    {
      id:         'diamond',
      label:      'Diamond',
      project:    'digital-diamond',
      model:      'gpt-4o',
      systemType: 'openclaw',
      systemId:   'diamond',
      capabilities: ['draft_proposal', 'research', 'outreach', 'analytics', 'report'],
      schedule:   null,
      memory:     true,
      description: 'AI consulting agent — drafts proposals, runs research, manages outreach.',
    },
    {
      id:         'medbot',
      label:      'MedBot',
      project:    'medai',
      model:      'gpt-4o-mini',
      systemType: 'openclaw',
      systemId:   'medbot',
      capabilities: ['schedule_appointment', 'handle_call', 'insurance_check', 'waitlist', 'notify_staff'],
      schedule:   '0 8 * * 1-5',
      memory:     false,
      description: 'Manages inbound calls, appointment scheduling, and patient comms.',
    },
    {
      id:         'cannabot',
      label:      'CannaBot',
      project:    'cannaops',
      model:      'gpt-4o-mini',
      systemType: 'openclaw',
      systemId:   'cannabot',
      capabilities: ['inventory_sync', 'compliance_check', 'report', 'leafly_update'],
      schedule:   '0 */6 * * *',
      memory:     false,
      description: 'Syncs inventory, flags compliance issues, generates regulatory digests.',
    },
    {
      id:         'hookr',
      label:      'Hookr',
      project:    'hotel-hooker',
      model:      'claude-3-5-sonnet-20241022',
      systemType: 'openclaw',
      systemId:   'hookr',
      capabilities: ['generate_content', 'post_to_social', 'caption', 'story', 'schedule_post'],
      schedule:   '0 10 * * *',
      memory:     true,
      description: 'Generates and schedules brand content across all Hotel Hooker channels.',
    },
    {
      id:         'twin',
      label:      'Twin',
      project:    'ai-twin',
      model:      'claude-3-5-sonnet-20241022',
      systemType: 'openclaw',
      systemId:   'twin',
      capabilities: ['script_video', 'generate_hooks', 'batch_content', 'voice_clone_prep', 'publish'],
      schedule:   '0 9 * * *',
      memory:     true,
      description: 'Personal brand AI — writes scripts, generates hooks, batches content calendars.',
    },
    {
      id:         'recovery',
      label:      'Recovery',
      project:    'lead-recovery',
      model:      'gpt-4o-mini',
      systemType: 'openclaw',
      systemId:   'recovery',
      capabilities: ['whatsapp_sequence', 'email_sequence', 'telegram_ping', 'tag_lead', 'book_call'],
      schedule:   '0 14 * * 1-5',
      memory:     true,
      description: 'Runs multi-channel reactivation sequences on cold leads.',
    },
    {
      id:         'hermes',
      label:      'Hermes',
      project:    'hermes',
      model:      'gpt-4o',
      systemType: 'custom',        // ← lives in a separate system
      systemId:   'hermes-main',
      systemConfig: {
        baseUrl: process.env.NEXT_PUBLIC_HERMES_URL || 'http://localhost:4000',
        auth: { type: 'bearer', token: process.env.HERMES_API_KEY || '' },
      },
      capabilities: ['send_message', 'broadcast', 'route_comms', 'translate', 'summarize_thread', 'draft_reply'],
      schedule:   null,
      memory:     true,
      description: 'Cross-brand communications agent — routes, drafts, and manages outbound messaging.',
    },
    {
      id:         'sentinel',
      label:      'Sentinel',
      project:    null,
      model:      'gpt-4o-mini',
      systemType: 'openclaw',
      systemId:   'sentinel',
      capabilities: ['health_check', 'alert', 'monitor', 'failover'],
      schedule:   '*/5 * * * *',
      memory:     false,
      description: 'System watchdog — monitors all agents and fires alerts on failures.',
    },
  ],

  // ── Approval Rules ────────────────────────────────────────────────
  approvalRules: {
    requireApproval: [
      'post_to_social', 'send_email_blast', 'charge_client',
      'publish_content', 'whatsapp_broadcast', 'delete_record',
      'file_compliance_doc', 'broadcast',
    ],
    autoApprove: [
      'fetch_analytics', 'generate_draft', 'read_calendar',
      'health_check', 'monitor', 'report',
    ],
    approvalWindowHours: 24,
    reminderMinutes: 30,
  },

  // ── Dashboard ─────────────────────────────────────────────────────
  ui: {
    liveRefreshMs:  10_000,
    operatorName:   'Command',
    timezone:       'America/New_York',
  },
};

module.exports = config;
