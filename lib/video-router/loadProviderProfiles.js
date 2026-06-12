// lib/video-router/loadProviderProfiles.js
// SERVER-SIDE ONLY.
// Loads provider profiles from /video-router/provider-profiles.json.

import path from 'path';
import fs from 'fs';

const PROFILES_PATH = path.join(process.cwd(), 'video-router', 'provider-profiles.json');

let _cache = null;

function load() {
  if (_cache) return _cache;
  try {
    _cache = JSON.parse(fs.readFileSync(PROFILES_PATH, 'utf-8'));
    return _cache;
  } catch {
    return { providers: [], budgetModes: {}, contentFormatRouting: {} };
  }
}

export function loadProviderProfiles() {
  return load().providers || [];
}

export function getProviderProfile(providerId) {
  return loadProviderProfiles().find(p => p.providerId === providerId) || null;
}

/**
 * Get recommended providers for a content format and budget mode.
 * Returns an array of providers in priority order, with recommendation rationale.
 *
 * @param {string} contentFormat — 'short-form' | 'avatar' | 'cinematic' | 'ugc-ad' | 'b-roll' | 'ai-twin'
 * @param {string} budgetMode    — 'low-cost' | 'balanced' | 'premium'
 * @returns {{ primary, secondary, tertiary, allProviders, budgetNote }}
 */
export function getRecommendedProviders(contentFormat = 'short-form', budgetMode = 'balanced') {
  const data              = load();
  const routing           = data.contentFormatRouting  || {};
  const budgetModes       = data.budgetModes            || {};
  const allProfiles       = data.providers              || [];

  // Start with format-based routing
  const formatRoute = routing[contentFormat] || routing['short-form'] || {};
  const budgetPref  = budgetModes[budgetMode]?.preferredProviders || [];

  // Score each provider
  const scored = allProfiles.map(p => {
    let score = 0;
    if (p.providerId === formatRoute.primary)   score += 100;
    if (p.providerId === formatRoute.secondary) score += 60;
    if (p.providerId === formatRoute.tertiary)  score += 30;
    // Budget alignment boost
    const budgetIdx = budgetPref.indexOf(p.providerId);
    if (budgetIdx !== -1) score += (4 - budgetIdx) * 15;
    return { ...p, recommendationScore: score };
  }).sort((a, b) => b.recommendationScore - a.recommendationScore);

  const primary   = scored[0] || null;
  const secondary = scored[1] || null;
  const tertiary  = scored[2] || null;

  return {
    primary,
    secondary,
    tertiary,
    allProviders:  scored,
    budgetNote:    budgetModes[budgetMode]?.description || '',
    formatNote:    `Routing for ${contentFormat} with ${budgetMode} budget`,
  };
}

export function getBudgetModes() {
  return load().budgetModes || {};
}

export function getContentFormatRouting() {
  return load().contentFormatRouting || {};
}
