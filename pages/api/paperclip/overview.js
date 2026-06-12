import {
  fetchPaperclipJson,
  getPaperclipCompanyId,
  getPaperclipPublicMetadata,
  PaperclipConfigurationError,
} from '../../../lib/paperclip/client';

function configurationResponse(res, metadata) {
  return res.status(200).json({
    state: metadata.state,
    reachable: false,
    refreshMs: metadata.refreshMs,
    workspaceUrl: metadata.workspaceUrl || null,
    views: metadata.views,
    company: null,
    stats: null,
    agents: [],
    activity: [],
    projects: [],
    issueByStatus: {},
  });
}

export default async function handler(req, res) {
  res.setHeader('Allow', 'GET');
  res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const metadata = getPaperclipPublicMetadata();
  if (!metadata.configured) return configurationResponse(res, metadata);

  try {
    const companyId = getPaperclipCompanyId();
    const [companyResult, agentsResult, runsResult, issuesResult, projectsResult] = await Promise.all([
      fetchPaperclipJson(`/companies/${companyId}`, {}),
      fetchPaperclipJson(`/companies/${companyId}/agents`, []),
      fetchPaperclipJson(`/companies/${companyId}/heartbeat-runs?limit=40`, []),
      fetchPaperclipJson(`/companies/${companyId}/issues`, []),
      fetchPaperclipJson(`/companies/${companyId}/projects`, []),
    ]);

    const reachable = companyResult.ok;
    if (!reachable) {
      return res.status(200).json({
        ...configurationResponsePayload(metadata),
        state: 'unreachable',
        error: companyResult.error,
      });
    }

    const company = companyResult.data || {};
    const agents = Array.isArray(agentsResult.data) ? agentsResult.data : [];
    const runs = Array.isArray(runsResult.data) ? runsResult.data : [];
    const issues = Array.isArray(issuesResult.data) ? issuesResult.data : [];
    const projects = Array.isArray(projectsResult.data) ? projectsResult.data : [];

    const cleanAgents = agents.map(agent => ({
      id: agent.id,
      name: agent.name,
      role: agent.role || '',
      title: agent.title || agent.role || '',
      icon: agent.icon || '',
      status: agent.status || 'unknown',
      reportsTo: agent.reportsTo ?? null,
      model: agent.adapterConfig?.model || '',
      provider: agent.adapterConfig?.provider || agent.adapterType || '',
      budgetCents: agent.budgetMonthlyCents ?? 0,
      spentCents: agent.spentMonthlyCents ?? 0,
      lastHeartbeatAt: agent.lastHeartbeatAt || null,
      urlKey: agent.urlKey || '',
    }));
    const agentName = id => cleanAgents.find(agent => agent.id === id)?.name || 'Unknown';
    const activity = runs.slice(0, 16).map(run => {
      const result = run.resultJson;
      const summary = (
        result?.summary ||
        result?.text ||
        String(run.stdoutExcerpt || '').replace(/^\[hermes\][^\n]*\n?/, '').replace(/\n+/g, ' ').slice(0, 140) ||
        run.error ||
        ''
      );
      return {
        id: run.id,
        agent: agentName(run.agentId),
        status: run.status || 'unknown',
        when: run.finishedAt || run.startedAt || run.createdAt || '',
        summary: String(summary).slice(0, 140),
      };
    });

    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recent = runs.filter(run => {
      const timestamp = Date.parse(run.finishedAt || run.startedAt || run.createdAt || '');
      return Number.isFinite(timestamp) && timestamp >= dayAgo;
    });
    const succeeded = recent.filter(run => ['succeeded', 'completed'].includes(run.status)).length;
    const failed = recent.filter(run => ['failed', 'error'].includes(run.status)).length;
    const successRate = succeeded + failed > 0 ? Math.round((succeeded / (succeeded + failed)) * 100) : null;
    const issueByStatus = {};
    for (const issue of issues) {
      const status = issue.status || 'unknown';
      issueByStatus[status] = (issueByStatus[status] || 0) + 1;
    }

    return res.status(200).json({
      state: 'reachable',
      reachable: true,
      refreshMs: metadata.refreshMs,
      workspaceUrl: metadata.workspaceUrl,
      views: metadata.views,
      company: {
        name: company.name || 'Paperclip',
        mission: company.description || '',
        prefix: company.issuePrefix || '',
        brandColor: company.brandColor || null,
        status: company.status || 'unknown',
      },
      stats: {
        agents: cleanAgents.length,
        runs24h: recent.length,
        succeeded,
        failed,
        successRate,
        issues: issues.length,
        doneIssues: issues.filter(issue => issue.status === 'done').length,
        spentCents: Number(company.spentMonthlyCents ?? cleanAgents.reduce((sum, agent) => sum + agent.spentCents, 0)) || 0,
        budgetCents: Number(company.budgetMonthlyCents ?? cleanAgents.reduce((sum, agent) => sum + agent.budgetCents, 0)) || 0,
      },
      agents: cleanAgents,
      activity,
      projects: projects.map(project => {
        const projectIssues = issues.filter(issue => issue.projectId === project.id);
        return {
          name: project.name || 'Project',
          total: projectIssues.length,
          done: projectIssues.filter(issue => issue.status === 'done').length,
        };
      }),
      issueByStatus,
    });
  } catch (error) {
    if (error instanceof PaperclipConfigurationError) {
      return configurationResponse(res, { ...metadata, state: error.state });
    }
    console.error('Paperclip overview failed:', error);
    return res.status(200).json({
      ...configurationResponsePayload(metadata),
      state: 'unreachable',
      error: 'Paperclip overview is unavailable',
    });
  }
}

function configurationResponsePayload(metadata) {
  return {
    reachable: false,
    refreshMs: metadata.refreshMs,
    workspaceUrl: metadata.workspaceUrl || null,
    views: metadata.views,
    company: null,
    stats: null,
    agents: [],
    activity: [],
    projects: [],
    issueByStatus: {},
  };
}
