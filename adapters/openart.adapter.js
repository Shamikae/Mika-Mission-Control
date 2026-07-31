// adapters/openart.adapter.js
// OAuth-authenticated MCP adapter for OpenArt AI image generation.
// Activation: set OPENART_ENABLED=true, then POST /api/openart/connect and
// complete the OAuth flow. There is no OPENART_API_KEY — auth is per-account
// OAuth via the MCP server at OPENART_MCP_URL.
//
// Checkpoint 2 scope: governed text-to-image generation only. Model
// discovery/selection, schema-driven params, prompt governance, credit
// budget guard, and bounded polling all live in lib/openart/openartMcpClient.js
// — this adapter is a thin, governance-facing wrapper around that pipeline.

import { checkOpenArtHealth, generateOpenArtImage } from '../lib/openart/openartMcpClient.js';

const openartAdapter = {
  adapterId:         'openart',
  displayName:       'OpenArt',
  status:            'active',
  supportedTaskTypes: [
    'image_generation', 'image_variation', 'style_transfer',
    'product_image', 'brand_visual', 'thumbnail_generation',
  ],

  async healthCheck() {
    return checkOpenArtHealth();
  },

  /**
   * Returns a result object with a `status` field for expected non-error
   * outcomes (prompt_selection_required, budget_exceeded, failed, cancelled,
   * timed_out, completed) — executeViaOpenArt in executeDispatch.js branches
   * on it. Throws only for hard pre-flight errors (auth, config, invalid
   * model/project, missing prompt, unsupported schema).
   */
  async execute(task) {
    return generateOpenArtImage(task);
  },

  validateInput(task) {
    const errors = [];
    if (!task.taskId && !task.id) errors.push('taskId is required');
    if (!task.taskType)           errors.push('taskType is required');
    if (!this.supportedTaskTypes.includes(task.taskType)) {
      errors.push(`Task type "${task.taskType}" is not supported by OpenArt adapter`);
    }
    if (!task.description && !task.instructions && !task.prompt) {
      errors.push('description, instructions, or prompt (image prompt) is required');
    }
    return { valid: errors.length === 0, errors };
  },

  estimateCost() {
    // Real per-job pricing is fetched live via openart_model_cost before every
    // generation (see generateOpenArtImage) and stored on the task as
    // estimatedCredits. This is only a rough, synchronous, informational
    // figure for dashboards that call estimateCost() without hitting the network.
    return {
      estimatedCost: null,
      currency:      'credits',
      tier:          'variable',
      note:          'OpenArt bills in credits (10–40+ per image depending on model/resolution). Exact cost is fetched live via openart_model_cost before each generation and recorded on the task.',
    };
  },
};

export default openartAdapter;
