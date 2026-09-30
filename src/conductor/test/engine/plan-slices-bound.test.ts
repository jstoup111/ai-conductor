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

function sliceRows(count: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    const position = index + 1;
    const taskIds = position === count
      ? Array.from({ length: 7 - position }, (_, taskIndex) => position + taskIndex).join(', ')
      : String(position);
    return `| ${position} | Slice ${position} | ${taskIds} |`;
  });
}

describe('plan slice bound', () => {
  it('exports a fixed bound, keeps the validator configuration-free, and enforces that bound', () => {
    expect(MAX_PLAN_SLICES).toBe(5);
    expect(validatePlanSlices).toHaveLength(1);

    const withinBound = validatePlanSlices(slicedPlan(sliceRows(MAX_PLAN_SLICES)));
    expect(withinBound).toMatchObject({ kind: 'sliced' });
    expect(withinBound.kind === 'sliced' && withinBound.slices).toHaveLength(5);

    const result = validatePlanSlices(slicedPlan(sliceRows(MAX_PLAN_SLICES + 1)));
    expect(result).toMatchObject({ kind: 'invalid' });
    expect(result.kind === 'invalid' && result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'max-slices',
        message: expect.stringContaining('plan declares 6 slices and the bound is 5'),
      }),
    ]));
  });

  it('accepts one slice holding every task', () => {
    expect(validatePlanSlices(slicedPlan(['| 1 | Everything | 1, 2, 3, 4, 5, 6 |']))).toMatchObject({ kind: 'sliced' });
  });

  it('aggregates the slice bound and an empty slice into one invalid result', () => {
    const result = validatePlanSlices(slicedPlan([
      ...sliceRows(MAX_PLAN_SLICES + 1).slice(0, 4),
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
