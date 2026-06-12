// lib/ContentSkillsRegistry.js
// Static definitions for the Content Division pipeline stages, skills, and workflow steps.
// This is architecture-only — skills listed here are not yet implemented.

export const PIPELINE_STAGES = [
  { id: 'trend',      label: 'TREND',      icon: '◉', color: '#10b981', agent: 'trend-hunter',      description: 'Discover trending topics and opportunities' },
  { id: 'research',   label: 'RESEARCH',   icon: '◎', color: '#3b82f6', agent: 'pattern-hunter',    description: 'Analyze viral patterns and structures'       },
  { id: 'hooks',      label: 'HOOKS',      icon: '◆', color: '#c9a84c', agent: 'hook-engineer',     description: 'Engineer scroll-stopping hooks and openings'  },
  { id: 'script',     label: 'SCRIPT',     icon: '◳', color: '#c9a84c', agent: 'content-architect', description: 'Write full scripts and outlines'              },
  { id: 'visuals',    label: 'VISUALS',    icon: '◈', color: '#818cf8', agent: 'visual-designer',   description: 'Create visual concepts and AI image prompts'  },
  { id: 'video',      label: 'VIDEO',      icon: '▷', color: '#f472b6', agent: 'video-producer',    description: 'Generate video via AI providers'              },
  { id: 'editing',    label: 'EDITING',    icon: '◭', color: '#f59e0b', agent: 'editor',            description: 'Assemble and polish final content'            },
  { id: 'publishing', label: 'PUBLISH',    icon: '◉', color: '#0dd3c5', agent: 'publisher',         description: 'Schedule and distribute across platforms'     },
  { id: 'analytics',  label: 'ANALYTICS',  icon: '◆', color: '#10b981', agent: 'analytics-agent',   description: 'Track performance and extract insights'       },
  { id: 'repurpose',  label: 'REPURPOSE',  icon: '↺', color: '#c9a84c', agent: 'content-architect', description: 'Transform one piece into many formats'        },
];

export const CONTENT_SKILLS = [
  { id: 'viral-content-workflow', name: 'Viral Content Workflow',   status: 'planned',  category: 'workflow'    },
  { id: 'trend-hunter',           name: 'Trend Hunter',             status: 'planned',  category: 'research'    },
  { id: 'pattern-hunter',         name: 'Pattern Hunter',           status: 'planned',  category: 'research'    },
  { id: 'creator-research',       name: 'Creator Research',         status: 'planned',  category: 'research'    },
  { id: 'hook-engineer',          name: 'Hook Engineer',            status: 'planned',  category: 'creation'    },
  { id: 'content-architect',      name: 'Content Architect',        status: 'planned',  category: 'creation'    },
  { id: 'image-prompt-generator', name: 'Image Prompt Generator',   status: 'planned',  category: 'generation'  },
  { id: 'caption-generator',      name: 'Caption Generator',        status: 'planned',  category: 'creation'    },
  { id: 'repurposing-engine',     name: 'Repurposing Engine',       status: 'planned',  category: 'workflow'    },
  { id: 'higgsfield-director',    name: 'Higgsfield Director',      status: 'planned',  category: 'video'       },
  { id: 'veo-director',           name: 'Veo Director',             status: 'planned',  category: 'video'       },
  { id: 'kling-director',         name: 'Kling Director',           status: 'planned',  category: 'video'       },
  { id: 'heygen-director',        name: 'HeyGen Director',          status: 'planned',  category: 'video'       },
  { id: 'video-router',           name: 'Video Router',             status: 'planned',  category: 'routing'     },
];

export const VIRAL_CONTENT_WORKFLOW_STEPS = [
  { step: 1, id: 'trend-discovery',  label: 'Trend Discovery',  agent: 'trend-hunter',      output: 'Scored trend list'         },
  { step: 2, id: 'trend-scoring',    label: 'Trend Scoring',    agent: 'pattern-hunter',    output: 'Viral opportunity ranking' },
  { step: 3, id: 'hook-generation',  label: 'Hook Generation',  agent: 'hook-engineer',     output: 'Hook batch ×10'            },
  { step: 4, id: 'content-creation', label: 'Content Creation', agent: 'content-architect', output: 'Full script'               },
  { step: 5, id: 'video-creation',   label: 'Video Creation',   agent: 'video-producer',    output: 'Rendered video'            },
  { step: 6, id: 'publishing',       label: 'Publishing',       agent: 'publisher',         output: 'Published post'            },
  { step: 7, id: 'analytics',        label: 'Analytics',        agent: 'analytics-agent',   output: 'Performance report'        },
  { step: 8, id: 'repurposing',      label: 'Repurposing',      agent: 'content-architect', output: 'Repurposed batch'          },
];
