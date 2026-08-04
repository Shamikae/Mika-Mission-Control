// lib/creative-director/workforce/stages/index.js
// The ONLY place stage definitions are wired into runnable workers via the
// one shared createStageWorker() factory (workforceContract.js).

import { researchStageDef } from './researchStage';
import { scriptStageDef } from './scriptStage';
import { storyboardStageDef } from './storyboardStage';
import { promptsStageDef } from './promptsStage';
import { thumbnailStageDef } from './thumbnailStage';
import { captionStageDef, bindCaptionParser } from './captionStage';
import { reviewStageDef } from './reviewStage';
import { createStageWorker } from '../workforceContract';

const STAGE_DEFS = {
  research: researchStageDef,
  script: scriptStageDef,
  storyboard: storyboardStageDef,
  prompts: promptsStageDef,
  thumbnail: thumbnailStageDef,
  caption: captionStageDef,
  review: reviewStageDef,
};

export function getStageDef(stageId) {
  return STAGE_DEFS[stageId] || null;
}

/**
 * Builds a runnable worker for one stage, matching the shared contract.
 * Caption's parser needs the request's platform bound at call time (its
 * platformVariants fallback logic) — every other stage's def is used as-is.
 */
export function buildStageWorker(stageId, { requestPlatform } = {}) {
  const def = STAGE_DEFS[stageId];
  if (!def) return null;
  if (stageId === 'caption') {
    return createStageWorker({ ...def, parseOutput: bindCaptionParser(requestPlatform) });
  }
  return createStageWorker(def);
}
