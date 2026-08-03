// lib/orchestration/globalSearch.js
// Pure function — no I/O. Searches across already-loaded packages,
// production jobs, artifacts, providers, and publish jobs. Read-only —
// never mutates anything, and each result carries only a navigational
// target (tab + id), never a raw filesystem path.

import { normalizeArtifactList } from '../artifacts/normalizeArtifact';
import { PROVIDER_CATALOG } from '../production/productionRules';
import { PLATFORM_CATALOG } from '../publishing/publishingRules';

const MAX_RESULTS = 40;

function matches(query, ...fields) {
  const q = query.toLowerCase();
  return fields.some(f => typeof f === 'string' && f.toLowerCase().includes(q));
}

export function searchAll({ packages, productionJobs, publishJobs }, query) {
  const q = (query || '').trim();
  if (!q) return [];
  const results = [];

  for (const pkg of packages) {
    if (matches(q, pkg.topic, pkg.brand, pkg.platform, pkg.id)) {
      results.push({ type: 'package', id: pkg.id, label: pkg.topic || pkg.id, detail: `${pkg.brand || '—'} · ${pkg.platform || '—'}`, tab: 'content-orchestrator', packageId: pkg.id });
    }
  }

  for (const job of productionJobs) {
    if (matches(q, job.id, job.selectedProvider, job.selectedMode, job.packageId)) {
      results.push({ type: 'production_job', id: job.id, label: `Production ${job.id}`, detail: `${job.selectedProvider || '—'} · ${job.status}`, tab: 'production-router', productionJobId: job.id });
    }
    const artifacts = normalizeArtifactList(job.execution?.outputs, { job });
    for (const artifact of artifacts) {
      if (matches(q, artifact.filename, artifact.mimeType)) {
        results.push({ type: 'artifact', id: artifact.artifactId, label: artifact.filename, detail: `${artifact.mimeType} · ${job.selectedProvider || '—'}`, tab: 'production-router', productionJobId: job.id, artifactId: artifact.artifactId });
      }
    }
  }

  for (const provider of PROVIDER_CATALOG) {
    if (matches(q, provider.id, provider.displayName)) {
      results.push({ type: 'provider', id: provider.id, label: provider.displayName, detail: provider.status || 'registered', tab: 'production-router' });
    }
  }

  for (const platform of PLATFORM_CATALOG) {
    if (matches(q, platform.id, platform.displayName)) {
      results.push({ type: 'platform', id: platform.id, label: platform.displayName, detail: platform.status, tab: 'publishing-router' });
    }
  }

  for (const job of publishJobs) {
    if (matches(q, job.id, job.platform, job.caption, job.productionJobId)) {
      results.push({ type: 'publish_job', id: job.id, label: `${job.platform} publish job`, detail: `${job.status}${job.caption ? ` · ${job.caption.slice(0, 60)}` : ''}`, tab: 'publishing-router', publishJobId: job.id });
    }
  }

  return results.slice(0, MAX_RESULTS);
}
