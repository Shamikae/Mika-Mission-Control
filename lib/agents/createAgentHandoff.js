export function createAgentHandoff({
  sourceAgent = 'mika-mission-control',
  targetAgent,
  businessLane,
  taskType,
  instructions,
  contextSummary = '',
  expectedOutput = '',
  returnToOpenClaw = true,
}) {
  return {
    handoffId:      `handoff-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sourceAgent,
    targetAgent,
    businessLane,
    taskType,
    instructions,
    contextSummary,
    expectedOutput,
    returnToOpenClaw,
    createdAt: new Date().toISOString(),
  };
}
