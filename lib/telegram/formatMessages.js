const LANE_LABELS = {
  'digital-diamond': 'Digital Diamond AI',
  'managed-by-mika': 'Managed by Mika',
  'medai':           'MedAI',
  'cannaops':        'CannaOps',
  'hotel-hooker':    'The Hotel Hooker',
  'ai-twin':         'AI Twin Content Studio',
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function formatQueuedMessage(task) {
  const label   = LANE_LABELS[task.lane] || task.lane;
  const preview = task.description.length > 80
    ? task.description.slice(0, 80) + '...'
    : task.description;
  return [
    '<b>New Task Queued</b>',
    '',
    `Lane:     ${label}`,
    `Type:     ${task.taskType}`,
    `Priority: ${task.priority}`,
    `Status:   QUEUED`,
    '',
    `<i>${escapeHtml(preview)}</i>`,
    '',
    'Open Mika Mission Control to approve.',
  ].join('\n');
}

export function formatApprovedMessage(entry) {
  const label = LANE_LABELS[entry.laneId] || entry.laneId;
  return [
    '<b>Task Approved — Ready for Dispatch</b>',
    '',
    `Lane:  ${label}`,
    `Task:  ${escapeHtml(entry.title)}`,
    '',
    'Open Mika Mission Control to dispatch.',
  ].join('\n');
}

export function formatCompletedMessage(task, reply, error, finalStatus) {
  const label = LANE_LABELS[task.lane] || task.lane;
  if (finalStatus === 'failed' || error) {
    const errText = (error || 'Unknown error').slice(0, 150);
    return [
      '<b>Task Failed</b>',
      '',
      `Lane:  ${label}`,
      `Type:  ${task.taskType}`,
      `Error: ${escapeHtml(errText)}`,
    ].join('\n');
  }
  const replyText = reply
    ? reply.slice(0, 200) + (reply.length > 200 ? '...' : '')
    : 'No response';
  return [
    '<b>Task Completed</b>',
    '',
    `Lane:  ${label}`,
    `Type:  ${task.taskType}`,
    '',
    `<i>${escapeHtml(replyText)}</i>`,
  ].join('\n');
}
