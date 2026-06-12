import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const MEMORY_DIR = join(process.cwd(), 'memory');

/**
 * Load rolling memory entries for a business lane.
 * Returns [] safely if the file is missing or unreadable.
 */
export function loadLaneMemory(laneId) {
  if (!laneId) return [];
  try {
    const file = join(MEMORY_DIR, `${laneId}.json`);
    if (!existsSync(file)) return [];
    const entries = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

/**
 * Format loaded memory as a compact system-prompt block.
 * Injects the N most recent entries. Keeps tokens low.
 */
export function formatMemoryBlock(entries, maxEntries = 5) {
  const recent = entries.slice(0, maxEntries);
  if (recent.length === 0) return null;

  const lines = recent.map(m => {
    const d = new Date(m.timestamp);
    const stamp = `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const response = m.responseSummary ? ` → ${m.responseSummary}` : '';
    return `• [${stamp}] ${m.taskType}: ${m.summary}${response}`;
  });

  return `RECENT MEMORY (last ${recent.length} tasks):\n${lines.join('\n')}`;
}
