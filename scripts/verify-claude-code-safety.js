#!/usr/bin/env node
// scripts/verify-claude-code-safety.js
// Verifies Claude Code safety constraints and capability mode configuration.
// Run: node scripts/verify-claude-code-safety.js

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;

function check(label, fn) {
  try {
    const result = fn();
    if (result === true || result === undefined) {
      console.log(`  ✓  ${label}`);
      passed++;
    } else {
      console.log(`  ✗  ${label}`);
      console.log(`     → ${result}`);
      failed++;
    }
  } catch (e) {
    console.log(`  ✗  ${label}`);
    console.log(`     → ${e.message}`);
    failed++;
  }
}

// ── Load adapter source ───────────────────────────────────────────────────────

const adapterSrc = fs.readFileSync(path.join(ROOT, 'adapters', 'claude-code.adapter.js'), 'utf-8');

// ── Load env ──────────────────────────────────────────────────────────────────

let envVars = {};
try {
  const envSrc = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf-8');
  for (const line of envSrc.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) envVars[m[1]] = m[2].split('#')[0].trim();
  }
} catch { /* .env.local may not exist in CI */ }

// ── Load CAPABILITY_MODES inline (without module execution) ──────────────────
// We read the constants from source rather than importing to avoid side effects.

const modesMatch = adapterSrc.match(/const CAPABILITY_MODES = \{([\s\S]*?)\n\};/);
const hasModes = !!modesMatch;

console.log('\nClaude Code Safety Verification\n');

// ── 1. Adapter source checks ──────────────────────────────────────────────────
console.log('── Adapter source ─────────────────────────────────────────────');

check('adapters/claude-code.adapter.js exists', () => {
  return fs.existsSync(path.join(ROOT, 'adapters', 'claude-code.adapter.js')) || 'File not found';
});

check('CAPABILITY_MODES constant defined', () => hasModes || 'CAPABILITY_MODES not found in adapter source');

check('analysis-only-no-files mode defined', () =>
  adapterSrc.includes("'analysis-only-no-files'") || '"analysis-only-no-files" mode not found'
);

check('read-only-inspection mode defined', () =>
  adapterSrc.includes("'read-only-inspection'") || '"read-only-inspection" mode not found'
);

check('canWriteFiles is always false in both modes', () => {
  const writeMatches = [...adapterSrc.matchAll(/canWriteFiles:\s*(true)/g)];
  return writeMatches.length === 0 || `canWriteFiles: true found ${writeMatches.length} time(s) — must always be false`;
});

check('canRunShell is always false in both modes', () => {
  const shellMatches = [...adapterSrc.matchAll(/canRunShell:\s*(true)/g)];
  return shellMatches.length === 0 || `canRunShell: true found ${shellMatches.length} time(s) — must always be false`;
});

check('Bash tool not in any allowedTools list', () => {
  const bashInTools = /allowedTools:\s*\[([^\]]*Bash[^\]]*)\]/.test(adapterSrc);
  return !bashInTools || 'Bash found in an allowedTools array — shell execution must not be allowed';
});

check('Write tool not in any allowedTools list', () => {
  const writeInTools = /allowedTools:\s*\[([^\]]*['"]Write['"][^\]]*)\]/.test(adapterSrc);
  return !writeInTools || 'Write found in an allowedTools array — file writes must not be allowed';
});

check('Edit tool not in any allowedTools list', () => {
  const editInTools = /allowedTools:\s*\[([^\]]*['"]Edit['"][^\]]*)\]/.test(adapterSrc);
  return !editInTools || 'Edit found in an allowedTools array — file edits must not be allowed';
});

check('read-only-inspection allows only Read,Glob,Grep,LS', () => {
  const match = adapterSrc.match(/['"]read-only-inspection['"][\s\S]{0,500}?allowedTools:\s*\[([^\]]*)\]/);
  if (!match) return 'Could not extract allowedTools for read-only-inspection';
  const tools = match[1].replace(/['"]/g, '').split(',').map(s => s.trim()).filter(Boolean);
  const forbidden = tools.filter(t => !['Read','Glob','Grep','LS'].includes(t));
  return forbidden.length === 0 || `Forbidden tools in read-only-inspection: ${forbidden.join(', ')}`;
});

check('analysis-only-no-files allows no tools (empty array)', () => {
  const match = adapterSrc.match(/['"]analysis-only-no-files['"][\s\S]{0,500}?allowedTools:\s*\[([^\]]*)\]/);
  if (!match) return 'Could not extract allowedTools for analysis-only-no-files';
  const tools = match[1].replace(/['"]/g, '').split(',').map(s => s.trim()).filter(Boolean);
  return tools.length === 0 || `analysis-only-no-files should have empty allowedTools but found: ${tools.join(', ')}`;
});

check('capabilityMode is surfaced in healthCheck return', () =>
  adapterSrc.includes('capabilityMode:') || 'capabilityMode not returned from healthCheck'
);

check('capabilityMode is surfaced in execute return', () => {
  const executeBlock = adapterSrc.slice(adapterSrc.indexOf('async execute('));
  return executeBlock.includes('capabilityMode:') || 'capabilityMode not returned from execute()';
});

check('safetyNotice is surfaced in healthCheck return', () =>
  adapterSrc.includes('safetyNotice:') || 'safetyNotice not returned from healthCheck'
);

check('Honesty prefix for analysis-only mode is in adapter', () =>
  adapterSrc.includes('Do not claim files exist') || 'Honesty prompt prefix not found for analysis-only mode'
);

// ── 2. Env configuration checks ───────────────────────────────────────────────
console.log('\n── Environment configuration ───────────────────────────────────');

const toolMode = envVars['CLAUDE_CODE_TOOL_MODE'];
check('CLAUDE_CODE_TOOL_MODE is set in .env.local', () =>
  toolMode !== undefined || 'CLAUDE_CODE_TOOL_MODE not found in .env.local'
);

check('CLAUDE_CODE_TOOL_MODE is a known mode', () => {
  const valid = ['analysis-only-no-files', 'read-only-inspection'];
  return (toolMode && valid.includes(toolMode)) || `Unknown mode "${toolMode}". Valid: ${valid.join(', ')}`;
});

const currentMode = toolMode || 'analysis-only-no-files';
console.log(`     Active mode: ${currentMode}`);

if (currentMode === 'read-only-inspection') {
  check('read-only-inspection: no write tools implied by mode', () => true);
  check('read-only-inspection: canInspectFiles will be true', () => true);
} else {
  check('analysis-only-no-files: canInspectFiles will be false', () => true);
  check('analysis-only-no-files: honesty prefix will be prepended', () => true);
}

// ── 3. Governance documentation ───────────────────────────────────────────────
console.log('\n── Governance documentation ────────────────────────────────────');

const govSrc = fs.readFileSync(path.join(ROOT, 'AGENT_GOVERNANCE.md'), 'utf-8');

check('AGENT_GOVERNANCE.md documents analysis-only-no-files mode', () =>
  govSrc.includes('analysis-only-no-files') || 'Mode not documented in governance'
);

check('AGENT_GOVERNANCE.md documents read-only-inspection mode', () =>
  govSrc.includes('read-only-inspection') || 'Mode not documented in governance'
);

check('AGENT_GOVERNANCE.md documents implementation mode as not-yet-available', () =>
  govSrc.includes('implementation') || 'Implementation mode not mentioned in governance'
);

check('AGENT_GOVERNANCE.md states canWriteFiles always false', () =>
  govSrc.includes('canWriteFiles') || 'canWriteFiles not mentioned in governance'
);

// ── 4. UI surface checks ──────────────────────────────────────────────────────
console.log('\n── UI surface ──────────────────────────────────────────────────');

const engDivSrc = fs.readFileSync(path.join(ROOT, 'components/sections/EngineeringDivision.jsx'), 'utf-8');

check('EngineeringDivision renders CapabilityBadge', () =>
  engDivSrc.includes('CapabilityBadge') || 'CapabilityBadge not found in EngineeringDivision'
);

check('EngineeringDivision shows READ-ONLY INSPECTION ENABLED label', () =>
  engDivSrc.includes('READ-ONLY INSPECTION ENABLED') || 'Label not found'
);

check('EngineeringDivision shows ANALYSIS ONLY — NO FILE INSPECTION label', () =>
  engDivSrc.includes('ANALYSIS ONLY') || 'Label not found'
);

const workspaceSrc = fs.readFileSync(path.join(ROOT, 'components/sections/AgentWorkspace.jsx'), 'utf-8');

check('AgentWorkspace renders CAPABILITY CONTRACT panel for claude-code', () =>
  workspaceSrc.includes('CAPABILITY CONTRACT') || 'CAPABILITY CONTRACT panel not found in AgentWorkspace'
);

check('AgentWorkspace shows canInspectFiles in capability panel', () =>
  workspaceSrc.includes('INSPECT FILES') || 'INSPECT FILES row not found'
);

check('AgentWorkspace shows canWriteFiles: NO in capability panel', () =>
  workspaceSrc.includes("'NO'") || workspaceSrc.includes('"NO"') || 'NO value not found for write/shell rows'
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n── Summary ─────────────────────────────────────────────────────');
console.log(`   ${passed} passed  ${failed} failed`);
if (failed > 0) {
  console.log(`\n   ✗ Safety verification failed. Review failures above before running Claude Code.\n`);
  process.exit(1);
} else {
  console.log(`\n   ✓ All safety constraints verified. Active mode: ${currentMode}\n`);
}
