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
 * @param {string} def.systemPrompt
 * @param {(context: object) => string} def.buildUserMessage
 * @param {(context: object) => object} def.summarizeInput — small, safe-to-persist input summary (no secrets/paths)
 * @param {(raw: object) => { valid: boolean, errors: string[], data: object|null, warnings?: string[] }} def.parseOutput
 * @param {(context: object) => boolean} [def.validateContext] — returns true if upstream context is sufficient to run
 * @param {number} [def.temperature]
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
      return estimateCostFromPromptLength(userMessage.length + def.systemPrompt.length, getWorkforceMaxTokens());
    },

    async execute(context) {
      const startedAt = new Date().toISOString();
      const stage = def.id;
      const model = modelForStage(stage);
      const inputSummary = def.summarizeInput ? def.summarizeInput(context) : null;

      if (typeof def.validateContext === 'function' && !def.validateContext(context)) {
        return {
          ok: false, stage, model, startedAt, completedAt: new Date().toISOString(),
          inputSummary, output: null, usage: null, estimatedCost: null, warnings: [],
          errorReason: 'missing_upstream_context',
          error: `Stage "${stage}" is missing required upstream context and cannot run yet.`,
        };
      }

      const userMessage = def.buildUserMessage(context);
      const result = await callWorkforceStageWithRepair({
        stageId: stage,
        systemPrompt: def.systemPrompt,
        userMessage,
        parseOutput: def.parseOutput,
        temperature: def.temperature,
      });

      const completedAt = new Date().toISOString();
      const warnings = result.repaired ? ['A schema-repair retry was needed for this stage.'] : [];

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
