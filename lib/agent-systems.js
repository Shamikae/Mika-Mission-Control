// lib/agent-systems.js
// ─────────────────────────────────────────────────────────────────────
// System-type abstraction layer.
// Each exported function accepts an agent definition (from config)
// and resolves the correct HTTP call for that agent's systemType.
// ─────────────────────────────────────────────────────────────────────

const MOCK_MODE = !process.env.NEXT_PUBLIC_VPS_GATEWAY_URL ||
                  (process.env.NEXT_PUBLIC_VPS_GATEWAY_URL || '').includes('YOUR_VPS_IP');

// ── Mock log lines per agent ──────────────────────────────────────

const MOCK_LOGS = {
  mika:     ['[TASK] guest-checkin-408 completed · 2.1s', '[INFO] WhatsApp sent → Priya', '[INFO] Maintenance ticket #44 closed', '[TASK] Late checkout approved: Rm 311'],
  diamond:  ['[TASK] Draft proposal: TechCo AI Audit v1 · 8,412 tokens', '[INFO] Apollo list parsed: 87 leads', '[TASK] Email sequence queued: 87 recipients'],
  medbot:   ['[CALL] Inbound handled: schedule_appointment · 47s', '[INFO] Appointment confirmed: Dr. Chen 14:30', '[TASK] Waitlist slot filled: cancellation Rm 10:00'],
  cannabot: ['[ERROR] Leafly rate limit exceeded — retry in 60s', '[INFO] Inventory fetch queued', '[TASK] Compliance digest generated: FL-2024-Q4'],
  hookr:    ['[APPROVAL] post_to_social queued → Instagram × 4 stories', '[INFO] Brand voice check passed', '[TASK] Caption batch generated: 10 posts'],
  twin:     ['[TASK] Script batch: Ep 4–6 complete · hook avg 8.7', '[INFO] Hook score eval: Ep7 = 7.9/10', '[TASK] TikTok queue updated: 3 new scripts'],
  recovery: ['[TASK] WhatsApp sequence: 31 sent, 14 replied', '[INFO] Lead tagged: truly-cold × 5', '[TASK] Call booked: Alex B. → Friday 3pm'],
  hermes:   ['[ROUTE] Inbound message classified: sales_inquiry', '[TASK] Draft reply generated: TechCo thread', '[INFO] Broadcast queued: 12 recipients'],
  sentinel: ['[HEALTH] All agents nominal', '[ALERT] cannabot: Leafly API error — notified', '[HEALTH] Gateway latency: 42ms'],
};

const MOCK_MEMORY = {
  mika:     [{ key: 'guest_prefs:408', value: 'Priya: quiet room, no calls after 10pm, vegan breakfast' }, { key: 'property:miami_beach', value: 'Check-in: 3pm. Parking: valet $25/night. Pool: heated.' }],
  diamond:  [{ key: 'client:techco', value: 'CEO: Marcus Webb. Budget $8-15k. Pain: manual ops handoffs. Async comms preferred.' }, { key: 'pitch:audit_template', value: 'Standard 12-page AI readiness audit format v3.' }],
  hermes:   [{ key: 'routing:sales', value: 'Sales inquiries → Diamond agent. Response SLA: 2h.' }, { key: 'routing:support', value: 'Support → Mika or MedBot based on brand context.' }],
  medbot:   [{ key: 'dr_chen:schedule', value: 'Mon-Fri 9am-5pm. Lunch 12-1pm. No new patients Fridays.' }],
  cannabot: [{ key: 'leafly:rate_limit', value: 'Free tier: 100 req/hour. Resets at :00. Use cache when possible.' }],
  twin:     [{ key: 'voice:style', value: 'Conversational, slightly provocative, first-person, no corporate speak.' }, { key: 'series:ai_job', value: '7-episode arc. Eps 1-3 published. 4-6 pending approval.' }],
  recovery: [{ key: 'sequence:warmup', value: 'Day 0 → Day 3 → Day 7 → Day 14. Archive if no reply after Day 14.' }],
  sentinel: [],
  hookr:    [{ key: 'brand:voice', value: 'Cheeky, luxury, unapologetic. Double-entendres OK. Never explicit.' }],
};

// ── System resolver ────────────────────────────────────────────────

function resolveSystem(agentDef) {
  // agentDef.systemConfig can override the global system config
  const base = agentDef.systemConfig || {};
  return { systemType: agentDef.systemType || 'openclaw', ...base };
}

function buildUrl(agentDef, action) {
  // In a real implementation: look up agentSystems[systemType].controlEndpoints[action]
  // replace :id with agentDef.systemId, prepend baseUrl.
  // For now returns a placeholder that the mock intercepts.
  return `/__agent__/${agentDef.id}/${action}`;
}

async function agentFetch(agentDef, action, method = 'GET', body = null) {
  if (MOCK_MODE) return null; // caller handles mock path
  const url = buildUrl(agentDef, action);
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  const sys = resolveSystem(agentDef);
  if (sys.auth?.type === 'bearer')  opts.headers['Authorization'] = `Bearer ${sys.auth.token}`;
  if (sys.auth?.type === 'api-key') opts.headers[sys.auth.header || 'X-API-Key'] = sys.auth.token;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`Agent ${agentDef.id} → ${action}: HTTP ${res.status}`);
  return res.json();
}

// ── Public API ─────────────────────────────────────────────────────

export async function agentGetStatus(agentDef) {
  if (MOCK_MODE) return { id: agentDef.id, status: 'running', uptime: '4h 12m', taskCount: 24 };
  return agentFetch(agentDef, 'status');
}

export async function agentStart(agentDef) {
  if (MOCK_MODE) return { success: true, status: 'running' };
  return agentFetch(agentDef, 'start', 'POST');
}

export async function agentStop(agentDef) {
  if (MOCK_MODE) return { success: true, status: 'stopped' };
  return agentFetch(agentDef, 'stop', 'POST');
}

export async function agentRestart(agentDef) {
  if (MOCK_MODE) return { success: true, status: 'running' };
  return agentFetch(agentDef, 'restart', 'POST');
}

export async function agentPause(agentDef) {
  if (MOCK_MODE) return { success: true, status: 'paused' };
  return agentFetch(agentDef, 'pause', 'POST');
}

export async function agentResume(agentDef) {
  if (MOCK_MODE) return { success: true, status: 'running' };
  return agentFetch(agentDef, 'resume', 'POST');
}

export async function agentDispatch(agentDef, task) {
  // task: { capability, input, priority, requireApproval }
  if (MOCK_MODE) {
    await new Promise(r => setTimeout(r, 400 + Math.random() * 600));
    return {
      taskId:    `task-${Date.now()}`,
      status:   'accepted',
      agentId:   agentDef.id,
      queuePos:  1,
      estimatedMs: Math.floor(1000 + Math.random() * 4000),
    };
  }
  return agentFetch(agentDef, 'dispatch', 'POST', task);
}

export async function agentGetLogs(agentDef, limit = 50) {
  if (MOCK_MODE) {
    const base = MOCK_LOGS[agentDef.id] || ['[INFO] Agent operational'];
    const logs = [];
    const now = Date.now();
    for (let i = 0; i < Math.min(limit, 20); i++) {
      const line = base[i % base.length];
      logs.push({
        ts:    new Date(now - i * 47000).toISOString(),
        level: line.startsWith('[ERROR]') ? 'ERROR' : line.startsWith('[ALERT]') ? 'WARN' : 'INFO',
        msg:   line.replace(/^\[\w+\] /, ''),
        raw:   line,
      });
    }
    return logs;
  }
  return agentFetch(agentDef, 'logs');
}

export async function agentGetMemory(agentDef) {
  if (MOCK_MODE) return MOCK_MEMORY[agentDef.id] || [];
  return agentFetch(agentDef, 'memory');
}

export async function agentGetConfig(agentDef) {
  if (MOCK_MODE) return {
    model:       agentDef.model,
    schedule:    agentDef.schedule,
    memory:      agentDef.memory,
    systemType:  agentDef.systemType,
    systemId:    agentDef.systemId,
    capabilities:agentDef.capabilities,
  };
  return agentFetch(agentDef, 'config');
}

export async function agentSetConfig(agentDef, patch) {
  if (MOCK_MODE) return { success: true, config: { ...patch } };
  return agentFetch(agentDef, 'setConfig', 'PUT', patch);
}

// ── System connection test ─────────────────────────────────────────
export async function testSystemConnection(agentDef) {
  if (MOCK_MODE) {
    await new Promise(r => setTimeout(r, 300));
    return {
      reachable: agentDef.id !== 'cannabot',
      latencyMs: 30 + Math.floor(Math.random() * 80),
      systemType: agentDef.systemType,
      error: agentDef.id === 'cannabot' ? 'Connection refused' : null,
    };
  }
  try {
    const start = Date.now();
    await agentFetch(agentDef, 'status');
    return { reachable: true, latencyMs: Date.now() - start, systemType: agentDef.systemType };
  } catch (e) {
    return { reachable: false, latencyMs: null, systemType: agentDef.systemType, error: e.message };
  }
}
