// lib/vault.js — client-side helpers to persist data to the Obsidian vault

async function vaultPost(op, payload) {
  try {
    await fetch('/api/vault', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ op, ...payload }),
    });
  } catch (e) {
    console.warn('[vault] save failed:', e.message);
  }
}

export const vaultAppendChat = (agentLabel, role, content, timestamp, capability) =>
  vaultPost('appendChat', { agentLabel, role, content, timestamp, capability });

export const vaultSaveJournal = (entry) =>
  vaultPost('saveJournal', entry);

export const vaultSyncGoals = (goals) =>
  vaultPost('syncGoals', { goals });
