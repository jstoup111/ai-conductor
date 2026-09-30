// Covers: task:7
import { describe, expect, it } from 'vitest';
import { validatePlanSlices } from '../../src/engine/plan-slices.js';

function task(id: number, dependencies?: string): string {
  return [
    `### Task ${id}: Task ${id}`,
    ...(dependencies === undefined ? [] : [`**Dependencies:** ${dependencies}`]),
  ].join('\n');
}

function plan(dependencies: Record<number, string | undefined>): string {
  return [
    '# Plan',
    '',
    '## Slices',
    '',
    '| Slice | Title | Tasks |',
    '| --- | --- | --- |',
    '| 1 | First | 1, 2, 3 |',
    '| 2 | Second | 4, 5, 6 |',
    '| 3 | Third | 7, 8, 9 |',
    '',
    ...Array.from({ length: 9 }, (_, index) => {
      const id = index + 1;
      return task(id, Object.hasOwn(dependencies, id) ? dependencies[id] : 'none');
    }),
  ].join('\n');
}

function violations(planText: string) {
  const result = validatePlanSlices(planText);
  expect(result.kind).toBe('invalid');
  if (result.kind !== 'invalid') throw new Error('expected invalid plan slices');
  return result.violations;
}

describe('validatePlanSlices Dependencies', () => {
  it('leaves unsliced plans free to use prose Dependencies', () => {
    expect(validatePlanSlices(task(1, 'all prior.'))).toEqual({ kind: 'unsliced' });
  });

  it('accepts none, same-or-earlier dependencies, and annotated plural references', () => {
    expect(validatePlanSlices(plan({
      1: 'none',
      2: 'Task 1',
      3: 'Tasks 1, Task 2',
      4: 'Tasks 1 (prepared), Task 2 (reviewed), 3',
      5: 'Task 4',
      6: 'none',
      7: 'Tasks 1, 4, Task 6',
      8: 'Task 7',
      9: 'none',
    }))).toMatchObject({ kind: 'sliced' });
  });

  it.each([
    ['a range', 'Tasks 1–5', /malformed Dependencies/i],
    ['prose', 'all prior.', /malformed Dependencies/i],
    ['an unknown task', 'Task 20', /Task 20.*unknown/i],
  ])('refuses $0 Dependencies', (_name, dependencies, message) => {
    expect(violations(plan({ 4: dependencies }))).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: '4', message: expect.stringMatching(message) }),
    ]));
  });

  it('requires exactly one Dependencies line for every non-remediation task', () => {
    expect(violations(plan({ 4: undefined }))).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: '4', message: expect.stringMatching(/exactly one Dependencies/i) }),
    ]));
  });

  it('refuses Task 2 depending on Task 7 in a later slice', () => {
    expect(violations(plan({ 2: 'Task 7' }))).toEqual(expect.arrayContaining([
      expect.objectContaining({
        taskId: '2',
        message: expect.stringMatching(/Task 2.*slice 1.*Task 7.*slice 3/i),
      }),
    ]));
  });
});
