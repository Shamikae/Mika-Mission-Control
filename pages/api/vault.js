// pages/api/vault.js — writes to Obsidian vault on the local filesystem
import fs   from 'fs';
import path from 'path';
import { loadConfig } from '../../lib/config-loader';

function getVaultConfig() {
  const { vault } = loadConfig();
  if (!vault?.localPath) {
    throw new Error('Vault path is not configured. Run `npm run setup` and choose your vault folder.');
  }
  return vault;
}

function vaultDir(folderKey) {
  const vault = getVaultConfig();
  return path.join(vault.localPath, vault.folders?.[folderKey] || folderKey);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// ── chat ────────────────────────────────────────────────────────────

function appendChat({ agentLabel, role, content, timestamp, capability }) {
  const date = timestamp.slice(0, 10);
  const dir  = vaultDir('chats');
  ensureDir(dir);

  const file = path.join(dir, `${date} - ${agentLabel}.md`);
  const time = new Date(timestamp).toLocaleTimeString('en-US', {
    hour12: false, hour: '2-digit', minute: '2-digit',
  });

  if (!fs.existsSync(file)) {
    const dateLabel = new Date(timestamp).toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    });
    fs.writeFileSync(
      file,
      `# Chat: ${agentLabel} — ${dateLabel}\n\n> Auto-saved from Mika Mission Control\n`,
      'utf8',
    );
  }

  const cap   = capability ? ` \`/${capability}\`` : '';
  const who   = role === 'user' ? `You${cap}` : agentLabel;
  const block = `\n### [${time}] ${who}\n${content}\n`;
  fs.appendFileSync(file, block, 'utf8');
}

// ── journal ─────────────────────────────────────────────────────────

function saveJournal({ title, body, mood, tags, date }) {
  const dir      = vaultDir('journal');
  ensureDir(dir);

  const dateStr   = (date || new Date().toISOString()).slice(0, 10);
  const dateLabel = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });

  const file = path.join(dir, `${dateStr}.md`);

  const moodEmoji = { focused: '🎯', winning: '🔥', blocked: '😤', tired: '😴', curious: '🧠' };
  const moodLine  = mood ? `**Mood:** ${moodEmoji[mood] || ''} ${mood}` : '';
  const tagsLine  = tags?.length ? `**Tags:** ${tags.join(', ')}` : '';

  const entry = [
    `## ${title || 'Entry'} · ${time}`,
    '',
    moodLine,
    tagsLine,
    '',
    body,
    '',
  ].filter(l => l !== null && l !== undefined).join('\n');

  if (fs.existsSync(file)) {
    fs.appendFileSync(file, '\n---\n\n' + entry, 'utf8');
  } else {
    const header = `# Journal — ${dateLabel}\n\n`;
    fs.writeFileSync(file, header + entry, 'utf8');
  }
}

// ── goals ────────────────────────────────────────────────────────────

function syncGoals({ goals }) {
  const vault = getVaultConfig();
  ensureDir(vault.localPath);

  const now = new Date().toLocaleString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  let md = `# Goals\n\n*Last synced: ${now}*\n\n`;

  for (const g of goals) {
    const tasks     = g.tasks || [];
    const done      = tasks.filter(t => t.done).length;
    const progress  = tasks.length > 0
      ? Math.round((done / tasks.length) * 100)
      : (g.progress || 0);

    md += `## ${g.title}\n\n`;
    if (g.brand)    md += `**Brand:** ${g.brand}  \n`;
    if (g.category) md += `**Category:** ${g.category}  \n`;
    if (g.deadline) {
      const due = new Date(g.deadline + 'T12:00:00').toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric',
      });
      md += `**Due:** ${due}  \n`;
    }
    md += `**Progress:** ${progress}%\n\n`;

    if (tasks.length > 0) {
      for (const t of tasks) {
        md += `- [${t.done ? 'x' : ' '}] ${t.text}\n`;
      }
    } else {
      md += `*No tasks yet.*\n`;
    }

    md += '\n---\n\n';
  }

  if (goals.length === 0) md += '*No goals set.*\n';
  const goalsPath = vault.folders?.goals
    ? path.join(vault.localPath, vault.folders.goals, 'Goals.md')
    : path.join(vault.localPath, 'Goals.md');
  ensureDir(path.dirname(goalsPath));
  fs.writeFileSync(goalsPath, md, 'utf8');
}

// ── handler ─────────────────────────────────────────────────────────

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { op, ...payload } = req.body;
  try {
    if      (op === 'appendChat')  appendChat(payload);
    else if (op === 'saveJournal') saveJournal(payload);
    else if (op === 'syncGoals')   syncGoals(payload);
    else return res.status(400).json({ error: 'Unknown op' });
    res.json({ ok: true });
  } catch (e) {
    console.error('[vault]', e);
    res.status(500).json({ error: e.message });
  }
}
