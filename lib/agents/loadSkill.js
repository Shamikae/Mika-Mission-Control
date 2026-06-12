// lib/agents/loadSkill.js
// SERVER-SIDE ONLY — uses fs.
// Loads skill definition files from /skills/{agentId}.md.
// Skills are injected into Hermes as system context to shape specialist behaviour.

import path from 'path';
import fs from 'fs';

const SKILLS_DIR = path.join(process.cwd(), 'skills');

// Maps agentId → skill filename (identical by convention, explicit for clarity)
const SKILL_MAP = {
  'trend-hunter':    'trend-hunter.md',
  'hook-engineer':   'hook-engineer.md',
  'content-architect':'content-architect.md',
  'prompt-engineer': 'prompt-engineer.md',
  'publisher':       'publisher.md',
  'analytics-agent': 'analytics-agent.md',
};

// Agents without a dedicated skill — no injection for these
const NO_SKILL_AGENTS = new Set([
  'openclaw', 'hermes', 'recovery', 'mika', 'diamond', 'medbot',
  'cannabot', 'hookr', 'twin', 'sentinel', 'claude-code', 'codex',
]);

let _cache = {};

/**
 * Load the full skill definition for an agent.
 * Returns null if the agent has no skill file.
 *
 * @param {string} agentId
 * @returns {{ agentId, skillId, exists, content, promptBlock } | null}
 */
export function loadSkill(agentId) {
  if (!agentId || NO_SKILL_AGENTS.has(agentId)) return null;

  const filename = SKILL_MAP[agentId];
  if (!filename) return null;

  if (_cache[agentId]) return _cache[agentId];

  const skillPath = path.join(SKILLS_DIR, filename);

  try {
    if (!fs.existsSync(skillPath)) {
      return { agentId, skillId: agentId, exists: false, content: null, promptBlock: null };
    }

    const content = fs.readFileSync(skillPath, 'utf-8');

    // Build the clean prompt block for injection into Hermes
    // Strip HTML comments (<!-- ... -->) and keep the rest of the markdown
    const promptBlock = buildPromptBlock(agentId, content);

    const result = { agentId, skillId: agentId, exists: true, content, promptBlock };
    _cache[agentId] = result;
    return result;
  } catch {
    return { agentId, skillId: agentId, exists: false, content: null, promptBlock: null };
  }
}

/**
 * Return just the injectable prompt string for an agent.
 * Returns null if no skill exists.
 *
 * @param {string} agentId
 * @returns {string | null}
 */
export function getSkillPrompt(agentId) {
  const skill = loadSkill(agentId);
  return skill?.promptBlock || null;
}

/**
 * Check whether a skill file exists for an agent without loading the content.
 *
 * @param {string} agentId
 * @returns {{ skillId: string|null, exists: boolean, agentId: string }}
 */
export function validateSkill(agentId) {
  if (!agentId || NO_SKILL_AGENTS.has(agentId)) {
    return { agentId, skillId: null, exists: false };
  }
  const filename = SKILL_MAP[agentId];
  if (!filename) {
    return { agentId, skillId: null, exists: false };
  }
  const skillPath = path.join(SKILLS_DIR, filename);
  const exists    = fs.existsSync(skillPath);
  return { agentId, skillId: exists ? agentId : null, exists };
}

/**
 * List all known skill IDs.
 * @returns {string[]}
 */
export function listSkillIds() {
  return Object.keys(SKILL_MAP);
}

// ── Internal ──────────────────────────────────────────────────────────────────

/**
 * Build a clean system-prompt block from skill markdown.
 * Strips HTML comments, preserves section headings and content.
 * Wraps in clear delimiters so Hermes knows it is a skill context injection.
 */
function buildPromptBlock(agentId, content) {
  const cleaned = content
    // Remove HTML comments (<!-- ... -->)
    .replace(/<!--[\s\S]*?-->/g, '')
    // Collapse multiple blank lines to at most two
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return [
    `[SPECIALIST SKILL CONTEXT — ${agentId.toUpperCase()}]`,
    `You are acting as a specialist agent. Follow the skill definition below precisely.`,
    `Your output format, process, and constraints are defined by this skill.`,
    ``,
    cleaned,
    ``,
    `[END SKILL CONTEXT]`,
    `Apply this skill to the task that follows. Respond only as defined above.`,
  ].join('\n');
}
