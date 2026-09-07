import { parsePlanTaskBodies } from '../plan-task-parse.js';
import { sectionBody, splitStoryBlocks } from '../story-criteria.js';

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
  const summary = sectionBody(planText, /^Summary$/i)?.trim();
  if (summary) sections.push(`Summary:\n${summary}`);

  sections.push(`Track: ${track}${tier ? `; Tier: ${tier}` : ''}`);

  const stories = splitStoryBlocks(storiesText)
    .map((block) => block.text.split('\n')[0]?.replace(/^##\s+/, '').trim())
    .filter((heading): heading is string => Boolean(heading));
  if (stories.length > 0) sections.push(`Stories:\n${stories.map((heading) => `- ${heading}`).join('\n')}`);

  const taskIds = [...parsePlanTaskBodies(planText).keys()];
  if (taskIds.length > 0) {
    sections.push(`Tasks: ${taskIds.length}\n${taskIds.map((id) => `- Task ${id}`).join('\n')}`);
  }

  return [subjectFor(idea), ...sections].join('\n\n');
}
