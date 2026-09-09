// Covers: task:1, task:2
import { describe, expect, it } from 'vitest';
import {
  PLAN_TASK_HARD_STOP_BOUNDARY,
  PLAN_TASK_WARNING_BOUNDARY,
  classifyPlanTaskCount,
  validatePlanTaskCount,
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

describe('validatePlanTaskCount', () => {
  it('reports an unauthorized hard-stop plan with no declaration', () => {
    expect(validatePlanTaskCount(planWithTasks(PLAN_TASK_HARD_STOP_BOUNDARY))).toEqual({
      kind: 'unauthorized',
      taskCount: PLAN_TASK_HARD_STOP_BOUNDARY,
    });
  });

  it('authorizes one non-empty scope-exception rationale', () => {
    expect(validatePlanTaskCount(`${planWithTasks(PLAN_TASK_HARD_STOP_BOUNDARY)}

**Scope-exception:** The tasks must land together to preserve one atomic migration.`)).toEqual({
      kind: 'authorized',
      rationale: 'The tasks must land together to preserve one atomic migration.',
    });
  });

  it.each([
    ['an empty rationale', '**Scope-exception:**'],
    ['a whitespace-only rationale', '**Scope-exception:**   \t '],
    ['duplicate declarations', '**Scope-exception:** First reason.\n**Scope-exception:** Second reason.'],
  ])('reports a malformed declaration for %s', (_caseName, declaration) => {
    expect(validatePlanTaskCount(`${planWithTasks(PLAN_TASK_HARD_STOP_BOUNDARY)}

${declaration}`)).toEqual({
      kind: 'malformed',
      taskCount: PLAN_TASK_HARD_STOP_BOUNDARY,
    });
  });

  it.each([
    ['without a declaration', planWithTasks(PLAN_TASK_HARD_STOP_BOUNDARY - 1)],
    ['with a declaration', `${planWithTasks(PLAN_TASK_HARD_STOP_BOUNDARY - 1)}

**Scope-exception:** Inert below the hard-stop boundary.`],
  ])('leaves a below-boundary plan alone %s', (_caseName, plan) => {
    expect(validatePlanTaskCount(plan)).toBeUndefined();
  });
});
