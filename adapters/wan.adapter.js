// adapters/wan.adapter.js
// STAGED — adapter for Wan (WanVideo) AI video generation.
// Activation: set WAN_API_KEY and WAN_ENABLED=true, or configure local/self-hosted endpoint.
// Execute: POST to Wan API with prompt + duration + resolution.

const wanAdapter = {
  adapterId:         'wan',
  displayName:       'Wan',
  status:            'staged',
  supportedTaskTypes: [
    'video_generation', 'text_to_video', 'image_to_video',
    'video_upscale', 'motion_generation',
  ],

  async healthCheck() {
    const enabled  = process.env.WAN_ENABLED  === 'true';
    const endpoint = process.env.WAN_ENDPOINT || '';
    return {
      ok:        false,
      status:    enabled && endpoint ? 'not_connected' : 'staged',
      error:     'Wan adapter is staged. Set WAN_ENABLED=true and WAN_ENDPOINT to activate.',
      adapterId: 'wan',
      activationGuide: 'Set WAN_ENABLED=true and WAN_ENDPOINT (self-hosted or cloud). Wan supports local ComfyUI deployment.',
    };
  },

  async execute(task, decision) {
    throw new Error(
      'Wan adapter is staged. Activate by setting WAN_ENABLED=true and WAN_ENDPOINT.'
    );
    // When active, implementation will:
    // 1. POST to WAN_ENDPOINT/generate with { prompt, duration, resolution, seed }
    // 2. Poll /status/{job_id} until complete
    // 3. Return video URL or base64 output
  },

  validateInput(task) {
    const errors = [];
    if (!task.taskId && !task.id) errors.push('taskId is required');
    if (!task.taskType)           errors.push('taskType is required');
    if (!this.supportedTaskTypes.includes(task.taskType)) {
      errors.push(`Task type "${task.taskType}" is not supported by Wan adapter`);
    }
    // Future: validate prompt, duration (1–10s), resolution
    return { valid: errors.length === 0, errors };
  },

  estimateCost(task) {
    // Wan is open-source — cost is compute (self-hosted GPU) or cloud API credits
    return {
      estimatedCost: null,
      currency:      'USD',
      tier:          'variable',
      note:          'Staged — cost depends on hosting mode: self-hosted GPU or cloud API',
    };
  },
};

export default wanAdapter;
