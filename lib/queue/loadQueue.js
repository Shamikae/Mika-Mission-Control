import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const QUEUE_FILE = join(process.cwd(), 'queue', 'tasks-queue.json');

export function loadQueue() {
  try {
    if (!existsSync(QUEUE_FILE)) return [];
    const entries = JSON.parse(readFileSync(QUEUE_FILE, 'utf8'));
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}
