import { loadConfig } from '../../../lib/config-loader';

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { agents, projects } = loadConfig();

  const projectMap = Object.fromEntries(projects.map(p => [p.id, p]));
  const nodes = [];
  const links = [];

  // Project nodes
  for (const p of projects) {
    nodes.push({
      id:    `project:${p.id}`,
      name:  p.label,
      type:  'project',
      color: p.color,
      val:   8,
      icon:  p.icon,
      description: p.description,
    });
  }

  // Agent nodes
  for (const agent of agents) {
    const projColor = projectMap[agent.project]?.color || '#c9a84c';
    nodes.push({
      id:           `agent:${agent.id}`,
      name:         agent.label,
      type:         'agent',
      color:        projColor,
      val:          5 + (agent.capabilities?.length || 0) * 0.4,
      description:  agent.description,
      model:        agent.model,
      capabilities: agent.capabilities || [],
      systemType:   agent.systemType,
      project:      agent.project,
      schedule:     agent.schedule,
    });

    // Agent → project
    if (agent.project && projectMap[agent.project]) {
      links.push({
        source:    `agent:${agent.id}`,
        target:    `project:${agent.project}`,
        type:      'member',
        color:     `${projColor}50`,
      });
    }

    // OpenClaw orchestrates openclaw-type agents
    if (agent.systemType === 'openclaw') {
      links.push({
        source: `agent:openclaw`,
        target: `agent:${agent.id}`,
        type:   'orchestrates',
        color:  'rgba(201,168,76,0.25)',
      });
    }
  }

  // Hermes research handoff → OpenClaw synthesis
  links.push({
    source: `agent:hermes`,
    target: `agent:openclaw`,
    type:   'handoff',
    color:  'rgba(167,139,250,0.4)',
  });

  return res.status(200).json({ nodes, links });
}
