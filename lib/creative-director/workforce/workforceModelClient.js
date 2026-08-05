// lib/creative-director/workforce/workforceModelClient.js
// SERVER-SIDE ONLY. Never import this from client components.
// Governed OpenRouter JSON-mode call for the Content Workforce — sibling to
// lib/openrouter/contentPackClient.js and fusionClient.js: same provider,
// same env-var/error-taxonomy conventions, own dedicated enable flag and
// dedicated model config so it can never be silently activated by Content
// Pack Generator or Fusion's flags (or vice versa). API keys are read from
// environment and never returned to callers; the raw provider response body
// is never persisted — only the parsed JSON payload and token usage counts
// cross this boundary.

const BASE_URL = process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1';

function primaryModel() {
  return process.env.CONTENT_WORKFORCE_MODEL || 'openai/gpt-4o-mini';
}
function reviewModel() {
  return process.env.CONTENT_WORKFORCE_REVIEW_MODEL || primaryModel();
}
function maxTokens() {
  const n = Number(process.env.CONTENT_WORKFORCE_MAX_TOKENS);
  return Number.isFinite(n) && n > 0 ? n : 2000;
}
function stageTimeoutMs() {
  const n = Number(process.env.CONTENT_WORKFORCE_STAGE_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 45000;
}

export function modelForStage(stageId) {
  return stageId === 'review' ? reviewModel() : primaryModel();
}

export function getWorkforceConfig() {
  const enabled = String(process.env.CONTENT_WORKFORCE_ENABLED || '').trim().toLowerCase() === 'true';
  const openrouterEnabled = String(process.env.OPENROUTER_ENABLED || '').trim().toLowerCase() === 'true';
  const apiKey = String(process.env.OPENROUTER_API_KEY || '').trim();

  if (!enabled) return { configured: false, reason: 'CONTENT_WORKFORCE_ENABLED is not set to true' };
  if (!openrouterEnabled) return { configured: false, reason: 'OPENROUTER_ENABLED is not set to true' };
  if (!apiKey) return { configured: false, reason: 'OPENROUTER_API_KEY is not configured' };
  return { configured: true };
}

export function getWorkforceMaxTokens() { return maxTokens(); }

/**
 * TEST-ONLY escape hatch for the offline validator suite. Never documented
 * in .env.example, never honored in production. Guarded on two independent
 * conditions so it can never accidentally activate for a real user: the
 * literal string "true", AND NODE_ENV !== 'production'.
 */
function mockModeActive() {
  return process.env.CONTENT_WORKFORCE_MOCK_MODE === 'true' && process.env.NODE_ENV !== 'production';
}

/**
 * Deterministic mocked model responses, keyed by stage id, used only when
 * mockModeActive(). These flow through the exact same parseOutput/schema-
 * validation path as a real response — only the network call itself is
 * replaced — so the validator exercises real validation logic.
 */
function mockResponseFor(stageId, userMessage) {
  const fixtures = {
    research: {
      summary: 'Mocked research summary for validator fixtures.',
      researchMode: 'model-synthesis',
      audienceInsights: ['Fixture audience insight one.', 'Fixture audience insight two.'],
      contentAngles: [
        { title: 'Fixture Angle A', angle: 'curiosity gap', hookPotential: 'high', relevanceScore: 8, riskLevel: 'low' },
        { title: 'Fixture Angle B', angle: 'bold claim', hookPotential: 'medium', relevanceScore: 6, riskLevel: 'low' },
      ],
      recommendedAngle: 'Fixture Angle A',
      keyPoints: ['Fixture key point one.', 'Fixture key point two.'],
      claims: [
        { text: 'Fixture claim requiring verification.', verificationStatus: 'unverified', sourceNeeded: true, sourceIds: [] },
        { text: 'Fixture supported claim from mock-1.', verificationStatus: 'supported', sourceNeeded: false, sourceIds: ['mock-1'] },
      ],
      competitorPatterns: ['Fixture competitor pattern.'],
      platformNotes: ['Fixture platform note.'],
      risks: ['Fixture low risk note.'],
      recommendedRuntimeSeconds: 30,
      // Live-search-mode-only fields — harmlessly ignored by
      // parseResearchOutput when the actual mode is model-synthesis, and
      // gives the mocked live-search browser/validator flow a realistic
      // evidence shape citing the mock adapter's own fixture source ids.
      sourceIds: ['mock-1', 'mock-2'],
      evidence: [
        { claim: 'Fixture supported claim from mock-1.', sourceIds: ['mock-1'], evidenceType: 'statistic', confidence: 'high', verificationStatus: 'supported', notes: 'Directly stated in the primary source.' },
        { claim: 'Fixture partially-corroborated claim.', sourceIds: ['mock-2'], evidenceType: 'trend', confidence: 'medium', verificationStatus: 'partially_supported', notes: 'Industry report hints at this but does not confirm fully.' },
      ],
      unresolvedClaims: ['Fixture claim with no supporting source found.'],
    },
    script: {
      hooks: [
        { text: 'Fixture hook one.', angle: 'curiosity gap', score: 8 },
        { text: 'Fixture hook two.', angle: 'bold claim', score: 6 },
      ],
      selectedHook: 'Fixture hook one.',
      opening: 'Fixture hook one. This is the fixture opening line.',
      body: 'Fixture body content for validator purposes, describing the mocked product story in a few sentences.',
      cta: 'Fixture CTA — follow for more.',
      fullText: 'Fixture hook one. This is the fixture opening line. Fixture body content for validator purposes, describing the mocked product story in a few sentences. Fixture CTA — follow for more.',
      estimatedRuntimeSeconds: 30,
      voiceDirection: 'Fixture voice direction: upbeat, direct.',
      tone: 'Bold and direct',
      onScreenText: ['Fixture on-screen text.'],
      complianceNotes: [],
    },
    storyboard: {
      scenes: [
        { index: 0, startSeconds: 0, endSeconds: 5, narration: 'Fixture hook one.', visual: 'Fixture opening visual.', onScreenText: 'HOOK', camera: 'close-up', motion: 'static', transition: 'cut', assetType: 'video', providerHint: 'manual-export' },
        { index: 1, startSeconds: 5, endSeconds: 30, narration: 'Fixture body content for validator purposes.', visual: 'Fixture body visual.', onScreenText: '', camera: 'medium', motion: 'pan', transition: 'cut', assetType: 'video', providerHint: 'manual-export' },
      ],
      totalDurationSeconds: 30,
      pacing: 'medium',
      visualStyle: 'Fixture visual style.',
      continuityNotes: [],
    },
    prompts: {
      productionMode: 'faceless_social',
      heygen: { applicable: false, avatarDirection: '', voiceDirection: '', sceneInstructions: [], constraints: [] },
      hyperframes: { applicable: false, compositionBrief: '', animationDirections: [], typography: '', transitions: [], aspectRatio: '9:16' },
      imageGeneration: {
        applicable: true,
        prompts: [{ sceneIndex: 0, prompt: 'Fixture image prompt.', negativePrompt: 'Fixture negative prompt.', aspectRatio: '9:16' }],
      },
      thumbnail: { imagePrompt: 'Fixture thumbnail image prompt.', headline: 'Fixture Headline', composition: 'centered subject', exclusions: [] },
    },
    thumbnail: {
      headline: 'Fixture Thumbnail Headline',
      alternateHeadlines: ['Fixture Alt Headline'],
      visualBrief: 'Fixture visual brief for the thumbnail.',
      subject: 'Fixture subject',
      background: 'Fixture background',
      composition: 'centered, high contrast',
      emotion: 'curiosity',
      contrastStrategy: 'Fixture contrast strategy.',
      brandElements: [],
      imagePrompt: 'Fixture thumbnail image generation prompt.',
      negativePrompt: 'Fixture negative prompt.',
      platformSafeAreaNotes: ['Fixture safe-area note.'],
      score: 7,
    },
    caption: {
      primaryCaption: 'Fixture primary caption for validator purposes.',
      alternateCaptions: ['Fixture alternate caption.'],
      cta: 'Fixture CTA — follow for more.',
      hashtags: ['fixture', 'validator', 'mika'],
      keywords: ['fixture keyword'],
      firstComment: 'Fixture first comment.',
      platformVariants: {
        tiktok: 'Fixture TikTok caption.', instagram: 'Fixture Instagram caption.', youtubeShorts: 'Fixture YouTube Shorts caption.',
        linkedin: 'Fixture LinkedIn caption.', pinterest: 'Fixture Pinterest caption.', x: 'Fixture X caption.',
      },
      complianceNotes: [],
    },
    review: {
      verdict: 'approved',
      overallScore: 8,
      categoryScores: { brandFit: 8, hookStrength: 8, clarity: 8, platformFit: 8, productionReadiness: 7, factualSafety: 9, ctaStrength: 7 },
      blockingIssues: [],
      warnings: ['Fixture non-blocking warning.'],
      revisionInstructions: [],
      approvedForPackageCreation: true,
    },
  };
  // Second-call (schema-repair) fixture path: if the validator's malformed-JSON
  // test injects a marker into the user message, return intentionally broken
  // output once so the repair-attempt path is exercised for real.
  if (userMessage.includes('__MOCK_FORCE_MALFORMED_ONCE__') && !userMessage.includes('Your previous JSON output was invalid')) {
    return { __rawOverride: '{not valid json' };
  }
  // Validator marker: force a Creative Review verdict with blocking issues,
  // to test that human approval is refused when AI review did not approve.
  if (stageId === 'review' && userMessage.includes('__MOCK_REVIEW_BLOCKED__')) {
    return {
      verdict: 'revisions_required',
      overallScore: 4,
      categoryScores: { brandFit: 4, hookStrength: 4, clarity: 4, platformFit: 4, productionReadiness: 4, factualSafety: 4, ctaStrength: 4 },
      blockingIssues: ['Mocked blocking issue for validator test.'],
      warnings: [],
      revisionInstructions: ['Mocked revision instruction.'],
      approvedForPackageCreation: false,
    };
  }
  return fixtures[stageId] || {};
}

// Test-only, in-memory, mock-mode-only state for the "retry a genuinely
// failed stage succeeds on the next attempt" validator scenario. Never
// consulted outside mockModeActive() — irrelevant to real behavior.
const mockFirstAttemptSeen = new Set();

async function callOnce({ stageId, model, systemPrompt, userMessage, temperature }) {
  if (mockModeActive()) {
    if (userMessage.includes('__MOCK_FORCE_HARD_FAILURE__')) {
      return { ok: false, status: 'provider_error', message: 'Mocked non-repairable hard failure for validator test.' };
    }
    if (userMessage.includes('__MOCK_FAIL_FIRST_ATTEMPT_ONLY__')) {
      const key = `${stageId}:first-attempt`;
      if (!mockFirstAttemptSeen.has(key)) {
        mockFirstAttemptSeen.add(key);
        return { ok: false, status: 'provider_error', message: 'Mocked first-attempt-only failure for validator retry test.' };
      }
      // second+ attempt (a real retry via run-next) falls through to a normal fixture below.
    }
    const mocked = mockResponseFor(stageId, userMessage);
    if (mocked.__rawOverride) {
      return { ok: false, status: 'malformed_output', message: 'Mocked malformed JSON for validator schema-repair test.' };
    }
    return {
      ok: true,
      model: `${model} (mocked)`,
      raw: mocked,
      usage: { promptTokens: 120, completionTokens: 180, totalTokens: 300 },
    };
  }

  const cfg = getWorkforceConfig();
  if (!cfg.configured) return { ok: false, status: 'configuration_pending', message: cfg.reason };

  const apiKey = process.env.OPENROUTER_API_KEY;
  let response;
  try {
    response = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://mika-mission-control.local',
        'X-Title': 'MIKA AGENTIC OS Content Workforce',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: temperature ?? 0.6,
        max_tokens: maxTokens(),
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(stageTimeoutMs()),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError') {
      return { ok: false, status: 'timeout', message: `Stage timed out after ${stageTimeoutMs()}ms.` };
    }
    return { ok: false, status: 'network_error', message: 'Could not reach OpenRouter. Check your connection and retry.' };
  }

  if (!response.ok) {
    const status = response.status;
    if (status === 401 || status === 403) return { ok: false, status: 'auth_error', message: 'OpenRouter authentication failed. Verify OPENROUTER_API_KEY.' };
    if (status === 429) return { ok: false, status: 'rate_limited', message: 'OpenRouter rate limit reached. Retry in a moment.' };
    if (status === 402) return { ok: false, status: 'billing_error', message: 'OpenRouter billing issue. Check your account credits.' };
    return { ok: false, status: 'provider_error', message: 'Stage generation could not be completed. Please retry.' };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return { ok: false, status: 'parse_error', message: 'OpenRouter returned an unexpected response format.' };
  }

  const rawContent = data?.choices?.[0]?.message?.content;
  if (!rawContent) return { ok: false, status: 'empty_response', message: 'Stage returned no content. Retry or adjust the request.' };

  let parsed;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    return { ok: false, status: 'malformed_output', message: 'Model output was not valid JSON.' };
  }

  return {
    ok: true,
    model: data.model || model,
    raw: parsed,
    usage: {
      promptTokens: data.usage?.prompt_tokens ?? null,
      completionTokens: data.usage?.completion_tokens ?? null,
      totalTokens: data.usage?.total_tokens ?? null,
    },
  };
}

/**
 * Calls one workforce stage's model, with at most ONE schema-repair retry
 * driven by the caller's own parseOutput() validator. Never retries more
 * than once; never silently falls back to fabricated content on failure.
 *
 * @param {object} params
 * @param {string} params.stageId
 * @param {string} params.systemPrompt
 * @param {string} params.userMessage
 * @param {(raw: object) => { valid: boolean, errors: string[], data: object|null, warnings?: string[] }} params.parseOutput
 * @param {number} [params.temperature]
 */
// Failure modes where retrying the SAME request with a corrective note is
// plausibly useful (the model produced something, just not schema-valid
// JSON). Config/network/auth/billing/rate-limit/timeout/provider failures
// are never retried — a second identical call cannot fix them and would
// just burn additional budget/time for no benefit.
const REPAIRABLE_STATUSES = new Set(['malformed_output', 'parse_error', 'empty_response']);

export async function callWorkforceStageWithRepair({ stageId, systemPrompt, userMessage, parseOutput, temperature }) {
  const model = modelForStage(stageId);

  let attempt = await callOnce({ stageId, model, systemPrompt, userMessage, temperature });
  let repaired = false;

  const firstFailureReason = !attempt.ok
    ? (REPAIRABLE_STATUSES.has(attempt.status) ? attempt.message : null)
    : (!parseOutput(attempt.raw).valid ? parseOutput(attempt.raw).errors.join('; ') : null);

  if (firstFailureReason) {
    // ── one, and only one, schema-repair attempt ────────────────────────
    const repairMessage = `${userMessage}\n\n---\nYour previous JSON output was invalid: ${firstFailureReason}\nReturn corrected JSON matching the required schema exactly. No markdown fences, no preamble.`;
    attempt = await callOnce({ stageId, model, systemPrompt, userMessage: repairMessage, temperature });
    repaired = true;
  }

  if (!attempt.ok) return { ...attempt, model, repaired };
  const parsed = parseOutput(attempt.raw);
  return { ok: true, model: attempt.model, raw: attempt.raw, usage: attempt.usage, parsed, repaired };
}
