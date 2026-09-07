import { parsePlanTaskBodies, TASK_ID_PATTERN } from '../plan-task-parse.js';
import { sectionBody, splitStoryBlocks } from '../story-criteria.js';

const TASK_TRAILER_LINE = new RegExp(`^Task: ${TASK_ID_PATTERN}$`);

function subjectFor(idea: string): string {
  return `spec: land authored artifacts for "${idea}" [engineer/land]`;
}

/** Compose the human-readable commit message for a landed DECIDE artifact set. */
export function composeSpecCommitMessage(
  idea: string,
  track: string,
  tier: string | undefined,
  storiesText: string,
  planText: string,
): string {
  const sections: string[] = [];
  const summary = sectionBody(planText, /^Summary$/i)
    ?.split('\n')
    .filter((line) => !TASK_TRAILER_LINE.test(line))
    .join('\n')
    .trim();
  if (summary) sections.push(`Summary:\n${summary}`);

  if (track) sections.push(`Track: ${track}${tier ? `; Tier: ${tier}` : ''}`);

  const stories = splitStoryBlocks(storiesText)
    .filter((block) => block.id)
    .map((block) => block.text.split('\n')[0]?.replace(/^##\s+/, '').trim())
    .filter((heading): heading is string => Boolean(heading));
  if (stories.length > 0) sections.push(`Stories:\n${stories.map((heading) => `- ${heading}`).join('\n')}`);

  const taskIds = [...parsePlanTaskBodies(planText).keys()];
  if (taskIds.length > 0) {
    sections.push(`Tasks: ${taskIds.length}\n${taskIds.map((id) => `- Task ${id}`).join('\n')}`);
  }

  return [subjectFor(idea), ...sections].join('\n\n');
}
