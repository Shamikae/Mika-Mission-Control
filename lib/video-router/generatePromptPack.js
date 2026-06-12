// lib/video-router/generatePromptPack.js
// SERVER-SIDE ONLY.
//
// Transforms a video-prompt.md artifact into provider-specific generation prompts.
// Does NOT call any external APIs. No video is generated. No credits are spent.
// Output: a structured prompt pack with one optimised prompt per provider.

import fs from 'fs';
import path from 'path';
import { loadProviderProfiles, getRecommendedProviders } from './loadProviderProfiles';
import { getContentArtifact } from '../content-artifacts/loadContentArtifacts';

const ARTIFACTS_ROOT  = path.join(process.cwd(), 'content-artifacts');
const PACK_JSON_NAME  = 'video-router-pack.json';
const PACK_MD_NAME    = 'video-router-pack.md';

// ── Source artifact parser ────────────────────────────────────────────────────
// Extracts structured sections from a video-prompt.md file.

function parseVideoPromptArtifact(content) {
  const sections = {
    heroPrompt:        extractSection(content, 'HERO VIDEO PROMPT', ['PROVIDER-SPECIFIC', 'B-ROLL', 'THUMBNAIL', 'BRAND']),
    styleNotes:        extractSection(content, 'Style Notes:', ['PROVIDER-SPECIFIC', 'B-ROLL']),
    providerNotes:     extractSection(content, 'PROVIDER-SPECIFIC NOTES', ['B-ROLL', 'THUMBNAIL', 'BRAND']),
    brollPrompts:      extractSection(content, 'B-ROLL PROMPTS', ['THUMBNAIL', 'BRAND']),
    thumbnailPrompt:   extractSection(content, 'THUMBNAIL', ['BRAND AESTHETIC']),
    brandNotes:        extractSection(content, 'BRAND AESTHETIC NOTES', [null]),
    platform:          extractInlineValue(content, 'Platform:'),
    brand:             extractInlineValue(content, 'Brand:'),
    contentType:       extractInlineValue(content, 'Content Type:'),
  };

  // Extract individual style fields from style notes
  sections.visualStyle  = extractInlineValue(sections.styleNotes || '', 'Visual style:');
  sections.lighting     = extractInlineValue(sections.styleNotes || '', 'Lighting:');
  sections.colorPalette = extractInlineValue(sections.styleNotes || '', 'Colour palette:');
  sections.motion       = extractInlineValue(sections.styleNotes || '', 'Motion:');
  sections.camera       = extractInlineValue(sections.styleNotes || '', 'Camera:');

  return sections;
}

function extractSection(content, startMarker, endMarkers) {
  const start = content.indexOf(startMarker);
  if (start === -1) return null;
  const fromStart = content.slice(start + startMarker.length);
  let end = fromStart.length;
  for (const marker of endMarkers || []) {
    if (!marker) continue;
    const idx = fromStart.indexOf(marker);
    if (idx !== -1 && idx < end) end = idx;
  }
  return fromStart.slice(0, end).replace(/^[\s\n:]+/, '').trim() || null;
}

function extractInlineValue(content, key) {
  const lines = content.split('\n');
  for (const line of lines) {
    if (line.trimStart().startsWith(key)) {
      return line.slice(line.indexOf(key) + key.length).replace(/^[-:\s]+/, '').trim() || null;
    }
  }
  return null;
}

// ── Provider-specific prompt builders ────────────────────────────────────────
// Each builder takes the parsed sections and returns a formatted string
// optimised for that provider's requirements.

const PROMPT_BUILDERS = {

  higgsfield: (s) => [
    s.heroPrompt || '(no hero prompt)',
    s.lighting   ? `\nLighting: ${s.lighting}` : '',
    s.camera     ? `\nCamera: ${s.camera}` : '',
    s.motion     ? `\nMotion: ${s.motion}` : '',
    s.brandNotes ? `\nBrand: ${s.brandNotes.slice(0, 150)}` : '',
    `\n--negative low quality, artifacts, amateur lighting, shaky camera, distorted`,
  ].filter(Boolean).join(''),

  heygen: (s) => [
    `Avatar: [Select custom avatar — ${s.brand || 'brand'}]`,
    `Background: [${s.visualStyle || 'Minimalist studio background'}]`,
    ``,
    `Script:`,
    `"${s.heroPrompt?.split('.')[0] || '(Insert script here)'}. ${s.heroPrompt?.split('.')[1] || ''}"`,
    ``,
    `Voice: [Select voice — confident, natural tone]`,
    `Captions: Enabled`,
    `Resolution: 1080x1920 (9:16 vertical)`,
    ``,
    `Background style: ${s.visualStyle || 'clean professional'}`,
    s.lighting ? `Lighting: ${s.lighting}` : '',
    ``,
    `Note: Replace [script] with final approved script from script.md artifact.`,
  ].filter(Boolean).join('\n'),

  openart: (s) => [
    `${s.heroPrompt || '(no hero prompt)'}`,
    s.visualStyle    ? `, ${s.visualStyle}` : '',
    `, professional photography, high resolution, 8k`,
    ``,
    `--negative low quality, watermark, text overlay, amateur, blurry`,
    ``,
    `Model: Flux 1.1 Pro`,
    `Aspect: 9:16`,
    `Steps: 30 | CFG: 7`,
    s.colorPalette ? `Color reference: ${s.colorPalette}` : '',
  ].filter(Boolean).join(''),

  veo: (s) => [
    `Subject: ${s.brand || 'creator'} — ${s.heroPrompt?.slice(0, 120) || '(no prompt)'}`,
    s.camera   ? `Camera: ${s.camera}` : '',
    s.motion   ? `Movement: ${s.motion}` : '',
    s.lighting ? `Lighting: ${s.lighting}` : '',
    `Duration: 8 seconds`,
    `Aspect: 16:9 or 9:16 (platform-dependent)`,
    `Mood: ${s.visualStyle || 'professional, aspirational'}`,
  ].filter(l => l).join('\n'),

  kling: (s) => {
    const core = s.heroPrompt?.split('.')[0] || '(no prompt)';
    const setting = s.visualStyle ? ` in ${s.visualStyle}` : '';
    return [
      `${core}${setting}.`,
      s.motion ? `Motion: ${s.motion}.` : '',
      `Vertical 9:16. 8 seconds.`,
    ].filter(Boolean).join(' ');
  },

  wan: (s) => [
    `Masterpiece, best quality, high resolution.`,
    s.heroPrompt ? `${s.heroPrompt}` : '(no hero prompt)',
    s.lighting   ? `${s.lighting}.` : '',
    `smooth motion, professional quality`,
    ``,
    `--negative low quality, artifacts, distorted, blurry, jerky motion, amateur`,
    ``,
    `Motion Score: 4`,
    `Resolution: 720p`,
    `FPS: 16`,
  ].filter(Boolean).join('\n'),

  comfyui: (s) => [
    `Checkpoint: RealVisXL v5.0 (or equivalent)`,
    `LoRA: [brand-style LoRA if available, strength 0.7]`,
    ``,
    `Positive prompt:`,
    s.heroPrompt || '(no hero prompt)',
    s.lighting ? `Lighting: ${s.lighting}` : '',
    s.visualStyle || '',
    `photorealistic, professional, high detail`,
    ``,
    `Negative prompt:`,
    `ugly, deformed, watermark, artifacts, low quality, blurry, amateur`,
    ``,
    `Sampler: DPM++ 2M Karras`,
    `Steps: 30 | CFG: 7.5 | Clip Skip: 2`,
    `Resolution: 1024×1024 (or 1024×1792 for vertical)`,
    `Upscale: 2x via Ultimate SD Upscale`,
    s.colorPalette ? `\nColor reference: ${s.colorPalette}` : '',
  ].filter(l => l !== '').join('\n'),
};

// ── Cost + routing notes ──────────────────────────────────────────────────────

const COST_NOTES = {
  higgsfield: 'Estimated $0.30–$0.80 per 5-8 second generation. Premium quality.',
  heygen:     'Estimated $0.50–$1.50 per video depending on duration and avatar tier.',
  openart:    'Low cost — approximately $0.02–$0.10 per image. Video from $0.10–$0.30.',
  veo:        'Via Google Vertex AI — pricing varies. Estimated $0.50–$2.00 per generation.',
  kling:      'Estimated $0.10–$0.30 per 5-second video. Cost-effective for volume.',
  wan:        'FREE — open source. Requires local GPU (12GB+ VRAM) or self-hosted cloud.',
  comfyui:    'FREE — open source. Requires local ComfyUI install with GPU. No per-generation cost.',
};

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Generate a provider-specific video prompt pack from a video-prompt.md artifact.
 * Saves to content-artifacts/<laneId>/<workflowId>/video-router-pack.json + .md
 * Does NOT call any external APIs.
 *
 * @param {object} params
 * @param {string} params.laneId
 * @param {string} params.workflowId
 * @param {string} [params.budgetMode]    — 'low-cost' | 'balanced' | 'premium'
 * @param {string} [params.contentFormat] — 'short-form' | 'avatar' | 'cinematic' | 'ugc-ad' | 'b-roll' | 'ai-twin'
 * @returns {object} promptPack
 */
export function generatePromptPack({ laneId, workflowId, budgetMode = 'balanced', contentFormat = 'short-form' }) {
  // ── 1. Load source artifact ────────────────────────────────────────────────
  const source = getContentArtifact(laneId, workflowId, 'visual_prompting');

  if (!source.content) {
    return {
      ok:    false,
      error: `video-prompt.md artifact not found for workflow ${workflowId}. Execute the Visual Prompting stage first.`,
    };
  }

  // ── 2. Parse artifact ──────────────────────────────────────────────────────
  const sections = parseVideoPromptArtifact(source.content);

  // ── 3. Get routing recommendation ─────────────────────────────────────────
  const recommendation = getRecommendedProviders(contentFormat, budgetMode);

  // ── 4. Build provider-specific prompts ────────────────────────────────────
  const providers  = loadProviderProfiles();
  const now        = new Date().toISOString();

  const providerPrompts = {};
  for (const provider of providers) {
    const builder = PROMPT_BUILDERS[provider.providerId];
    providerPrompts[provider.providerId] = {
      providerId:   provider.providerId,
      displayName:  provider.displayName,
      emoji:        provider.emoji,
      status:       provider.status,
      costTier:     provider.costTier,
      bestFor:      provider.bestFor,
      approvalRequired: provider.approvalRequired,
      prompt:       builder ? builder(sections) : sections.heroPrompt || '(prompt adaptation not available)',
      costNote:     COST_NOTES[provider.providerId] || '',
      promptStyle:  provider.promptStyle,
      isRecommended: recommendation.primary?.providerId === provider.providerId,
      recommendationScore: recommendation.allProviders?.find(p => p.providerId === provider.providerId)?.recommendationScore || 0,
    };
  }

  // ── 5. Build pack ──────────────────────────────────────────────────────────
  const pack = {
    ok:                 true,
    version:            '1.0',
    laneId,
    workflowId,
    budgetMode,
    contentFormat,
    sourceArtifact:     'video-prompt.md',
    generatedAt:        now,
    humanApprovalRequired: true,
    governanceNote:     'No video generated. Prompt pack only. All video generation requires human approval before any provider is called.',
    parsedSections: {
      heroPrompt:  sections.heroPrompt?.slice(0, 200),
      visualStyle: sections.visualStyle,
      platform:    sections.platform,
      brand:       sections.brand,
    },
    routingRecommendation: {
      contentFormat,
      budgetMode,
      primary:    recommendation.primary   ? { providerId: recommendation.primary.providerId,   displayName: recommendation.primary.displayName,   reason: `Best for ${contentFormat} content with ${budgetMode} budget` } : null,
      secondary:  recommendation.secondary ? { providerId: recommendation.secondary.providerId, displayName: recommendation.secondary.displayName } : null,
      tertiary:   recommendation.tertiary  ? { providerId: recommendation.tertiary.providerId,  displayName: recommendation.tertiary.displayName  } : null,
      note:       recommendation.budgetNote,
    },
    providerPrompts,
    // Convenience shortcuts
    higgsfieldPrompt: providerPrompts.higgsfield?.prompt,
    heygenPrompt:     providerPrompts.heygen?.prompt,
    openartPrompt:    providerPrompts.openart?.prompt,
    veoPrompt:        providerPrompts.veo?.prompt,
    klingPrompt:      providerPrompts.kling?.prompt,
    wanPrompt:        providerPrompts.wan?.prompt,
    comfyuiPrompt:    providerPrompts.comfyui?.prompt,
  };

  // ── 6. Save to disk ────────────────────────────────────────────────────────
  const dir = path.join(ARTIFACTS_ROOT, laneId, workflowId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(path.join(dir, PACK_JSON_NAME), JSON.stringify(pack, null, 2));
  fs.writeFileSync(path.join(dir, PACK_MD_NAME),   buildMarkdownPack(pack));

  return pack;
}

/**
 * Load a previously generated prompt pack from disk.
 */
export function loadPromptPack(laneId, workflowId) {
  try {
    const file = path.join(ARTIFACTS_ROOT, laneId, workflowId, PACK_JSON_NAME);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch { return null; }
}

// ── Markdown formatter ────────────────────────────────────────────────────────

function buildMarkdownPack(pack) {
  const rec = pack.routingRecommendation;
  const lines = [
    `# 🎬 Video Router Prompt Pack`,
    `<!-- MIKA AGENTIC OS™ · No video generated · Prompt pack only -->`,
    `<!-- Generated: ${pack.generatedAt} · Workflow: ${pack.workflowId} -->`,
    ``,
    `## Routing Recommendation`,
    `| | |`,
    `|---|---|`,
    `| **Format** | ${pack.contentFormat} |`,
    `| **Budget** | ${pack.budgetMode} |`,
    `| **Primary Provider** | ${rec.primary?.displayName || '—'} |`,
    `| **Secondary** | ${rec.secondary?.displayName || '—'} |`,
    `| **Budget note** | ${rec.note || '—'} |`,
    ``,
    `> ⚠️ **Governance**: No video generated. All video generation requires human approval.`,
    ``,
  ];

  for (const [id, p] of Object.entries(pack.providerPrompts)) {
    lines.push(`## ${p.emoji} ${p.displayName}${p.isRecommended ? ' ⭐ RECOMMENDED' : ''}`);
    lines.push(`**Status**: ${p.status} | **Cost**: ${p.costTier} | **Best for**: ${p.bestFor}`);
    lines.push(`**Cost note**: ${p.costNote}`);
    lines.push(``);
    lines.push('```');
    lines.push(p.prompt);
    lines.push('```');
    lines.push(``);
  }

  return lines.join('\n');
}
