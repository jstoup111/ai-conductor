// Covers: task:8
import { describe, expect, it } from 'vitest';
import { MAX_PLAN_SLICES, validatePlanSlices } from '../../src/engine/plan-slices.js';

function task(id: number): string {
  return `### Task ${id}: Task ${id}\n**Dependencies:** none`;
}

function slicedPlan(rows: string[], taskCount = 6): string {
  return [
    '# Plan',
    '',
    '## Slices',
    '',
    '| Slice | Title | Tasks |',
    '| --- | --- | --- |',
    ...rows,
    '',
    ...Array.from({ length: taskCount }, (_, index) => task(index + 1)),
  ].join('\n');
}

const fiveSlices = [
  '| 1 | First | 1 |',
  '| 2 | Second | 2 |',
  '| 3 | Third | 3 |',
  '| 4 | Fourth | 4 |',
  '| 5 | Fifth | 5, 6 |',
];

const sixSlices = [
  '| 1 | First | 1 |',
  '| 2 | Second | 2 |',
  '| 3 | Third | 3 |',
  '| 4 | Fourth | 4 |',
  '| 5 | Fifth | 5 |',
  '| 6 | Sixth | 6 |',
];

describe('plan slice bound', () => {
  it('exports a fixed bound and keeps the validator configuration-free', () => {
    expect(MAX_PLAN_SLICES).toBe(5);
    expect(validatePlanSlices).toHaveLength(1);
  });

  it('accepts exactly five slices and one slice holding every task', () => {
    expect(validatePlanSlices(slicedPlan(fiveSlices))).toMatchObject({ kind: 'sliced' });
    expect(validatePlanSlices(slicedPlan(['| 1 | Everything | 1, 2, 3, 4, 5, 6 |']))).toMatchObject({ kind: 'sliced' });
  });

  it('refuses six otherwise well-formed slices with the declared count and bound', () => {
    const result = validatePlanSlices(slicedPlan(sixSlices));

    expect(result).toMatchObject({ kind: 'invalid' });
    expect(result.kind === 'invalid' && result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'max-slices',
        message: expect.stringContaining('plan declares 6 slices and the bound is 5'),
      }),
    ]));
  });

  it('aggregates the slice bound and an empty slice into one invalid result', () => {
    const result = validatePlanSlices(slicedPlan([
      ...sixSlices.slice(0, 4),
      '| 5 | Fifth | |',
      '| 6 | Sixth | 5, 6 |',
    ]));

    expect(result).toMatchObject({ kind: 'invalid' });
    expect(result.kind === 'invalid' && result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'max-slices', message: expect.stringContaining('bound is 5') }),
      expect.objectContaining({ code: 'empty-slice', position: 5 }),
    ]));
  });
});
