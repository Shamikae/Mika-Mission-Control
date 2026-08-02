// lib/production/execution/adapters/mockVideo.adapter.js
// SERVER-SIDE ONLY.
//
// Development/test-only adapter. Disabled unless
// PROVIDER_MOCK_VIDEO_ENABLED=true. Simulates asynchronous provider
// execution (submit -> waiting_provider -> poll x N -> completed) so the
// full async lifecycle can be exercised without ever calling a real
// external video provider. The final output is a tiny locally-generated
// JSON manifest — NEVER a real video file, and always labeled as such.

import { randomBytes } from 'crypto';

const TOTAL_STEPS = 3;
const MOCK_DISCLAIMER = 'TEST SIMULATION — NOT A REAL VIDEO';

function isEnabled() {
  return String(process.env.PROVIDER_MOCK_VIDEO_ENABLED || '').trim().toLowerCase() === 'true';
}

const mockVideoAdapter = {
  id: 'mock-video',
  displayName: 'Mock Video (Test)',
  status: 'staged', // true executable status is only ever reported via healthCheck()
  supportedModes: ['avatar_video', 'cinematic_broll', 'product_demo', 'faceless_social', 'talking_head', 'image_to_video', 'slideshow', 'custom'],
  executionType: 'mock',
  mock: true,

  async healthCheck() {
    if (!isEnabled()) {
      return { ok: false, status: 'staged', error: 'Mock Video adapter is disabled. Set PROVIDER_MOCK_VIDEO_ENABLED=true (development/test only — never enable in production).', latencyMs: 0 };
    }
    return { ok: true, status: 'active', error: null, latencyMs: 0 };
  },

  validateInput() {
    if (!isEnabled()) {
      return { valid: false, errors: ['Mock Video adapter is disabled via PROVIDER_MOCK_VIDEO_ENABLED.'], warnings: [] };
    }
    return { valid: true, errors: [], warnings: ['This is a test/mock provider — it never produces a real video.'] };
  },

  estimate() {
    return { estimateType: 'provisional_tier', estimatedRange: null, costTier: 'free', currency: 'USD', provisional: true };
  },

  async submit() {
    if (!isEnabled()) {
      return { ok: false, providerJobId: null, status: 'failed', nextPollSeconds: null, error: 'Mock Video adapter is disabled.', errorReason: 'validation_error', rawMetadata: { mock: true } };
    }
    return {
      ok: true,
      providerJobId: `mock-${randomBytes(4).toString('hex')}`,
      status: 'waiting_provider',
      nextPollSeconds: 2,
      rawMetadata: { mock: true, stepsCompleted: 0, totalSteps: TOTAL_STEPS },
    };
  },

  async poll({ job }) {
    const prior = job?.execution?.providerMetadata || {};
    const stepsCompleted = Math.min((prior.stepsCompleted || 0) + 1, TOTAL_STEPS);
    const progress = Math.round((stepsCompleted / TOTAL_STEPS) * 100);

    if (stepsCompleted < TOTAL_STEPS) {
      return {
        ok: true,
        status: 'waiting_provider',
        progress,
        nextPollSeconds: 2,
        outputs: [],
        error: null,
        rawMetadata: { mock: true, stepsCompleted, totalSteps: TOTAL_STEPS },
      };
    }

    const manifest = {
      disclaimer: MOCK_DISCLAIMER,
      mock: true,
      simulatedMode: job?.selectedMode || null,
      simulatedProvider: 'mock-video',
      simulatedDurationLabel: job?.outputSpec?.targetDuration || null,
      generatedAt: new Date().toISOString(),
    };

    return {
      ok: true,
      status: 'completed',
      progress: 100,
      nextPollSeconds: null,
      error: null,
      outputs: [
        { type: 'document', localBuffer: Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'), mimeType: 'application/json', filename: 'mock-video-manifest.json', metadata: { kind: 'mock-video-manifest', mock: true } },
      ],
      rawMetadata: { mock: true, stepsCompleted, totalSteps: TOTAL_STEPS },
    };
  },

  async cancel() {
    return { ok: true, status: 'cancelled', error: null };
  },

  normalizeResult(result) {
    return {
      status: result.status,
      outputs: result.outputs || [],
      providerMetadata: result.rawMetadata || null,
    };
  },
};

export default mockVideoAdapter;
