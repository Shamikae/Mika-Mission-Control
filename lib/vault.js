// lib/vault.js — client-side helpers to persist data to the Obsidian vault

async function vaultPost(op, payload) {
  try {
    const response = await fetch('/api/vault', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ op, ...payload }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok !== true) {
      return {
        ok: false,
        error: body.error || 'The vault operation could not be completed.',
      };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: 'The vault could not be reached. Check configuration and try again.',
    };
  }
}

export const vaultAppendChat = (agentLabel, role, content, timestamp, capability) =>
  vaultPost('appendChat', { agentLabel, role, content, timestamp, capability });

export const vaultSaveJournal = (entry) =>
  vaultPost('saveJournal', entry);

export const vaultSyncGoals = (goals) =>
  vaultPost('syncGoals', { goals });
