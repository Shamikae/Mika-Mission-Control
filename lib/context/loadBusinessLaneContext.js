import { readFileSync } from 'fs';
import { join } from 'path';

const CONTEXT_FILE = join(process.cwd(), 'context', 'business-lanes.json');

let _cache = null;

function getLanes() {
  if (_cache) return _cache;
  try {
    _cache = JSON.parse(readFileSync(CONTEXT_FILE, 'utf8'));
  } catch {
    _cache = {};
  }
  return _cache;
}

/**
 * Load the persistent context for a business lane.
 * Returns null (safe) if the lane ID is missing or the file is unreadable.
 */
export function loadBusinessLaneContext(laneId) {
  if (!laneId) return null;
  const lane = getLanes()[laneId];
  if (!lane) return null;
  return {
    laneId,
    displayName:          String(lane.displayName          || laneId),
    sessionKey:           String(lane.sessionKey           || laneId),
    voice:                String(lane.voice                || ''),
    mission:              String(lane.mission              || ''),
    goals:                Array.isArray(lane.goals)                ? lane.goals                : [],
    contentFocus:         String(lane.contentFocus         || ''),
    operatingInstructions: Array.isArray(lane.operatingInstructions) ? lane.operatingInstructions : [],
  };
}
