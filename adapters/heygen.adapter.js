// adapters/heygen.adapter.js
// STAGED — HTTP adapter for HeyGen AI video generation.
// Activation: set HEYGEN_API_KEY and HEYGEN_ENABLED=true.
// Execute: POST to HeyGen API v2 /video/generate with avatar + script.

const heygenAdapter = {
  adapterId:         'heygen',
  displayName:       'HeyGen',
  status:            'staged',
  supportedTaskTypes: [
    'avatar_video', 'video_generation', 'talking_head', 'video_translation',
    'video_localization', 'presenter_video',
  ],

  async healthCheck() {
    const enabled = process.env.HEYGEN_ENABLED === 'true';
    const apiKey  = process.env.HEYGEN_API_KEY  || '';
    if (!enabled || !apiKey) {
      return {
        ok:        false,
        status:    'staged',
        error:     'HeyGen adapter is staged. Set HEYGEN_API_KEY and HEYGEN_ENABLED=true to activate.',
        adapterId: 'heygen',
        activationGuide: 'Set HEYGEN_API_KEY and HEYGEN_ENABLED=true. Choose an avatar ID from your HeyGen account.',
      };
    }
    const t0 = Date.now();
    try {
      const res = await fetch('https://api.heygen.com/v2/avatars', {
        headers: { 'X-Api-Key': apiKey },
        signal:  AbortSignal.timeout(5000),
      });
      const latencyMs = Date.now() - t0;
      return {
        ok:        res.ok,
        latencyMs,
        status:    res.ok ? 'active' : 'auth_failed',
        error:     res.ok ? null : `HeyGen API returned ${res.status}`,
        adapterId: 'heygen',
      };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t0, status: 'offline', error: e.message, adapterId: 'heygen' };
    }
  },

  async execute(task, decision) {
    throw new Error(
      'HeyGen adapter is staged. Activate by setting HEYGEN_API_KEY and HEYGEN_ENABLED=true.'
    );
    // When active, implementation will:
    // 1. POST /v2/video/generate with { video_inputs: [{ character, voice, background }], test: false }
    // 2. Poll /v1/video_status.get?video_id={id} until status === 'completed'
    // 3. Return video_url from status response
  },

  validateInput(task) {
    const errors = [];
    if (!task.taskId && !task.id) errors.push('taskId is required');
    if (!task.taskType)           errors.push('taskType is required');
    if (!this.supportedTaskTypes.includes(task.taskType)) {
      errors.push(`Task type "${task.taskType}" is not supported by HeyGen adapter`);
    }
    // Future: validate avatarId, voiceId, script are present
    return { valid: errors.length === 0, errors };
  },

  estimateCost(task) {
    // HeyGen: ~1 credit per minute of video, credits ~$0.10–$0.33 each depending on plan
    return {
      estimatedCost: 0.25,
      currency:      'USD',
      tier:          'medium',
      note:          'Staged estimate — ~$0.25 per minute of generated video',
    };
  },
};

export default heygenAdapter;
