// Covers: task:6
import { describe, expect, it } from 'vitest';
import { validatePlanSlices } from '../../src/engine/plan-slices.js';

function task(id: number | string): string {
  return `### Task ${id}: Task ${id}\n**Dependencies:** none`;
}

function plan(rows: string[]): string {
  return [
    '# Plan',
    '',
    '## Slices',
    '',
    '| Slice | Title | Tasks |',
    '| --- | --- | --- |',
    ...rows,
    '',
    ...[1, 2, 3, 4, 5, 6].map(task),
  ].join('\n');
}

function violations(planText: string) {
  const result = validatePlanSlices(planText);
  expect(result.kind).toBe('invalid');
  if (result.kind !== 'invalid') throw new Error('expected invalid plan slices');
  return result.violations;
}

describe('validatePlanSlices membership', () => {
  it('accepts a clean manifest with every task owned once', () => {
    expect(validatePlanSlices(plan([
      '| 1 | First | 1, 2, 3 |',
      '| 2 | Second | 4 (landed), 5, 6 |',
    ]))).toMatchObject({ kind: 'sliced' });
  });

  it('collects Task 6 when no slice owns it', () => {
    expect(violations(plan(['| 1 | First | 1, 2, 3, 4, 5 |']))).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: '6', message: expect.stringMatching(/Task 6.*no slice/i) }),
    ]));
  });
});
