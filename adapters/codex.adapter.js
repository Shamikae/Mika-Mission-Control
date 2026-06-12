// adapters/codex.adapter.js
// STAGED — API adapter for OpenAI Codex.
// Activation: set OPENAI_API_KEY and CODEX_ENABLED=true.

const codexAdapter = {
  adapterId:         'codex',
  displayName:       'Codex',
  status:            'staged',
  supportedTaskTypes: [
    'code_review', 'implement_feature', 'write_unit_tests',
    'optimize_performance', 'security_audit', 'generate_docs',
  ],

  async healthCheck() {
    const enabled = process.env.CODEX_ENABLED === 'true';
    const apiKey  = process.env.OPENAI_API_KEY || '';
    return {
      ok:        false,
      status:    enabled && apiKey ? 'not_connected' : 'staged',
      error:     'Codex adapter is staged. Set OPENAI_API_KEY and CODEX_ENABLED=true to activate.',
      adapterId: 'codex',
      activationGuide: 'Set OPENAI_API_KEY and CODEX_ENABLED=true, then change status to active.',
    };
  },

  async execute(task, decision) {
    throw new Error(
      'Codex adapter is staged. Activate by setting OPENAI_API_KEY and CODEX_ENABLED=true.'
    );
  },

  validateInput(task) {
    const errors = [];
    if (!task.taskId && !task.id) errors.push('taskId is required');
    if (!task.taskType)           errors.push('taskType is required');
    if (!this.supportedTaskTypes.includes(task.taskType)) {
      errors.push(`Task type "${task.taskType}" is not supported by Codex adapter`);
    }
    return { valid: errors.length === 0, errors };
  },

  estimateCost(task) {
    return {
      estimatedCost: 0.02,
      currency:      'USD',
      tier:          'low',
      note:          'Staged estimate — ~$0.02 per task at gpt-4o pricing',
    };
  },
};

export default codexAdapter;
