import { parsePlanTaskBodies, TASK_TRAILER_LINE_PATTERN } from '../plan-task-parse.js';
import { sectionBody, splitStoryBlocks } from '../story-criteria.js';

/**
 * The trailer grammar the build evidence reader accepts, applied here as a
 * filter so no line copied out of artifact text can be read back as task
 * routing evidence. Lines are trimmed before the test because the reader's
 * fast-feedback path trims too, and because Git message cleanup removes the
 * trailing horizontal whitespace that would otherwise disguise the line.
 */
const TASK_TRAILER_LINE = new RegExp(TASK_TRAILER_LINE_PATTERN);

function isTrailerShaped(line: string): boolean {
  return TASK_TRAILER_LINE.test(line.trim());
}

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
    .filter((line) => !isTrailerShaped(line))
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
