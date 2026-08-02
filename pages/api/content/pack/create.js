// POST /api/content/pack/create
// Creates one structured content package from a brief via governed OpenRouter
// synthesis (lib/openrouter/contentPackClient.js — server-side only, never
// calls a provider from the browser). Optionally generates a thumbnail
// through the existing, unmodified OpenArt MCP dispatch pipeline.
//
// Input:
//   { brand, platform, goal, topic, audience, offer, tone, videoDuration,
//     cta, instructions, generateThumbnail, maxImageCredits }
//
// Output (success):
//   { ok: true, package }
// Output (synthesis not configured / failed):
//   { ok: false, status, error }   — HTTP 200, so the UI renders an honest
//                                    state instead of a network error.
//
// No package is persisted unless the required written sections (hooks,
// script) synthesize successfully — a failed synthesis never leaves a
// broken half-package behind.

import { randomBytes } from 'crypto';
import { synthesizeContentPack } from '../../../../lib/openrouter/contentPackClient';
import { buildContentPackage }   from '../../../../lib/content/contentPackageSchema';
import { savePackage }           from '../../../../lib/content/contentPackageStore';
import { generatePackageThumbnail, applyThumbnailResultToPackage } from '../../../../lib/content/generatePackageThumbnail';

export const config = {
  api: { bodyParser: { sizeLimit: '512kb' } },
};

const MAX_LENS = { brand: 200, platform: 100, goal: 100, topic: 500, audience: 300, offer: 300, tone: 100, videoDuration: 50, cta: 300, instructions: 2000 };

function cleanStr(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const {
    brand, platform, goal, topic, audience, offer, tone, videoDuration,
    cta, instructions, generateThumbnail, maxImageCredits,
  } = req.body || {};

  // ── Validate ──────────────────────────────────────────────────────────────
  // Brand/platform/goal are intentionally free text — Content Pack Generator
  // is not hardcoded to a fixed set of brands or platforms.
  if (!brand || typeof brand !== 'string' || !brand.trim()) {
    return res.status(400).json({ ok: false, error: 'brand is required.' });
  }
  if (!platform || typeof platform !== 'string' || !platform.trim()) {
    return res.status(400).json({ ok: false, error: 'platform is required.' });
  }
  if (!goal || typeof goal !== 'string' || !goal.trim()) {
    return res.status(400).json({ ok: false, error: 'goal is required.' });
  }
  if (!topic || typeof topic !== 'string' || !topic.trim()) {
    return res.status(400).json({ ok: false, error: 'topic is required.' });
  }
  if (topic.trim().length > MAX_LENS.topic) {
    return res.status(400).json({ ok: false, error: `topic must be ${MAX_LENS.topic} characters or fewer.` });
  }

  let maxCredits;
  if (generateThumbnail) {
    if (maxImageCredits == null || !Number.isFinite(Number(maxImageCredits)) || Number(maxImageCredits) <= 0) {
      return res.status(400).json({ ok: false, error: 'maxImageCredits (a positive number) is required when generateThumbnail is enabled.' });
    }
    maxCredits = Number(maxImageCredits);
  }

  const input = {
    brand:         cleanStr(brand, MAX_LENS.brand),
    platform:      cleanStr(platform, MAX_LENS.platform),
    goal:          cleanStr(goal, MAX_LENS.goal),
    topic:         cleanStr(topic, MAX_LENS.topic),
    audience:      cleanStr(audience, MAX_LENS.audience),
    offer:         cleanStr(offer, MAX_LENS.offer),
    tone:          cleanStr(tone, MAX_LENS.tone),
    videoDuration: cleanStr(videoDuration, MAX_LENS.videoDuration),
    cta:           cleanStr(cta, MAX_LENS.cta),
    instructions:  cleanStr(instructions, MAX_LENS.instructions),
  };

  // ── Governed synthesis (server-side only; never a direct provider call from the UI) ──
  const synthesis = await synthesizeContentPack(input);
  if (!synthesis.ok) {
    // 200 on purpose — a clean, renderable failure state, not a network error.
    return res.status(200).json({ ok: false, status: synthesis.status, error: synthesis.message });
  }

  // ── Build + persist the written package ──────────────────────────────────
  const id = `pack-${Date.now()}-${randomBytes(3).toString('hex')}`;
  let pkg = buildContentPackage({
    id,
    ...input,
    ctaInput: input.cta,
    synthesized: synthesis.data,
    model:    synthesis.model,
    provider: 'openrouter',
  });
  pkg.metadata.estimatedCost = 0; // token cost tracking not wired to $-cost yet; credits (image) tracked below
  savePackage(pkg);

  // ── Optional thumbnail (reuses the existing OpenArt MCP dispatch pipeline) ──
  if (generateThumbnail) {
    let thumbResult;
    try {
      thumbResult = await generatePackageThumbnail({
        packageId:   id,
        brand:       input.brand,
        platform:    input.platform,
        headline:    pkg.thumbnail.headline,
        visualBrief: pkg.thumbnail.visualBrief,
        maxCredits,
      });
    } catch (err) {
      thumbResult = { ok: false, executionStatus: 'failed', error: err.message, result: null };
    }
    pkg = applyThumbnailResultToPackage(pkg, thumbResult);
    pkg.metadata.updatedAt = new Date().toISOString();
    savePackage(pkg);
  }

  return res.status(201).json({ ok: true, package: pkg });
}
