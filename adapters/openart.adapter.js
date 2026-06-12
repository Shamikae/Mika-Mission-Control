// adapters/openart.adapter.js
// STAGED — HTTP adapter for OpenArt AI image generation.
// Activation: set OPENART_API_KEY and OPENART_ENABLED=true.
// Execute: POST to OpenArt API with prompt + model + dimensions.

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
    throw new Error(
      'OpenArt adapter is staged. Activate by setting OPENART_API_KEY and OPENART_ENABLED=true.'
    );
    // When active, implementation will:
    // 1. POST /v1/images/generate with { prompt, model, width, height, num_images }
    // 2. Return array of image URLs from response
  },

  validateInput(task) {
    const errors = [];
    if (!task.taskId && !task.id) errors.push('taskId is required');
    if (!task.taskType)           errors.push('taskType is required');
    if (!this.supportedTaskTypes.includes(task.taskType)) {
      errors.push(`Task type "${task.taskType}" is not supported by OpenArt adapter`);
    }
    // Future: validate prompt is present and not empty
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
