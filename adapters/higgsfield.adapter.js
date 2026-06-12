// adapters/higgsfield.adapter.js
// STAGED — HTTP adapter for Higgsfield AI video generation.
// Activation: set HIGGSFIELD_API_KEY and HIGGSFIELD_ENABLED=true.
// Execute: POST to Higgsfield API with prompt + style + duration.

const higgsfieldAdapter = {
  adapterId:         'higgsfield',
  displayName:       'Higgsfield',
  status:            'staged',
  supportedTaskTypes: [
    'video_generation', 'cinematic_video', 'motion_video',
    'style_transfer_video', 'ai_film',
  ],

  async healthCheck() {
    const enabled = process.env.HIGGSFIELD_ENABLED === 'true';
    const apiKey  = process.env.HIGGSFIELD_API_KEY  || '';
    return {
      ok:        false,
      status:    enabled && apiKey ? 'not_connected' : 'staged',
      error:     'Higgsfield adapter is staged. Set HIGGSFIELD_API_KEY and HIGGSFIELD_ENABLED=true to activate.',
      adapterId: 'higgsfield',
      activationGuide: 'Set HIGGSFIELD_API_KEY and HIGGSFIELD_ENABLED=true. Check Higgsfield API docs for video generation endpoint.',
    };
  },

  async execute(task, decision) {
    throw new Error(
      'Higgsfield adapter is staged. Activate by setting HIGGSFIELD_API_KEY and HIGGSFIELD_ENABLED=true.'
    );
    // When active, implementation will:
    // 1. POST to Higgsfield API with { prompt, style, duration, seed }
    // 2. Poll job status until complete
    // 3. Return video download URL
  },

  validateInput(task) {
    const errors = [];
    if (!task.taskId && !task.id) errors.push('taskId is required');
    if (!task.taskType)           errors.push('taskType is required');
    if (!this.supportedTaskTypes.includes(task.taskType)) {
      errors.push(`Task type "${task.taskType}" is not supported by Higgsfield adapter`);
    }
    // Future: validate prompt, style params
    return { valid: errors.length === 0, errors };
  },

  estimateCost(task) {
    return {
      estimatedCost: 0.50,
      currency:      'USD',
      tier:          'medium',
      note:          'Staged estimate — cinematic video generation is compute-intensive',
    };
  },
};

export default higgsfieldAdapter;
