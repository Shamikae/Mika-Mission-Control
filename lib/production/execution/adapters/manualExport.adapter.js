// lib/production/execution/adapters/manualExport.adapter.js
// SERVER-SIDE ONLY.
//
// The only production-safe executable adapter in v1. Reuses the existing
// Production Router export builder (lib/production/productionExport.js —
// unmodified) to produce a JSON and a Markdown production brief as local
// artifacts. Completes synchronously — no external credentials, no polling.

import { buildManualExportJson, buildManualExportMarkdown } from '../../productionExport.js';

const manualExportAdapter = {
  id: 'manual-export',
  displayName: 'Manual Export',
  status: 'active',
  supportedModes: ['avatar_video', 'cinematic_broll', 'product_demo', 'faceless_social', 'talking_head', 'image_to_video', 'slideshow', 'custom'],
  executionType: 'manual',
  mock: false,

  async healthCheck() {
    return { ok: true, status: 'active', error: null, latencyMs: 0 };
  },

  validateInput({ pkg }) {
    const errors = [];
    if (!pkg?.script?.fullText) errors.push('Package script is required to build a manual export brief.');
    return { valid: errors.length === 0, errors, warnings: [] };
  },

  estimate() {
    return {
      estimateType: 'free',
      estimatedRange: { min: 0, max: 0, currency: 'USD', unit: 'no provider API spend' },
      costTier: 'free',
      currency: 'USD',
      unit: 'currency',
      provisional: false,
    };
  },

  async submit({ job, pkg }) {
    const jsonContent = JSON.stringify(buildManualExportJson(pkg, job), null, 2);
    const markdownContent = buildManualExportMarkdown(pkg, job);

    return {
      ok: true,
      providerJobId: `manual-${job.id}`,
      status: 'completed', // synchronous — no polling is ever needed for this adapter
      nextPollSeconds: null,
      rawMetadata: { mock: false, synchronous: true },
      outputs: [
        { type: 'document', localBuffer: Buffer.from(jsonContent, 'utf-8'), mimeType: 'application/json', filename: 'production-brief.json', metadata: { kind: 'manual-export-json' } },
        { type: 'document', localBuffer: Buffer.from(markdownContent, 'utf-8'), mimeType: 'text/markdown', filename: 'production-brief.md', metadata: { kind: 'manual-export-markdown' } },
      ],
    };
  },

  async poll() {
    // Never reached in practice — submit() always completes synchronously.
    return { ok: true, status: 'completed', progress: 100, nextPollSeconds: null, outputs: [], error: null, rawMetadata: { mock: false } };
  },

  async cancel() {
    return { ok: false, status: 'completed', error: 'Manual export completes synchronously — there is nothing in-flight to cancel.' };
  },

  normalizeResult(result) {
    return {
      status: result.status,
      outputs: result.outputs || [],
      providerMetadata: result.rawMetadata || null,
    };
  },
};

export default manualExportAdapter;
