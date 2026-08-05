// lib/creative-director/workforce/workforceContract.js
// SERVER-SIDE ONLY (imports the model client, which reads OPENROUTER_API_KEY).
//
// ONE shared, replaceable worker contract used by every workforce stage —
// this file is the entire "engine" for turning a stage definition (prompt +
// schema) into a runnable worker. There are seven stage DEFINITIONS (plain
// data: system prompt, schema parser, context builder, estimator) under
// ./stages/, but exactly one factory and one execute() implementation. A
// stage is swapped to a different model/provider later by changing only its
// definition's systemPrompt/parseOutput — never this file.

import { callWorkforceStageWithRepair, modelForStage } from './workforceModelClient';
import { estimateCostFromPromptLength, estimateCostFromTokens } from './workforceRules';
import { getWorkforceMaxTokens } from './workforceModelClient';

/**
 * @param {object} def
 * @param {string} def.id
 * @param {string} def.displayName
 * @param {string|(context: object) => string} def.systemPrompt — a fixed
 *   string for most stages, or a function of the (possibly prepareContext-
 *   enriched) context for a stage whose prompt must vary by mode (Research).
 * @param {(context: object) => string} def.buildUserMessage
 * @param {(context: object) => object} def.summarizeInput — small, safe-to-persist input summary (no secrets/paths)
 * @param {(raw: object, context?: object) => { valid: boolean, errors: string[], data: object|null, warnings?: string[] }} def.parseOutput —
 *   context is only ever passed during a real execute() call (bound via
 *   closure over the effective/enriched context); validateOutput/
 *   sanitizeOutput call it with context undefined, which every stage's
 *   parser must handle gracefully (Research does: no context => no known
 *   source ids => sourceIds/evidence degrade to empty, never fabricated).
 * @param {(context: object) => boolean} [def.validateContext] — returns true if upstream context is sufficient to run
 * @param {number} [def.temperature]
 * @param {(context: object) => Promise<{ context?: object, warnings?: string[], error?: { errorReason: string, error: string } }>} [def.prepareContext] —
 *   optional hook run BEFORE validateContext/buildUserMessage. Lets a stage
 *   do non-model async work (e.g. the Research stage's live-search pipeline)
 *   and hand the model call an ENRICHED context. Returning `error` short-
 *   circuits execute() with an honest failure, exactly like a model-call
 *   failure would. Every other stage omits this — the contract stays the
 *   same for all seven; only Research currently uses it.
 * @returns {object} a worker matching the shared contract
 */
export function createStageWorker(def) {
  const inputSchemaVersion = 1;
  const outputSchemaVersion = 1;

  return {
    id: def.id,
    displayName: def.displayName,
    inputSchemaVersion,
    outputSchemaVersion,
    status: 'available',

    validateInput(context) {
      if (typeof def.validateContext === 'function') return def.validateContext(context);
      return true;
    },

    validateOutput(output) {
      return def.parseOutput(output).valid;
    },

    sanitizeOutput(output) {
      return def.parseOutput(output).data;
    },

    estimate(context) {
      const userMessage = def.buildUserMessage(context);
      const systemPrompt = typeof def.systemPrompt === 'function' ? def.systemPrompt(context) : def.systemPrompt;
      return estimateCostFromPromptLength(userMessage.length + systemPrompt.length, getWorkforceMaxTokens());
    },

    async execute(context) {
      const startedAt = new Date().toISOString();
      const stage = def.id;
      const model = modelForStage(stage);
      const inputSummary = def.summarizeInput ? def.summarizeInput(context) : null;

      let effectiveContext = context;
      let prepareWarnings = [];
      if (typeof def.prepareContext === 'function') {
        const prepared = await def.prepareContext(context);
        if (prepared?.error) {
          return {
            ok: false, stage, model, startedAt, completedAt: new Date().toISOString(),
            inputSummary, output: null, usage: null, estimatedCost: null, warnings: prepared.warnings || [],
            errorReason: prepared.error.errorReason || 'prepare_context_failed',
            error: prepared.error.error || 'Failed to prepare stage context.',
          };
        }
        effectiveContext = prepared?.context || context;
        prepareWarnings = prepared?.warnings || [];
      }

      if (typeof def.validateContext === 'function' && !def.validateContext(effectiveContext)) {
        return {
          ok: false, stage, model, startedAt, completedAt: new Date().toISOString(),
          inputSummary, output: null, usage: null, estimatedCost: null, warnings: prepareWarnings,
          errorReason: 'missing_upstream_context',
          error: `Stage "${stage}" is missing required upstream context and cannot run yet.`,
        };
      }

      const resolvedSystemPrompt = typeof def.systemPrompt === 'function' ? def.systemPrompt(effectiveContext) : def.systemPrompt;
      const userMessage = def.buildUserMessage(effectiveContext);
      const result = await callWorkforceStageWithRepair({
        stageId: stage,
        systemPrompt: resolvedSystemPrompt,
        userMessage,
        parseOutput: (raw) => def.parseOutput(raw, effectiveContext),
        temperature: def.temperature,
      });

      const completedAt = new Date().toISOString();
      const warnings = [...prepareWarnings, ...(result.repaired ? ['A schema-repair retry was needed for this stage.'] : [])];

      if (!result.ok) {
        return {
          ok: false, stage, model: result.model || model, startedAt, completedAt,
          inputSummary, output: null, usage: null, estimatedCost: null, warnings,
          errorReason: result.status || 'unknown_error',
          error: result.message || 'Stage failed for an unknown reason.',
        };
      }

      if (!result.parsed.valid) {
        return {
          ok: false, stage, model: result.model, startedAt, completedAt,
          inputSummary,
          output: null,
          usage: result.usage,
          estimatedCost: estimateCostFromTokens(result.usage?.totalTokens),
          warnings,
          errorReason: 'malformed_output',
          error: `Stage output failed schema validation: ${result.parsed.errors.join('; ')}`,
        };
      }

      return {
        ok: true, stage, model: result.model, startedAt, completedAt,
        inputSummary,
        output: result.parsed.data,
        usage: result.usage,
        estimatedCost: estimateCostFromTokens(result.usage?.totalTokens),
        warnings: [...warnings, ...(result.parsed.warnings || [])],
        errorReason: null,
        error: null,
      };
    },
  };
}
