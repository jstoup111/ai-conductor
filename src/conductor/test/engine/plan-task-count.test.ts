// Covers: task:1
import { describe, expect, it } from 'vitest';
import {
  PLAN_TASK_HARD_STOP_BOUNDARY,
  PLAN_TASK_WARNING_BOUNDARY,
  classifyPlanTaskCount,
} from '../../src/engine/plan-task-count.js';

function planWithTasks(taskCount: number): string {
  return Array.from(
    { length: taskCount },
    (_, index) => `### Task ${index + 1}: Task ${index + 1}`,
  ).join('\n\n');
}

describe('classifyPlanTaskCount', () => {
  it.each([
    ['one below the warning boundary', PLAN_TASK_WARNING_BOUNDARY - 1, 'normal'],
    ['exactly at the warning boundary', PLAN_TASK_WARNING_BOUNDARY, 'warning'],
    ['exactly at the hard-stop boundary', PLAN_TASK_HARD_STOP_BOUNDARY, 'hard-stop'],
    ['above the hard-stop boundary', PLAN_TASK_HARD_STOP_BOUNDARY + 1, 'hard-stop'],
  ] as const)('classifies a plan %s', (_caseName, taskCount, band) => {
    expect(classifyPlanTaskCount(planWithTasks(taskCount))).toEqual({ taskCount, band });
  });

  it('does not count task headings inside fenced code blocks', () => {
    const plan = `${planWithTasks(PLAN_TASK_WARNING_BOUNDARY - 1)}

\`\`\`markdown
${planWithTasks(PLAN_TASK_HARD_STOP_BOUNDARY)}
\`\`\``;

    expect(classifyPlanTaskCount(plan)).toEqual({
      taskCount: PLAN_TASK_WARNING_BOUNDARY - 1,
      band: 'normal',
    });
  });

  it('counts each id in a comma-listed task heading', () => {
    expect(classifyPlanTaskCount('### Task 1, 2, 3: Shared task')).toEqual({
      taskCount: 3,
      band: 'normal',
    });
  });
});
