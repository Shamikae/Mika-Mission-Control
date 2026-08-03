// lib/publishing/publishExport.js
// Pure functions — no I/O. Builds the manual publishing bundle content
// (JSON bundle + Markdown brief + platform checklist), mirroring
// lib/production/productionExport.js's pattern: content is assembled at
// download time from freshly-loaded records, never persisted separately.

import { buildPlatformChecklist } from './publishingRules';

export function buildPublishJsonBundle({ pkg, productionJob, publishJob, artifact, platform }) {
  return {
    publishJobId: publishJob.id,
    productionJobId: productionJob.id,
    packageId: pkg.id,
    platform: { id: platform.id, displayName: platform.displayName },
    generatedAt: new Date().toISOString(),
    status: publishJob.status,
    scheduledFor: publishJob.scheduledFor,
    publishedAt: publishJob.publishedAt,
    caption: publishJob.caption || '',
    hashtags: publishJob.hashtags || [],
    firstComment: publishJob.firstComment || '',
    artifact: artifact ? {
      artifactId: artifact.artifactId,
      filename: artifact.filename,
      mimeType: artifact.mimeType,
      sizeBytes: artifact.sizeBytes,
      duration: artifact.duration,
      width: artifact.width,
      height: artifact.height,
      localUrl: artifact.localUrl,
    } : null,
    thumbnail: pkg.thumbnail?.status === 'completed' ? {
      headline: pkg.thumbnail.headline || '',
      artifactUrl: pkg.thumbnail.artifactUrl || null,
    } : null,
    platformChecklist: buildPlatformChecklist(platform),
    package: {
      topic: pkg.topic, brand: pkg.brand, goal: pkg.goal,
    },
  };
}

export function buildPublishMarkdownBrief({ pkg, productionJob, publishJob, artifact, platform }) {
  const checklist = buildPlatformChecklist(platform);
  const lines = [
    `# Publishing Brief — ${pkg.topic}`,
    '',
    `**Platform:** ${platform.displayName}  ·  **Status:** ${publishJob.status}  ·  **Brand:** ${pkg.brand}`,
    publishJob.scheduledFor ? `**Scheduled for:** ${publishJob.scheduledFor}` : '',
    publishJob.publishedAt ? `**Published at:** ${publishJob.publishedAt}` : '',
    '',
    '## Caption',
    '',
    publishJob.caption || '_No caption written yet._',
    '',
    `**Hashtags:** ${(publishJob.hashtags || []).map(h => `#${h}`).join(' ') || '—'}`,
    publishJob.firstComment ? `\n**First comment (post separately):** ${publishJob.firstComment}` : '',
    '',
    '## Media',
    '',
    artifact
      ? `- File: ${artifact.filename}\n- Type: ${artifact.mimeType}\n- Size: ${artifact.sizeBytes} bytes${artifact.duration != null ? `\n- Duration: ${artifact.duration}s` : ''}${artifact.width && artifact.height ? `\n- Dimensions: ${artifact.width}×${artifact.height}` : ''}`
      : '_No artifact attached._',
    '',
    pkg.thumbnail?.status === 'completed' ? `**Thumbnail:** ${pkg.thumbnail.headline || 'generated'}` : '_No generated thumbnail._',
    '',
    `## ${platform.displayName} Checklist`,
    '',
    ...checklist.map(item => `- [ ] ${item}`),
    '',
    '---',
    `_This is a manual publishing brief — Publishing Router v1 does not upload to any platform. Generated ${new Date().toISOString()} · Publish Job ${publishJob.id} · Production Job ${productionJob.id}_`,
  ];
  return lines.join('\n');
}
