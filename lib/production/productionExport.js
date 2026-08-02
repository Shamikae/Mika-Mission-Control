// lib/production/productionExport.js
// Pure functions — no I/O. Builds the Manual Export production brief.
//
// This is the ONLY place package content (script/scenes/caption/thumbnail)
// is combined with plan data — and only ever at download time, from a
// freshly-loaded package passed in by the caller. Nothing built here is
// ever persisted into the production job store (data/production-jobs/*.json
// only ever holds derived metadata — see productionRules.js summaries).

import { modeLabel } from './productionRules';

export function buildManualExportJson(pkg, job) {
  return {
    jobId: job.id,
    packageId: pkg.id,
    generatedAt: new Date().toISOString(),
    package: {
      topic: pkg.topic,
      brand: pkg.brand,
      platform: pkg.platform,
      goal: pkg.goal,
      audience: pkg.audience || null,
      offer: pkg.offer || null,
      tone: pkg.tone || null,
    },
    script: pkg.script?.fullText || '',
    scenePlan: (pkg.scenes || []).map(s => ({
      order: s.order,
      durationSeconds: s.durationSeconds,
      visual: s.visual,
      voiceover: s.voiceover,
      onScreenText: s.onScreenText,
    })),
    onScreenText: (pkg.scenes || []).map(s => s.onScreenText).filter(Boolean),
    voiceoverByScene: (pkg.scenes || []).filter(s => (s.voiceover || '').trim()).map(s => ({ order: s.order, voiceover: s.voiceover })),
    captionPlan: {
      caption: pkg.caption || '',
      cta: pkg.cta || '',
      hashtags: pkg.hashtags || [],
      keywords: pkg.keywords || [],
    },
    thumbnail: {
      headline: pkg.thumbnail?.headline || '',
      visualBrief: pkg.thumbnail?.visualBrief || '',
      artifactUrl: pkg.thumbnail?.status === 'completed' ? (pkg.thumbnail?.artifactUrl || null) : null,
    },
    outputSpecification: job.outputSpec,
    selectedProductionMode: job.selectedMode,
    modeReason: job.modeReason,
    recommendedFutureProvider: job.preferredFutureProvider,
  };
}

export function buildManualExportMarkdown(pkg, job) {
  const scenes = pkg.scenes || [];
  const lines = [
    `# Production Brief — ${pkg.topic}`,
    '',
    `**Brand:** ${pkg.brand}  ·  **Platform:** ${pkg.platform}  ·  **Goal:** ${pkg.goal}`,
    `**Selected mode:** ${modeLabel(job.selectedMode)}  ·  **Preferred future provider:** ${job.preferredFutureProvider || 'None'}`,
    '',
    '## Script',
    '',
    pkg.script?.fullText || '_No script._',
    '',
    '## Scene Plan',
    '',
    ...scenes.map(s => `${s.order}. **[${s.durationSeconds ?? '?'}s]** ${s.visual || '_no visual note_'}${s.voiceover ? `\n   - VO: ${s.voiceover}` : ''}${s.onScreenText ? `\n   - On-screen: ${s.onScreenText}` : ''}`),
    '',
    '## Caption',
    '',
    pkg.caption || '_No caption._',
    '',
    `**CTA:** ${pkg.cta || '—'}`,
    `**Hashtags:** ${(pkg.hashtags || []).map(h => `#${h}`).join(' ')}`,
    `**Keywords:** ${(pkg.keywords || []).join(', ')}`,
    '',
    '## Thumbnail',
    '',
    `**Headline:** ${pkg.thumbnail?.headline || '—'}`,
    `**Visual brief:** ${pkg.thumbnail?.visualBrief || '—'}`,
    pkg.thumbnail?.status === 'completed' && pkg.thumbnail?.artifactUrl ? `**Generated thumbnail:** ${pkg.thumbnail.artifactUrl}` : '_No generated thumbnail._',
    '',
    '## Output Specification',
    '',
    `- Platform: ${job.outputSpec.platform}`,
    `- Aspect ratio: ${job.outputSpec.aspectRatio}`,
    `- Target duration: ${job.outputSpec.targetDuration}`,
    `- Resolution: ${job.outputSpec.resolution}`,
    `- Frame rate: ${job.outputSpec.frameRate}fps`,
    `- Caption burn-in: ${job.outputSpec.captionBurnIn ? 'Yes' : 'No'}`,
    `- Safe-area notes: ${job.outputSpec.safeAreaNotes}`,
    `- File format: ${job.outputSpec.fileFormat}`,
    '',
    '---',
    `_Generated ${new Date().toISOString()} · Job ${job.id} · Package ${pkg.id}_`,
  ];
  return lines.join('\n');
}
