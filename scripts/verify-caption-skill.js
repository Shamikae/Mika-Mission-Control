#!/usr/bin/env node
// scripts/verify-caption-skill.js
// Verifies TikTok caption skill wiring, sanitizer, and CSCEC validator.
// Run: node scripts/verify-caption-skill.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT       = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_FILE = path.join(ROOT, 'prompts', 'tiktok-caption.md');

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

// ── Mirror helpers from pages/api/openclaw/task.js ────────────────────────────
// Keep in sync manually — the verify script tests the same logic the API uses.

const TIKTOK_CAPTION_CTA_RE   = /^[•\-*]?\s*CTA(?:\s+variants?)?:.*drive\s+to/i;
const TIKTOK_CAPTION_CTA_REPL = '• CTA: comment-based lead capture guided by TikTok caption skill rules.';

const TIKTOK_BANNED_LINE_PATTERNS = [
  /\blink\s+in\s+bio\b/i,
  /\blimited[\s-]time\b/i,
  /\bfake\s+scarcity\b/i,
  /\b\d+\s+slots?\b/i,
  /\bdouble\s+your\s+revenue\b/i,
  /\blife[\s-]changing\b/i,
  /\bdrive\s+to\s+(?:["']?starter[\s-]kit["']?|primary\s*offer|primaryOffer)/i,
  /\burgency[\s-]driven\s+cta\b/i,
];

function sanitizeTikTokCaptionDescription(description) {
  const lines = String(description || '').split('\n');
  let changed = false;
  const sanitized = lines
    .map(line => {
      if (TIKTOK_CAPTION_CTA_RE.test(line.trim()) && !line.includes('comment-based')) {
        changed = true;
        return TIKTOK_CAPTION_CTA_REPL;
      }
      for (const re of TIKTOK_BANNED_LINE_PATTERNS) {
        if (re.test(line)) { changed = true; return null; }
      }
      return line;
    })
    .filter(l => l !== null)
    .join('\n');
  return { sanitized, changed };
}

const CSCEC_OUTPUT_VIOLATIONS = [
  { pattern: /\blink\s+in\s+bio\b/i,                                                         label: 'link in bio' },
  { pattern: /\blimited[\s-]time\b/i,                                                        label: 'limited time' },
  { pattern: /\b\d+\s+slots?\b/i,                                                            label: 'slot scarcity (N slots)' },
  { pattern: /\bdouble\s+your\s+revenue\b/i,                                                 label: 'double your revenue' },
  { pattern: /\blife[\s-]changing\b/i,                                                       label: 'life-changing' },
  { pattern: /\b\d+[xX]\s+(?:your\s+)?(?:revenue|income|results?)\b/i,                      label: 'unsupported revenue claim' },
  { pattern: /\bonly\s+\d+\s+(?:spots?|slots?|openings?)\s+(?:left|available|remaining)\b/i, label: 'fake scarcity' },
];

function validateCscecOutput(output) {
  const text  = String(output || '');
  const flags = CSCEC_OUTPUT_VIOLATIONS.filter(v => v.pattern.test(text)).map(v => v.label);
  return { clean: flags.length === 0, flags };
}

function loadSkillPrompt(task) {
  if (task.stageId !== 'caption_generation') return null;
  const platform     = String(task.platform || '').toLowerCase().trim();
  const searchText   = `${task.title || ''} ${task.description || ''} ${task.instructions || ''}`;
  const textMentions = searchText.toLowerCase().includes('tiktok');
  const isTikTok     = platform === 'tiktok' || (platform !== 'tiktok' && textMentions);
  if (!isTikTok) return null;
  try { return fs.readFileSync(SKILL_FILE, 'utf-8'); } catch { return null; }
}

console.log('\nCaption Skill Verification\n');

// ── 1. Skill file content ─────────────────────────────────────────────────────
console.log('── Skill file content ──────────────────────────────────────────');

check('prompts/tiktok-caption.md exists', () =>
  fs.existsSync(SKILL_FILE) || 'File not found at ' + SKILL_FILE
);

const skill = fs.existsSync(SKILL_FILE) ? fs.readFileSync(SKILL_FILE, 'utf-8') : '';

check('Contains CSCEC framework',               () => skill.includes('CSCEC')              || 'CSCEC keyword not found');
check('Contains first-line ≤12 words',          () => skill.includes('12 words')           || '12-word constraint not found');
check('Contains no income claims constraint',   () => (skill.includes('income claim') || skill.includes('no income')) || 'Income claims constraint not found');
check('Contains no fake scarcity constraint',   () => (skill.includes('scarcity') || skill.includes('fake scarcity')) || 'Fake scarcity constraint not found');
check('Contains comment-based CTA requirement', () => skill.includes('comment')            || 'Comment CTA not found');
check('Contains hashtag limit (3-5)',           () => (skill.includes('3–5') || skill.includes('3-5')) || 'Hashtag limit not found');
check('Contains before/after example',          () => (skill.includes('CAPTION VARIANT A') && skill.includes('CAPTION VARIANT B')) || 'Example variants not found');

// ── 2. Platform matching — loads prompt ──────────────────────────────────────
console.log('\n── Platform matching — should load skill ───────────────────────');

check('platform: "TikTok" (exact) loads skill',     () => loadSkillPrompt({ stageId: 'caption_generation', platform: 'TikTok' })     !== null || 'returned null');
check('platform: "tiktok" (lowercase) loads skill', () => loadSkillPrompt({ stageId: 'caption_generation', platform: 'tiktok' })     !== null || 'returned null');
check('platform: "TIKTOK" (uppercase) loads skill', () => loadSkillPrompt({ stageId: 'caption_generation', platform: 'TIKTOK' })     !== null || 'returned null');
check('platform: "  TikTok  " (padded) loads skill',() => loadSkillPrompt({ stageId: 'caption_generation', platform: '  TikTok  ' }) !== null || 'returned null');

// ── 3. Fallback text matching ─────────────────────────────────────────────────
console.log('\n── Fallback text matching ──────────────────────────────────────');

check('platform missing + description mentions "TikTok" → loads skill', () =>
  loadSkillPrompt({ stageId: 'caption_generation', description: 'Write TikTok captions for this hook' }) !== null || 'returned null'
);
check('platform missing + title mentions "tiktok" → loads skill', () =>
  loadSkillPrompt({ stageId: 'caption_generation', title: 'caption_generation — tiktok · digital-diamond' }) !== null || 'returned null'
);
check('platform missing + instructions mention "TikTok" → loads skill', () =>
  loadSkillPrompt({ stageId: 'caption_generation', instructions: 'Create TikTok captions using the CSCEC framework' }) !== null || 'returned null'
);
check('platform missing + no TikTok text → does NOT load skill', () =>
  loadSkillPrompt({ stageId: 'caption_generation', description: 'Write captions for this hook' }) === null || 'returned non-null (false positive)'
);

// ── 4. Non-TikTok platforms — must NOT load prompt ───────────────────────────
console.log('\n── Non-TikTok platforms — must NOT load skill ──────────────────');

for (const platform of ['Instagram', 'LinkedIn', 'YouTube', 'Pinterest', 'Blog', 'Podcast']) {
  check(`${platform} caption_generation does NOT load TikTok skill`, () =>
    loadSkillPrompt({ stageId: 'caption_generation', platform }) === null || `returned non-null for ${platform}`
  );
}

// ── 5. Non-caption stages — must NOT load skill (even for TikTok) ────────────
console.log('\n── Non-caption stages — must NOT load skill ────────────────────');

for (const stageId of ['hook_generation', 'script_generation', 'trend_research', 'repurposing', 'visual_prompting', 'content_strategy']) {
  check(`TikTok ${stageId} does NOT load caption skill`, () =>
    loadSkillPrompt({ stageId, platform: 'TikTok' }) === null || `returned non-null for ${stageId}`
  );
}

// ── 6. Sanitizer — removes conflicting phrases ────────────────────────────────
console.log('\n── Sanitizer — removes conflicting phrases ─────────────────────');

check('removes CTA drive-to line', () => {
  const { sanitized } = sanitizeTikTokCaptionDescription(
    '• CTA variants: drive to "Starter Kit"\n• 3-5 hashtag sets'
  );
  return (!sanitized.includes('drive to') && sanitized.includes('comment-based')) || 'CTA line not replaced';
});

check('removes "link in bio" line', () => {
  const { sanitized } = sanitizeTikTokCaptionDescription('Hook text here\n• Add link in bio\nAudience: entrepreneurs');
  return !sanitized.includes('link in bio') || '"link in bio" not removed';
});

check('removes "500 slots" line', () => {
  const { sanitized } = sanitizeTikTokCaptionDescription('Script here\n• Only 500 slots available\nTone: educational');
  return !sanitized.includes('500 slots') || '"500 slots" not removed';
});

check('removes "life-changing" line', () => {
  const { sanitized } = sanitizeTikTokCaptionDescription('Goal: life-changing results for entrepreneurs\nPlatform: TikTok');
  return !sanitized.includes('life-changing') || '"life-changing" not removed';
});

check('preserves Platform: line', () => {
  const { sanitized } = sanitizeTikTokCaptionDescription('Platform: TikTok\n• CTA variants: drive to "offer"');
  return sanitized.includes('Platform: TikTok') || 'Platform line was stripped';
});

check('preserves Brand: line', () => {
  const { sanitized } = sanitizeTikTokCaptionDescription('Brand: Digital Diamond AI\n• link in bio\nAudience: coaches');
  return sanitized.includes('Brand: Digital Diamond AI') || 'Brand line was stripped';
});

check('preserves Audience: line', () => {
  const { sanitized } = sanitizeTikTokCaptionDescription('Audience: high-ticket coaches\n• 500 slots limited time');
  return sanitized.includes('Audience: high-ticket coaches') || 'Audience line was stripped';
});

check('preserves hook context line', () => {
  const desc = 'Hook: "You\'re one DM away from your first client"\n• limited time offer ends Friday';
  const { sanitized } = sanitizeTikTokCaptionDescription(desc);
  return sanitized.includes('Hook:') || 'Hook line was stripped';
});

check('changed: true when something removed', () => {
  const { changed } = sanitizeTikTokCaptionDescription('• CTA variants: drive to "offer"\nPlatform: TikTok');
  return changed === true || 'changed should be true';
});

check('changed: false when nothing to remove', () => {
  const { changed } = sanitizeTikTokCaptionDescription('Platform: TikTok\nAudience: coaches\nHook: scroll-stopper text');
  return changed === false || 'changed should be false';
});

check('CTA replacement is idempotent (no double-replace)', () => {
  const first  = sanitizeTikTokCaptionDescription('• CTA variants: drive to "offer"').sanitized;
  const second = sanitizeTikTokCaptionDescription(first).sanitized;
  return first === second || 'Second pass changed the already-replaced CTA line';
});

// ── 7. CSCEC output validator ─────────────────────────────────────────────────
console.log('\n── CSCEC output validator ──────────────────────────────────────');

check('"link in bio" in output is flagged', () => {
  const { clean, flags } = validateCscecOutput('Check the link in bio to get started.');
  return (!clean && flags.includes('link in bio')) || `clean=${clean}, flags=${JSON.stringify(flags)}`;
});

check('"limited time" in output is flagged', () => {
  const { clean, flags } = validateCscecOutput('This is a limited time offer.');
  return (!clean && flags.includes('limited time')) || `clean=${clean}, flags=${JSON.stringify(flags)}`;
});

check('"500 slots" in output is flagged', () => {
  const { clean, flags } = validateCscecOutput('Only 500 slots remaining. Act now.');
  return (!clean && flags.includes('slot scarcity (N slots)')) || `clean=${clean}, flags=${JSON.stringify(flags)}`;
});

check('"double your revenue" in output is flagged', () => {
  const { clean, flags } = validateCscecOutput('This system will double your revenue in 90 days.');
  return (!clean && flags.includes('double your revenue')) || `clean=${clean}, flags=${JSON.stringify(flags)}`;
});

check('"life-changing" in output is flagged', () => {
  const { clean, flags } = validateCscecOutput('This is the life-changing system you needed.');
  return (!clean && flags.includes('life-changing')) || `clean=${clean}, flags=${JSON.stringify(flags)}`;
});

check('fake scarcity in output is flagged', () => {
  const { clean, flags } = validateCscecOutput('Only 3 spots left available this week.');
  return (!clean && flags.includes('fake scarcity')) || `clean=${clean}, flags=${JSON.stringify(flags)}`;
});

check('compliant CSCEC output passes clean', () => {
  const compliant = [
    'CAPTION VARIANT A:',
    'You\'re one DM away from your first high-ticket client.',
    '',
    'Comment "READY" below and I\'ll send you the details.',
    '',
    '#highticketcoaching #clientgrowth #digitalmarketing',
  ].join('\n');
  const { clean, flags } = validateCscecOutput(compliant);
  return (clean && flags.length === 0) || `clean=${clean}, flags=${JSON.stringify(flags)}`;
});

check('multiple violations — all flagged', () => {
  const bad = 'Limited time offer. Only 500 slots. Link in bio. life-changing results.';
  const { clean, flags } = validateCscecOutput(bad);
  return (!clean && flags.length >= 3) || `Expected ≥3 flags, got: ${JSON.stringify(flags)}`;
});

// ── 8. Source-level checks in task.js ────────────────────────────────────────
console.log('\n── Prompt injection in task.js ─────────────────────────────────');

const taskSrc = fs.readFileSync(path.join(ROOT, 'pages/api/openclaw/task.js'), 'utf-8');

check('task.js has sanitizeTikTokCaptionDescription function', () =>
  taskSrc.includes('function sanitizeTikTokCaptionDescription') || 'Function not found'
);
check('task.js has validateCscecOutput function', () =>
  taskSrc.includes('function validateCscecOutput') || 'Function not found'
);
check('task.js has case-insensitive platform normalisation', () =>
  taskSrc.includes('.toLowerCase().trim()') || 'toLowerCase().trim() not found'
);
check('task.js has text-fallback check', () =>
  taskSrc.includes("includes('tiktok')") || 'text fallback not found'
);
check('task.js logs platform value on caption_generation', () =>
  taskSrc.includes('[loadSkillPrompt]') || 'logging not found'
);
check('task.js injects full override header', () =>
  taskSrc.includes('OVERRIDE TASK DESCRIPTION, LANE CONTEXT, MEMORY, PRIOR EXAMPLES') || 'Override header missing or incomplete'
);
check('task.js includes cscecValidation in response', () =>
  taskSrc.includes('cscecValidation') || 'cscecValidation not in response'
);
check('task.js includes skillPromptLoaded in response', () =>
  taskSrc.includes('skillPromptLoaded') || 'skillPromptLoaded not in response'
);
check('task.js includes sanitizedDescriptionUsed in response', () =>
  taskSrc.includes('sanitizedDescriptionUsed') || 'sanitizedDescriptionUsed not in response'
);

// ── 9. createViralContentTasks.js — TikTok CTA source ────────────────────────
console.log('\n── createViralContentTasks.js CTA override ─────────────────────');

const workflowSrc = fs.readFileSync(
  path.join(ROOT, 'lib/workflows/createViralContentTasks.js'), 'utf-8'
);
check('TikTok caption_generation uses comment-based CTA in workflow builder', () =>
  workflowSrc.includes('comment-based lead capture guided by TikTok caption skill rules') || 'Comment-based CTA not found'
);
check('Non-TikTok platforms still use drive-to CTA in workflow builder', () =>
  workflowSrc.includes('drive to') || 'drive-to CTA removed — non-TikTok platforms will break'
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n── Summary ─────────────────────────────────────────────────────');
console.log(`   ${passed} passed  ${failed} failed`);
if (failed > 0) {
  console.log('\n   ✗ Caption skill verification failed. Review failures above.\n');
  process.exit(1);
} else {
  console.log('\n   ✓ TikTok caption skill wiring verified.\n');
}
