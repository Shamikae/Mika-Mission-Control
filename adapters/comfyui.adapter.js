// adapters/comfyui.adapter.js
// STAGED — HTTP adapter for ComfyUI (local or remote Stable Diffusion node).
// Activation: set COMFYUI_ENDPOINT and COMFYUI_ENABLED=true.
// Execute: POST workflow JSON to /prompt endpoint, poll /history/{id} for result.

const comfyuiAdapter = {
  adapterId:         'comfyui',
  displayName:       'ComfyUI',
  status:            'staged',
  supportedTaskTypes: [
    'image_generation', 'inpainting', 'outpainting', 'img2img',
    'upscale', 'style_transfer', 'lora_generation', 'controlnet',
  ],

  async healthCheck() {
    const enabled  = process.env.COMFYUI_ENABLED   === 'true';
    const endpoint = process.env.COMFYUI_ENDPOINT  || '';
    if (!enabled || !endpoint) {
      return {
        ok:        false,
        status:    'staged',
        error:     'ComfyUI adapter is staged. Set COMFYUI_ENDPOINT and COMFYUI_ENABLED=true to activate.',
        adapterId: 'comfyui',
        activationGuide: 'Run ComfyUI locally (default: http://127.0.0.1:8188) or on VPS. Set COMFYUI_ENDPOINT and COMFYUI_ENABLED=true.',
      };
    }
    const t0 = Date.now();
    try {
      const res = await fetch(`${endpoint.replace(/\/$/, '')}/system_stats`, {
        signal: AbortSignal.timeout(4000),
      });
      const latencyMs = Date.now() - t0;
      return {
        ok:        res.ok,
        latencyMs,
        status:    res.ok ? 'active' : 'unreachable',
        error:     res.ok ? null : `ComfyUI returned ${res.status}`,
        adapterId: 'comfyui',
      };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t0, status: 'offline', error: e.message, adapterId: 'comfyui' };
    }
  },

  async execute(task, decision) {
    throw new Error(
      'ComfyUI adapter is staged. Activate by setting COMFYUI_ENDPOINT and COMFYUI_ENABLED=true.'
    );
    // When active, implementation will:
    // 1. Load appropriate workflow JSON for the task type
    // 2. Inject prompt, seed, dimensions into workflow nodes
    // 3. POST workflow to COMFYUI_ENDPOINT/prompt
    // 4. Poll /history/{prompt_id} until images are ready
    // 5. Fetch images from /view?filename={name}&subfolder={sub}&type=output
    // 6. Return image URLs or base64 data
  },

  validateInput(task) {
    const errors = [];
    if (!task.taskId && !task.id) errors.push('taskId is required');
    if (!task.taskType)           errors.push('taskType is required');
    if (!this.supportedTaskTypes.includes(task.taskType)) {
      errors.push(`Task type "${task.taskType}" is not supported by ComfyUI adapter`);
    }
    // Future: validate workflow exists for task type, prompt is present
    return { valid: errors.length === 0, errors };
  },

  estimateCost(task) {
    // ComfyUI is self-hosted — no per-call fee, only compute cost
    return {
      estimatedCost: 0,
      currency:      'USD',
      tier:          'free',
      note:          'Self-hosted compute — no per-call API fee. GPU time only.',
    };
  },
};

export default comfyuiAdapter;
