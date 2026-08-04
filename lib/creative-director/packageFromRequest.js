// lib/creative-director/packageFromRequest.js
// SERVER-SIDE ONLY — uses fs (via the existing content package store).
//
// This is the ONLY place the Creative Director touches Content Package
// storage, and it does so exclusively through the SAME interfaces Content
// Pack Generator already uses:
//   - lib/content/contentPackageSchema.js's buildContentPackage() — the
//     canonical package-shape builder (never reimplemented here).
//   - lib/content/contentPackageStore.js's savePackage() — the same
//     file-backed store every other package (Content Pack Generator,
//     imported HyperFrames/manual-export jobs) already writes through.
//   - lib/content/contentPipelineRules.js's defaultPipelineMeta() — the
//     same pipeline-entry metadata every package gets, so a
//     Creative-Director-created package is 100% indistinguishable in the
//     Package Pipeline, Production Router, Publishing Router, and Content
//     Orchestrator from one created any other way. No special-casing, no
//     schema drift, never bypasses the Package Pipeline.

import { randomBytes } from 'crypto';
import { buildContentPackage } from '../content/contentPackageSchema';
import { savePackage } from '../content/contentPackageStore';
import { defaultPipelineMeta } from '../content/contentPipelineRules';

/**
 * @param {object} request — a Content Request record
 * @param {object} brief — the output of buildProductionBrief(request)
 * @returns {object} the persisted Content Package
 */
export function createPackageFromRequest(request, brief) {
  const id = `pack-${Date.now()}-${randomBytes(3).toString('hex')}`;
  const now = new Date().toISOString();

  let pkg = buildContentPackage({
    id,
    brand: request.brand,
    platform: request.platform,
    goal: request.goal,
    topic: request.topic,
    audience: request.targetAudience,
    offer: '',
    tone: request.style,
    videoDuration: request.desiredRuntime,
    ctaInput: request.cta,
    instructions: `Created by the Creative Director from Content Request ${request.id}.`,
    synthesized: brief,
    model: null,
    provider: 'creative-director',
  });

  // Same pipeline-entry metadata every package gets — this package is a
  // completely normal Package Pipeline citizen from the moment it exists.
  pkg = { ...pkg, pipeline: defaultPipelineMeta(now) };

  savePackage(pkg);
  return pkg;
}
