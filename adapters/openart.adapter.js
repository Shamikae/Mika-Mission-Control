// adapters/openart.adapter.js
// HTTP adapter for OpenArt AI image generation.
// Activation: set OPENART_API_KEY and OPENART_ENABLED=true.
// Execute: calls openartClient.callOpenArt() and returns image Buffers.
// Saving buffers to disk is handled by executeViaOpenArt in executeDispatch.js.

import { callOpenArt } from '../lib/openart/openartClient.js';

const openartAdapter = {
  adapterId:         'openart',
  displayName:       'OpenArt',
  status:            'staged',
  supportedTaskTypes: [
    'image_generation', 'image_variation', 'style_transfer',
    'product_image', 'brand_visual', 'thumbnail_generation',
  ],

  async healthCheck() {
    const enabled = process.env.OPENART_ENABLED === 'true';
    const apiKey  = process.env.OPENART_API_KEY  || '';
    if (!enabled || !apiKey) {
      return {
        ok:        false,
        status:    'staged',
        error:     'OpenArt adapter is staged. Set OPENART_API_KEY and OPENART_ENABLED=true to activate.',
        adapterId: 'openart',
        activationGuide: 'Set OPENART_API_KEY and OPENART_ENABLED=true. API base: https://openart.ai/api/',
      };
    }
    const t0 = Date.now();
    try {
      const res = await fetch('https://openart.ai/api/v1/me', {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal:  AbortSignal.timeout(5000),
      });
      const latencyMs = Date.now() - t0;
      return {
        ok:        res.ok,
        latencyMs,
        status:    res.ok ? 'active' : 'auth_failed',
        error:     res.ok ? null : `OpenArt API returned ${res.status}`,
        adapterId: 'openart',
      };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t0, status: 'offline', error: e.message, adapterId: 'openart' };
    }
  },

  async execute(task, decision) {
    const enabled = process.env.OPENART_ENABLED === 'true';
    const apiKey  = process.env.OPENART_API_KEY || '';
    if (!enabled || !apiKey) {
      throw new Error('OpenArt adapter is not configured. Set OPENART_API_KEY and OPENART_ENABLED=true.');
    }

    // task.prompt is the raw user-provided image prompt (thumbnail-studio path).
    // task.description is the full structured brief for Hermes (fallback path).
    // Prefer the raw prompt for OpenArt so we don't send the whole brief structure.
    const prompt = (task.prompt || task.description || task.instructions || '').trim();
    if (!prompt) throw new Error('Task description (image prompt) is required for OpenArt');

    const result = await callOpenArt({
      prompt,
      negativePrompt: task.negativePrompt || '',
      model:     task.model  || undefined,
      width:     task.width  || undefined,
      height:    task.height || undefined,
      numImages: task.numImages || 1,
    });

    if (!result.ok) throw new Error(result.error || 'OpenArt image generation failed');

    return {
      ok:           true,
      imageBuffers: result.imageBuffers,
      model:        result.model,
      count:        result.count,
    };
  },

  validateInput(task) {
    const errors = [];
    if (!task.taskId && !task.id) errors.push('taskId is required');
    if (!task.taskType)           errors.push('taskType is required');
    if (!this.supportedTaskTypes.includes(task.taskType)) {
      errors.push(`Task type "${task.taskType}" is not supported by OpenArt adapter`);
    }
    if (!task.description && !task.instructions) {
      errors.push('description or instructions (image prompt) is required');
    }
    return { valid: errors.length === 0, errors };
  },

  estimateCost(task) {
    // OpenArt: ~$0.002–$0.008 per image depending on model
    return {
      estimatedCost: 0.005,
      currency:      'USD',
      tier:          'low',
      note:          'Staged estimate — ~$0.005 per generated image',
    };
  },
};

export default openartAdapter;
