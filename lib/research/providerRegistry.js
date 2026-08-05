// lib/research/providerRegistry.js
// SERVER-SIDE ONLY (imports adapters that read env). Exposes the governed
// list of research providers — status, executability, and capabilities —
// WITHOUT ever exposing a credential. Only the provider selected via
// CONTENT_RESEARCH_PROVIDER, if genuinely configured, is ever "executable".
// Exa and Tavily both have real adapters (Phase 5A / Phase 5B). Brave Search
// remains an honestly "staged" entry — no adapter implementation exists for
// it — so a future milestone can activate it without any registry shape
// change. model-synthesis is always available as the non-search fallback
// mode. Tavily's capabilities are deliberately limited to search + selective
// extraction — tavily_crawl/tavily_map/tavily_research are never wired into
// Mika's runtime, regardless of what the live Tavily MCP server (a separate,
// editor-scoped, ungoverned tool) exposes.

import { getExaConfig } from './adapters/exaAdapter.js';
import { getTavilyConfig } from './adapters/tavilyAdapter.js';
import { getResearchConfig } from './researchRules.js';

const REGISTRY_ENTRIES = [
  {
    id: 'exa',
    displayName: 'Exa',
    executionType: 'api_key',
    capabilities: ['neural_search', 'keyword_search', 'inline_content_extraction', 'content_fetch'],
    hasAdapter: true,
  },
  {
    id: 'tavily',
    displayName: 'Tavily',
    executionType: 'direct-api',
    capabilities: ['search', 'selective_extraction', 'normalized_sources', 'evidence_backed_research'],
    hasAdapter: true,
  },
  {
    id: 'brave-search',
    displayName: 'Brave Search',
    executionType: 'api_key',
    capabilities: ['keyword_search'],
    hasAdapter: false,
  },
  {
    id: 'model-synthesis',
    displayName: 'Model Synthesis (no live search)',
    executionType: 'none',
    capabilities: ['model_assisted_synthesis'],
    hasAdapter: true,
  },
];

function healthFor(id) {
  if (id === 'exa') {
    const cfg = getExaConfig();
    return cfg.configured ? { configured: true, message: 'Configured (key present).' } : { configured: false, message: cfg.reason };
  }
  if (id === 'tavily') {
    const cfg = getTavilyConfig();
    return cfg.configured ? { configured: true, message: 'Configured (key present).' } : { configured: false, message: cfg.reason };
  }
  if (id === 'model-synthesis') return { configured: true, message: 'Always available — no external provider required.' };
  return { configured: false, message: `${id} has no adapter implemented in this milestone (staged for a future phase).` };
}

/**
 * @returns {Array<{id, displayName, status, executable, configured, executionType, capabilities, health}>}
 */
export function listResearchProviders() {
  const researchCfg = getResearchConfig();
  const selected = researchCfg.provider;

  return REGISTRY_ENTRIES.map(entry => {
    const health = healthFor(entry.id);
    const isSelected = entry.id === selected;
    const executable = entry.id === 'model-synthesis'
      ? true
      : entry.hasAdapter && isSelected && researchCfg.enabled && health.configured;

    let status;
    if (entry.id === 'model-synthesis') status = 'available';
    else if (!entry.hasAdapter) status = 'staged';
    else if (!researchCfg.enabled) status = 'disabled';
    else if (!isSelected) status = 'staged';
    else if (!health.configured) status = 'configuration_pending';
    else status = 'available';

    return {
      id: entry.id,
      displayName: entry.displayName,
      status,
      executable,
      configured: health.configured,
      executionType: entry.executionType,
      capabilities: entry.capabilities,
      health: health.message,
    };
  });
}

export function getExecutableProvider() {
  return listResearchProviders().find(p => p.executable && p.id !== 'model-synthesis') || null;
}
