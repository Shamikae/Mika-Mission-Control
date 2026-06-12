import {
  buildPaperclipIssueUrl,
  fetchPaperclipJson,
  getPaperclipCompanyId,
  getPaperclipPublicMetadata,
  PaperclipConfigurationError,
} from '../../../lib/paperclip/client';

const BUILD_URL_PATTERN = /(https?:\/\/[^\s)]+\/builds\/[A-Za-z0-9_.-]+\.html)/i;

function normalizeLiveUrl(description) {
  const match = String(description || '').match(BUILD_URL_PATTERN);
  if (!match) return null;

  try {
    const url = new URL(match[1]);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function stateResponse(res, metadata, state, error = null) {
  return res.status(200).json({
    state,
    reachable: false,
    refreshMs: metadata.refreshMs,
    count: 0,
    builds: [],
    error,
  });
}

export default async function handler(req, res) {
  res.setHeader('Allow', 'GET');
  res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const metadata = getPaperclipPublicMetadata();
  if (!metadata.configured) return stateResponse(res, metadata, metadata.state);

  try {
    const companyId = getPaperclipCompanyId();
    const [agentsResult, issuesResult, projectsResult] = await Promise.all([
      fetchPaperclipJson(`/companies/${companyId}/agents`, []),
      fetchPaperclipJson(`/companies/${companyId}/issues`, []),
      fetchPaperclipJson(`/companies/${companyId}/projects`, []),
    ]);

    if (!issuesResult.ok) {
      return stateResponse(res, metadata, 'unreachable', issuesResult.error);
    }

    const agents = Array.isArray(agentsResult.data) ? agentsResult.data : [];
    const issues = Array.isArray(issuesResult.data) ? issuesResult.data : [];
    const projects = Array.isArray(projectsResult.data) ? projectsResult.data : [];
    const candidates = issues.filter(issue => normalizeLiveUrl(issue.description));

    const builds = await Promise.all(candidates.map(async issue => {
      const attachmentsResult = await fetchPaperclipJson(`/issues/${issue.id}/attachments`, []);
      const attachments = Array.isArray(attachmentsResult.data) ? attachmentsResult.data : [];
      const image = attachments.find(attachment =>
        String(attachment.contentType || attachment.mimeType || '').toLowerCase().startsWith('image/')
      );
      const agent = agents.find(entry => entry.id === issue.assigneeAgentId);
      const project = projects.find(entry => entry.id === issue.projectId);

      return {
        issueId: issue.id,
        identifier: issue.identifier || '',
        title: issue.title || 'Untitled build',
        status: issue.status || 'unknown',
        agent: agent?.name || null,
        agentIcon: agent?.icon || '',
        project: project?.name || '',
        createdAt: issue.createdAt || issue.updatedAt || '',
        liveUrl: normalizeLiveUrl(issue.description),
        issueUrl: buildPaperclipIssueUrl(issue.id),
        previewUrl: image ? `/api/paperclip/attachment/${encodeURIComponent(image.id)}` : null,
      };
    }));

    builds.sort((a, b) => Date.parse(b.createdAt || '0') - Date.parse(a.createdAt || '0'));
    return res.status(200).json({
      state: 'reachable',
      reachable: true,
      refreshMs: metadata.refreshMs,
      count: builds.length,
      builds,
      error: null,
    });
  } catch (error) {
    if (error instanceof PaperclipConfigurationError) {
      return stateResponse(res, metadata, error.state);
    }
    console.error('Paperclip builds failed:', error);
    return stateResponse(res, metadata, 'unreachable', 'Paperclip builds are unavailable');
  }
}
