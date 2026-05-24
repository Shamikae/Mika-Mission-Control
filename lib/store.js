// lib/store.js
import { create } from 'zustand';

export const useStore = create((set, get) => ({
  // ── Theme ───────────────────────────────────────────
  theme: 'dark',
  toggleTheme: () => set((s) => {
    const next = s.theme === 'dark' ? 'light' : 'dark';
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('mika-theme', next); } catch {}
    }
    return { theme: next };
  }),

  // ── Active Section ──────────────────────────────────
  activeSection: 'mission-control',
  setActiveSection: (s) => set({ activeSection: s, activeAgentId: null }),

  // ── Active Agent Workspace ───────────────────────────
  activeAgentId: null,
  setActiveAgentId: (id) => set({ activeAgentId: id, activeSection: id ? 'agent-workspace' : get().activeSection }),
  clearAgentWorkspace: () => set({ activeAgentId: null, activeSection: 'mission-control' }),

  // ── Gateway Status ──────────────────────────────────
  gatewayStatus: null,
  setGatewayStatus: (s) => set({ gatewayStatus: s }),

  // ── Approvals ───────────────────────────────────────
  pendingApprovals: [],
  setPendingApprovals: (a) => set({ pendingApprovals: a }),
  removeApproval: (id) => set((s) => ({
    pendingApprovals: s.pendingApprovals.filter((a) => a.id !== id),
  })),

  // ── Per-agent live logs ─────────────────────────────
  agentLogs: {},
  appendAgentLog: (agentId, entry) => set((s) => ({
    agentLogs: {
      ...s.agentLogs,
      [agentId]: [entry, ...(s.agentLogs[agentId] || [])].slice(0, 200),
    },
  })),
  clearAgentLogs: (agentId) => set((s) => ({
    agentLogs: { ...s.agentLogs, [agentId]: [] },
  })),

  // ── Per-agent chat messages ─────────────────────────
  agentChats: {},
  appendChatMessage: (agentId, msg) => set((s) => ({
    agentChats: {
      ...s.agentChats,
      [agentId]: [...(s.agentChats[agentId] || []), msg],
    },
  })),
  clearAgentChat: (agentId) => set((s) => ({
    agentChats: { ...s.agentChats, [agentId]: [] },
  })),

  // ── Per-agent status overrides ──────────────────────
  agentStatusOverrides: {},
  setAgentStatus: (agentId, status) => set((s) => ({
    agentStatusOverrides: { ...s.agentStatusOverrides, [agentId]: status },
  })),

  // ── Notifications ───────────────────────────────────
  notifications: [],
  addNotification: (n) => set((s) => ({
    notifications: [
      { id: Date.now(), ts: new Date().toISOString(), ...n },
      ...s.notifications.slice(0, 49),
    ],
  })),

  // ── Sidebar ─────────────────────────────────────────
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}));
